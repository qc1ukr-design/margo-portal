-- ============================================================
-- Migration 002 — Add currency to bank_transactions
-- Reason: Марков has USD/EUR accounts in PrivatBank
-- Decision: store original currency + amount; reconciliation
--           engine compares only UAH transactions by default
--           (FX transactions flagged as needs_review)
-- ============================================================

alter table bank_transactions
  add column if not exists currency text not null default 'UAH';

-- Index for filtering by currency (UAH-only queries in matching engine)
create index on bank_transactions(currency) where currency != 'UAH';

comment on column bank_transactions.currency is
  'ISO 4217 currency code. UAH = default. Non-UAH rows flagged needs_review in reconciliation.';
