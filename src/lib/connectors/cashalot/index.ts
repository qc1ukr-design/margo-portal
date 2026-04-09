// ============================================================
// Cashalot Connector (офіційна назва: Cashälot)
// ПРРО: фіскальні чеки
// Site: cashalot.ua
// Spec: WEB API ПРРО Cashälot v2.0.0.7149 (25.12.2025)
// Docs: cashalot.ua/instructions/api-webapi-cashalot
//
// ⚠️ АРХІТЕКТУРНА ОСОБЛИВІСТЬ:
// Cashalot WEB API — це ЛОКАЛЬНИЙ сервер, встановлений на інфраструктурі клієнта.
// НЕ існує хмарного endpoint типу api.cashalot.ua.
// URL зберігається в credentials.extra.base_url (наприклад: http://192.168.1.10:8080)
//
// Auth: КЕП (кваліфікований електронний підпис) в base64 — Certificate + PrivateKey
//       + Password (пароль до ключа) + NumFiscal (фіскальний номер ПРРО)
//       всі передаються в тілі кожного JSON запиту
//
// Клієнт: Смирнова
// ============================================================

import type { ConnectorCredentials, FetchParams, FiscalReceipt, PaymentType, TransactionType } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorResult,
  withRetry,
} from '../base'

// ------ Raw API shapes (based on WEB API spec v2.0.0.7149) ------

export interface CashalotRequestBase {
  Command: string
  NumFiscal: number       // фіскальний номер ПРРО (реєстраційний номер касового апарата)
  Certificate: string     // КЕП публічний ключ в base64
  PrivateKey: string      // КЕП приватний ключ в base64
  Password: string        // пароль до приватного ключа КЕП
  UID?: string            // опціональний унікальний ідентифікатор запиту
}

export interface CashalotGetChecksRequest extends CashalotRequestBase {
  Command: 'GetChecks'
  DateFrom: string        // 'YYYY-MM-DD' або 'DD.MM.YYYY' — уточнити в Stage 0
  DateTo: string
  Skip?: number           // для пагінації
  Take?: number
}

export interface CashalotCheckRaw {
  CheckLocalNumber: string    // локальний номер чеку
  CheckDateTime: string       // дата/час чека
  TotalSum: number            // загальна сума (уточнити: копійки чи гривні)
  FiscalCode: string | null   // фіскальний номер
  OperationType: number       // 0 = продаж, 1 = повернення (уточнити в Stage 0)
  PayForms: Array<{           // форми оплати
    PayFormCode: number
    PayFormName: string       // 'Готівка', 'Картка', 'NovaPay', тощо
    Sum: number
  }>
  [key: string]: unknown
}

export interface CashalotResponse {
  Status: number              // 0 = OK, інше = помилка
  Message: string | null      // повідомлення про помилку
  Checks?: CashalotCheckRaw[]
  [key: string]: unknown
}

// ------ Credentials structure ------
// credentials.token        = Certificate (КЕП публічний ключ, base64)
// credentials.extra.private_key = PrivateKey (КЕП приватний ключ, base64)
// credentials.extra.password    = Password (пароль до КЕП)
// credentials.extra.num_fiscal  = NumFiscal (фіскальний номер ПРРО, числовий)
// credentials.extra.base_url    = base URL локального WEB API сервера клієнта
//                                 наприклад: http://192.168.1.10:8080

// ------ Payment type mapping (preliminary — verify in Stage 0) ------

function mapPaymentType(payForms: CashalotCheckRaw['PayForms']): PaymentType {
  if (!payForms?.length) return 'unknown'
  const names = payForms.map((p) => p.PayFormName?.toLowerCase() ?? '')
  if (names.some((n) => n.includes('novapay') || n.includes('нп'))) return 'novapay'
  if (names.some((n) => n.includes('liqpay'))) return 'liqpay'
  if (names.some((n) => n.includes('готівка') || n.includes('cash'))) return 'cash'
  if (names.some((n) => n.includes('картка') || n.includes('термінал') || n.includes('card'))) return 'terminal'
  return 'unknown'
}

function mapTransactionType(operationType: number): TransactionType {
  // TODO Stage 0: verify actual values for sale/return
  return operationType === 1 ? 'return' : 'sale'
}

