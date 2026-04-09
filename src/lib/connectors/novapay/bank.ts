// ============================================================
// NovaPay Connector — Розрахунковий банк (виписка)
// source = 'novapay_bank'
//
// ⚠️ Stage 0 finding: NovaPay uses SOAP, NOT REST
// SOAP Endpoint: https://business.novapay.ua/Services/ClientAPIService.svc
//
// Operations used here:
//   GetAccountExtract(principal|jwt, account_id, date_from, date_to) → bank statement
//   GetAccountsList → discover account_id
//   GetAccountRest → account balance
//
// Credentials: same structure as novapay_agent.ts
//   credentials.token = principal or jwt
//   credentials.extra.refresh_token = JWT refresh token (Сухарєв type)
//   credentials.extra.client_id = NovaPay client ID
//   credentials.extra.account_id = primary account ID
// ============================================================

import type { BankTransaction, ConnectorCredentials, FetchParams } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorResult,
  withRetry,
} from '../base'
import {
  getNovapayToken,
  getAccountId,
  authFields,
  extractElement,
  extractElements,
  callSoap,
} from './soap-client'

// ------ Raw API shapes (to be verified with live token in Stage 0) ------

export interface NovapayExtractTransactionRaw {
  id?: string
  date?: string
  amount?: number          // + credit, - debit
  description?: string
  reference?: string | null  // may contain BO-number
  type?: string              // 'CREDIT' | 'DEBIT' or similar
  [key: string]: unknown
}

// ------ Normalizer ------

function normalize(
  raw: NovapayExtractTransactionRaw,
  business_entity_id: string,
  tenant_id: string,
): Omit<BankTransaction, 'id' | 'is_matched' | 'created_at'> {
  const amount = raw.amount ?? 0
  return {
    business_entity_id,
    tenant_id,
    source: 'novapay_bank',
    external_id: raw.id ?? String(Date.now()),
    transaction_date: raw.date ?? new Date().toISOString(),
    amount: Math.abs(amount),
    credit_debit: amount >= 0 ? 'CREDIT' : 'DEBIT',
    description: raw.description ?? '',
    // Reference may contain BO-номер for direct matching with agent registries
    reference: raw.reference ?? null,
    currency: 'UAH',
    raw_data: raw,
  }
}

// ------ Connector ------

export class NovapayBankConnector
  implements BaseConnector<NovapayExtractTransactionRaw, ReturnType<typeof normalize>>
{
  readonly source = 'novapay_bank'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    // Validate by attempting GetAccountExtract for today only
    try {
      const { token, tokenType } = await getNovapayToken(credentials)
      const accountId = await getAccountId(credentials)
      const today = new Date().toISOString().slice(0, 10)

      const xml = await callSoap('GetAccountExtract', `
        <tns:GetAccountExtract>
          <tns:request>
            ${authFields(token, tokenType)}
            <tns:account_id>${accountId}</tns:account_id>
            <tns:date_from>${today}</tns:date_from>
            <tns:date_to>${today}</tns:date_to>
          </tns:request>
        </tns:GetAccountExtract>`)

      const result = extractElement(xml, 'result')
      if (result === 'error') throw new ConnectorAuthError(this.source)
    } catch (e) {
      if (e instanceof ConnectorAuthError) throw e
      throw new ConnectorError(this.source, `validate failed: ${(e as Error).message}`)
    }
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<NovapayExtractTransactionRaw, ReturnType<typeof normalize>>> {
    const transactions = await withRetry(
      () => this.fetchExtract(credentials, params),
      this.source,
    )

    return {
      raw: transactions,
      normalized: transactions.map((t) =>
        normalize(t, params.business_entity_id, params.tenant_id),
      ),
      fetched: transactions.length,
      fetched_at: new Date().toISOString(),
    }
  }

  private async fetchExtract(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<NovapayExtractTransactionRaw[]> {
    const { token, tokenType } = await getNovapayToken(credentials)
    const accountId = await getAccountId(credentials)

    const dateFrom = params.date_from.toISOString().slice(0, 10)
    const dateTo = params.date_to.toISOString().slice(0, 10)

    const xml = await callSoap('GetAccountExtract', `
      <tns:GetAccountExtract>
        <tns:request>
          ${authFields(token, tokenType)}
          <tns:account_id>${accountId}</tns:account_id>
          <tns:date_from>${dateFrom}</tns:date_from>
          <tns:date_to>${dateTo}</tns:date_to>
        </tns:request>
      </tns:GetAccountExtract>`)

    const result = extractElement(xml, 'result')
    if (result === 'error') {
      const errStatus = extractElement(xml, 'status') ?? ''
      if (errStatus.includes('auth') || errStatus.includes('token')) {
        throw new ConnectorAuthError(this.source)
      }
      throw new ConnectorError(this.source, `GetAccountExtract error: ${extractElement(xml, 'title') ?? errStatus}`)
    }

    // TODO Stage 0: verify exact response structure from live token
    // Extract transactions from SOAP response XML
    const transactionElements = extractElements(xml, 'transaction')
    if (transactionElements.length > 0) {
      return transactionElements.map((el) => ({
        id: extractElement(el, 'id') ?? undefined,
        date: extractElement(el, 'date') ?? undefined,
        amount: parseFloat(extractElement(el, 'amount') ?? '0'),
        description: extractElement(el, 'description') ?? undefined,
        reference: extractElement(el, 'reference'),
        type: extractElement(el, 'type') ?? undefined,
      }))
    }

    // Alternative: may return as embedded JSON string
    const extractStr = extractElement(xml, 'extract') ?? extractElement(xml, 'GetAccountExtractResult') ?? '[]'
    try {
      const data = JSON.parse(extractStr)
      return Array.isArray(data) ? data : data.items ?? data.transactions ?? []
    } catch {
      return []
    }
  }
}

export const novapayBankConnector = new NovapayBankConnector()
