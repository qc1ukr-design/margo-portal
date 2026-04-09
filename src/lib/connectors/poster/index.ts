// ============================================================
// Poster Connector
// ПРРО: фіскальні чеки (альтернатива Checkbox)
// Docs: https://dev.joinposter.com/
// Rate limit: TBD in Stage 0
// Клієнт: Голубов (token format: "account_id:token")
// ============================================================

import type { ConnectorCredentials, FetchParams, FiscalReceipt, PaymentType, TransactionType } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorResult,
  withRetry,
} from '../base'

// ------ Raw API shapes (confirmed Stage 0 on real data 2026-04-08) ------

export interface PosterTransactionRaw {
  transaction_id: number        // receipt/order number (e.g. 4597)
  table_id: number
  spot_id: number               // 1 = DiceNDrip
  client_id: number             // 0 if no loyalty client
  sum: string                   // pre-discount total in UAH (e.g. "135.00")
  payed_sum: string             // actual paid in UAH (e.g. "122.25")
  payed_cash: string            // cash portion UAH (e.g. "0.00")
  payed_card: string            // card portion UAH (e.g. "122.25")
  payed_cert: string            // certificate UAH
  payed_bonus: string           // loyalty bonus UAH
  payed_third_party: string     // third party (LiqPay etc.) UAH
  payed_card_type: number       // card type id
  round_sum: string
  tips_cash: string
  tips_card: string
  pay_type: number              // payment type enum
  reason: number                // 0=sale, 1=return
  tip_sum: string
  bonus: number
  discount: number
  print_fiscal: number          // 1 = fiscal receipt printed
  total_profit: number          // profit in kopecks (e.g. 12225 = 122.25 UAH)
  total_profit_netto: number
  date_close: string            // 'YYYY-MM-DD HH:MM:SS' (when closed/paid)
  products: Array<{
    product_id: number
    modification_id: number
    type: number
    num: number                 // quantity
    product_sum: string         // price per item UAH
    payed_sum: string           // paid for this item UAH
    discount: number
    print_fiscal: number
    tax_id: number
    tax_value: number
    tax_type: number
    tax_fiscal: number
    tax_sum: string
    product_cost: number        // kopecks
    product_profit: number      // kopecks
  }>
  auto_accept: boolean
  application_id: string | null
  [key: string]: unknown
}

// ------ Payment type mapping (confirmed Stage 0 from real data) ------

function mapPaymentType(raw: PosterTransactionRaw): PaymentType {
  const cash = parseFloat(raw.payed_cash) || 0
  const card = parseFloat(raw.payed_card) || 0
  const thirdParty = parseFloat(raw.payed_third_party) || 0

  if (thirdParty > 0) return 'liqpay'      // TODO Stage 0: verify if NovaPay uses this field
  if (card > 0 && cash === 0) return 'terminal'
  if (cash > 0 && card === 0) return 'cash'
  if (cash > 0 && card > 0) return 'mixed'
  return 'unknown'
}

function mapTransactionType(raw: PosterTransactionRaw): TransactionType {
  // TODO Stage 0: verify field and values for returns
  return raw.reason === 1 ? 'return' : 'sale'
}

// ------ Normalizer ------

function normalize(
  raw: PosterTransactionRaw,
  business_entity_id: string,
  tenant_id: string,
): Omit<FiscalReceipt, 'id' | 'status' | 'needs_review' | 'created_at'> {
  return {
    business_entity_id,
    tenant_id,
    source: 'poster',
    external_id: String(raw.transaction_id),
    receipt_number: null,     // Poster API doesn't expose fiscal_code directly
    fiscal_date: raw.date_close,          // 'YYYY-MM-DD HH:MM:SS'
    amount: parseFloat(raw.payed_sum),    // UAH string → float (NOT kopecks)
    payment_type: mapPaymentType(raw),
    transaction_type: mapTransactionType(raw),
    raw_data: raw,
  }
}

// ------ Connector ------

// Poster API uses account subdomain or account_id in token
// Token format from client: "account_id:access_token"
const BASE_URL = 'https://joinposter.com/api'

/** Poster date format: DD.MM.YYYY (NOT Unix, NOT ISO — confirmed Stage 0) */
function formatPosterDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${d}.${m}.${date.getFullYear()}`
}

export class PosterConnector
  implements BaseConnector<PosterTransactionRaw, ReturnType<typeof normalize>>
{
  readonly source = 'poster'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    // Use transactions.getTransactions with DD.MM.YYYY date format (Stage 0 confirmed)
    // Unix timestamps silently return 0 results — must use string dates
    const { token } = this.extractAuth(credentials)
    const yesterday = formatPosterDate(new Date(Date.now() - 86400_000))
    const today = formatPosterDate(new Date())
    const res = await fetch(
      `${BASE_URL}/transactions.getTransactions?token=${token}&date_from=${yesterday}&date_to=${today}&per_page=1`
    )
    if (res.status === 401) throw new ConnectorAuthError(this.source)
    if (!res.ok) throw new ConnectorError(this.source, `validate failed: ${res.status}`)
    const data = await res.json()
    if (data.error === 1 || !('response' in data)) throw new ConnectorAuthError(this.source)
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<PosterTransactionRaw, ReturnType<typeof normalize>>> {
    const transactions = await withRetry(
      () => this.fetchTransactions(credentials, params),
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

  private async fetchTransactions(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<PosterTransactionRaw[]> {
    const { token } = this.extractAuth(credentials)
    const results: PosterTransactionRaw[] = []
    let page = 1
    const perPage = 100

    // CRITICAL: Poster requires DD.MM.YYYY string format.
    // Unix timestamps silently return 0 results (confirmed Stage 0).
    const dateFrom = formatPosterDate(params.date_from)
    const dateTo = formatPosterDate(params.date_to)

    while (true) {
      const url = `${BASE_URL}/transactions.getTransactions?token=${token}&date_from=${dateFrom}&date_to=${dateTo}&per_page=${perPage}&page=${page}`

      const res = await fetch(url)
      if (res.status === 401) throw new ConnectorAuthError(this.source)
      if (res.status === 429) throw new ConnectorError(this.source, 'Rate limited')
      if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)

      const data = await res.json()
      // Response: { response: { count, page: {...}, data: [...] } }
      const pageData = data.response?.data ?? (Array.isArray(data.response) ? data.response : [])
      const txns: PosterTransactionRaw[] = pageData
      results.push(...txns)

      const totalCount: number = data.response?.count ?? 0
      if (txns.length < perPage || results.length >= totalCount) break
      page++
    }

    return results
  }

  /** Poster token format: "account_id:access_token" or just "access_token" */
  private extractAuth(credentials: ConnectorCredentials): { accountId: string | null; token: string } {
    // IMPORTANT: token is in memory only — never log this object
    const parts = credentials.token.split(':')
    if (parts.length === 2) {
      return { accountId: parts[0], token: credentials.token }
    }
    return { accountId: null, token: credentials.token }
  }
}

export const posterConnector = new PosterConnector()
