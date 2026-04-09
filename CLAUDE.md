# CLAUDE.md — Margo Portal Master Context
> Читати перед кожним завданням. Не переходити до наступного етапу без PM_STATUS: APPROVED.

## Проєкт
Клієнтський портал бухгалтерської компанії "Марго" (SaaS, multi-tenant).
Модуль звірки чеків: автоматично зіставляє фіскальні чеки з банківськими надходженнями через ланцюжок API.
Один розробник: власник продукту + Claude Code. Velocity: 10-12 SP/sprint (2 тижні).

## Поточний стан
- **Поточний етап:** Stage 0 — Discovery
- **PM_STATUS попереднього:** N/A (старт)
- **Наступна дія:** Підключити всі API, витягнути дані 10 клієнтів

## Стек
- Frontend + API: Next.js (Vercel) — serverless, timeout 60 сек на route
- БД: Supabase (PostgreSQL + RLS)
- Фонові сервіси: Railway.app — job timeout 5 хвилин (тест в Stage 1)
- Шифрування токенів: AWS KMS eu-central-1
- ПРРО: Checkbox (primary), Вчасно, Poster, Cashalot, Webcheck
- Маркетплейси: Prom.UA, Rozetka, Casta (Casta = маркетплейс, НЕ ПРРО)
- Інші джерела: ДПС Електронний кабінет (чеки для Куденко), Nova Poshta (доставка)

## Ключові архітектурні рішення (НЕ порушувати)
1. **Тільки API** — xlsx не використовується в production (виняток: email-реєстри маркетплейсів — автообробка)
2. **NovaPay = два підключення:** платіжний агент (реєстри, source='novapay_agent') + розрахунковий банк (виписка, source='novapay_bank')
   **‼️ SOAP API** — `business.novapay.ua/Services/ClientAPIService.svc` (не REST). Auth: principal (OTP) або jwt (refresh_token). Операції: GetPaymentsList (agent), GetAccountExtract (bank).
3. **Одиниця звірки = NovaPay реєстр** (не календарний день), тригер — event-driven через polling
4. **payment_type у чеку = маршрутизатор алгоритму** (NovaPay/Готівка/LiqPay/IBAN/Термінал/Prom/Rozetka)
5. **Модульна архітектура конекторів** — кожне джерело незалежний модуль
6. **Алгоритм — попередній** до завершення Stage 0
7. **MATCHED_CROSS_ENTITY** — чек на "не тому" ФОПі групи, завжди помилка
8. **Multi-tenant:** tenant → client_group → business_entity
9. **RLS на всіх таблицях** по tenant_id / client_group_id — обов'язкові негативні тести ізоляції
10. **algorithm_version + match_strategy** зберігається в reconciliation_matches
11. **api_credentials** має source_role для розрізнення ролей (novapay_agent vs novapay_bank)
12. **Маркетплейси (Prom, Rozetka, Casta) — ДВОСТУПЕНЕВИЙ матчинг:**
    - Крок А: замовлення (Orders API, дата оплати) → фіскальний чек (по даті + повній сумі)
    - Крок Б: реєстр виплат (email) → банківська транзакція (точна сума ПІСЛЯ комісії)
    - Email-реєстри: переадресація на одну поштову скриньку Марго → IMAP polling → автообробка
    - match_strategy = `marketplace_order` (крок А) | `marketplace_register` (крок Б)
13. **КОМІСІЯ МАРКЕТПЛЕЙСІВ — критичне правило:**
    - Фіскальний чек = ПОВНА сума покупця (включаючи комісію маркетплейсу)
    - Банк отримує = сума МІНУС комісія
    - delta_amount в matches ≈ розмір комісії — це НОРМА, не помилка
    - Prom картка: 3.5%, Prom рахунок: 1.7%, Rozetka: 1.5%
