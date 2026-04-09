# ТЗ Модуля Звірки Чеків v1.3
**Клієнтський портал — бухгалтерська компанія "Марго"**

| Параметр | Значення |
|---|---|
| Версія | v1.3 |
| Попередня версія | v1.1 від 06.04.2026 |
| Дата | 07.04.2026 |
| Стек | Next.js · Supabase · Railway · AWS KMS eu-central-1 |
| Статус | ✅ Актуальне ТЗ |

## Зміни v1.3 відносно v1.1
- Тільки API (xlsx видалено з production scope)
- NovaPay додано як розрахунковий банк (подвійна роль)
- Алгоритм позначено як попередній до Stage 0
- Вікно Checkbox↔NovaPay: ±14 днів (було ±1 день)
- Новий статус MATCHED_CROSS_ENTITY
- Крок 5 алгоритму: cross-entity пошук
- payment_type як маршрутизатор алгоритму
- Оновлена сценарна карта А–Е
- Discovery Sprint: 2 тижні, 10 клієнтів
- Upload UI drag-and-drop видалено зі scope
- 1 розробник (власник + Claude Code), velocity 10-12 SP/sprint
- 2 UAT тестувальники

---

## 1. Контекст і мета

ФОП-підприємці продають товари через Нову Пошту, приймаючи оплату через NovaPay та інших платіжних агентів. При кожному продажу пробивається фіскальний чек через ПРРО (Checkbox, Вчасно та ін.). Кошти надходять на рахунок із затримкою у вигляді пакетних переказів.

**Мета модуля:** Автоматично зіставити кожен фіскальний чек із відповідною транзакцією в банку. Виявити розбіжності. Надати звіт бухгалтеру та клієнту.

**Верифікація алгоритму:** Попередній алгоритм верифіковано на xlsx-даних клієнтів (лютий 2026). Фінальний алгоритм визначається після Stage 0 Discovery на реальних API-даних.

---

## 2. Модель тенантів

```
TENANT: Бухгалтерська компанія "Марго"
  └── CLIENT GROUP: Людина / власник бізнесу (1 логін = 1 кабінет)
        └── BUSINESS ENTITY: Конкретний ФОП або ТОВ (ЄДРПОУ)
```

Ізоляція між клієнтами: RLS по client_group_id. Всі дані прив'язані до business_entity_id + tenant_id.

---

## 3. Модель ролей

### ACCOUNTANT
Повний доступ до всіх клієнтів тенанту. Вводить API-токени від імені клієнта.

| Дія | Доступ |
|---|---|
| Запустити звірку | ✅ |
| Переглянути результати | ✅ Всі клієнти |
| Ручне зіставлення | ✅ |
| Позначити "Вирішено" | ✅ |
| Керування клієнтами | ✅ |
| Вводити API-токени клієнта | ✅ |

### CLIENT
Read-only. Бачить тільки свою client_group.

| Дія | Доступ |
|---|---|
| Переглянути результати звірки | ✅ Тільки своя група |
| Завантажити PDF/XLS звіт | ✅ |
| Налаштувати власні токени | ✅ |
| Бачити дані інших клієнтів | ❌ RLS |

---

## 4. Джерела даних (тільки API)

> xlsx не використовується в production. Файли xlsx використовувались виключно для аналізу структури даних під час проєктування.

| Джерело | Роль | Пріоритет | Примітка |
|---|---|---|---|
| Checkbox | ПРРО (фіскальні чеки) | 🔴 Stage 0 | Основний реєстратор |
| Вчасно Каса | ПРРО | 🟡 Stage 0 | Альтернативний реєстратор |
| Poster | ПРРО | 🟡 | |
| Webcheck | ПРРО | 🟢 | |
| Nova Poshta | Доставка + відправлення | 🔴 Stage 0 | EN-номери |
| NovaPay (агент) | Платіжні реєстри | 🔴 Stage 0 | Реєстри + EN-рядки |
| NovaPay (банк) | Розрахунковий рахунок | 🔴 Stage 0 | Банківська виписка |
| ПриватБанк | Банк | 🔴 Stage 0 | |
| Monobank | Банк | 🔴 Stage 0 | |
| LiqPay | Платіжний агент | 🟡 Stage 0 | |
| Rozetka Pay (ФК ЕВО) | Платіжний агент | 🟡 | |
| Prom.UA | Маркетплейс + платіж | 🟡 | |
| Укрпошта | Доставка | 🟢 TBD | Платіжний механізм TBD після Stage 0 |

