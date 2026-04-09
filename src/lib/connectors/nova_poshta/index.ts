// ============================================================
// Nova Poshta Connector
// Purpose: fetch shipment data (EN-номери) to link with NovaPay lines
// Docs: https://developers.novaposhta.ua/documentation
// Rate limit: TBD in Stage 0
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

export interface NovaPoshtaShipmentRaw {
  IntDocNumber: string         // ТТН номер (не Number — підтверджено Stage 0)
  Ref: string                  // internal GUID
  DateTime: string             // дата створення (YYYY-MM-DD HH:mm:ss)
  RecipientDateTime: string | null  // дата вручення (DD.MM.YYYY HH:mm:ss)
  Cost: number                 // оголошена вартість
  SeatsAmount: number
  Description: string
  StateName: string            // стан доставки
  State: string                // state code
  // Payment
  PaymentMethod: string        // 'Cash' | 'NonCash' | ...
  AfterpaymentOnGoodsCost: string | number | null  // сума накладеного платежу (рядок!)
  BackwardDeliverySum: string | number | null       // сума зворотньої доставки
  BackwardDeliveryMoney: string | number | null     // гроші зворотньої доставки
  SenderEDRPOU: string         // ЄДРПОУ відправника
  [key: string]: unknown
}

export interface NovaPoshtaShipmentNormalized {
  en_number: string
  ref: string
  created_date: string
  delivered_date: string | null
  cost: number
  payment_method: string
  afterpayment_amount: number | null
  state: string
  sender_edrpou: string
  raw_data: NovaPoshtaShipmentRaw
}

// ------ Normalizer ------

function normalize(raw: NovaPoshtaShipmentRaw): NovaPoshtaShipmentNormalized {
  return {
    en_number: raw.IntDocNumber,
    ref: raw.Ref,
    created_date: raw.DateTime,
    delivered_date: raw.RecipientDateTime,
    cost: Number(raw.Cost) || 0,
    payment_method: raw.PaymentMethod,
    afterpayment_amount: raw.AfterpaymentOnGoodsCost != null ? Number(raw.AfterpaymentOnGoodsCost) || null : null,
    state: raw.StateName,
    sender_edrpou: raw.SenderEDRPOU,
    raw_data: raw,
  }
}

// ------ Connector ------

// Nova Poshta uses JSON API (POST) rather than REST GET
const API_URL = 'https://api.novaposhta.ua/v2.0/json/'

export class NovaPoshtaConnector
  implements BaseConnector<NovaPoshtaShipmentRaw, NovaPoshtaShipmentNormalized>
{
  readonly source = 'nova_poshta'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    const body = {
      apiKey: credentials.token,
      modelName: 'CommonGeneral',
      calledMethod: 'getTimeIntervals',
      methodProperties: {},
    }
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new ConnectorError(this.source, `validate failed: ${res.status}`)
    const data = await res.json()
    if (!data.success) throw new ConnectorAuthError(this.source)
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<NovaPoshtaShipmentRaw, NovaPoshtaShipmentNormalized>> {
    const shipments = await withRetry(
      () => this.fetchShipments(credentials, params),
      this.source,
    )

    return {
      raw: shipments,
      normalized: shipments.map(normalize),
      fetched: shipments.length,
      fetched_at: new Date().toISOString(),
    }
  }

  private async fetchShipments(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<NovaPoshtaShipmentRaw[]> {
    // TODO Stage 0: confirm correct model/method for sender shipments list
    // and date filtering parameters
    const body = {
      apiKey: credentials.token,
      modelName: 'InternetDocument',
      calledMethod: 'getDocumentList',
      methodProperties: {
        // ⚠️ Stage 0: date format MUST be DD.MM.YYYY (ISO silently returns empty)
        DateTimeFrom: `${String(params.date_from.getDate()).padStart(2,'0')}.${String(params.date_from.getMonth()+1).padStart(2,'0')}.${params.date_from.getFullYear()}`,
        DateTimeTo: `${String(params.date_to.getDate()).padStart(2,'0')}.${String(params.date_to.getMonth()+1).padStart(2,'0')}.${params.date_to.getFullYear()}`,
        Page: 1,
        Limit: 200,  // confirmed working; max range = 3 months per request
        GetFullList: 1,
      },
    }

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)

    const data = await res.json()
    if (!data.success) {
      const errMsg = data.errors?.[0] ?? 'Unknown error'
      if (errMsg.toLowerCase().includes('auth') || errMsg.toLowerCase().includes('key')) {
        throw new ConnectorAuthError(this.source)
      }
      throw new ConnectorError(this.source, errMsg)
    }

    return data.data ?? []
  }
}

export const novaPoshtaConnector = new NovaPoshtaConnector()
