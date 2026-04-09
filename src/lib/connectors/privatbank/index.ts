// ============================================================
// PrivatBank Connector — Корпоративний API (виписка)
// Docs: https://api.privatbank.ua/#p24/businessCards
// Rate limit: TBD in Stage 0
// ============================================================

import type { BankTransaction, ConnectorCredentials, FetchParams } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorResult,
  withRetry,
} from '../base'

// ------ Raw API shapes ------
// PrivatBank business API uses token + card_number / account

export interface PrivatBankTransactionRaw {
  trandate: string       // 'YYYY-MM-DD'
  trantime: string       // 'HH:MM:SS'
  cardamount: string     // e.g. '-500.00 UAH' or '-100.00 USD' (string with currency!)
  restamount: string     // balance after
  description: string
  card: string           // masked card number
  appcode: string        // approval code / reference
  terminal: string       // terminal ID
  [key: string]: unknown
}

// ------ Normalizer ------

function parseAmountAndCurrency(raw: string): { amount: number; currency: string } {
  // PrivatBank returns amounts like '-500.00 UAH' or '+1000.00 USD'
  const match = raw.match(/^([+-]?\d+\.?\d*)\s*([A-Z]{3})?/)
  return {
    amount: match ? parseFloat(match[1]) : 0,
    currency: match?.[2] ?? 'UAH',
  }
}

function normalize(
  raw: PrivatBankTransactionRaw,
  business_entity_id: string,
  tenant_id: string,
): Omit<BankTransaction, 'id' | 'created_at'> {
  const datetime = `${raw.trandate}T${raw.trantime}`
  const { amount, currency } = parseAmountAndCurrency(raw.cardamount)
  return {
    business_entity_id,
    tenant_id,
    bank: 'privatbank',
    external_id: `${raw.trandate}_${raw.appcode}_${raw.card}`,  // TODO Stage 0: confirm unique ID field
    transaction_date: datetime,
    amount,
    currency,
    description: raw.description ?? null,
    reference: raw.appcode ?? null,
    raw_data: raw,
  }
}

// ------ Connector ------

const BASE_URL = 'https://acp.privatbank.ua/api/statements'  // corporate API

export class PrivatBankConnector
  implements BaseConnector<PrivatBankTransactionRaw, ReturnType<typeof normalize>>
{
  readonly source = 'privatbank'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    // PrivatBank token is a signed JWT — validate by requesting today's statement
    const today = new Date().toISOString().slice(0, 10)
    const res = await fetch(
      `${BASE_URL}/transactions/interim?startDate=${today}&endDate=${today}&limit=1`,
      { headers: this.headers(credentials) },
    )
    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
    if (!res.ok) throw new ConnectorError(this.source, `validate failed: ${res.status}`)
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<PrivatBankTransactionRaw, ReturnType<typeof normalize>>> {
    const transactions = await withRetry(
      () => this.fetchStatement(credentials, params),
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

  private async fetchStatement(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<PrivatBankTransactionRaw[]> {
    const results: PrivatBankTransactionRaw[] = []
    let nextId: string | null = null
    const startDate = params.date_from.toISOString().slice(0, 10)
    const endDate = params.date_to.toISOString().slice(0, 10)

    // PrivatBank API uses cursor-based pagination
    while (true) {
      const url = new URL(`${BASE_URL}/transactions/final`)
      url.searchParams.set('startDate', startDate)
      url.searchParams.set('endDate', endDate)
      url.searchParams.set('limit', '100')
      if (nextId) url.searchParams.set('followId', nextId)

      const res = await fetch(url.toString(), { headers: this.headers(credentials) })
      if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
      if (res.status === 429) throw new ConnectorError(this.source, 'Rate limited')
      if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)

      const data = await res.json()
      // TODO Stage 0: verify actual response structure
      const txns: PrivatBankTransactionRaw[] = data.transactions ?? data.StatementsResponse?.statements?.statement ?? []
      results.push(...txns)

      nextId = data.nextPageId ?? null
      if (!nextId || txns.length === 0) break
    }

    return results
  }

  private headers(credentials: ConnectorCredentials): Record<string, string> {
    // IMPORTANT: token is in memory only — never log this object
    return {
      'token': credentials.token,
      'Content-Type': 'application/json;charset=utf8',
    }
  }
}

export const privatBankConnector = new PrivatBankConnector()
