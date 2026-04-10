НАСТУПНА ДІЯ: Stage 1 — написати код kms-service (envelope encryption) + reconciliation-worker stub + підключити Railway до GitHub repo

STATUS: IN_PROGRESS
AUTONOMOUS: YES
CONTEXT: STANDARD

Активний крок: Stage 1 — Infrastructure & Security
Статус: IN_PROGRESS — всі блокери знято 2026-04-10, залишилась розробка

---

## Що зроблено сьогодні (2026-04-10)
✅ Supabase БД — підтверджено 10 таблиць (api_credentials, bank_transactions, business_entities, client_groups, fiscal_receipts, novapay_register_lines, novapay_registers, reconciliation_matches, reconciliation_runs, tenants)
✅ AWS IAM — підтверджено 2 policy: AWSKeyManagementServicePowerUser + margo-kms-policy
✅ Railway — створено проєкт margo-portal + 3 сервіси (kms-service, reconciliation-worker, signing-service)

## Railway IDs
- Project ID: 3cfeefba-1b1b-42c1-8997-0bbe81e91b01
- Environment ID (production): 2e18e5c8-2ae1-4b74-a353-55e3a508af69
- kms-service ID: be13f9d1-e431-4500-bac1-1889c1de52fe
- reconciliation-worker ID: fef84647-0963-40c5-ab5a-833d3b492993
- signing-service ID: 586c641d-c3e6-4127-9870-ada552b6fbc3

## Що залишилось для Stage 1
1. 🔴 Написати код kms-service (envelope encrypt/decrypt через AWS KMS)
2. 🔴 Написати reconciliation-worker stub (health + timeout test)
3. 🔴 Підключити Railway до GitHub repo (deploy source)
4. 🔴 RLS negative isolation tests
5. 🔴 Smoke test (KMS encrypt → store → decrypt)
6. 🟡 Security checklist
7. 🟡 CI/CD pipeline

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

