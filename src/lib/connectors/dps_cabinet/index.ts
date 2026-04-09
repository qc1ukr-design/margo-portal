// ============================================================
// ДПС Електронний кабінет — Connector
// source = 'dps_cabinet'
// API: cabinet.tax.gov.ua/ws/public_api/ (приватна частина)
// Docs: cabinet.tax.gov.ua/help/api-registers-int.html
//
// AUTH — КЕП (кваліфікований електронний підпис):
//   Authorization: <base64(CMS_SignedData_DER)>  — НЕ "Bearer", просто base64
//   Що підписується: ЄДРПОУ або РНОКПП клієнта (UTF-8 bytes)
//   Підпис: DSTU 4145 + GOST 28147-89 (українські стандарти)
//   Формат ключів: Key-6.dat (АЦСК) або .jks (ПриватБанк АЦСК)
//   Бібліотека: jkurwa (npm install jkurwa gost89)
//
// АРХІТЕКТУРА ПІДПИСУВАННЯ:
//   ⚠️ jkurwa не запускається надійно в Vercel serverless (native modules + 60s timeout)
//   Рішення: Railway signing-service (Express.js) → окремий мікросервіс
//   Next.js API route → POST http://signing-service.railway.internal/sign → base64 auth header
//   Конфіг: SIGNING_SERVICE_URL в .env
//
// CREDENTIALS (всі зберігаються зашифровано через KMS, Stage 1):
//   credentials.token          = ЄДРПОУ або РНОКПП (8 або 10 цифр)
//   credentials.extra.key_type = 'key6dat' | 'jks'
//   credentials.extra.password = пароль до КЕП ключа
//   credentials.extra.key_ref  = посилання на зашифрований ключ-файл в Supabase Storage
//                                (Key-6.dat або .jks — великий файл, зберігається окремо)
//
// TODO Stage 0: верифікувати endpoints для отримання чеків ФОП
//   cabinet.tax.gov.ua/ws/public_api/ — секція "Дані РРО"
//   Можливий endpoint: /rroline ?date_from=&date_to=
//
// Клієнт: Куденко
// ============================================================

import type { ConnectorCredentials, FetchParams, FiscalReceipt, PaymentType, TransactionType } from '../../types'
import {
  BaseConnector,
  ConnectorAuthError,
  ConnectorError,
  ConnectorResult,
  withRetry,
} from '../base'

// ------ Raw API shapes (TODO Stage 0: verify against real API) ------

export interface DpsFiscalReceiptRaw {
  // Fields from ДПС API response — needs verification with real token
  // Based on ПРРО fiscal document XML schema (tax.gov.ua/data/files/530962.docx)
  fn: string            // фіскальний номер РРО (ПРРО реєстраційний номер)
  fd: number            // фіскальний номер документа (per-device counter)
  fp: string            // фіскальний підпис (контрольна сума)
  date: string          // дата та час операції (ISO або 'DD.MM.YYYY HH:MM:SS')
  sm: number            // сума операції
  paymentType?: number  // форма розрахунку (0=готівка, 1=картка, тощо)
  operationType?: number // тип операції (0=продаж, 1=повернення)
  edrpou: string        // ЄДРПОУ/РНОКПП ФОП
  [key: string]: unknown
}

// ------ Payment type mapping ------

function mapPaymentType(raw: DpsFiscalReceiptRaw): PaymentType {
  // TODO Stage 0: verify actual paymentType codes from ДПС API
  switch (raw.paymentType) {
    case 0: return 'cash'
    case 1: return 'terminal'
    default: return 'unknown'
  }
}

function mapTransactionType(raw: DpsFiscalReceiptRaw): TransactionType {
  return raw.operationType === 1 ? 'return' : 'sale'
}

// ------ Normalizer ------

