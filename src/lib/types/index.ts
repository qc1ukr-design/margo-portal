// ============================================================
// Shared types — Margo Portal Reconciliation Module
// ============================================================

// ------ Enums (mirror DB enums) ------

export type CredentialSource =
  | 'checkbox'
  | 'vchasno'
  | 'cashalot'
  | 'poster'
  | 'novapay_agent'
  | 'novapay_bank'
  | 'nova_poshta'
  | 'privatbank'
  | 'monobank'
  | 'liqpay'
  | 'rozetka_pay'
  | 'prom'
  | 'casta'
  | 'dps_cabinet'
  | 'email_imap'   // IMAP mailbox for marketplace payout register emails (Prom/Rozetka/Casta)

export type PaymentType =
  | 'novapay'
  | 'cash'
  | 'liqpay'
  | 'iban'
  | 'terminal'
  | 'rozetka_pay'
  | 'prom'
  | 'unknown'

export type TransactionType = 'sale' | 'return'

export type ReceiptStatus =
  | 'pending'
  | 'matched_full'
  | 'matched_cash'
  | 'matched_direct'
  | 'matched_return'
  | 'matched_cross_entity'
  | 'partial'
  | 'unmatched'

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed'

export type MatchStrategy =
  | 'novapay_registry'
  | 'direct_bank'
  | 'cash'
  | 'liqpay'
  | 'marketplace_order'    // Prom/Rozetka/Casta: Step A — order (payment date) → fiscal receipt (full amount)
  | 'marketplace_register' // Prom/Rozetka/Casta: Step B — email payout register → bank transaction (net amount)
  | 'marketplace_fuzzy'    // Prom/Rozetka: нечіткий матч — сума ± комісія% + вікно T+N днів (low confidence, needs_review=true)
  | 'cross_entity'
  | 'manual'

// ------ DB row types ------

export interface Tenant {
  id: string
  name: string
  created_at: string
}

export interface ClientGroup {
  id: string
  tenant_id: string
  name: string
  created_at: string
}

export interface BusinessEntity {
  id: string
  client_group_id: string
  tenant_id: string
  name: string
  edrpou: string | null
  created_at: string
}

export interface ApiCredential {
  id: string
  business_entity_id: string
  tenant_id: string
  source: CredentialSource
  encrypted_token: Uint8Array
  kms_data_key_encrypted: Uint8Array
  kms_key_id: string
  label: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface FiscalReceipt {
  id: string
  business_entity_id: string
  tenant_id: string
  source: string
  external_id: string
  receipt_number: string | null
  fiscal_date: string
  amount: number
  payment_type: PaymentType
  transaction_type: TransactionType
  status: ReceiptStatus
  needs_review: boolean
  raw_data: unknown
  created_at: string
}

export interface BankTransaction {
  id: string
  business_entity_id: string
  tenant_id: string
  bank: string
  external_id: string
  transaction_date: string
  amount: number
  currency: string          // ISO 4217: 'UAH', 'USD', 'EUR' — default 'UAH'
  description: string | null
  reference: string | null
  raw_data: unknown
  created_at: string
}

export interface NovapayRegister {
  id: string
  business_entity_id: string
  tenant_id: string
  registry_id: string
  registry_date: string
  transferred_at: string
  total_amount: number
  bank_transaction_id: string | null
  is_matched: boolean
  raw_data: unknown
  created_at: string
}

export interface NovapayRegisterLine {
  id: string
  register_id: string
  tenant_id: string
  en_number: string
  amount: number
  cargo_value: number | null
  raw_data: unknown
  created_at: string
}

export interface ReconciliationRun {
  id: string
  business_entity_id: string
  tenant_id: string
  trigger_registry_id: string | null
  period_start: string
  period_end: string
  status: RunStatus
  algorithm_version: string
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface ReconciliationMatch {
  id: string
  run_id: string
  tenant_id: string
  fiscal_receipt_id: string
  bank_transaction_id: string | null
  novapay_register_id: string | null
  novapay_register_line_id: string | null
  status: ReceiptStatus
  match_strategy: MatchStrategy | null
  algorithm_version: string
  confidence_score: number | null
  delta_amount: number | null
  delta_days: number | null
  needs_review: boolean
  created_at: string
  updated_at: string
}

// ------ Connector types ------

/** Decrypted credentials passed to connector fetch() in memory only */
export interface ConnectorCredentials {
  token: string         // plaintext — never log, never persist
  extra?: Record<string, string>  // connector-specific (e.g. merchant_id)
}

export interface FetchParams {
  business_entity_id: string
  tenant_id: string
  date_from: Date
  date_to: Date
}
