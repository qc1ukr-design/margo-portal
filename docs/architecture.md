# Архітектурні рішення — Margo Portal
> Джерело правди для PM при перевірці кожного етапу.

## Стек
| Компонент | Технологія | Призначення |
|---|---|---|
| Frontend + API | Next.js (Vercel) | Портал для бухгалтерів і клієнтів |
| БД | Supabase (PostgreSQL) | Дані, RLS ізоляція |
| Фонові сервіси | Railway.app | Звірка, синхронізація API |
| Шифрування | AWS KMS eu-central-1 | Envelope Encryption токенів |

## Модель тенантів (3 рівні)
```
TENANT: Бухгалтерська компанія "Марго"
  └── CLIENT GROUP: Людина / власник бізнесу (1 логін = 1 кабінет)
        └── BUSINESS ENTITY: Конкретний ФОП або ТОВ (ЄДРПОУ)
```
Всі дані прив'язані до business_entity_id + tenant_id.

## Ролі
- **ACCOUNTANT:** повний доступ до всіх клієнтів тенанту
- **CLIENT:** read-only, тільки своя client_group

## NovaPay — подвійна роль
1. **Платіжний агент** → таблиця `novapay_transfers` (реєстри EN-номерів)
2. **Розрахунковий банк** → таблиця `bank_transactions` (bank='novapay')
Nova Poshta вимагає відкривати рахунок у NovaPay — це основний банк більшості клієнтів.

### NovaPay — два підключення
api_credentials потребує ДВОХ записів для NovaPay:
1. source='novapay_agent', source_role='agent' — платіжний агент (реєстри платежів)
2. source='novapay_bank', source_role='bank' — розрахунковий банк (банківська виписка)
UNIQUE constraint: (tenant_id, source, source_role) — НЕ просто (tenant_id, source)

## Одиниця звірки
**NovaPay реєстр** (не календарний день).
Тригер звірки: надходження нового реєстру через API (event-driven).
Перехідні залишки: прив'язка до дати реєстру (transferred_at), не до місяця.

### Тригер звірки (Event-driven)
- Polling: Railway cron кожні 15 хвилин перевіряє нові реєстри NovaPay
- При виявленні нового реєстру → запускається reconciliation_run
- Idempotency key: (tenant_id, registry_id) — захист від дубльованого запуску
- Timeout: 5 хвилин (Railway job limit) — тестується в Stage 1

## Алгоритм маршрутизації
payment_type у фіскальному чеку визначає стратегію матчингу:
- "NovaPay" → NovaPay реєстр → банк NovaPay/Приват
- "Готівка" → MATCHED_CASH (банк не шукаємо)
- "LiqPay" → LiqPay API → банк
- "IBAN/р-р" → пряма банківська виписка
- "Термінал" → еквайринг у банківській виписці
- Невідомий → UNMATCHED (на перевірку бухгалтеру)

## Статуси чека
| Статус | Опис |
|---|---|
| MATCHED_FULL | Повний ланцюжок знайдено |
| MATCHED_CASH | Готівка — банк не очікується |
| MATCHED_DIRECT | Пряме зарахування в банк |
| MATCHED_CROSS_ENTITY | Знайдено на іншому ФОПі групи — ПОМИЛКА |
| PARTIAL | Частина ланцюжка знайдена |
| UNMATCHED | Нічого не знайдено |

## Часові вікна матчингу
- NovaPay реєстр ↔ Банк: ±2 робочі дні
- Checkbox ↔ NovaPay: ±14 днів (EN-номер у чеку відсутній)
- NP відправлення ↔ NovaPay рядки: точний збіг по EN

## Безпека
- RLS на кожній таблиці по tenant_id + client_group_id
- Токени шифруються через AWS KMS (Envelope Encryption)
- Розшифрований токен — тільки в пам'яті Railway job, не логується

### RLS Negative Tests (обов'язково)
Кожна таблиця з RLS повинна мати negative isolation test:
- Тест: tenant A аутентифікується і намагається отримати дані tenant B → має отримати 0 рядків
- Тести запускаються в Reality Checker перед кожним PM Review
- Відсутність negative RLS тестів = автоматичний FAIL Reality Checker

## Важливо: алгоритм попередній
Поточна специфікація алгоритму базується на аналізі xlsx-файлів.
**Фінальний алгоритм визначається після Stage 0** на реальних API-даних.
