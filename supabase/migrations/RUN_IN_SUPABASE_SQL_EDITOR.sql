-- ============================================================
-- COMBINED MIGRATIONS — Run in Supabase SQL Editor
-- Project: margo-portal (qholjpqsrafmuyfnhdqo)
-- Run at: https://supabase.com/dashboard/project/qholjpqsrafmuyfnhdqo/sql/new
-- Run all 4 migrations in sequence (this file = all 4 combined)
-- ============================================================

-- ============================================================
-- Migration 001 — Initial Schema
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create table tenants (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table client_groups (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create index on client_groups(tenant_id);
alter table client_groups enable row level security;

create table business_entities (
  id               uuid primary key default uuid_generate_v4(),
  client_group_id  uuid not null references client_groups(id) on delete cascade,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  name             text not null,
  edrpou           text,
  created_at       timestamptz not null default now()
);

create index on business_entities(tenant_id);
create index on business_entities(client_group_id);
alter table business_entities enable row level security;

create type credential_source as enum (
  'checkbox',
  'vchasno',
  'novapay_agent',
  'novapay_bank',
  'nova_poshta',
  'privatbank',
  'monobank',
  'liqpay',
  'rozetka_pay',
  'prom'
);

create table api_credentials (
  id                      uuid primary key default uuid_generate_v4(),
  business_entity_id      uuid not null references business_entities(id) on delete cascade,
  tenant_id               uuid not null references tenants(id) on delete cascade,
  source                  credential_source not null,
  encrypted_token         bytea not null,
  kms_data_key_encrypted  bytea not null,
  kms_key_id              text not null,
  label                   text,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (business_entity_id, source)
);

create index on api_credentials(tenant_id);
create index on api_credentials(business_entity_id);
alter table api_credentials enable row level security;

create type payment_type as enum (
  'novapay',
  'cash',
  'liqpay',
  'iban',
  'terminal',
  'rozetka_pay',
  'prom',
  'unknown'
);

create type transaction_type as enum (
  'sale',
  'return'
);

create type receipt_status as enum (
  'pending',
  'matched_full',
  'matched_cash',
  'matched_direct',
  'matched_return',
  'matched_cross_entity',
  'partial',
  'unmatched'
);

create table fiscal_receipts (
  id                    uuid primary key default uuid_generate_v4(),
  business_entity_id    uuid not null references business_entities(id) on delete cascade,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  source                text not null,
  external_id           text not null,
  receipt_number        text,
  fiscal_date           timestamptz not null,
  amount                numeric(12,2) not null,
  payment_type          payment_type not null default 'unknown',
  transaction_type      transaction_type not null default 'sale',
  status                receipt_status not null default 'pending',
  needs_review          boolean not null default false,
  raw_data              jsonb,
  created_at            timestamptz not null default now(),
  unique (business_entity_id, source, external_id)
);

create index on fiscal_receipts(tenant_id);
create index on fiscal_receipts(business_entity_id);
create index on fiscal_receipts(fiscal_date);
create index on fiscal_receipts(status);
create index on fiscal_receipts(payment_type);
alter table fiscal_receipts enable row level security;

create table bank_transactions (
  id                    uuid primary key default uuid_generate_v4(),
  business_entity_id    uuid not null references business_entities(id) on delete cascade,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  bank                  text not null,
  external_id           text not null,
  transaction_date      timestamptz not null,
  amount                numeric(12,2) not null,
  description           text,
  reference             text,
  raw_data              jsonb,
  created_at            timestamptz not null default now(),
  unique (business_entity_id, bank, external_id)
);

create index on bank_transactions(tenant_id);
create index on bank_transactions(business_entity_id);
create index on bank_transactions(transaction_date);
create index on bank_transactions(bank);
alter table bank_transactions enable row level security;

create table novapay_registers (
  id                    uuid primary key default uuid_generate_v4(),
  business_entity_id    uuid not null references business_entities(id) on delete cascade,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  registry_id           text not null,
  registry_date         date not null,
  transferred_at        timestamptz not null,
  total_amount          numeric(12,2) not null,
  bank_transaction_id   uuid references bank_transactions(id),
  is_matched            boolean not null default false,
  raw_data              jsonb,
  created_at            timestamptz not null default now(),
  unique (business_entity_id, registry_id)
);

create index on novapay_registers(tenant_id);
create index on novapay_registers(business_entity_id);
create index on novapay_registers(transferred_at);
create index on novapay_registers(is_matched);
alter table novapay_registers enable row level security;

create table novapay_register_lines (
  id                    uuid primary key default uuid_generate_v4(),
  register_id           uuid not null references novapay_registers(id) on delete cascade,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  en_number             text not null,
  amount                numeric(12,2) not null,
  cargo_value           numeric(12,2),
  raw_data              jsonb,
  created_at            timestamptz not null default now()
);

create index on novapay_register_lines(register_id);
create index on novapay_register_lines(tenant_id);
create index on novapay_register_lines(en_number);
alter table novapay_register_lines enable row level security;

create type run_status as enum (
  'pending',
  'running',
  'completed',
  'failed'
);

create table reconciliation_runs (
  id                    uuid primary key default uuid_generate_v4(),
  business_entity_id    uuid not null references business_entities(id) on delete cascade,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  trigger_registry_id   uuid references novapay_registers(id),
  period_start          date not null,
  period_end            date not null,
  status                run_status not null default 'pending',
  algorithm_version     text not null default 'v1.3-preliminary',
  error_message         text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  unique (business_entity_id, trigger_registry_id)
);

create index on reconciliation_runs(tenant_id);
create index on reconciliation_runs(business_entity_id);
create index on reconciliation_runs(status);
alter table reconciliation_runs enable row level security;

create type match_strategy as enum (
  'novapay_registry',
  'direct_bank',
  'cash',
  'liqpay',
  'cross_entity',
  'manual'
);

create table reconciliation_matches (
  id                      uuid primary key default uuid_generate_v4(),
  run_id                  uuid not null references reconciliation_runs(id) on delete cascade,
  tenant_id               uuid not null references tenants(id) on delete cascade,
  fiscal_receipt_id       uuid not null references fiscal_receipts(id),
  bank_transaction_id     uuid references bank_transactions(id),
  novapay_register_id     uuid references novapay_registers(id),
  novapay_register_line_id uuid references novapay_register_lines(id),
  status                  receipt_status not null,
  match_strategy          match_strategy,
  algorithm_version       text not null,
  confidence_score        numeric(4,3),
  delta_amount            numeric(12,2),
  delta_days              numeric(5,2),
  needs_review            boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index on reconciliation_matches(tenant_id);
create index on reconciliation_matches(run_id);
create index on reconciliation_matches(fiscal_receipt_id);
create index on reconciliation_matches(status);
create index on reconciliation_matches(needs_review) where needs_review = true;
alter table reconciliation_matches enable row level security;

-- ============================================================
-- Migration 002 — Add currency to bank_transactions
-- ============================================================

alter table bank_transactions
  add column if not exists currency text not null default 'UAH';

create index on bank_transactions(currency) where currency != 'UAH';

comment on column bank_transactions.currency is
  'ISO 4217 currency code. UAH = default. Non-UAH rows flagged needs_review in reconciliation.';

-- ============================================================
-- Migration 003 — Add new credential_source values
-- ============================================================

alter type credential_source add value if not exists 'cashalot';
alter type credential_source add value if not exists 'poster';
alter type credential_source add value if not exists 'casta';
alter type credential_source add value if not exists 'dps_cabinet';

-- ============================================================
-- Migration 004 — Add marketplace match strategies + email_imap
-- ============================================================

alter type match_strategy add value if not exists 'marketplace_order';
alter type match_strategy add value if not exists 'marketplace_register';

alter type credential_source add value if not exists 'email_imap';

-- ============================================================
-- Verification queries (run after migration to confirm)
-- ============================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT typname, enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid WHERE typname IN ('credential_source', 'match_strategy') ORDER BY typname, enumsortorder;
