НАСТУПНА ДІЯ: Stage 1 — отримати доступи від власника (AWS, Supabase, Railway)

Активний крок: Stage 1 — Infrastructure & Security
Статус: NOT STARTED (очікую доступи від власника)

---

## Stage 0 — DONE (2026-04-09)
- git tag: stage-0-complete
- PM_STATUS: APPROVED
- 5 APIs підключено, Data Contract v1.0, fixtures збережено

---

## Що потрібно від власника для старту Stage 1

| Доступ | Що саме | Навіщо |
|---|---|---|
| AWS | IAM user або role в eu-central-1 з доступом до KMS | Шифрування токенів клієнтів |
| Supabase | Запрошення до проєкту або service_role key | База даних, RLS |
| Railway | Доступ до проєкту або invite | Фонові jobs (NovaPay polling, IMAP) |

Це разова авторизація. Після отримання — Stage 1 починається автономно.

---

## Відкриті питання (переносяться в Stage 2a)
- NovaPay login (email/phone NovaPay Business) для Сухарєва і Терещука
- Cashalot IP/port від Смирнової
- Nova Poshta API ключ від Гачавої (окремий від Checkbox)

---

## Маппінг файлів (для PM v2.8)
- ROADMAP -> docs/roadmap.md
- TECH_DOC -> docs/tech_log/stage_1_infrastructure.md
- DECISIONS_LOG -> DECISIONS_LOG.md

---
> Оновлювати після КОЖНОЇ сесії. НАСТУПНА ДІЯ — завжди першим рядком.