function normalize(
  raw: DpsFiscalReceiptRaw,
  business_entity_id: string,
  tenant_id: string,
): Omit<FiscalReceipt, 'id' | 'status' | 'needs_review' | 'created_at'> {
  return {
    business_entity_id,
    tenant_id,
    source: 'dps_cabinet',
    external_id: `${raw.fn}_${raw.fd}`,  // fn + fd = унікальний ідентифікатор
    receipt_number: String(raw.fd),
    fiscal_date: raw.date,
    amount: raw.sm,
    payment_type: mapPaymentType(raw),
    transaction_type: mapTransactionType(raw),
    raw_data: raw,
  }
}

// ------ Auth header via Railway signing service ------

const SIGNING_SERVICE_URL = process.env.SIGNING_SERVICE_URL ?? 'http://localhost:3001'

/**
 * Calls Railway signing-service to produce ДПС Authorization header.
 * Signs credentials.token (ЄДРПОУ/РНОКПП) with the client's КЕП key.
 *
 * Returns base64(CMS_SignedData) — used directly as Authorization header value.
 * NO "Bearer" prefix — ДПС accepts just the raw base64.
 */
async function getDpsAuthHeader(credentials: ConnectorCredentials): Promise<string> {
  // IMPORTANT: key_ref and password are sensitive — never log
  const keyRef = credentials.extra?.key_ref
  const password = credentials.extra?.password
  const keyType = credentials.extra?.key_type ?? 'key6dat'

  if (!keyRef) throw new ConnectorError('dps_cabinet', 'Missing key_ref in credentials.extra')
  if (!password) throw new ConnectorError('dps_cabinet', 'Missing password in credentials.extra')

  const res = await fetch(`${SIGNING_SERVICE_URL}/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: credentials.token,  // ЄДРПОУ/РНОКПП — что підписуємо
      key_ref: keyRef,          // посилання на зашифрований ключ-файл
      key_type: keyType,        // 'key6dat' | 'jks'
      password,                 // пароль до КЕП
    }),
  })

  if (!res.ok) throw new ConnectorError('dps_cabinet', `Signing service failed: ${res.status}`)
  const data = await res.json()
  if (!data.signature) throw new ConnectorError('dps_cabinet', 'No signature in signing service response')
  return data.signature  // base64 CMS
}

// ------ Connector ------

const BASE_URL = 'https://cabinet.tax.gov.ua/ws/public_api'

export class DpsCabinetConnector
  implements BaseConnector<DpsFiscalReceiptRaw, ReturnType<typeof normalize>>
{
  readonly source = 'dps_cabinet'

  async validate(credentials: ConnectorCredentials): Promise<void> {
    const authHeader = await getDpsAuthHeader(credentials)
    // TODO Stage 0: find lightest-weight endpoint for validation
    // Trying payer_card as a simple identity check
    const res = await fetch(`${BASE_URL}/payer_card`, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    })
    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
    if (!res.ok) throw new ConnectorError(this.source, `validate failed: ${res.status}`)
  }

  async fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<DpsFiscalReceiptRaw, ReturnType<typeof normalize>>> {
    const receipts = await withRetry(
      () => this.fetchReceipts(credentials, params),
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

  private async fetchReceipts(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<DpsFiscalReceiptRaw[]> {
    // ⚠️ TODO Stage 0: verify actual endpoint for ФОП's fiscal receipts
    // Candidate endpoints from ДПС API docs (приватна частина):
    //   /rroline — рядки РРО
    //   /rro     — перелік РРО
    // Need to browse cabinet.tax.gov.ua/help/api-registers-int.html with real КЕП session
    const authHeader = await getDpsAuthHeader(credentials)

    const url = new URL(`${BASE_URL}/rroline`)
    url.searchParams.set('date_from', params.date_from.toISOString().slice(0, 10))
    url.searchParams.set('date_to', params.date_to.toISOString().slice(0, 10))

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    })

    if (res.status === 401 || res.status === 403) throw new ConnectorAuthError(this.source)
    if (res.status === 429) throw new ConnectorError(this.source, 'Rate limited')
    if (!res.ok) throw new ConnectorError(this.source, `HTTP ${res.status}`)

    const data = await res.json()
    return Array.isArray(data) ? data : data.data ?? data.items ?? data.receipts ?? []
  }
}

export const dpsCabinetConnector = new DpsCabinetConnector()
