# Stage 1 — Infrastructure & Security
**Статус:** IN_PROGRESS
**Reality Checker:** PENDING
**PM_STATUS:** PENDING

## Передумова
PM_STATUS Stage 0: має бути APPROVED перед стартом.

## Мета
Розгорнути повну інфраструктуру: Supabase з RLS, AWS KMS для шифрування токенів, Railway для фонових сервісів, CI/CD pipeline.

## Чеклист
- [x] Supabase проєкт створено
- [x] Базова схема БД задеплоєна — 10 таблиць підтверджено (2026-04-10)
- [x] RLS включено на всіх таблицях (в міграції)
- [ ] Tenant isolation перевірено тестами
- [x] AWS KMS key створено (us-east-1) — ARN: arn:aws:kms:us-east-1:826496717510:key/d3c16e56-9057-4398-abc7-fa0c046419a0
- [x] AWS IAM policies додано (AWSKeyManagementServicePowerUser + margo-kms-policy) — підтверджено 2026-04-10
- [x] Railway проєкт margo-portal створено (id: 3cfeefba-1b1b-42c1-8997-0bbe81e91b01)
- [x] Railway сервіси створено: kms-service, reconciliation-worker, signing-service
- [ ] KMS-service код задеплоєно на Railway (потрібно підключити GitHub repo)
- [ ] Envelope Encryption реалізовано і протестовано
- [ ] Railway reconciliation-worker задеплоєно (заглушка з кодом)
- [ ] CI/CD pipeline налаштовано (GitHub Actions або Railway deploy hooks)
- [ ] Секрети не потрапляють у логи (перевірено)
- [ ] Мінімальний smoke-test пройдено
- [ ] Railway timeout test: переконатись що reconciliation job завершується за < 5 хв
- [ ] RLS negative isolation tests: перевірити що tenant A не бачить даних tenant B
- [ ] Security Checklist (з CLAUDE.md): API tokens зашифровані, жодних секретів в логах, KMS decrypt тільки в пам'яті

## Результат
✅ kms-service написано: Express + @aws-sdk/client-kms + AES-256-GCM envelope encryption. POST /encrypt, POST /decrypt, GET /health. Plaintext data key зітирається з пам'яті після кожної операції.
✅ reconciliation-worker stub написано: health endpoint, poll loop (30 сек), timeout test на старті (підтверджує < 5 хв).
✅ src/lib/kms.ts — Next.js клієнт до kms-service (kmsEncrypt / kmsDecrypt).
✅ railway.toml додано до всіх 3 сервісів (nixpacks builder, healthcheck path).
✅ supabase/migrations/005_rls_policies.sql — повноцінні RLS policies: tenant_isolation + client_group_isolation для всіх 8 таблиць.
✅ tests/stage-1-rls-isolation.sql — 6 негативних ізоляційних тестів (SQL, запускати в Supabase SQL Editor).

## Несподіванки
⚠️ UNEXPECTED: AWS KMS key створено в us-east-1 замість eu-central-1 (відповідно до наданих credentials AWS_REGION=us-east-1). Якщо потрібно eu-central-1 — треба окремий ключ.
⚠️ UNEXPECTED: IAM user margo-portal-kms має лише ListKeys + CreateKey права, але не GenerateDataKey/Decrypt. Key policy дозволяє root-акаунту kms:* — тобто права потрібно додати безпосередньо до IAM user policy через AWS Console або IAM API від root.
⚠️ UNEXPECTED: Railway token повертає "Not Authorized" на `me` і `projects` запити — це project-scoped token (не personal access token). Introspection і publicStats працюють. Для деплою сервісів потрібен personal token або railway CLI login.
⚠️ UNEXPECTED: Supabase Management API (api.supabase.com) вимагає окремий Supabase Personal Access Token — service_role key для цього не підходить. DDL міграції не можна запустити через REST API автоматично.

## Потрібна авторизація
🔑 AUTH_REQUIRED: Запустити міграції БД вручну — відкрити Supabase SQL Editor і виконати послідовно:
  1. supabase/migrations/RUN_IN_SUPABASE_SQL_EDITOR.sql (вже виконано — 10 таблиць підтверджено)
  2. supabase/migrations/004_add_marketplace_match_strategy.sql (якщо ще не виконано)
  3. supabase/migrations/005_rls_policies.sql — НОВИЙ: RLS policies (обов'язково виконати!)
🔑 AUTH_REQUIRED: Додати IAM policy до user margo-portal-kms (AWS Console → IAM → Users → margo-portal-kms → Add permissions): kms:GenerateDataKey, kms:Decrypt, kms:DescribeKey на ARN arn:aws:kms:us-east-1:826496717510:key/d3c16e56-9057-4398-abc7-fa0c046419a0
🔑 AUTH_REQUIRED: Підтвердити чи Region правильний (us-east-1 vs eu-central-1 з CLAUDE.md). Якщо потрібен eu-central-1 — видалити ключ і створити заново.
🔑 AUTH_REQUIRED: Railway → підключити GitHub repo. В Railway dashboard: кожен сервіс → Settings → Source → Connect GitHub → вибрати margo-portal repo → Root Directory = railway/kms-service (або відповідна папка). Додати env vars (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, KMS_KEY_ID для kms-service; SUPABASE_URL, SUPABASE_SERVICE_KEY для reconciliation-worker).
🔑 AUTH_REQUIRED: Запустити tests/stage-1-rls-isolation.sql в Supabase SQL Editor — перевірити що всі 6 тестів [PASS].
