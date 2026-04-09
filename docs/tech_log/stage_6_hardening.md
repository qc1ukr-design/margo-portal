# Stage 6 — Hardening
**Статус:** NOT_STARTED
**Reality Checker:** PENDING
**PM_STATUS:** PENDING

## Передумова
PM_STATUS Stage 5: має бути APPROVED перед стартом.

## Мета
Система пройшла security audit, навантажувальне тестування і має повний моніторинг. Готова до деплою на продакшн з реальними клієнтами.

## Чеклист
- [ ] Security audit: RLS перевірено на всіх таблицях (спроби cross-tenant)
- [ ] Security audit: токени не потрапляють у логи (grep по логах Railway)
- [ ] Security audit: API endpoints захищені від несанкціонованого доступу
- [ ] Security audit: rate limiting перевірено під навантаженням
- [ ] Навантажувальний тест: 50 одночасних звірок без деградації
- [ ] Навантажувальний тест: генерація 100 звітів паралельно
- [ ] Моніторинг: uptime alerts налаштовані
- [ ] Моніторинг: error rate dashboard готовий
- [ ] Моніторинг: Railway job failures алертять в Slack/Telegram
- [ ] Disaster recovery: backup стратегія задокументована і протестована
- [ ] Всі змінні середовища задокументовані (без значень) у README
- [ ] Production checklist пройдено
- [ ] Disaster Recovery план: процедура відновлення БД з backup
- [ ] Security audit: фінальна перевірка всіх RLS політик
- [ ] Penetration test (мінімальний): перевірка ізоляції між tenant-ами

## Результат
<!-- Заповнюється після завершення -->

## Несподіванки
<!-- ⚠️ UNEXPECTED: [опис] → вплив: [...] -->

## Потрібна авторизація
<!-- 🔑 AUTH_REQUIRED: [що і навіщо] -->
