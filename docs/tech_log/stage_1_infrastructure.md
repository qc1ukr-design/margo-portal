# Stage 1 — Infrastructure & Security
**Статус:** NOT_STARTED
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
- [ ] AWS KMS key створено (eu-central-1)
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
<!-- ⚠️ UNEXPECTED: [опис] → вплив: [...] -->

## Потрібна авторизація
<!-- 🔑 AUTH_REQUIRED: [що і навіщо] -->