14. **Cashalot** — локальний WEB API сервер. URL в `credentials.extra.base_url` (типово порт 5757 або 8080). Auth = КЕП (ДСТУ).
15. **ДПС кабінет** — реалізується через КЕП підпис (ДСТУ 4145). Бібліотека: `jkurwa` + `gost89` (npm).
    - Auth: `Authorization: <base64(CMS_SignedData)>` — підписується ЄДРПОУ/РНОКПП, БЕЗ "Bearer" префіксу
    - Ключ-файл: Key-6.dat (АЦСК) або .jks (ПриватБанк АЦСК) — великий файл, зберігається в Supabase Storage зашифровано
    - Підписування: Railway signing-service (`railway/signing-service/`) — jkurwa не запускати в Vercel serverless
    - Flow: Next.js → POST signing-service/sign → base64 → ДПС API
    - Клієнт надає: Key-6.dat або .jks файл + пароль до КЕП
16. **Валюта:** `bank_transactions.currency` (ISO 4217). Matching engine = UAH only. Не-UAH → `needs_review=true`.

## Правила розробки (обов'язкові)
- Перед стартом: перевір PM_STATUS попереднього stage у docs/tech_log/
- Після завершення: запиши результат у відповідний stage_N.md, встанови PM_STATUS: PENDING
- Петля: будуй → тестуй → виправляй → тестуй → Reality Checker → PM Review → бекап
- НЕ переходь до наступного кроку якщо є незакриті помилки
- Бекап після кожного APPROVED (у папку backups/)
- В tech_log пиши тільки: результат, несподіванки (⚠️ UNEXPECTED:), потрібна авторизація (🔑 AUTH_REQUIRED:)
- При зміні алгоритму в Stage 0: ОБОВ'ЯЗКОВО оновити tz_v1.x.md до нової версії та оновити версію в CLAUDE.md

## Reality Checker Protocol
Reality Checker — автоматизований крок перед PM Review. Перевіряє:

**Завжди (всі stages):**
- [ ] Всі тести проходять (unit + integration)
- [ ] Нуль TypeScript/linting помилок
- [ ] API endpoints відповідають контракту з tz_v1.x.md
- [ ] Fixtures у tests/fixtures/ покривають всі сценарії А–Е
- [ ] Нуль секретів у коді (токени, ключі)

**Stage 1 + Stage 6 додатково:**
- [ ] Негативний тест: юзер A НЕ бачить дані юзера B (між тенантами)
- [ ] Негативний тест: CLIENT роль НЕ бачить дані іншої client_group
- [ ] Розшифрований токен НЕ з'являється в логах
- [ ] Rate limiting активний на /api/credentials

Reality Checker FAILED → агент виправляє → петля. Без PASSED → PM Review неможливий.

## PM Review Gates
PM агент викликається при PM_STATUS: PENDING.
PM читає: CLAUDE.md + відповідний stage_N.md + розділ ТЗ для цього stage.

**Стандартна перевірка (всі stages):**
- Результат відповідає меті stage за ТЗ?
- Немає відхилень від архітектурних рішень п.1–11?
- tech_log заповнений правильно?
- Бекап зроблено?

