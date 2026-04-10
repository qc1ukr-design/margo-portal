НАСТУПНА ДІЯ: Власник виконує 2 AUTH_REQUIRED дії (Supabase міграція 005 + RLS тести), потім — Reality Checker та PM Review Stage 1

STATUS: WAITING_OWNER
AUTONOMOUS: NO (залишились тільки Supabase дії)
CONTEXT: STANDARD

Активний крок: Stage 1 — Infrastructure & Security
Статус: DEPLOY_COMPLETE — всі 3 Railway сервіси живі, smoke test PASSED

---

## Що зроблено (2026-04-10, сесія 4 — автономно)
✅ Railway деплой — всі 3 сервіси живі:
   - kms-service: https://kms-service-production.up.railway.app/health → {"status":"ok","service":"kms-service"}
   - reconciliation-worker: https://reconciliation-worker-production.up.railway.app/health → {"status":"ok",...}
   - signing-service: https://signing-service-production.up.railway.app/health → {"status":"ok","service":"signing-service"}
✅ Smoke test PASSED:
   - POST /encrypt → {"encrypted_token":"...","kms_data_key_encrypted":"...","kms_key_id":"arn:aws:kms:..."}
   - POST /decrypt → {"plaintext":"test-smoke-token-stage1"} ← точне відновлення
   - AWS KMS GenerateDataKey + Decrypt підтверджено на prod
✅ gost89 версія виправлена (^0.1.11 замість ^1.0.6)
✅ KMS_SERVICE_URL встановлено для signing-service та reconciliation-worker
✅ GitHub repo публічний + CI workflow pushed
✅ serviceInstanceDeploy(commitSha) — спосіб деплою без Railway GitHub App webhook

---

## Що зроблено раніше (сесії 1-3)
✅ railway/kms-service/ — envelope encryption AWS KMS + AES-256-GCM
✅ railway/reconciliation-worker/ — stub з health endpoint
✅ src/lib/kms.ts — Next.js клієнт
✅ railway.toml — у всіх 3 сервісах
✅ supabase/migrations/005_rls_policies.sql — RLS для всіх 8 таблиць
✅ tests/stage-1-rls-isolation.sql — 6 негативних ізоляційних тестів
✅ tests/kms-crypto-smoke.cjs — 6/6 PASS (локальні AES-256-GCM тести)
✅ .github/workflows/ci.yml — GitHub Actions CI

---

## AUTH_REQUIRED від власника (2 дії залишились)
1. 🔑 Supabase SQL Editor → виконати supabase/migrations/005_rls_policies.sql
2. 🔑 Supabase SQL Editor → запустити tests/stage-1-rls-isolation.sql → перевірити [PASS] x6

(Railway + IAM + smoke test — все DONE)

---

## Що залишилось для Stage 1
- [x] Код kms-service
- [x] Код reconciliation-worker stub
- [x] Railway конфіги (railway.toml)
- [x] RLS policies (005_rls_policies.sql)
- [x] RLS isolation tests SQL
- [x] Railway деплой — всі 3 сервіси (AUTH_REQUIRED виконано автономно)
- [x] Smoke test після деплою — PASSED
- [ ] AUTH_REQUIRED: виконати 005_rls_policies.sql в Supabase
- [ ] AUTH_REQUIRED: запустити RLS isolation tests → [PASS] x6
- [ ] Security checklist (після RLS тестів)
- [ ] Reality Checker → PM Review

---

## Railway (prod)
- kms-service: https://kms-service-production.up.railway.app
- reconciliation-worker: https://reconciliation-worker-production.up.railway.app
- signing-service: https://signing-service-production.up.railway.app
- Project ID: 3cfeefba-1b1b-42c1-8997-0bbe81e91b01
- Environment: 2e18e5c8-2ae1-4b74-a353-55e3a508af69

---

## Stage 0 — DONE (2026-04-09)
- git tag: stage-0-complete
- PM_STATUS: APPROVED
- 5 APIs підключено, Data Contract v1.0, fixtures збережено

---

## Маппінг файлів
- ROADMAP -> docs/roadmap.md
- TECH_DOC -> docs/tech_log/stage_1_infrastructure.md
- DECISIONS_LOG -> DECISIONS_LOG.md

---
> Оновлювати після КОЖНОЇ сесії. НАСТУПНА ДІЯ — завжди першим рядком.
