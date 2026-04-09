# DECISIONS_LOG.md — Margo Portal
> Архітектурні та технологічні рішення. Тільки PM додає записи.
> Хронологічний порядок. Не видаляти старі записи.

---

## [2026-04] Архітектурні рішення — базова специфікація

### DEC-001: Тільки API, без xlsx у production
**Рішення:** xlsx не використовується в production.
**Виняток:** email-реєстри маркетплейсів — автообробка через IMAP.
**Причина:** надійність, автоматизація, відсутність ручного кроку.

### DEC-002: NovaPay — два підключення
**Рішення:** NovaPay реалізується як два незалежних конектори:
- `novapay_agent` — платіжний агент (реєстри, GetPaymentsList)
- `novapay_bank` — розрахунковий банк (виписка, GetAccountExtract)
**API:** SOAP (`business.novapay.ua/Services/ClientAPIService.svc`), не REST.
**Auth:** principal (OTP) або jwt (refresh_token).
**Поле:** `api_credentials.source_role` розрізняє ролі.

### DEC-003: Одиниця звірки = NovaPay реєстр
**Рішення:** тригер звірки — event-driven через polling NovaPay реєстру, не календарний день.
**Причина:** реєстр є природною одиницею розрахунку.

### DEC-004: payment_type = маршрутизатор алгоритму
**Рішення:** `payment_type` у чеку визначає алгоритм звірки.
**Значення:** NovaPay / Готівка / LiqPay / IBAN / Термінал / Prom / Rozetka.

### DEC-005: Модульна архітектура конекторів
**Рішення:** кожне джерело даних — незалежний модуль у `src/lib/connectors/`.
**Причина:** ізоляція, незалежне тестування, масштабування.

### DEC-006: Алгоритм — попередній до завершення Stage 0
**Рішення:** фінальний алгоритм звірки фіксується тільки після аналізу реальних даних 10 клієнтів.

### DEC-007: MATCHED_CROSS_ENTITY — завжди помилка
**Рішення:** чек зіставлений з транзакцією "не того" ФОПа в межах групи → завжди помилка, не норма.

### DEC-008: Multi-tenant архітектура
**Рішення:** `tenant → client_group → business_entity`.
**Ізоляція:** RLS на всіх таблицях по `tenant_id` / `client_group_id`. Негативні тести ізоляції — обов'язкові.

### DEC-009: algorithm_version + match_strategy в matches
**Рішення:** `reconciliation_matches` зберігає `algorithm_version` і `match_strategy` для кожного матчу.
**Причина:** аудит, відтворюваність, A/B порівняння алгоритмів.

### DEC-010: Маркетплейси — двоступеневий матчинг
**Рішення:** Prom.UA, Rozetka, Casta — два кроки:
- Крок А: замовлення (Orders API) → фіскальний чек (дата + повна сума). `match_strategy = marketplace_order`
- Крок Б: реєстр виплат (email) → банківська транзакція (сума після комісії). `match_strategy = marketplace_register`
**Email-реєстри:** IMAP polling → автообробка.

### DEC-011: Комісія маркетплейсів — delta_amount є нормою
**Рішення:** `delta_amount` в matches ≈ розміру комісії маркетплейсу — це норма, не помилка.
**Значення комісій:** Prom картка 3.5%, Prom рахунок 1.7%, Rozetka 1.5%.
**Причина:** фіскальний чек = повна сума покупця, банк отримує суму мінус комісія.

### DEC-012: Cashalot — локальний WEB API
**Рішення:** Cashalot реалізується через локальний WEB API сервер.
**URL:** в `credentials.extra.base_url` (типово порт 5757 або 8080).
**Auth:** КЕП (ДСТУ).

### DEC-013: ДПС кабінет — КЕП підпис через Railway signing-service
**Рішення:** auth через КЕП підпис (ДСТУ 4145), бібліотека `jkurwa` + `gost89`.
**Flow:** Next.js → POST railway/signing-service/sign → base64 → ДПС API.
**Причина:** jkurwa не запускається в Vercel serverless.
**Зберігання ключів:** Supabase Storage зашифровано.

### DEC-014: Валюта — UAH only в matching engine
**Рішення:** matching engine працює тільки з UAH. Не-UAH транзакції → `needs_review=true`.
**Поле:** `bank_transactions.currency` (ISO 4217).

### DEC-015: Стек
**Frontend + API:** Next.js (Vercel), serverless, timeout 60 сек на route.
**БД:** Supabase (PostgreSQL + RLS).
**Фонові сервіси:** Railway.app, job timeout 5 хв.
**Шифрування токенів:** AWS KMS eu-central-1.

### DEC-016: ПРРО та джерела
**ПРРО:** Checkbox (primary), Вчасно, Poster, Cashalot, Webcheck.
**Маркетплейси:** Prom.UA, Rozetka, Casta (Casta = маркетплейс, НЕ ПРРО).
**Інші:** ДПС Електронний кабінет, Nova Poshta.

---

## [2026-04-09] Stage 0 Discovery — архітектурні рішення за результатами реального тестування

### DEC-017: Rozetka Seller API — неможливо автоматизувати (2FA Viber)
**Рішення:** Rozetka Seller API не використовується для автоматичного отримання даних.
**Причина:** `seller.rozetka.com.ua` вимагає Viber PIN (2FA) при кожному вході. Програмна автоматизація = неможлива без обходу 2FA (порушує ToS і security).
**Стратегія замість:**
- **Step A (замовлення → чек):** RozetkaPay `TS=YYYYMMDDHHMMSS` timestamp у Checkbox `service_info` → прямий зв'язок з замовленням Rozetka
- **Step B (реєстр → банк):** email реєстри від Rozetka (IMAP polling на пошту Марго) → автообробка
**Альтернатива відхилена:** ручне введення 2FA PIN — не підходить для автоматизованого background job.

### DEC-018: marketplace_fuzzy — новий тип match_strategy
**Рішення:** Додано `marketplace_fuzzy` до MatchStrategy enum.
**Призначення:** нечіткий матч для Prom/Rozetka коли email реєстр недоступний:
- сума = order_amount × (1 - commission_rate) з допуском ±2%
- дата = delivery_date + T+N (де N = специфічний для платформи)
- confidence_score = 0.7–0.8 + `needs_review = true`
**Причина:** потрібен fallback коли реєстр виплат ще не отримано, але матч можливий з низькою впевненістю.

### DEC-019: Checkbox auth — виправлені ендпоінти (Stage 0 finding)
**Рішення:** задокументовано критичні відхилення від стандартної документації:
- `POST /cashier/signin` (lowercase) — `/signIn` (camelCase) → 404
- `Authorization: Bearer {token}` для receipts — `X-Access-Token` → 403
- `total_sum` = копійки (÷100 для UAH) — не гривні
**Причина:** виявлено через реальне тестування Stage 0. Конектор виправлено.

### DEC-020: Nova Poshta — дата тільки DD.MM.YYYY, поле IntDocNumber
**Рішення:** задокументовано критичні відхилення від типових очікувань:
- Дата фільтрації: `DD.MM.YYYY` (ISO → порожньо без помилки!)
- ТТН поле: `IntDocNumber` (НЕ `Number`)
- Max range: 3 місяці на запит
**Причина:** виявлено через реальне тестування Stage 0. Конектор виправлено.

---

## Шаблон нового запису

```
### DEC-XXX: [Назва рішення]
**Рішення:** [що вирішено]
**Причина:** [чому саме так]
**Альтернатива відхилена:** [якщо є]
**Дата:** [YYYY-MM]
```