// ------ Normalizer ------

function normalize(
  raw: CashalotCheckRaw,
  business_entity_id: string,
  tenant_id: string,
): Omit<FiscalReceipt, 'id' | 'status' | 'needs_review' | 'created_at'> {
  return {
    business_entity_id,
    tenant_id,
    source: 'cashalot',
    external_id: raw.CheckLocalNumber,
    receipt_number: raw.FiscalCode ?? null,
    fiscal_date: raw.CheckDateTime,
    amount: raw.TotalSum,   // TODO Stage 0: verify if kopecks or UAH
    payment_type: mapPaymentType(raw.PayForms),
    transaction_type: mapTransactionType(raw.OperationType),
    raw_data: raw,
  }
}

// ------ Connector ------

export class CashalotConnector
  implements BaseConnector<CashalotCheckRaw, ReturnType<typeof normalize>>
{
  readonly source = 'cashalot'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    const { baseUrl, ...keys } = this.extractKeys(credentials)
    const res = await this.request(baseUrl, {
      Command: 'GetRegistrarState',
      ...keys,
    })
    if (res.Status !== 0) {
      if (res.Message?.toLowerCase().includes('auth') || res.Status === 401) {
        throw new ConnectorAuthError(this.source)
      }
      throw new ConnectorError(this.source, `validate failed: ${res.Message}`)
    }
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<CashalotCheckRaw, ReturnType<typeof normalize>>> {
    const checks = await withRetry(
      () => this.fetchAllChecks(credentials, params),
      this.source,
    )

    return {
      raw: checks,
      normalized: checks.map((c) =>
        normalize(c, params.business_entity_id, params.tenant_id),
      ),
      fetched: checks.length,
      fetched_at: new Date().toISOString(),
    }
  }

  private async fetchAllChecks(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<CashalotCheckRaw[]> {
    const { baseUrl, ...keys } = this.extractKeys(credentials)
    const results: CashalotCheckRaw[] = []
    const take = 100  // TODO Stage 0: confirm max page size from spec
    let skip = 0

    while (true) {
      const body: CashalotGetChecksRequest = {
        Command: 'GetChecks',
        ...keys,
        DateFrom: params.date_from.toISOString().slice(0, 10),
        DateTo: params.date_to.toISOString().slice(0, 10),
        Skip: skip,
        Take: take,
      }

      const res = await this.request(baseUrl, body)
      if (res.Status !== 0) {
        if (res.Status === 401) throw new ConnectorAuthError(this.source)
        throw new ConnectorError(this.source, `GetChecks failed: ${res.Message}`)
      }

      const checks = res.Checks ?? []
      results.push(...checks)
      if (checks.length < take) break
      skip += take
    }

    return results
  }

  private async request(baseUrl: string, body: Record<string, unknown>): Promise<CashalotResponse> {
    // IMPORTANT: body contains PrivateKey + Password — never log this object
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)
    return res.json()
  }

  private extractKeys(credentials: ConnectorCredentials): {
    baseUrl: string
    Certificate: string
    PrivateKey: string
    Password: string
    NumFiscal: number
  } {
    // IMPORTANT: keys are in memory only — never log this object
    const privateKey = credentials.extra?.private_key
    const password = credentials.extra?.password
    const numFiscal = credentials.extra?.num_fiscal
    const baseUrl = credentials.extra?.base_url

    if (!privateKey) throw new ConnectorError(this.source, 'Missing private_key in credentials.extra')
    if (!password) throw new ConnectorError(this.source, 'Missing password in credentials.extra')
    if (!numFiscal) throw new ConnectorError(this.source, 'Missing num_fiscal in credentials.extra')
    if (!baseUrl) throw new ConnectorError(this.source, 'Missing base_url in credentials.extra (Cashalot runs locally — need client server URL)')

    return {
      baseUrl,
      Certificate: credentials.token,  // КЕП публічний ключ, base64
      PrivateKey: privateKey,           // КЕП приватний ключ, base64
      Password: password,               // пароль до КЕП
      NumFiscal: parseInt(numFiscal, 10),
    }
  }
}

export const cashalotConnector = new CashalotConnector()
