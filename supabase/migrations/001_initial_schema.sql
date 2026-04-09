-- ============================================================
-- Migration 001 — Initial Schema
-- Margo Portal — Reconciliation Module
-- Created: Stage 0 (scaffolding)
-- RLS policies: Stage 1 (stubs below — enabled but permissive)
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- TENANTS
-- ============================================================
create table tenants (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- CLIENT GROUPS
-- One login = one cabinet (1 person / business owner)
-- ============================================================
create table client_groups (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create index on client_groups(tenant_id);

alter table client_groups enable row level security;

-- ============================================================
-- BUSINESS ENTITIES
-- A specific FOP or LLC (identified by EDRPOU)
-- ============================================================
create table business_entities (
  id               uuid primary key default uuid_generate_v4(),
  client_group_id  uuid not null references client_groups(id) on delete cascade,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  name             text not null,
  edrpou           text,          -- ЄДРПОУ / РНОКПП
  created_at       timestamptz not null default now()
);

create index on business_entities(tenant_id);
create index on business_entities(client_group_id);

alter table business_entities enable row level security;

-- ============================================================
-- API CREDENTIALS
-- Encrypted tokens per source per business entity
-- source_role distinguishes novapay_agent vs novapay_bank
-- ============================================================
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
  -- Envelope Encryption via AWS KMS (Stage 1)
  encrypted_token         bytea not null,          -- token encrypted with DEK
  kms_data_key_encrypted  bytea not null,          -- DEK encrypted with KMS CMK
  kms_key_id              text not null,           -- AWS KMS key ARN
  -- Metadata
  label                   text,                    -- human-readable hint
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- One credential per source per entity
  -- NovaPay gets TWO rows: novapay_agent + novapay_bank
  unique (business_entity_id, source)
);

create index on api_credentials(tenant_id);
create index on api_credentials(business_entity_id);

alter table api_credentials enable row level security;

-- ============================================================
-- FISCAL RECEIPTS
-- From ПРРО: Checkbox, Вчасно, etc.
-- ============================================================
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
  -- Source info
  source                text not null,             -- 'checkbox', 'vchasno', etc.
  external_id           text not null,             -- receipt ID from ПРРО
  receipt_number        text,                      -- fiscal number
  -- Data
  fiscal_date           timestamptz not null,      -- date/time of receipt
  amount                numeric(12,2) not null,    -- total amount
  payment_type          payment_type not null default 'unknown',
  transaction_type      transaction_type not null default 'sale',
  -- Status (updated by matching engine)
  status                receipt_status not null default 'pending',
  needs_review          boolean not null default false,
  -- Raw API response (for audit/debugging)
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

-- ============================================================
-- BANK TRANSACTIONS
-- From banks: PrivatBank, Monobank, NovaPay (bank role)
-- ============================================================
create table bank_transactions (
  id                    uuid primary key default uuid_generate_v4(),
  business_entity_id    uuid not null references business_entities(id) on delete cascade,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  -- Source
  bank                  text not null,             -- 'novapay', 'privatbank', 'monobank'
  external_id           text not null,             -- transaction ID from bank API
  -- Data
  transaction_date      timestamptz not null,
  amount                numeric(12,2) not null,    -- positive = credit
  description           text,
  reference             text,                      -- payment reference / призначення платежу
  -- Raw API response
  raw_data              jsonb,
  created_at            timestamptz not null default now(),

  unique (business_entity_id, bank, external_id)
);

create index on bank_transactions(tenant_id);
create index on bank_transactions(business_entity_id);
create index on bank_transactions(transaction_date);
create index on bank_transactions(bank);

alter table bank_transactions enable row level security;

-- ============================================================
-- NOVAPAY REGISTERS (реєстри)
-- Payment registry from NovaPay agent role
-- Unit of reconciliation
-- ============================================================
create table novapay_registers (
  id                    uuid primary key default uuid_generate_v4(),
  business_entity_id    uuid not null references business_entities(id) on delete cascade,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  -- Register data
  registry_id           text not null,             -- BO-номер реєстру
  registry_date         date not null,             -- дата формування
  transferred_at        timestamptz not null,      -- дата переказу (дата звіту)
  total_amount          numeric(12,2) not null,
  -- Matching state
  bank_transaction_id   uuid references bank_transactions(id),
  is_matched            boolean not null default false,
  -- Raw data
  raw_data              jsonb,
  created_at            timestamptz not null default now(),

  unique (business_entity_id, registry_id)
);

create index on novapay_registers(tenant_id);
create index on novapay_registers(business_entity_id);
create index on novapay_registers(transferred_at);
create index on novapay_registers(is_matched);

alter table novapay_registers enable row level security;

-- ============================================================
-- NOVAPAY REGISTER LINES (рядки реєстру)
-- Individual EN-номери within a register
-- ============================================================
create table novapay_register_lines (
  id                    uuid primary key default uuid_generate_v4(),
  register_id           uuid not null references novapay_registers(id) on delete cascade,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  -- Line data
  en_number             text not null,             -- tracking number (ТТН)
  amount                numeric(12,2) not null,    -- amount received for this shipment
  cargo_value           numeric(12,2),             -- declared value (for validation)
  -- Raw data
  raw_data              jsonb,
  created_at            timestamptz not null default now()
);

create index on novapay_register_lines(register_id);
create index on novapay_register_lines(tenant_id);
create index on novapay_register_lines(en_number);

alter table novapay_register_lines enable row level security;

-- ============================================================
-- RECONCILIATION RUNS
-- One run per (business_entity, trigger_registry)
-- ============================================================
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
  -- Trigger
  trigger_registry_id   uuid references novapay_registers(id),
  -- Period covered
  period_start          date not null,
  period_end            date not null,
  -- Status
  status                run_status not null default 'pending',
  algorithm_version     text not null default 'v1.3-preliminary',
  error_message         text,
  -- Timing
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),

  -- Idempotency: no duplicate pending/running runs for same entity+period
  unique (business_entity_id, trigger_registry_id)
);

