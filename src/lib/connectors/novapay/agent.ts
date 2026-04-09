// ============================================================
// NovaPay Connector — Платіжний агент (реєстри / виплати)
// source = 'novapay_agent'
//
// ⚠️ Stage 0 finding: NovaPay uses SOAP, NOT REST
// SOAP Endpoint: https://business.novapay.ua/Services/ClientAPIService.svc
// WSDL: https://business.novapay.ua/Services/ClientAPIService.svc?wsdl
// Version: 2.37.2.6 (confirmed)
//
// Operations used here:
//   GetPaymentsList → individual payments (BO-реєстри)
//   GetClientsList → discover client_id (one-time setup)
//   GetAccountsList → discover account_id (one-time setup)
//
// AUTH:
//   credentials.token = principal (OTP-based, session) OR jwt (automated)
//   credentials.extra.refresh_token = JWT refresh token (Сухарєв type)
//   credentials.extra.client_id = NovaPay client ID
//   credentials.extra.account_id = primary account ID
//
// Клієнти: Терещук (principal token, static), Сухарєв (JWT + refresh_token)
// ============================================================

import type { ConnectorCredentials, FetchParams, NovapayRegister, NovapayRegisterLine } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorResult,
  withRetry,
} from '../base'
import {
  getNovapayToken,
  getClientId,
  getAccountId,
  authFields,
  extractElement,
  extractElements,
  callSoap,
} from './soap-client'

// ------ Raw API shapes (from GetPaymentsList SOAP response) ------
// Note: GetPaymentsList returns `payments` as a string (likely embedded JSON/XML)
// Exact field names to be verified with live token in Stage 0

export interface NovapayPaymentRaw {
  payment_id?: string
  bo_number?: string           // BO-номер реєстру (BO-XXXXXXXX)
  en_number?: string           // ТТН (14 цифр)
  amount?: number              // сума від покупця
  commission?: number          // комісія
  amount_transferred?: number  // сума після комісії → надходить ФОП
  payment_date?: string        // ISO дата оплати
  status?: string
  [key: string]: unknown
}

export interface NovapayRegistryRaw {
  registry_id: string
  registry_num: string
  created_at: string
  transferred_at: string
  total_amount: number
  commission: number
  amount_transferred: number
  status: string
  items_count: number
  [key: string]: unknown
}

export interface NovapayRegistryLineRaw {
  en_number: string
  amount_received: number
  commission: number
  amount_transferred: number
  sender_name: string
  recipient_name: string
  payment_date: string
  [key: string]: unknown
}

// ------ Normalizers ------

function normalizeRegistry(
  raw: NovapayRegistryRaw,
  business_entity_id: string,
  tenant_id: string,
): Omit<NovapayRegister, 'id' | 'bank_transaction_id' | 'is_matched' | 'created_at'> {
  return {
    business_entity_id,
    tenant_id,
    registry_id: raw.registry_id ?? raw.registry_num,
    registry_date: raw.created_at.slice(0, 10),
    transferred_at: raw.transferred_at,
    // ⚠️ IMPORTANT: use amount_transferred (after commission), NOT total_amount
    total_amount: raw.amount_transferred,
    raw_data: raw,
  }
}

function normalizeLines(
  lines: NovapayRegistryLineRaw[],
  tenant_id: string,
): Array<Omit<NovapayRegisterLine, 'id' | 'register_id' | 'created_at'>> {
  return lines.map((line) => ({
    tenant_id,
    en_number: line.en_number,
    amount: line.amount_transferred,
    cargo_value: line.amount_received,
    raw_data: line,
  }))
}

// ------ Connector ------

export class NovapayAgentConnector
  implements BaseConnector<NovapayRegistryRaw, ReturnType<typeof normalizeRegistry>>
{
  readonly source = 'novapay_agent'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    // Validate by calling GetClientsList — lightweight, confirms auth works
    try {
      const { token, tokenType } = await getNovapayToken(credentials)
      const xml = await callSoap('GetClientsList', `
        <tns:GetClientsList>
          <tns:request>
            ${authFields(token, tokenType)}
          </tns:request>
        </tns:GetClientsList>`)

      const result = extractElement(xml, 'result')
      if (result === 'error') {
        const errStatus = extractElement(xml, 'status') ?? ''
        if (errStatus.includes('auth') || errStatus.includes('token') || errStatus.includes('principal')) {
          throw new ConnectorAuthError(this.source)
        }
        // Other errors (e.g. expired token) also map to auth error for validate
        throw new ConnectorAuthError(this.source)
      }
    } catch (e) {
      if (e instanceof ConnectorAuthError) throw e
      throw new ConnectorError(this.source, `validate failed: ${(e as Error).message}`)
    }
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<NovapayRegistryRaw, ReturnType<typeof normalizeRegistry>>> {
    const registries = await withRetry(
      () => this.fetchPayments(credentials, params),
      this.source,
    )

    return {
      raw: registries,
      normalized: registries.map((r) =>
        normalizeRegistry(r, params.business_entity_id, params.tenant_id),
      ),
      fetched: registries.length,
      fetched_at: new Date().toISOString(),
    }
  }

  async fetchLines(
    credentials: ConnectorCredentials,
    registry_id: string,
    tenant_id: string,
  ): Promise<ReturnType<typeof normalizeLines>> {
    // TODO Stage 0: verify if GetPaymentsList with specific registry/BO-number
    // or use DownloadRegister to get detailed lines
    return []
  }

  private async fetchPayments(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<NovapayRegistryRaw[]> {
    const { token, tokenType } = await getNovapayToken(credentials)
    const accountId = await getAccountId(credentials)

    const dateFrom = params.date_from.toISOString().slice(0, 10)
    const dateTo = params.date_to.toISOString().slice(0, 10)

    const xml = await callSoap('GetPaymentsList', `
      <tns:GetPaymentsList>
        <tns:request>
          ${authFields(token, tokenType)}
          <tns:account_id>${accountId}</tns:account_id>
          <tns:date_from>${dateFrom}</tns:date_from>
          <tns:date_to>${dateTo}</tns:date_to>
        </tns:request>
      </tns:GetPaymentsList>`)

    const result = extractElement(xml, 'result')
    if (result === 'error') {
      const errStatus = extractElement(xml, 'status') ?? ''
      if (errStatus.includes('auth') || errStatus.includes('token')) {
        throw new ConnectorAuthError(this.source)
      }
      throw new ConnectorError(this.source, `GetPaymentsList error: ${extractElement(xml, 'title') ?? errStatus}`)
    }

    // GetPaymentsList returns `payments` as a string (JSON or XML embedded in SOAP)
    // TODO Stage 0: parse actual structure from live token test
    const paymentsStr = extractElement(xml, 'payments') ?? '[]'
    try {
      const payments = JSON.parse(paymentsStr)
      return Array.isArray(payments) ? payments : payments.items ?? payments.data ?? []
    } catch {
      // If not JSON, return empty (need live token to verify format)
      return []
    }
  }
}

export const novapayAgentConnector = new NovapayAgentConnector()
