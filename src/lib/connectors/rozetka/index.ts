// ============================================================
// Rozetka Connector — Маркетплейс
// source = 'rozetka_pay' (reusing existing enum value — seller marketplace)
// Docs: https://api-seller.rozetka.com.ua/apidoc/
// Base URL: https://api-seller.rozetka.com.ua
//
// ДВОСТУПЕНЕВИЙ МАТЧИНГ:
//   Крок А (цей конектор): замовлення (дата оплати) → фіскальний чек (ПОВНА сума)
//     match_strategy = 'marketplace_order'
//     Фіскальний чек = ПОВНА сума покупця (включаючи комісію Rozetka)
//
//   Крок Б (email_imap конектор): реєстр виплат → банківська транзакція (сума ПІСЛЯ комісії)
//     match_strategy = 'marketplace_register'
//     Rozetka надсилає реєстр виплат EMAIL → переадресація на скриньку Марго
//     IMAP polling → парсинг реєстру → точний матч з банком
//
// Графік виплат Rozetka:
//   Пн–Чт → наступний робочий день (окремо: готівка і онлайн)
//   Пт–Нд → в понеділок (3 окремі суми)
//   Комісія: 1.5% (стандарт)
//   ВАЖЛИВО: delta_amount в matches = розмір комісії — це НОРМА, не помилка
//
// Auth: login + password → Bearer JWT (24h) — потребує щоденного оновлення!
//   credentials.token = login (email)
//   credentials.extra.password = password (base64)
//   Токен кешується в пам'яті, оновлюється автоматично
//
// ⚠️ RozetkaPay (cdn.rozetkapay.com) = ІНШИЙ сервіс (платіжний шлюз).
//    НЕ стосується виплат від маркетплейсу Rozetka.
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

export interface RozetkaOrderRaw {
  id: number
  status: string               // order status
  created: string              // ISO 8601 datetime
  // Amount fields — TODO Stage 0: verify exact field names from apidoc
  amount?: number              // total order amount
  commission?: number          // commission amount
  [key: string]: unknown
}

export interface RozetkaCommissionRaw {
  item_id: number
  commission: number
  [key: string]: unknown
}

// ------ Token management ------

interface TokenCache {
  access_token: string
  expires_at: number  // Unix ms
}

const tokenCache = new Map<string, TokenCache>()

async function getAccessToken(credentials: ConnectorCredentials): Promise<string> {
  const cacheKey = credentials.token  // login as cache key
  const cached = tokenCache.get(cacheKey)

  if (cached && cached.expires_at > Date.now() + 60_000) {
    return cached.access_token
  }

  // IMPORTANT: password is in memory only — never log
  const password = credentials.extra?.password
  if (!password) throw new ConnectorError('rozetka_pay', 'Missing password in credentials.extra')

  const res = await fetch(`${BASE_URL}/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: credentials.token,
      password,  // base64-encoded per Rozetka docs
    }),
  })

  if (res.status === 401 || res.status === 403) throw new ConnectorAuthError('rozetka_pay')
  if (!res.ok) throw new ConnectorError('rozetka_pay', `Auth failed: ${res.status}`)

  const data = await res.json()
  const accessToken: string = data.access_token ?? data.token
  if (!accessToken) throw new ConnectorError('rozetka_pay', 'No access_token in auth response')

  // Rozetka JWT lives 24h — cache for 23h to be safe
  tokenCache.set(cacheKey, {
    access_token: accessToken,
    expires_at: Date.now() + 23 * 60 * 60 * 1000,
  })

  return accessToken
}

// ------ Normalizer ------

export interface RozetkaOrderNormalized {
  business_entity_id: string
  tenant_id: string
  source: 'rozetka_pay'
  external_id: string
  order_date: string
  gross_amount: number
  // Expected payout (calculated, NOT from API — no payout API exists)
  // Standard commission: 1.5%. TODO Stage 0: verify from real apidoc
  expected_net_amount: number
  status: string
  raw_data: RozetkaOrderRaw
}

const ROZETKA_COMMISSION_RATE = 0.015  // TODO Stage 0: verify from real data

function normalize(
  raw: RozetkaOrderRaw,
  business_entity_id: string,
  tenant_id: string,
): RozetkaOrderNormalized {
  const grossAmount = raw.amount ?? 0
  return {
    business_entity_id,
    tenant_id,
    source: 'rozetka_pay',
    external_id: String(raw.id),
    order_date: raw.created,
    gross_amount: grossAmount,
    expected_net_amount: Math.round(grossAmount * (1 - ROZETKA_COMMISSION_RATE) * 100) / 100,
    status: raw.status,
    raw_data: raw,
  }
}

// ------ Connector ------

const BASE_URL = 'https://api-seller.rozetka.com.ua'

export class RozetkaConnector
  implements BaseConnector<RozetkaOrderRaw, RozetkaOrderNormalized>
{
  readonly source = 'rozetka_pay'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    const token = await getAccessToken(credentials)
    // Lightweight check — just verify token works
    const res = await fetch(`${BASE_URL}/orders/search?page=1`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
    if (!res.ok) throw new ConnectorError(this.source, `validate failed: ${res.status}`)
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<RozetkaOrderRaw, RozetkaOrderNormalized>> {
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
  ): Promise<RozetkaOrderRaw[]> {
    const token = await getAccessToken(credentials)
    const results: RozetkaOrderRaw[] = []
    let page = 1

    while (true) {
      // TODO Stage 0: verify date filter param names from apidoc
      const url = new URL(`${BASE_URL}/orders/search`)
      url.searchParams.set('page', String(page))
      // TODO Stage 0: find exact date filter params — may need to use sort + client-side filter
      // Rozetka apidoc is behind auth wall — verify on real token

      const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
      if (res.status === 429) throw new ConnectorError(this.source, 'Rate limited')
      if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)

      const data = await res.json()
      // TODO Stage 0: verify response structure from real API
      const orders: RozetkaOrderRaw[] = data.data?.items ?? data.items ?? data.orders ?? []
      if (!orders.length) break

      // Client-side date filter until API params are verified
      const filtered = orders.filter((o) => {
        const d = new Date(o.created)
        return d >= params.date_from && d <= params.date_to
      })
      results.push(...filtered)

      // Stop if all orders on this page are before date_from
      const oldest = new Date(orders[orders.length - 1]?.created ?? 0)
      if (oldest < params.date_from) break

      const totalPages: number = data.data?.total_pages ?? data.total_pages ?? 1
      if (page >= totalPages) break
      page++
    }

    return results
  }
}

export const rozetkaConnector = new RozetkaConnector()