create index on reconciliation_runs(tenant_id);
create index on reconciliation_runs(business_entity_id);
create index on reconciliation_runs(status);

alter table reconciliation_runs enable row level security;

-- ============================================================
-- RECONCILIATION MATCHES
-- Individual receipt → transaction link
-- ============================================================
create type match_strategy as enum (
  'novapay_registry',    -- Крок 1-3: через NovaPay реєстр
  'direct_bank',         -- Крок 4: пряме зарахування в банк
  'cash',                -- MATCHED_CASH
  'liqpay',              -- через LiqPay API
  'cross_entity',        -- Крок 5: знайдено на іншому ФОПі
  'manual'               -- ручне зіставлення бухгалтером
);

create table reconciliation_matches (
  id                      uuid primary key default uuid_generate_v4(),
  run_id                  uuid not null references reconciliation_runs(id) on delete cascade,
  tenant_id               uuid not null references tenants(id) on delete cascade,
  -- Links
  fiscal_receipt_id       uuid not null references fiscal_receipts(id),
  bank_transaction_id     uuid references bank_transactions(id),
  novapay_register_id     uuid references novapay_registers(id),
  novapay_register_line_id uuid references novapay_register_lines(id),
  -- Match result
  status                  receipt_status not null,
  match_strategy          match_strategy,
  algorithm_version       text not null,           -- зберігається з runs.algorithm_version
  -- Quality metrics
  confidence_score        numeric(4,3),            -- 0.000 – 1.000
  delta_amount            numeric(12,2),           -- різниця в сумі
  delta_days              numeric(5,2),            -- різниця в днях
  needs_review            boolean not null default false,
  -- Audit
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
-- RLS POLICIES — STUB (повноцінні реалізуються в Stage 1)
-- ============================================================
-- Stage 1 додасть policy через auth.uid() → tenant_id lookup.
-- Поки service_role обходить RLS автоматично (Supabase default).
-- Додати до кожної таблиці після реалізації auth у Stage 1:
--
-- create policy "tenant_isolation" on <table>
--   for all using (tenant_id = auth.jwt() ->> 'tenant_id');
-- ============================================================