---

## 5. NovaPay — подвійна роль

NovaPay є небанківською фінансовою установою. Nova Poshta вимагає відкривати рахунок у NovaPay при роботі з ними. Тому NovaPay виступає одночасно:

**Роль 1 — Платіжний агент:**
- Збирає оплати покупців при отриманні посилок
- Формує реєстри (BO-номери) з переліком EN-номерів
- Таблиця: `novapay_transfers`

**Роль 2 — Розрахунковий банк:**
- Рахунок ФОП у NovaPay
- Банківська виписка через API
- Таблиця: `bank_transactions` (bank = 'novapay')

Ланцюжок для основного сценарію А:
```
Checkbox чек → NovaPay реєстр (агент) → NovaPay рахунок (банк)
```

---

## 6. Алгоритм матчингу

> ⚠️ ПОПЕРЕДНІЙ. Фінальний алгоритм визначається після Stage 0 на реальних API-даних.

### 6.1 Одиниця звірки
**NovaPay реєстр** — закритий незмінний список транзакцій з конкретними EN-номерами.
Тригер звірки: надходження нового реєстру через API (event-driven).
Дата звіту: transferred_at реєстру (не дата відправки, не дата чека).

### 6.2 Маршрутизатор (payment_type → стратегія)

payment_type у фіскальному чеку визначає шлях матчингу:

| payment_type | Стратегія |
|---|---|
| "NovaPay" / "Платіж через інтегратора NovaPay" | NovaPay реєстр → NovaPay банк або Приват |
| "Готівка" | MATCHED_CASH (банк не шукаємо) |
| "LiqPay" | LiqPay API → банк |
| "IBAN" / пряме зарахування | Пряма банківська виписка по сумі+опису |
| "Термінал" / картка | Еквайринг у виписці банку |
| "Rozetka Pay" | ФК ЕВО → банк |
| "Prom" | Prom API → банк |
| Невідомий | UNMATCHED → бухгалтеру |

### 6.3 Кроки алгоритму (попередні)

