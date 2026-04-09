// ============================================================
// Checkbox Connector
// ПРРО: фіскальні чеки
// Docs: https://docs.checkbox.ua/
// Rate limit: TBD in Stage 0
//
// AUTH — двоступенева:
//   1. X-License-Key = ліцензія каси (24 hex chars) → validate device (/cash-registers/info)
//   2. POST /cashier/signin {login, password} → access_token → receipts (Authorization: Bearer)
//
// ⚠️ Stage 0 findings (2026-04-09):
//   - endpoint: /cashier/signin (lowercase, NOT /cashier/signIn — 404!)
//   - receipts auth: Authorization: Bearer {access_token} (NOT X-Access-Token — 403!)
//   - total_sum in KOPECKS (divide by 100 for UAH)
//   - /receipts returns only current cashier's receipts (current shift only)
//     Historical data: needs /reports or web export
//   - Терещук cashier login = username (not email format), password = same as login
//
// CREDENTIALS:
//   credentials.token                = X-License-Key (hex 24 chars)
//   credentials.extra.cashier_login  = логін касира (username or email)
//   credentials.extra.cashier_password = пароль касира
// ============================================================

import type { ConnectorCredentials, FetchParams, FiscalReceipt, PaymentType, TransactionType } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorResult,
  withRetry,
} from '../base'

// ------ Raw API shapes (populated from real API in Stage 0) ------

export interface CheckboxReceiptRaw {
  id: string
  fiscal_code: string
  serial: number
  status: string
  // Payment info
  payments: Array<{
    type: string   // 'CASHLESS' | 'CASH' | ...
    value: number  // in kopecks (ділити на 100)
    label: string
  }>
  // Total
  total_sum: number  // in kopecks
  // Timestamps
  created_at: string
  fiscal_date: string | null
  // Type
  type: string   // 'SELL' | 'RETURN' | 'SERVICE_IN' | 'SERVICE_OUT'
  // Raw goods
  goods: Array<{
    good: { name: string; price: number }
    quantity: number
    total_sum: number
  }>
  // TODO Stage 0: identify field for EN-номер if present
  [key: string]: unknown
}

// ------ Payment type mapping (preliminary — verify in Stage 0) ------

function mapPaymentType(payments: CheckboxReceiptRaw['payments']): PaymentType {
  if (!payments?.length) return 'unknown'
  const labels = payments.map((p) => p.label?.toLowerCase() ?? '')
  const types = payments.map((p) => p.type?.toUpperCase() ?? '')

  if (labels.some((l) => l.includes('novapay') || l.includes('нп'))) return 'novapay'
  if (labels.some((l) => l.includes('liqpay'))) return 'liqpay'
  if (labels.some((l) => l.includes('rozetka'))) return 'rozetka_pay'
  if (labels.some((l) => l.includes('prom'))) return 'prom'
  if (types.some((t) => t === 'CASH')) return 'cash'
  if (types.some((t) => t === 'CASHLESS')) return 'terminal'
  return 'unknown'
}

function mapTransactionType(type: string): TransactionType {
  return type === 'RETURN' ? 'return' : 'sale'
}

// ------ Normalizer ------

function normalize(
  raw: CheckboxReceiptRaw,
  business_entity_id: string,
  tenant_id: string,
): Omit<FiscalReceipt, 'id' | 'status' | 'needs_review' | 'created_at'> {
  return {
    business_entity_id,
    tenant_id,
    source: 'checkbox',
    external_id: raw.id,
    receipt_number: raw.fiscal_code ?? null,
    fiscal_date: raw.fiscal_date ?? raw.created_at,
    amount: raw.total_sum / 100,
    payment_type: mapPaymentType(raw.payments),
    transaction_type: mapTransactionType(raw.type),
    raw_data: raw,
  }
}

// ------ Cashier token cache ------

interface CashierTokenCache {
  access_token: string
  expires_at: number
}

const cashierTokenCache = new Map<string, CashierTokenCache>()

async function getCashierToken(credentials: ConnectorCredentials): Promise<string> {
  const cacheKey = credentials.token  // license key as cache key
  const cached = cashierTokenCache.get(cacheKey)

  if (cached && cached.expires_at > Date.now() + 60_000) {
    return cached.access_token
  }

  const login = credentials.extra?.cashier_login
  const password = credentials.extra?.cashier_password
  if (!login || !password) {
    throw new ConnectorError('checkbox', 'Missing cashier_login or cashier_password in credentials.extra')
  }

  // IMPORTANT: password is in memory only — never log
  // ⚠️ Stage 0: endpoint is /cashier/signin (lowercase!) — /signIn returns 404
  const res = await fetch(`${BASE_URL}/cashier/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  })

  if (res.status === 401 || res.status === 403) throw new ConnectorAuthError('checkbox')
  if (!res.ok) throw new ConnectorError('checkbox', `Cashier signIn failed: ${res.status}`)

  const data = await res.json()
  const token: string = data.token ?? data.access_token
  if (!token) throw new ConnectorError('checkbox', 'No token in cashier signIn response')

  // Checkbox cashier tokens are session-based — cache for 8h
  cashierTokenCache.set(cacheKey, {
    access_token: token,
    expires_at: Date.now() + 8 * 60 * 60 * 1000,
  })

  return token
}

// ------ Connector ------

const BASE_URL = 'https://api.checkbox.ua/api/v1'

export class CheckboxConnector
  implements BaseConnector<CheckboxReceiptRaw, ReturnType<typeof normalize>>
{
  readonly source = 'checkbox'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    // Step 1: validate license key via /cash-registers/info (no cashier signIn needed)
    const res = await fetch(`${BASE_URL}/cash-registers/info`, {
      headers: { 'X-License-Key': credentials.token },
    })
    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
    if (!res.ok) throw new ConnectorError(this.source, `validate failed: ${res.status}`)
    // Note: cashier signIn will be tested in Stage 2 when cashier_login/password collected
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<CheckboxReceiptRaw, ReturnType<typeof normalize>>> {
    const receipts = await withRetry(
      () => this.fetchAllPages(credentials, params),
      this.source,
    )

    return {
      raw: receipts,
      normalized: receipts.map((r) =>
        normalize(r, params.business_entity_id, params.tenant_id),
      ),
      fetched: receipts.length,
      fetched_at: new Date().toISOString(),
    }
  }

  private async fetchAllPages(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<CheckboxReceiptRaw[]> {
    const cashierToken = await getCashierToken(credentials)
    const results: CheckboxReceiptRaw[] = []
    let offset = 0
    const limit = 100  // TODO Stage 0: confirm max page size from real API

    while (true) {
      const url = new URL(`${BASE_URL}/receipts`)
      url.searchParams.set('from_date', params.date_from.toISOString())
      url.searchParams.set('to_date', params.date_to.toISOString())
      url.searchParams.set('limit', String(limit))
      url.searchParams.set('offset', String(offset))

      // ⚠️ Stage 0: receipts require Authorization: Bearer (NOT X-Access-Token — returns 403)
      const res = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${cashierToken}`,
          'X-License-Key': credentials.token,
          'Content-Type': 'application/json',
        },
      })

      if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
      if (res.status === 429) throw new ConnectorError(this.source, 'Rate limited')
      if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)

      const data = await res.json() as { results: CheckboxReceiptRaw[]; count: number }
      results.push(...data.results)

      if (results.length >= data.count) break
      offset += limit
    }

    return results
  }
}

export const checkboxConnector = new CheckboxConnector()
