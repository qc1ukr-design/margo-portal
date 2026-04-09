// ============================================================
// LiqPay Connector — Платіжний агент
// Docs: https://www.liqpay.ua/documentation/api/information/reports/doc
// Rate limit: TBD in Stage 0
// Note: credentials.extra must contain { public_key: string }
// ============================================================

import { createHash, createHmac } from 'crypto'
import type { BankTransaction, ConnectorCredentials, FetchParams } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorResult,
  withRetry,
} from '../base'

// ------ Raw API shapes ------

export interface LiqPayTransactionRaw {
  payment_id: number
  order_id: string
  amount: number
  currency: string
  status: string            // 'success' | 'failure' | 'reversed' | ...
  type: string              // 'buy' | 'reversal' | ...
  create_date: number       // Unix timestamp ms
  end_date: number          // Unix timestamp ms
  description: string
  sender_card_mask2: string | null
  receiver_card_mask2: string | null
  [key: string]: unknown
}

// ------ Normalizer ------

function normalize(
  raw: LiqPayTransactionRaw,
  business_entity_id: string,
  tenant_id: string,
): Omit<BankTransaction, 'id' | 'created_at'> {
  return {
    business_entity_id,
    tenant_id,
    bank: 'liqpay',
    external_id: String(raw.payment_id),
    transaction_date: new Date(raw.end_date).toISOString(),
    amount: raw.type === 'reversal' ? -Math.abs(raw.amount) : raw.amount,
    description: raw.description ?? null,
    reference: raw.order_id ?? null,
    raw_data: raw,
  }
}

// ------ LiqPay signature helpers ------

function buildSignature(privateKey: string, data: string): string {
  const str = privateKey + data + privateKey
  return Buffer.from(createHash('sha1').update(str).digest()).toString('base64')
}

function buildData(params: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(params)).toString('base64')
}

// ------ Connector ------

const API_URL = 'https://www.liqpay.ua/api/request'

export class LiqPayConnector
  implements BaseConnector<LiqPayTransactionRaw, ReturnType<typeof normalize>>
{
  readonly source = 'liqpay'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    const { publicKey, privateKey } = this.extractKeys(credentials)
    const data = buildData({
      version: 3,
      action: 'reports',
      public_key: publicKey,
      date_from: Date.now() - 86400000,
      date_to: Date.now(),
    })
    const signature = buildSignature(privateKey, data)

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data, signature }).toString(),
    })
    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
    if (!res.ok) throw new ConnectorError(this.source, `validate failed: ${res.status}`)
    const json = await res.json()
    if (json.result === 'error') throw new ConnectorAuthError(this.source)
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<LiqPayTransactionRaw, ReturnType<typeof normalize>>> {
    const transactions = await withRetry(
      () => this.fetchReport(credentials, params),
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

  private async fetchReport(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<LiqPayTransactionRaw[]> {
    const { publicKey, privateKey } = this.extractKeys(credentials)

    const data = buildData({
      version: 3,
      action: 'reports',
      public_key: publicKey,
      date_from: params.date_from.getTime(),
      date_to: params.date_to.getTime(),
    })
    const signature = buildSignature(privateKey, data)

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data, signature }).toString(),
    })

    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
    if (res.status === 429) throw new ConnectorError(this.source, 'Rate limited')
    if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)

    const json = await res.json()
    if (json.result === 'error') {
      throw new ConnectorError(this.source, json.err_description ?? 'API error')
    }

    return json.data ?? []
  }

  private extractKeys(credentials: ConnectorCredentials): { publicKey: string; privateKey: string } {
    // IMPORTANT: both keys are in memory only — never log
    const publicKey = credentials.extra?.public_key
    if (!publicKey) throw new ConnectorError(this.source, 'Missing public_key in credentials.extra')
    return { publicKey, privateKey: credentials.token }
  }
}

export const liqPayConnector = new LiqPayConnector()