**Security Checklist (Stage 1 і Stage 6 — обов'язково):**
- [ ] Негативні тести RLS пройдені та задокументовані
- [ ] Токени не логуються (підтверджено кодом)
- [ ] KMS envelope encryption активний
- [ ] Rate limiting налаштований
- [ ] Нуль secrets у репозиторії

**Stage 0 — додатково:**
- Data Contract v1.0 задокументований?
- Колізійність матчингу ±14 днів виміряна?
- Fallback по Prom.UA та Укрпошті вирішено?
- Якщо алгоритм змінено — ТЗ оновлено до нової версії?

**Stage 4 — додатково:**
- UAT acceptance criteria виконані (0 блокерів, acceptance від обох бухгалтерів)?
- Onboarding flow "Додати нового клієнта" протестований?

PM або: APPROVED (→ бекап → наступний stage) або REJECTED (→ список проблем → петля).

## Stages та послідовність

| Stage | Назва | Тривалість | Залежність |
|---|---|---|---|
| 0 | Discovery | 2 тижні | — |
| 1 | Infrastructure & Security | 2 тижні | Stage 0 APPROVED + Data Contract |
| 2a | Connectors — критичні | 2 тижні | Stage 1 APPROVED |
| 2b | Connectors — вторинні | 2 тижні | Stage 2a APPROVED |
| 3 | Matching Engine | 2 тижні | Stage 2a APPROVED + структура звіту зафіксована |
| 4 | UI | 2 тижні | Stage 3 APPROVED |
| 5 | Reports & Automation | 1 тиждень | Stage 4 APPROVED |
| 6 | Hardening | 1 тиждень | Stage 5 APPROVED |
| PRE | Pre-release Migration | 3-5 днів | Stage 6 APPROVED |
| — | Release | — | PRE APPROVED + власник авторизував |

**Stage 0 — go/no-go checkpoint після тижня 1:**
Після тижня 1: мінімум 3 API підключені, дані отримані. Якщо ключові поля відсутні або алгоритм потребує суттєвого перегляду → зупинка, перегляд алгоритму в рамках Stage 0 (не переходимо до Stage 1 за розкладом).

**Stage 2 — scope:**
- 2a (критичні 🔴): Checkbox, NovaPay agent, NovaPay bank, ПриватБанк, Nova Poshta
- 2b (вторинні 🟡): Вчасно, Monobank, LiqPay, Prom.UA (якщо вирішено в Stage 0), Rozetka Pay

## Сценарна карта клієнтів
| Сценарій | ПРРО | Канал | Оплата | Банк |
|---|---|---|---|---|
| А (найчастіший) | Checkbox | НП доставка | NovaPay | NovaPay-рахунок або Приват |
| Б1 | Вчасно | НП доставка | NovaPay | Приват/Mono |
| Б2 | Вчасно | Магазин | Готівка+Термінал | Приват |
| В | Checkbox | НП + Prom.UA | NovaPay+Prom | Приват |
| Г | Checkbox | Укрпошта | TBD після Stage 0 | Приват/NovaPay |
| Д | Будь-який | Онлайн | LiqPay | Приват/Mono |
| Е | Будь-який | B2B | IBAN пряме | Приват/Mono |

## Структура папок
```
docs/           — ТЗ, архітектура, roadmap, tech_log
src/lib/connectors/ — API конектори (кожен незалежний модуль)
src/lib/matching/   — алгоритм звірки + маршрутизатор
src/lib/reports/    — генерація PDF + XLS
supabase/migrations/ — зміни БД по порядку з тестами
railway/            — фонові сервіси
tests/fixtures/     — реальні анонімізовані тестові дані (з Stage 0)
backups/            — автобекапи після кожного APPROVED
```

## Авторизація від власника (тільки ці моменти)
🔑 Токени API клієнтів (Stage 0)
🔑 Доступи AWS/Supabase/Railway (Stage 1)
🔑 Go/no-go після тижня 1 Stage 0 (якщо алгоритм потребує перегляду)
🔑 Підтвердження результатів звірки (кінець Stage 3)
🔑 UAT тестування + acceptance (Stage 4)
🔑 Затвердження шаблону звіту (Stage 5)
🔑 Деплой на продакшн (Release)

## Маппінг файлів (PM v2.8 → Margo)
| PM v2.8 шукає | Margo файл |
|---|---|
| `SESSION_STATE.md` | `SESSION_STATE.md` ✅ |
| `ROADMAP.md` | `docs/roadmap.md` |
| `PROJECT_GOAL.md` | `PROJECT_GOAL.md` ✅ |
| `DECISIONS_LOG` | `DECISIONS_LOG.md` ✅ |
| `docs/TECH_DOC.md` | `docs/tech_log/stage_N.md` |
| `docs/SESSION_HISTORY.md` | `docs/tech_log/` (архів по stages) |
| Бекап milestone | `backups/` + `git tag` після APPROVED |

---

## Детальна документація
- docs/tz_v1.3.md — повне технічне завдання
- docs/architecture.md — архітектурні рішення з обґрунтуванням
- docs/roadmap.md — план для власника продукту
- docs/scenarios.md — детальна сценарна карта
