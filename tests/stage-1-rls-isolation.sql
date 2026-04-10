-- ============================================================
-- Stage 1 — RLS Negative Isolation Tests
-- Margo Portal
--
-- Запустити в Supabase SQL Editor (як service_role).
-- service_role обходить RLS → використовується для setup та cleanup.
-- authenticated role → RLS застосовується → перевіряємо ізоляцію.
--
-- Тест-сценарій:
--   Tenant A: tenantA_id, client Іваненко, FOP Іваненко_fop
--   Tenant B: tenantB_id, client Петренко, FOP Петренко_fop
--
--   Перевірки:
--   [1] Tenant A accountant НЕ бачить даних Tenant B (між тенантами)
--   [2] Tenant B accountant НЕ бачить даних Tenant A
--   [3] Client Іваненко НЕ бачить даних Client Петренко (в межах спільного тенанта — якщо такий сценарій)
--   [4] Client Іваненко бачить власні дані
--   [5] Accountant Tenant A бачить ВСІ дані свого тенанта
-- ============================================================

-- ============================================================
-- SETUP: Create test fixtures
-- ============================================================

begin;

-- ---- Tenants ----
insert into tenants (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Tenant A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Test Tenant B')
on conflict (id) do nothing;

-- ---- Client groups ----
insert into client_groups (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Іваненко Іван'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Сидоренко Олег'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Петренко Петро')
on conflict (id) do nothing;

-- ---- Business entities ----
insert into business_entities (id, client_group_id, tenant_id, name, edrpou) values
  ('aaaaaaaa-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'ФОП Іваненко', '1111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'ФОП Сидоренко', '2222222222'),
  ('bbbbbbbb-0000-0000-0000-000000000010', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'ФОП Петренко', '3333333333')
on conflict (id) do nothing;

-- ---- Fiscal receipts (one per entity) ----
insert into fiscal_receipts (id, business_entity_id, tenant_id, source, external_id, fiscal_date, amount, payment_type, transaction_type) values
  ('aaaaaaaa-0000-0000-0000-000000000020', 'aaaaaaaa-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000001', 'checkbox', 'CHK-A1', now(), 1000.00, 'novapay', 'sale'),
  ('aaaaaaaa-0000-0000-0000-000000000021', 'aaaaaaaa-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001', 'checkbox', 'CHK-A2', now(), 2000.00, 'cash', 'sale'),
  ('bbbbbbbb-0000-0000-0000-000000000020', 'bbbbbbbb-0000-0000-0000-000000000010', 'bbbbbbbb-0000-0000-0000-000000000001', 'checkbox', 'CHK-B1', now(), 3000.00, 'novapay', 'sale')
on conflict (business_entity_id, source, external_id) do nothing;

commit;

-- ============================================================
-- TEST [1]: Tenant A accountant НЕ бачить даних Tenant B
-- Expected: 0 rows from fiscal_receipts of Tenant B
-- ============================================================
do $$
declare
  cnt int;
  jwt_a text := '{"tenant_id": "aaaaaaaa-0000-0000-0000-000000000001", "client_group_id": null}';
begin
  -- Simulate authenticated role with Tenant A JWT
  perform set_config('request.jwt.claims', jwt_a, true);
  set local role authenticated;

  select count(*) into cnt
  from fiscal_receipts
  where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000001';

  reset role;

  if cnt > 0 then
    raise exception '[FAIL] TEST 1: Tenant A accountant CAN see Tenant B receipts (count=%)!', cnt;
  else
    raise notice '[PASS] TEST 1: Tenant A accountant sees 0 Tenant B receipts';
  end if;
end $$;

-- ============================================================
-- TEST [2]: Tenant B accountant НЕ бачить даних Tenant A
-- Expected: 0 rows
-- ============================================================
do $$
declare
  cnt int;
  jwt_b text := '{"tenant_id": "bbbbbbbb-0000-0000-0000-000000000001", "client_group_id": null}';
begin
  perform set_config('request.jwt.claims', jwt_b, true);
  set local role authenticated;

  select count(*) into cnt
  from fiscal_receipts
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  reset role;

  if cnt > 0 then
    raise exception '[FAIL] TEST 2: Tenant B accountant CAN see Tenant A receipts (count=%)!', cnt;
  else
    raise notice '[PASS] TEST 2: Tenant B accountant sees 0 Tenant A receipts';
  end if;
end $$;

-- ============================================================
-- TEST [3]: Client Іваненко НЕ бачить даних Сидоренка (інший client_group, той самий тенант)
-- Expected: 0 rows from Сидоренко's entity
-- ============================================================
do $$
declare
  cnt int;
  jwt_ivanenko text := '{"tenant_id": "aaaaaaaa-0000-0000-0000-000000000001", "client_group_id": "aaaaaaaa-0000-0000-0000-000000000002"}';
begin
  perform set_config('request.jwt.claims', jwt_ivanenko, true);
  set local role authenticated;

  select count(*) into cnt
  from fiscal_receipts
  where business_entity_id = 'aaaaaaaa-0000-0000-0000-000000000011';  -- Сидоренко's entity

  reset role;

  if cnt > 0 then
    raise exception '[FAIL] TEST 3: Client Іваненко CAN see Сидоренко receipts (count=%)!', cnt;
  else
    raise notice '[PASS] TEST 3: Client Іваненко sees 0 Сидоренко receipts';
  end if;
end $$;

-- ============================================================
-- TEST [4]: Client Іваненко бачить власні дані
-- Expected: 1 row (CHK-A1)
-- ============================================================
do $$
declare
  cnt int;
  jwt_ivanenko text := '{"tenant_id": "aaaaaaaa-0000-0000-0000-000000000001", "client_group_id": "aaaaaaaa-0000-0000-0000-000000000002"}';
begin
  perform set_config('request.jwt.claims', jwt_ivanenko, true);
  set local role authenticated;

  select count(*) into cnt
  from fiscal_receipts
  where business_entity_id = 'aaaaaaaa-0000-0000-0000-000000000010';  -- Іваненко's entity

  reset role;

  if cnt <> 1 then
    raise exception '[FAIL] TEST 4: Client Іваненко sees % own receipts (expected 1)!', cnt;
  else
    raise notice '[PASS] TEST 4: Client Іваненко sees 1 own receipt';
  end if;
end $$;

-- ============================================================
-- TEST [5]: Accountant Tenant A бачить ВСІ дані свого тенанта
-- Expected: 2 rows (Іваненко + Сидоренко)
-- ============================================================
do $$
declare
  cnt int;
  jwt_acct text := '{"tenant_id": "aaaaaaaa-0000-0000-0000-000000000001", "client_group_id": null}';
begin
  perform set_config('request.jwt.claims', jwt_acct, true);
  set local role authenticated;

  select count(*) into cnt
  from fiscal_receipts
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  reset role;

  if cnt <> 2 then
    raise exception '[FAIL] TEST 5: Accountant Tenant A sees % receipts (expected 2)!', cnt;
  else
    raise notice '[PASS] TEST 5: Accountant Tenant A sees 2 receipts (all in tenant)';
  end if;
end $$;

-- ============================================================
-- TEST [6]: business_entities isolation — Client бачить тільки свій entity
-- Expected: 1 row
-- ============================================================
do $$
declare
  cnt int;
  jwt_ivanenko text := '{"tenant_id": "aaaaaaaa-0000-0000-0000-000000000001", "client_group_id": "aaaaaaaa-0000-0000-0000-000000000002"}';
begin
  perform set_config('request.jwt.claims', jwt_ivanenko, true);
  set local role authenticated;

  select count(*) into cnt from business_entities
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  reset role;

  if cnt <> 1 then
    raise exception '[FAIL] TEST 6: Client Іваненко sees % business_entities (expected 1)!', cnt;
  else
    raise notice '[PASS] TEST 6: Client Іваненко sees only 1 business_entity';
  end if;
end $$;

-- ============================================================
-- CLEANUP: Remove test fixtures
-- ============================================================
begin;
delete from fiscal_receipts where id like 'aaaaaaaa-0000-0000-0000-0000000002%'
                                or id like 'bbbbbbbb-0000-0000-0000-0000000002%';
delete from business_entities where id like 'aaaaaaaa-0000-0000-0000-0000000001%'
                                  or id like 'bbbbbbbb-0000-0000-0000-0000000001%';
delete from client_groups where id like 'aaaaaaaa-0000-0000-0000-0000000000%'
                             or id like 'bbbbbbbb-0000-0000-0000-0000000000%';
delete from tenants where id in (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000001'
);
commit;

-- ============================================================
-- SUMMARY
-- ============================================================
-- All 6 tests must show [PASS] in notices.
-- Any [FAIL] = BLOCKING — do NOT approve Stage 1.
-- ============================================================
