-- ============================================================
-- Migration 005 — RLS Policies (Stage 1)
-- Margo Portal — Multi-tenant row-level security
--
-- Auth model:
--   JWT claims expected (set via Supabase Auth custom claims hook):
--     tenant_id       : uuid  — required for all authenticated users
--     client_group_id : uuid  — present for CLIENT role, NULL for accountants/admins
--
-- Access rules:
--   ACCOUNTANT (tenant staff):
--     - client_group_id IS NULL in JWT
--     - sees ALL rows within their tenant
--   CLIENT (business owner):
--     - client_group_id IS SET in JWT
--     - sees ONLY rows belonging to their client_group
--   SERVICE_ROLE (Railway worker, migrations):
--     - bypasses RLS automatically (Supabase default)
--
-- All policies are RESTRICTIVE by default (AND semantics when multiple exist)
-- ============================================================

-- ============================================================
-- Helper: extract tenant_id from JWT (cached per statement)
-- ============================================================
create or replace function margo_tenant_id() returns uuid
  language sql stable
  as $$
    select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
  $$;

-- ============================================================
-- Helper: extract client_group_id from JWT (null for accountants)
-- ============================================================
create or replace function margo_client_group_id() returns uuid
  language sql stable
  as $$
    select nullif(auth.jwt() ->> 'client_group_id', '')::uuid
  $$;

-- ============================================================
-- client_groups
-- Accountant: all groups in tenant
-- Client: only their own group
-- ============================================================
drop policy if exists "tenant_isolation" on client_groups;
create policy "tenant_isolation" on client_groups
  for all
  using (
    tenant_id = margo_tenant_id()
    and (
      margo_client_group_id() is null          -- accountant
      or id = margo_client_group_id()          -- client sees own group only
    )
  );

-- ============================================================
-- business_entities
-- Client sees only entities in their client_group
-- ============================================================
drop policy if exists "tenant_isolation" on business_entities;
create policy "tenant_isolation" on business_entities
  for all
  using (
    tenant_id = margo_tenant_id()
    and (
      margo_client_group_id() is null
      or client_group_id = margo_client_group_id()
    )
  );

-- ============================================================
-- api_credentials
-- Client sees own credentials; accountant sees all in tenant
-- api_credentials.business_entity_id → business_entities.client_group_id check
-- ============================================================
drop policy if exists "tenant_isolation" on api_credentials;
create policy "tenant_isolation" on api_credentials
  for all
  using (
    tenant_id = margo_tenant_id()
    and (
      margo_client_group_id() is null
      or business_entity_id in (
        select id from business_entities
        where client_group_id = margo_client_group_id()
          and tenant_id = margo_tenant_id()
      )
    )
  );

-- ============================================================
-- fiscal_receipts
-- ============================================================
drop policy if exists "tenant_isolation" on fiscal_receipts;
create policy "tenant_isolation" on fiscal_receipts
  for all
  using (
    tenant_id = margo_tenant_id()
    and (
      margo_client_group_id() is null
      or business_entity_id in (
        select id from business_entities
        where client_group_id = margo_client_group_id()
          and tenant_id = margo_tenant_id()
      )
    )
  );

-- ============================================================
-- bank_transactions
-- ============================================================
drop policy if exists "tenant_isolation" on bank_transactions;
create policy "tenant_isolation" on bank_transactions
  for all
  using (
    tenant_id = margo_tenant_id()
    and (
      margo_client_group_id() is null
      or business_entity_id in (
        select id from business_entities
        where client_group_id = margo_client_group_id()
          and tenant_id = margo_tenant_id()
      )
    )
  );

-- ============================================================
-- novapay_registers
-- ============================================================
drop policy if exists "tenant_isolation" on novapay_registers;
create policy "tenant_isolation" on novapay_registers
  for all
  using (
    tenant_id = margo_tenant_id()
    and (
      margo_client_group_id() is null
      or business_entity_id in (
        select id from business_entities
        where client_group_id = margo_client_group_id()
          and tenant_id = margo_tenant_id()
      )
    )
  );

-- ============================================================
-- novapay_register_lines
-- Linked via register_id → novapay_registers.tenant_id
-- ============================================================
drop policy if exists "tenant_isolation" on novapay_register_lines;
create policy "tenant_isolation" on novapay_register_lines
  for all
  using (
    tenant_id = margo_tenant_id()
    -- Client isolation: via register → business_entity → client_group
    and (
      margo_client_group_id() is null
      or register_id in (
        select r.id from novapay_registers r
        join business_entities be on be.id = r.business_entity_id
        where be.client_group_id = margo_client_group_id()
          and r.tenant_id = margo_tenant_id()
      )
    )
  );

-- ============================================================
-- reconciliation_runs
-- ============================================================
drop policy if exists "tenant_isolation" on reconciliation_runs;
create policy "tenant_isolation" on reconciliation_runs
  for all
  using (
    tenant_id = margo_tenant_id()
    and (
      margo_client_group_id() is null
      or business_entity_id in (
        select id from business_entities
        where client_group_id = margo_client_group_id()
          and tenant_id = margo_tenant_id()
      )
    )
  );

-- ============================================================
-- reconciliation_matches
-- ============================================================
drop policy if exists "tenant_isolation" on reconciliation_matches;
create policy "tenant_isolation" on reconciliation_matches
  for all
  using (
    tenant_id = margo_tenant_id()
    and (
      margo_client_group_id() is null
      or run_id in (
        select rr.id from reconciliation_runs rr
        join business_entities be on be.id = rr.business_entity_id
        where be.client_group_id = margo_client_group_id()
          and rr.tenant_id = margo_tenant_id()
      )
    )
  );
