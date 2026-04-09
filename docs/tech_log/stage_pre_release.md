# Stage Pre-release — Міграція та підготовка до виробництва

> Виконується між Stage 6 (Hardening) і офіційним Release.
> Мета: завантажити реальні дані клієнтів, перевірити перший цикл звірки в production.

## PM_STATUS: PENDING

## Передумови
- Stage 6: PM_STATUS: APPROVED
- Всі секрети в AWS KMS (production)
- Supabase production environment готовий

## Checklist

### Підготовка prod credentials
- [ ] Для кожного клієнта внести api_credentials (зашифровані через KMS)
- [ ] Перевірити підключення до кожного API (test call)
- [ ] Налаштувати Railway cron jobs (polling 15 хв)

### Initial sync
- [ ] Запустити initial_sync для кожного tenant (дані за останні 3 місяці)
- [ ] Перевірити completeness: кількість записів відповідає очікуванням
- [ ] Виявити аномалії в даних (пропуски, дублікати)

### Перша звірка
- [ ] Запустити перший reconciliation_run для кожного tenant
- [ ] Верифікувати результати вручну по 5-10 чеках на кожен тип сценарію (A-E)
- [ ] UNMATCHED rate < 10% (якщо більше — зупинити і розслідувати)

### Авторизація власника
- [ ] Власник (Марго) підтверджує результати першої звірки
- [ ] Go/no-go для публічного релізу

## Result
<!-- Заповнити після завершення -->

## Unexpected
<!-- Проблеми виявлені під час pre-release -->

## PM Review
PM_STATUS: PENDING
Notes: <!-- PM коментарі після перевірки -->