**Крок 0: Preprocessing — Refund/Return**
Перед запуском алгоритму:
- Чеки з transaction_type='return' (від'ємна сума) зіставляються з відповідним 'sale' чеком за номенклатурою та датою (вікно ±24 год).
- Успішно зіставлені повернення отримують статус MATCHED_RETURN і виключаються з основного алгоритму.
- Незіставлені повернення залишаються як UNMATCHED для ручного розгляду.

**Крок 1: NovaPay реєстр ↔ Банківська виписка**
Ключ: СУМА РЕЄСТРУ + ДАТА (±2 робочі дні)
Банк може бути NovaPay або ПриватБанк/Mono (залежить від клієнта).

**Крок 2: NovaPay рядки ↔ НП відправлення**
Ключ: EN-номер (точний збіг)
Перевірка: cargo_value ≈ amount_received (допуск ±1 грн)

**Крок 3: Checkbox чеки ↔ NovaPay рядки**
Ключ: Тип оплати "NovaPay" + Сума + Дата (±14 днів)
⚠️ EN-номер у чеках Checkbox відсутній — тільки через суму і дату.

**Крок 4: Checkbox чеки ↔ Банк напряму (Rozetka Pay)**
Ключ: Сума + FC-префікс + Дата (±3 дні)

**Крок 5 (новий): Cross-entity пошук**
Для записів зі статусом UNMATCHED після кроків 1-4:
Шукати в інших business_entities тієї ж client_group.
Якщо знайдено → MATCHED_CROSS_ENTITY (ПОМИЛКА — чек на "не тому" ФОПі).

### 6.4 Правила tie-breaking та ідемпотентність

**Tie-breaking:** Два кандидати з однаковою сумою/датою → обирається з меншою дельтою в часі. При рівності → PARTIAL + needs_review = true.

**Ранній вихід:** Після успішного матчингу на кроці N → кроки N+1..5 не виконуються.

**Ідемпотентність:** POST /api/reconciliation/run → HTTP 409 якщо існує run для (business_entity_id, period) зі статусом pending|running.

**Async flow:** POST /run → HTTP 202 + run_id. Клієнт поллить GET /runs/:id кожні 2 секунди.

### 6.5 Статуси чека

| Статус | Опис | Дія |
|---|---|---|
| MATCHED_FULL | Повний ланцюжок знайдено | ✅ Норма |
| MATCHED_CASH | Готівка — банк не очікується | ✅ Норма |
| MATCHED_DIRECT | Пряме зарахування в банк | ✅ Норма |
| MATCHED_RETURN | Повернення зіставлено з відповідним sale чеком | ✅ Норма (повернення) |
| MATCHED_CROSS_ENTITY | Знайдено на ІНШОМУ ФОПі групи | 🔴 ПОМИЛКА — обов'язково виділити |
| PARTIAL | Частина ланцюжка знайдена | ⚠️ Перевірити |
| UNMATCHED | Нічого не знайдено | ⚠️ Перевірити |

### 6.6 Перехідні залишки на стику місяців
Реєстр від 03.02 з EN-ами відправленими 28-31.01 → включається у ЛЮТИЙ (за датою transferred_at).
У звіті: окрема позначка "⚠️ Перехідні реєстри: N реєстрів з попереднього місяця".

---

## 6.7 Тригер запуску звірки
Звірка запускається подійно: при надходженні нового реєстру NovaPay (polling кожні 15 хвилин через Railway cron).
- Polling interval: 15 хвилин (Railway cron job)
- При виявленні нового реєстру → запускається `reconciliation_run` для відповідного tenant
- Дубльований запуск захищений idempotency key: (tenant_id, registry_id)
- Timeout на один run: 5 хвилин (Railway limit)

---

## 7. Схема бази даних (Supabase)

> RLS Policy на кожній таблиці: tenant_id = auth.jwt()->>'tenant_id'
> CLIENT role додатково: client_group_id = auth.jwt()->>'client_group_id'

### 7.1 Таблиці тенантів

| Таблиця | RLS | Ключові колонки |
|---|---|---|
| tenants | — | id UUID PK, name TEXT, plan TEXT, created_at |
| client_groups | tenant_id | id UUID PK, tenant_id FK, name TEXT, email TEXT, phone TEXT, status TEXT |
| business_entities | tenant_id | id UUID PK, client_group_id FK, tenant_id FK, type TEXT (fop/tov/pp), name TEXT, edrpou TEXT, tax_system TEXT, is_active BOOLEAN |
| client_module_settings | tenant_id | id UUID PK, tenant_id FK, client_group_id FK, module_id TEXT (reconciliation/dps_monitor/bank_balance/ep_limits/chat), is_enabled BOOLEAN DEFAULT false, enabled_by UUID FK, enabled_at TIMESTAMPTZ |

### 7.2 Таблиці даних

| Таблиця | RLS | Ключові колонки |
|---|---|---|
| fiscal_receipts | tenant_id | id, business_entity_id FK, source TEXT (checkbox/vchasno/poster), fiscal_num TEXT, payment_type TEXT, transaction_type TEXT NOT NULL DEFAULT 'sale', amount NUMERIC(12,2), rounded_amount NUMERIC(12,2), receipt_datetime TIMESTAMPTZ, is_offline BOOLEAN, external_id TEXT UNIQUE, raw_json JSONB |
| np_shipments | tenant_id | id, business_entity_id FK, en_number TEXT UNIQUE INDEX, en_date TIMESTAMPTZ, cargo_value NUMERIC(12,2), payment_form TEXT (Безготівка/Готівка), received_at TIMESTAMPTZ, raw_json JSONB |
| novapay_transfers | tenant_id | id, business_entity_id FK, registry_num TEXT INDEX, en_number TEXT INDEX, amount_received NUMERIC(12,2), commission NUMERIC(12,2), amount_transferred NUMERIC(12,2), transferred_at TIMESTAMPTZ, raw_json JSONB |
| bank_transactions | tenant_id | id, business_entity_id FK, bank TEXT (privat/mono/novapay/other), ref_num TEXT INDEX, amount NUMERIC(12,2), purpose TEXT, counterparty_name TEXT, transaction_date DATE INDEX, external_id TEXT UNIQUE, raw_json JSONB |
| api_credentials | tenant_id | id, business_entity_id FK, source TEXT, source_role TEXT, token_encrypted TEXT (AES-256-GCM), kms_key_id TEXT, is_active BOOLEAN |

> **fiscal_receipts:** `transaction_type TEXT NOT NULL DEFAULT 'sale'` — 'sale' | 'return' — для Refund/Return обробки

> **api_credentials — NovaPay потребує два записи:**
> - source='novapay_agent', source_role='agent' — платіжний агент (реєстри)
> - source='novapay_bank', source_role='bank' — розрахунковий банк (виписка)
>
> **UNIQUE constraint:** (tenant_id, source, source_role) — НЕ просто (tenant_id, source).
>
> `source_role TEXT` — 'agent' | 'bank' — для NovaPay (розрізняє два підключення)

### 7.3 Таблиці звірки

| Таблиця | RLS | Ключові колонки |
|---|---|---|
| reconciliation_runs | tenant_id | id, business_entity_id FK, scope TEXT (entity/group), period_start DATE, period_end DATE, status TEXT (pending/running/done/error), total_receipts INT, matched_count INT, unmatched_receipts INT, created_at, completed_at |
| reconciliation_matches | tenant_id | id, run_id FK, match_type TEXT (full/partial/manual/cross_entity), receipt_id FK, np_shipment_id FK, novapay_transfer_id FK, bank_transaction_id FK, cross_entity_id UUID nullable, match_confidence NUMERIC(5,2), needs_review BOOLEAN DEFAULT false, algorithm_version TEXT NOT NULL, match_strategy TEXT NOT NULL |
| reconciliation_unmatched | tenant_id | id, run_id FK, source TEXT, source_id UUID, amount NUMERIC(12,2), transaction_date DATE, reason TEXT, status TEXT (new/reviewed/resolved), notes TEXT, resolved_by UUID nullable |
| import_logs | tenant_id | id, business_entity_id FK, source TEXT, import_type TEXT (api), rows_total INT, rows_imported INT, rows_skipped INT, errors JSONB, imported_by UUID, imported_at TIMESTAMPTZ |

> **reconciliation_matches:** `algorithm_version TEXT NOT NULL` — версія алгоритму ('v1.0', 'v2.0', etc.); `match_strategy TEXT NOT NULL` — крок алгоритму ('novapay_registry', 'checkbox_novapay', 'cross_entity', etc.)

---

## 7.4 Стратегія зберігання raw_json
- raw_json зберігається для всіх вхідних даних (реєстри, транзакції, чеки) у відповідних таблицях
- Retention period: 90 днів (потім обрізається автоматичним cron)
- Призначення: дебаг, аудит, reprocessing при зміні алгоритму
- Supabase pg_cron для автоматичного очищення: DELETE WHERE created_at < NOW() - INTERVAL '90 days'

---

## 8. API Endpoints

| Метод | Endpoint | Роль | Опис |
|---|---|---|---|
| POST | /api/reconciliation/sync | ACCOUNTANT | API синхронізація для джерела. Асинхронно (Railway job). |
| POST | /api/reconciliation/run | ACCOUNTANT | Запуск звірки. HTTP 202 + run_id. Ідемпотентний. |
| GET | /api/reconciliation/runs | BOTH | Список звірок. Фільтр по period, entity. |
| GET | /api/reconciliation/runs/:id | BOTH | Деталі + статус (для polling кожні 2 сек). |
| GET | /api/reconciliation/matches/:run_id | BOTH | Зіставлені. Пагінація. Фільтр: match_type. |
| GET | /api/reconciliation/unmatched/:run_id | BOTH | Незіставлені. Фільтр: source, status. |
| PATCH | /api/reconciliation/unmatched/:id | ACCOUNTANT | Ручне зіставлення або "Вирішено". Audit trail: user_id + timestamp. |
| POST | /api/credentials | BOTH | Збереження токену. Шифрування через KMS. |
| GET | /api/reconciliation/report/:run_id | BOTH | PDF або XLS звіт. Генерація на Railway. |
| PATCH | /api/clients/:id/modules | ACCOUNTANT | Вмикання/вимикання модулів для client_group. |

---

## 8.1 Онбординг нового клієнта
1. Tenant створюється адміністратором (Марго) через internal API
2. Для кожного джерела даних вноситься запис в api_credentials (зашифрований через AWS KMS)
3. Запускається initial_sync: завантаження даних за останні 3 місяці
4. Після initial_sync → перша ручна звірка з відміткою "initial" у reconciliation_runs
5. Клієнт отримує доступ (роль CLIENT) і може переглядати результати

---

## 9. Звіт (PDF + XLS)

### Рівні звіту
- **Entity report:** звірка одного ФОПа
- **Group report:** зведений по всій client_group — виявляє MATCHED_CROSS_ENTITY

### Структура звіту
1. **Загальна структура надходжень** (по джерелах)
   - Таблиця: Джерело | Надійшло на р/р | Пробито чеків | Розбіжність | %
2. **Деталізація по кожному джерелу** (кількість, сума, статуси)
3. **Конкретні розбіжності** (деталь по кожній позиції: дата, сума, причина)
4. **MATCHED_CROSS_ENTITY** — виділений окремий блок (ПОМИЛКА)
5. **Висновок + рекомендації** (авто-скрипт, бухгалтер редагує)

### Формат
- PDF: брендований (логотип TBD), для передачі клієнту
- XLS: для аналізу командою (рішення про надання клієнту TBD)

### Важливо
Фінальна структура звіту визначається після Stage 0 на реальних API-даних.
Рекомендаційні скрипти розробляються після Stage 3.

### Каденція
- Тригер: новий NovaPay реєстр → авто-звірка
- Алерт: unmatched > 5% після реєстру
- Щомісячний зведений звіт (авто)
- Кастомний період: до 2+ років (для річної звірки перед декларацією)

---

## 10. Безпека

### AWS KMS — шифрування токенів
1. ACCOUNTANT або CLIENT вводить токен через HTTPS
2. Next.js передає на Railway KMS сервіс
3. Railway шифрує через AWS KMS eu-central-1 (Envelope Encryption)
4. Зашифрований blob → api_credentials.token_encrypted
5. При синхронізації: Railway розшифровує у пам'яті, використовує, не повертає
6. Розшифрований токен НЕ логується

### RLS ізоляція
| Рівень | Policy |
|---|---|
| Між тенантами | tenant_id = auth.jwt()->>'tenant_id' |
| Між клієнтами (CLIENT) | client_group_id = auth.jwt()->>'client_group_id' |
| ACCOUNTANT | tenant_id = my_tenant (всі client_groups) |

---

## 11. Граничні значення

- Максимальний розмір імпорту API (batch): 10 000 записів за запит
- Максимальний period для одного run: 3 місяці (більше → кілька runs)
- Максимум business_entities на client_group: 20
- Таймаут Railway job: 5 хвилин
- Retention: reconciliation_runs/matches/unmatched — 3 роки
- HTTP 409: повторний run для (entity, period) зі статусом pending/running

---

## 12. Обробка виняткових ситуацій

| Ситуація | Логіка |
|---|---|
| Готівкова оплата | payment_form = 'Готівка' → MATCHED_CASH, банк не шукаємо |
| Затримка зарахування 1-7 днів | Вікно ±2 робочі дні для реєстр↔банк |
| Комісія NovaPay | amount_received (чек) ≠ amount_transferred (банк) — норма |
| 1 банківський переказ = N чеків | 1 BO-запис = 1 реєстр = N рядків = N чеків |
| Дублікат імпорту | UNIQUE на external_id, INSERT ... ON CONFLICT DO NOTHING |
| Офлайн чек (is_offline=true) | Фіскалізація могла бути пізніше — включаємо, позначаємо |
| Кілька банків у клієнта | Шукаємо по всіх активних рахунках entity одночасно |
| Повернення (Return/Refund) | Тип='RETURN', від'ємна сума в банку — звіряємо окремо |
| Cross-entity помилка | Чек пробито на "не тому" ФОПі → MATCHED_CROSS_ENTITY, яскраво виділяємо |
| API недоступний | Retry з exponential backoff (3 спроби), потім status=error + алерт |

---

## 13. Метрики успіху

| Метрика | Ціль |
|---|---|
| Точність автоматичного матчингу | > 95% |
| Час виконання звірки (1 місяць) | < 30 сек |
| Час бухгалтера на звірку | < 10 хв / клієнт |
| Помилки синхронізації API | < 1% |

---

## 14. Plan розробки

### Команда
- 1 розробник: власник продукту + Claude Code
- Velocity: ~10-12 SP/sprint (2 тижні)
- UAT: 2 тестувальники з команди Марго

### Етапи

| Етап | Тривалість | Зміст |
|---|---|---|
| Stage 0: Discovery | 2 тижні | Підключити всі API, 10 клієнтів, аналіз даних, фінальний алгоритм |
| Stage 1: Infrastructure | 2 тижні | Supabase RLS, AWS KMS, Railway, CI/CD |
| Stage 2: Connectors | 2 тижні | Всі API-конектори (модульна архітектура) |
| Stage 3: Matching Engine | 2 тижні | Алгоритм звірки на реальних даних |
| Stage 4: UI | 2 тижні | Кабінет бухгалтера + клієнта, UAT |
| Stage 5: Reports | 1 тиждень | PDF, XLS, cron, alerts |
| Stage 6: Hardening | 1 тиждень | Security, performance, monitoring |

### PM Review Gate на кожному етапі
Після Reality Checker → PM Agent перевіряє: відповідність ТЗ + архітектурі → APPROVED або REJECTED.
Деталі: CLAUDE.md → розділ "PM Review Gates".

---

## 15. Ризики

| Ризик | Ймовірність | Вплив | Мітигація |
|---|---|---|---|
| API змінює формат | Середня | Критичний | Модульні конектори, version pinning, логування невідомих форматів |
| Алгоритм не масштабується | Середня | Високий | Performance тест в Stage 3 на синтетичних 5k+ чеків |
| UX-проблеми після UAT | Висока | Середній | Бухгалтери в Stage 4, buffer SP на UX-правки |
| API недоступний | Середня | Низький | Retry + алерт, система продовжує з наявними даними |
| Нові сценарії клієнтів | Висока | Низький | Модульна архітектура дозволяє додавати без переробки |

---

## 16. Відкриті питання

| # | Питання | Статус | Коли закрити |
|---|---|---|---|
| 1 | Укрпошта: платіжний механізм | 🔴 TBD | Stage 0 |
| 2 | XLS звіт: надавати клієнту? | 🟡 TBD | Stage 5 |
| 3 | Рекомендаційні скрипти: типові причини розбіжностей | 🔴 TBD | Stage 3 |
| 4 | Що при коригуванні реєстру NovaPay постфактум? | 🔴 TBD | Stage 2 |
| 5 | Фінальна структура PDF звіту | 🟡 Чернетка є, уточнюється | Stage 0 |
| 6 | Перший UAT користувач | ✅ 2 бухгалтери з команди Марго | — |
| 7 | ACCOUNTANT_ADMIN роль | 🟡 Опціонально | Stage 1 |
| 8 | Prom.UA API: доступність та формат | 🔴 TBD | Stage 0 |

---

*ТЗ v1.3 · Margo Portal · 07.04.2026 · Конфіденційно*
