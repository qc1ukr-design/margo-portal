НАСТУПНА ДІЯ: Власник виконує 5 AUTH_REQUIRED дій (Railway підключення + Supabase міграція 005 + IAM permissions + RLS тести), потім — Reality Checker та PM Review Stage 1

STATUS: WAITING_OWNER
AUTONOMOUS: NO (потрібна авторизація власника)
CONTEXT: STANDARD

Активний крок: Stage 1 — Infrastructure & Security
Статус: CODE_COMPLETE — очікуємо виконання AUTH_REQUIRED власником

---

## Що зроблено (2026-04-10, сесія 3 — додатково)
✅ railway/kms-service/ — envelope encryption AWS KMS + AES-256-GCM
   - POST /encrypt → { encrypted_token, kms_data_key_encrypted, kms_key_id }
   - POST /decrypt → { plaintext }
   - Plaintext data key зітирається з пам'яті після кожної операції
   - GET /health
✅ railway/reconciliation-worker/ — stub
   - Health endpoint (Express), poll loop 30 сек
   - 4-хв budget guard (< 5 хв Railway ліміт)
   - Timeout test на старті
✅ src/lib/kms.ts — Next.js клієнт (kmsEncrypt / kmsDecrypt)
✅ railway.toml — у всіх 3 сервісах (nixpacks, healthcheck, restart policy)
✅ supabase/migrations/005_rls_policies.sql — RLS для всіх 8 таблиць
   - Helper functions: margo_tenant_id(), margo_client_group_id()
   - Accountant: весь тенант / Client: тільки свій client_group
✅ tests/stage-1-rls-isolation.sql — 6 негативних ізоляційних тестів (SQL)

## Що зроблено (2026-04-10, сесія 3 — автономно)
✅ signing-service оновлено: Stage 1 інтеграція Supabase Storage + kms-service
   - fetchEncryptedKeyFile: завантажує JSON { encrypted, kms_data_key_encrypted } зі storage bucket 'kep-keys'
   - decryptKeyFile: викликає kms-service/decrypt → повертає binary buffer
   - key_ref тепер = шлях у Supabase Storage (не локальний файл)
✅ tests/kms-crypto-smoke.cjs — 6 локальних тестів AES-256-GCM (без Railway): всі PASS
✅ .github/workflows/ci.yml — GitHub Actions CI:
   - TypeScript check (коли з'явиться package.json)
   - KMS crypto smoke test (6/6 PASS)
   - Secret scan (AKIA*, sk_live_*)
   - Migration files lint
   - Railway services syntax check
✅ tests/stage-1-checklist.md — формальний чеклист Reality Checker
✅ kms.ts: виправлено TypeScript (undefined guard для KMS_SERVICE_URL)
✅ kms-service: видалено ARN з логів (account ID не логується)

---

## AUTH_REQUIRED від власника (5 дій)
1. 🔑 Supabase SQL Editor → виконати supabase/migrations/005_rls_policies.sql
2. 🔑 Supabase SQL Editor → перевірити що 004_add_marketplace_match_strategy.sql виконано
3. 🔑 AWS Console: IAM → margo-portal-kms → Add permissions:
   kms:GenerateDataKey, kms:Decrypt, kms:DescribeKey
   на ARN: arn:aws:kms:us-east-1:826496717510:key/d3c16e56-9057-4398-abc7-fa0c046419a0
4. 🔑 Railway: підключити GitHub repo до 3 сервісів
   - kms-service → Root Directory: railway/kms-service
   - reconciliation-worker → Root Directory: railway/reconciliation-worker
   - signing-service → Root Directory: railway/signing-service
   Env vars для kms-service: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, KMS_KEY_ID
   Env vars для reconciliation-worker: SUPABASE_URL, SUPABASE_SERVICE_KEY, KMS_SERVICE_URL
5. 🔑 Supabase SQL Editor → запустити tests/stage-1-rls-isolation.sql → перевірити [PASS] x6

## Після виконання AUTH_REQUIRED
- Smoke test: kms-service encrypt → store → decrypt
- Reality Checker
- PM Review Stage 1

---

## Що залишилось для Stage 1
- [x] Код kms-service
- [x] Код reconciliation-worker stub
- [x] Railway конфіги (railway.toml)
- [x] RLS policies (005_rls_policies.sql)
- [x] RLS isolation tests SQL
- [ ] AUTH_REQUIRED x5 (власник)
- [ ] Smoke test після деплою
- [ ] Security checklist
- [ ] Reality Checker → PM Review

---

## Railway IDs (довідка)
- Project ID: 3cfeefba-1b1b-42c1-8997-0bbe81e91b01
- kms-service ID: be13f9d1-e431-4500-bac1-1889c1de52fe
- reconciliation-worker ID: fef84647-0963-40c5-ab5a-833d3b492993
- signing-service ID: 586c641d-c3e6-4127-9870-ada552b6fbc3

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
