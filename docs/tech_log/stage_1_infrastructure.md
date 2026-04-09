# Stage 1 — Infrastructure & Security
**Статус:** IN_PROGRESS
**Reality Checker:** PENDING
**PM_STATUS:** PENDING

## Передумова
PM_STATUS Stage 0: має бути APPROVED перед стартом.

## Мета
Розгорнути повну інфраструктуру: Supabase з RLS, AWS KMS для шифрування токенів, Railway для фонових сервісів, CI/CD pipeline.

## Чеклист
- [ ] Supabase проєкт створено
- [ ] Базова схема БД задеплоєна (міграція 001)
- [ ] RLS включено на всіх таблицях
- [ ] Tenant isolation перевірено тестами
- [x] AWS KMS key створено (us-east-1) — ARN: arn:aws:kms:us-east-1:826496717510:key/d3c16e56-9057-4398-abc7-fa0c046419a0
- [ ] KMS-service задеплоєно на Railway
- [ ] Envelope Encryption реалізовано і протестовано
- [ ] Railway reconciliation-worker задеплоєно (заглушка)
- [ ] CI/CD pipeline налаштовано (GitHub Actions або Railway deploy hooks)
- [ ] Секрети не потрапляють у логи (перевірено)
- [ ] Мінімальний smoke-test пройдено
- [ ] Railway timeout test: переконатись що reconciliation job завершується за < 5 хв
- [ ] RLS negative isolation tests: перевірити що tenant A не бачить даних tenant B
- [ ] Security Checklist (з CLAUDE.md): API tokens зашифровані, жодних секретів в логах, KMS decrypt тільки в пам'яті

## Результат
<!-- Заповнюється після завершення -->

## Несподіванки
⚠️ UNEXPECTED: AWS KMS key створено в us-east-1 замість eu-central-1 (відповідно до наданих credentials AWS_REGION=us-east-1). Якщо потрібно eu-central-1 — треба окремий ключ.
⚠️ UNEXPECTED: IAM user margo-portal-kms має лише ListKeys + CreateKey права, але не GenerateDataKey/Decrypt. Key policy дозволяє root-акаунту kms:* — тобто права потрібно додати безпосередньо до IAM user policy через AWS Console або IAM API від root.
⚠️ UNEXPECTED: Railway token повертає "Not Authorized" на `me` і `projects` запити — це project-scoped token (не personal access token). Introspection і publicStats працюють. Для деплою сервісів потрібен personal token або railway CLI login.
⚠️ UNEXPECTED: Supabase Management API (api.supabase.com) вимагає окремий Supabase Personal Access Token — service_role key для цього не підходить. DDL міграції не можна запустити через REST API автоматично.

## Потрібна авторизація
🔑 AUTH_REQUIRED: Запустити міграції БД вручну — відкрити https://supabase.com/dashboard/project/qholjpqsrafmuyfnhdqo/sql/new і виконати файл supabase/migrations/RUN_IN_SUPABASE_SQL_EDITOR.sql
🔑 AUTH_REQUIRED: Додати IAM policy до user margo-portal-kms (AWS Console → IAM → Users → margo-portal-kms → Add permissions): kms:GenerateDataKey, kms:Decrypt, kms:DescribeKey на ARN arn:aws:kms:us-east-1:826496717510:key/d3c16e56-9057-4398-abc7-fa0c046419a0
🔑 AUTH_REQUIRED: Підтвердити чи Region правильний (us-east-1 vs eu-central-1 з CLAUDE.md). Якщо потрібен eu-central-1 — видалити ключ і створити заново з правильним region.
🔑 AUTH_REQUIRED: Railway token — для деплою signing-service та reconciliation-worker потрібен personal access token (Settings → Tokens у Railway dashboard) або railway CLI (`railway login`).
