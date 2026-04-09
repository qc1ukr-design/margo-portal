// ============================================================
// Monobank Connector — Виписка (особистий / корпоративний)
// Docs: https://api.monobank.ua/docs/
// Rate limit: 1 request per 60 seconds per token — strict!
// ============================================================

import type { BankTransaction, ConnectorCredentials, FetchParams } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorRateLimitError,
  ConnectorResult,
  withRetry,
} from '../base'

// ------ Raw API shapes ------

export interface MonobankTransactionRaw {
  id: string             // unique transaction ID
  time: number           // Unix timestamp
  description: string
  mcc: number            // merchant category code
  originalMcc: number
  amount: number         // in minor currency units (kopecks)
  operationAmount: number
  currencyCode: number   // 980 = UAH
  commissionRate: number
  cashbackAmount: number
  balance: number
  hold: boolean
  comment: string | null
  receiptId: string | null
  counterEdrpou: string | null
  counterIban: string | null
  counterName: string | null
}

// ------ Helpers ------

const ISO_CURRENCY: Record<number, string> = { 980: 'UAH', 840: 'USD', 978: 'EUR', 826: 'GBP' }
function currencyCodeToIso(code: number): string {
  return ISO_CURRENCY[code] ?? 'UAH'
}

// ------ Normalizer ------

function normalize(
  raw: MonobankTransactionRaw,
  business_entity_id: string,
  tenant_id: string,
): Omit<BankTransaction, 'id' | 'created_at'> {
  return {
    business_entity_id,
    tenant_id,
    bank: 'monobank',
    external_id: raw.id,
    transaction_date: new Date(raw.time * 1000).toISOString(),
    amount: raw.amount / 100,  // kopecks → UAH
    // ISO 4217: Monobank uses numeric codes (980=UAH, 840=USD, 978=EUR)
    currency: currencyCodeToIso(raw.currencyCode),
    description: raw.description ?? null,
    reference: raw.receiptId ?? null,
    raw_data: raw,
  }
}

// ------ Connector ------

const BASE_URL = 'https://api.monobank.ua'

// Monobank rate limit: 1 req/60s — we wait strictly
const RATE_LIMIT_MS = 61_000

export class MonobankConnector
  implements BaseConnector<MonobankTransactionRaw, ReturnType<typeof normalize>>
{
  readonly source = 'monobank'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    const res = await fetch(`${BASE_URL}/personal/client-info`, {
      headers: this.headers(credentials),
    })
    if (res.status === 401) throw new ConnectorAuthError(this.source)
    if (res.status === 429) throw new ConnectorRateLimitError(this.source, RATE_LIMIT_MS)
    if (!res.ok) throw new ConnectorError(this.source, `validate failed: ${res.status}`)
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<MonobankTransactionRaw, ReturnType<typeof normalize>>> {
    // Monobank API returns max 500 records per 31-day window
    // For longer periods, split into monthly chunks
    const chunks = splitIntoMonthlyChunks(params.date_from, params.date_to)
    const allTransactions: MonobankTransactionRaw[] = []

    for (const [from, to] of chunks) {
      const txns = await withRetry(
        () => this.fetchChunk(credentials, params, from, to),
        this.source,
        // Monobank is strict — single retry with 65s delay
        [RATE_LIMIT_MS],
      )
      allTransactions.push(...txns)

      // Respect rate limit between chunk requests
      if (chunks.indexOf([from, to]) < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS))
      }
    }

    return {
      raw: allTransactions,
      normalized: allTransactions.map((t) =>
        normalize(t, params.business_entity_id, params.tenant_id),
      ),
      fetched: allTransactions.length,
      fetched_at: new Date().toISOString(),
    }
  }

  private async fetchChunk(
    credentials: ConnectorCredentials,
    params: FetchParams,
    from: Date,
    to: Date,
  ): Promise<MonobankTransactionRaw[]> {
    // account = 0 means default account; for multi-account clients pass account ID
    const account = credentials.extra?.account_id ?? '0'
    const url = `${BASE_URL}/personal/statement/${account}/${Math.floor(from.getTime() / 1000)}/${Math.floor(to.getTime() / 1000)}`

    const res = await fetch(url, { headers: this.headers(credentials) })
    if (res.status === 401) throw new ConnectorAuthError(this.source)
    if (res.status === 429) throw new ConnectorRateLimitError(this.source, RATE_LIMIT_MS)
    if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)

    return res.json()
  }

  private headers(credentials: ConnectorCredentials): Record<string, string> {
    // IMPORTANT: token is in memory only — never log this object
    return {
      'X-Token': credentials.token,
    }
  }
}

/** Split date range into ≤31-day chunks (Monobank API limit) */
function splitIntoMonthlyChunks(from: Date, to: Date): [Date, Date][] {
  const chunks: [Date, Date][] = []
  const maxWindowMs = 31 * 24 * 60 * 60 * 1000
  let current = new Date(from)

  while (current < to) {
    const end = new Date(Math.min(current.getTime() + maxWindowMs, to.getTime()))
    chunks.push([new Date(current), end])
    current = new Date(end.getTime() + 1)
  }

  return chunks
}

export const monobankConnector = new MonobankConnector()
