// ============================================================
// Prom.UA Connector — Маркетплейс
// source = 'prom'
// Docs: public-api.docs.prom.ua
// Base URL: https://my.prom.ua/api/v1/
// Auth: Bearer token (статичний, генерується в кабінеті продавця)
// Rate limit: TBD in Stage 0 (рекомендація: polling кожні 5-15 хвилин)
//
// ДВОСТУПЕНЕВИЙ МАТЧИНГ:
//   Крок А (цей конектор): замовлення (дата оплати) → фіскальний чек (ПОВНА сума)
//     match_strategy = 'marketplace_order'
//     Фіскальний чек = ПОВНА сума покупця (включаючи комісію Prom)
//     Orders API → фільтр payment_option=Пром-оплата, status=delivered
//     Ключ зв'язку: дата оплати + сума (повна, до комісії)
//
//   Крок Б (email_imap конектор): реєстр виплат → банківська транзакція (сума ПІСЛЯ комісії)
//     match_strategy = 'marketplace_register'
//     Prom надсилає реєстр виплат на email продавця → переадресація на скриньку Марго
//     IMAP polling → парсинг реєстру → точний матч з банком
//     Банк отримує = order.price * (1 - commission_rate)
//
// Prom-оплата комісії та графік:
//   - Картка (P2P): 3.5%, T+1 після отримання посилки
//   - Поточний рахунок (acquiring): 1.7%, T+8 від оплати (7 днів холд)
//   - ВАЖЛИВО: delta_amount в matches = розмір комісії — це НОРМА, не помилка
//
// Клієнт: Гачава
// ============================================================

import type { ConnectorCredentials, FetchParams } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorResult,
  withRetry,
} from '../base'

// ------ Raw API shapes ------

export interface PromOrderRaw {
  id: number
  date_created: string         // ISO 8601
  status: string               // 'pending' | 'received' | 'delivered' | 'canceled' | 'paid'
  price: string                // total order amount (string!) — потрібно parseFloat
  full_price?: string
  payment_option?: string      // 'Пром-оплата' | 'Наложений платіж' | 'Готівка' etc.
  payment_data?: {             // populated for Пром-оплата orders
    status?: string
    commission?: number | string
    [key: string]: unknown
  } | null
  delivery_option?: string
  delivery_provider_data?: {
    tracking_number?: string   // ТТН відправлення
    [key: string]: unknown
  } | null
  client_first_name?: string
  client_last_name?: string
  products?: Array<{
    id: number
    name: string
    quantity: number
    price: string
    total_price: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}

export interface PromOrdersResponse {
  orders: PromOrderRaw[]
  [key: string]: unknown
}

// ------ Normalizer ------
// Prom orders are normalized for the marketplace matching pipeline,
// NOT into FiscalReceipt (they have no fiscal code).
// They feed the marketplace_fuzzy matching strategy in Stage 3.

export interface PromOrderNormalized {
  business_entity_id: string
  tenant_id: string
  source: 'prom'
  external_id: string          // order.id as string
  order_date: string           // date_created
  gross_amount: number         // order.price (total from buyer)
  // Expected payout (calculated, NOT from API — no payout API exists)
  // TODO Stage 0: verify commission_rate from real data (3.5% card / 1.7% acquiring)
  expected_net_amount: number | null   // null if payment_option != Пром-оплата
  payment_option: string | null
  tracking_number: string | null       // ТТН for delivery tracking
  status: string
  raw_data: PromOrderRaw
}

function normalize(
  raw: PromOrderRaw,
  business_entity_id: string,
  tenant_id: string,
): PromOrderNormalized {
  const grossAmount = parseFloat(raw.price ?? '0') || 0
  const isPromOplata = raw.payment_option?.toLowerCase().includes('пром-оплата')
    || raw.payment_option?.toLowerCase().includes('prom')

  // TODO Stage 0: determine if client uses card (3.5%) or current account (1.7%)
  // Store in credentials.extra.commission_type = 'card' | 'account'
  const commissionRate = 0.035  // default: card commission — verify from real data

  return {
    business_entity_id,
    tenant_id,
    source: 'prom',
    external_id: String(raw.id),
    order_date: raw.date_created,
    gross_amount: grossAmount,
    expected_net_amount: isPromOplata
      ? Math.round(grossAmount * (1 - commissionRate) * 100) / 100
      : null,
    payment_option: raw.payment_option ?? null,
    tracking_number: raw.delivery_provider_data?.tracking_number ?? null,
    status: raw.status,
    raw_data: raw,
  }
}

// ------ Connector ------

const BASE_URL = 'https://my.prom.ua/api/v1'

export class PromConnector
  implements BaseConnector<PromOrderRaw, PromOrderNormalized>
{
  readonly source = 'prom'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    const res = await fetch(`${BASE_URL}/orders/list?limit=1`, {
      headers: this.headers(credentials),
    })
    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
    if (!res.ok) throw new ConnectorError(this.source, `validate failed: ${res.status}`)
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<PromOrderRaw, PromOrderNormalized>> {
    const orders = await withRetry(
      () => this.fetchOrders(credentials, params),
      this.source,
    )

    return {
      raw: orders,
      normalized: orders.map((o) => normalize(o, params.business_entity_id, params.tenant_id)),
      fetched: orders.length,
      fetched_at: new Date().toISOString(),
    }
  }

  private async fetchOrders(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<PromOrderRaw[]> {
    const results: PromOrderRaw[] = []
    const limit = 100
    let lastId: number | null = null

    // TODO Stage 0: verify date filter param names (date_from / created_from / etc.)
    const dateFrom = params.date_from.toISOString()
    const dateTo = params.date_to.toISOString()

    while (true) {
      const url = new URL(`${BASE_URL}/orders/list`)
      url.searchParams.set('date_from', dateFrom)
      url.searchParams.set('date_to', dateTo)
      url.searchParams.set('limit', String(limit))
      if (lastId !== null) url.searchParams.set('last_id', String(lastId))

      const res = await fetch(url.toString(), { headers: this.headers(credentials) })
      if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
      if (res.status === 429) throw new ConnectorError(this.source, 'Rate limited')
      if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)

      const data: PromOrdersResponse = await res.json()
      const orders = data.orders ?? []
      results.push(...orders)

      if (orders.length < limit) break
      // Cursor: next page = orders with id < min(current page ids)
      lastId = Math.min(...orders.map((o) => o.id))
    }

    return results
  }

  private headers(credentials: ConnectorCredentials): Record<string, string> {
    // IMPORTANT: token is in memory only — never log
    return { 'Authorization': `Bearer ${credentials.token}` }
  }
}

export const promConnector = new PromConnector()
