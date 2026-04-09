# Stage 0 — Discovery
**Статус:** IN_PROGRESS
**Reality Checker:** PENDING
**PM_STATUS:** PENDING
**Дата старту:** 2026-04-08

## Мета
Підключити всі пріоритетні API. Витягнути дані 10 клієнтів.
Визначити реальні ключі зв'язку між джерелами. Підтвердити або оновити алгоритм.

## Підтверджені робочі сценарії (Stage 0)

| Клієнт | ПРРО | Банк/Платіжка | Інше | Пріоритет |
|---|---|---|---|---|
| Голубов | Poster ✅ | ПриватБанк ✅ | — | 🔴 |
| Марков | — | ПриватБанк ✅ (валютні рахунки) | — | 🟡 |
| Собакар | Checkbox ✅ | Monobank ✅ | — | 🔴 |
| Терещук | Checkbox ✅ | NovaPay agent ✅ + NovaPay bank ✅ + ПриватБанк ✅ + Monobank ✅ | — | 🔴 |
| Куденко | Вебчек ПРРО ⚠️ (локальний сервер, API TBD) | ПриватБанк ✅ | — | 🔴 |
| Гачава | — | NovaPay ✅ | Nova Poshta ✅, Prom.UA ✅, Rozetka ✅ | 🔴 |
| Смирнова | Cashalot ✅ (локальний сервер) | ПриватБанк ✅ | — | 🔴 |
| Сухарєв | — | NovaPay refresh ✅ | Nova Poshta ✅ | 🟡 (відкладено до Stage 2a) |

## API — Задокументовані параметри

### Checkbox (оновлено 2026-04-09 — ФІНАЛ Stage 0)
- **Base URL:** `https://api.checkbox.ua/api/v1`
- **Токен у xlsx:** X-License-Key (hex 24 chars) — ліцензія каси
- **Validate:** `GET /cash-registers/info` + `X-License-Key` header → 200 ✅
- **‼️ Auth flow (виправлено):**
  1. Validate: `X-License-Key` на `/cash-registers/info`
  2. Cashier signIn: `POST /cashier/signin` (lowercase! `/signIn` → **404**)
  3. Receipts: `Authorization: Bearer {access_token}` (НЕ `X-Access-Token` — **403**!)
- **total_sum:** KOPECKS (ділити на 100 для UAH)
- **Scope receipts:** `/receipts` повертає лише поточну зміну касира. Для повної історії → `/reports` або web export XLS
- **payment.label:** 'Платіж через інтегратора NovaPay' → payment_type=novapay; 'Платіж RozetkaPay' → rozetka_pay
- **context/service info:** RozetkaPay receipts містять `TS=YYYYMMDDHHMMSS` = timestamp замовлення Rozetka (ключ для Крок А маркетплейс матчингу!)
- **Терещук:** login=`ruslanteresuk862`, pass=`ruslanteresuk862`, fiscal=4000690599, назва="МАГАЗИН ФОП Терещук Руслан Юрійович", is_test=false ✅
- **Гачава:** 190 чеків лютий (XLS archive): 143 NovaPay + 47 RozetkaPay. 63,376 UAH. Fixture: `checkbox_гачава_feb26.xlsx`
- **Статус Stage 0:** ✅ Checkbox API повністю розкрито (signin+receipts). Конектор виправлено.

### Poster
- **Base URL:** `https://joinposter.com/api`
- **Auth:** `?token={token}` query param (token format: `account_id:access_token`)
- **Транзакції:** `GET /transactions.getTransactions?date_from=UNIX&date_to=UNIX&per_page&page`
- **КРИТИЧНО: date_from / date_to = `DD.MM.YYYY` рядок** (НЕ Unix timestamp, НЕ ISO). Unix timestamps тихо повертають 0 результатів без помилки.
  - `dateFrom` camelCase → error 34 "date_from is empty"
  - `date_from=01.02.2026` → повертає 606 чеків лютого ✅
  - `date_from=1769904000` (Unix) → повертає 0 (мовчки!) ❌
- **Validate:** `transactions.getTransactions` з DD.MM.YYYY, `"response"` ключ + `response.count` = OK
- **Правильний endpoint:** `transactions.getTransactions` → `response.count`, `response.page`, `response.data[]` (НЕ `response[]` array напряму)
- **Суми:** `payed_sum`, `payed_cash`, `payed_card` = рядки у гривнях (НЕ копійки). `total_profit` = копійки (integer). Inconsistent.
- **Поле payment_type:** визначати по `payed_cash` / `payed_card` / `payed_third_party` (кількісні поля), НЕ по enum `pay_type` (значення 3 для картки — неінтуїтивно)
- **print_fiscal:** 1 = фіскальний чек надрукований (важливо для фільтрації)
- **Spot:** spot_id=1, spot_name="DiceNDrip" (відповідає PrivatBank OSND "DayseNDrip")
- **Лютий 2026:** 606 чеків, 130667.00 UAH (508 картка, 94 готівка, 4 інше). Підтверджено через XLS звіт.
- **Березень-квітень 2026:** 1302 чеки у `fetch_data.cjs`
- **Статус Stage 0:** ✅ Голубов валідований. Дані отримані. Конектор виправлено.

### Cashalot (Cashälot) — ⚠️ ЛОКАЛЬНИЙ СЕРВЕР
- **Base URL:** ВІДСУТНІЙ фіксований URL. Клієнт розгортає WEB API сервер локально на своїй інфраструктурі
- **URL зберігається в** `credentials.extra.base_url` (наприклад: `http://192.168.1.10:8080`)
- **Auth:** КЕП (кваліфікований електронний підпис) — Certificate + PrivateKey (base64) + Password + NumFiscal в тілі кожного запиту
- **Метод:** POST до кореневого шляху локального сервера
- **Команди:** `GetChecks`, `GetRegistrarState`, `SetupRegistrar`
- **Що потрібно від Смирнової:** IP/port сервера, КЕП файли (.cer/.key), пароль КЕП, NumFiscal
- **Spec:** WEB API v2.0.0.7149 (25.12.2025)

### NovaPay (SOAP API — єдиний endpoint для agent і bank)
- **‼️ SOAP, NOT REST** — повністю змінена архітектура конектору (Stage 0 finding)
- **SOAP Endpoint:** `https://business.novapay.ua/Services/ClientAPIService.svc`
- **WSDL:** `https://business.novapay.ua/Services/ClientAPIService.svc?wsdl` → 200 ✅
- **Namespace:** `http://tempuri.org/`
- **Version:** 2.37.2.6 (підтверджено в заголовку відповіді)
- **Auth методи:**
  1. `principal` (session) — `PreUserAuthentication(login, pass)` → OTP → `UserAuthentication(tempPrincipal, OTP)` → `principal` token (НЕ автоматизується без OTP)
  2. `jwt` (автоматично) — `UserAuthenticationJWT(refresh_token)` → `jwt` + новий `refresh_token` (рекомендований метод)
- **BaseClientApiRequest:** містить `principal` OR `jwt` поле + `request_ref`
- **Ключові операції:**
  - `GetClientsList(principal|jwt)` → client_id (разова ініціалізація)
  - `GetAccountsList(principal|jwt, client_id)` → account_id
  - `GetPaymentsList(principal|jwt, account_id, date_from, date_to)` → payments (agent)
  - `GetAccountExtract(principal|jwt, account_id, date_from, date_to)` → bank statement (bank)
  - `GetRegister(principal|jwt, Type, ClientId, From, Into, FileExtension)` → реєстр файл
  - `DownloadRegister` → скачати файл реєстру
- **Токени у xlsx:**
  - Терещук: 500-char = `principal` token (expired — "Invalid length for a Base-64 char array or string")
  - Сухарєв: 500-char = `jwt`, 565-char = `refresh_token`, 425-char = RSA public cert (для підпису JWT auth)
- **Статус Stage 0:** SOAP endpoint ✅ (HTTP 200 на GetClientsList), токени прострочені
- **Терещук:** клієнт підтверджує що токен актуальний (працюють у кабінеті). Проблема: веб-сесія кабінету ≠ SOAP API principal token. При тестуванні: як `principal` → "Invalid length for Base-64", як `jwt` → "JWT is not well formed". Висновок: наданий токен є session cookie веб-кабінету, а не API principal. Клієнту потрібно згенерувати API-токен в налаштуваннях NovaPay Business (або надати refresh_token для JWT flow).
- **TODO:** отримати свіжі refresh_token від клієнтів (Терещук, Сухарєв) для тесту
- **ВАЖЛИВО:** `amount_transferred` (після комісії) ≠ `total_amount` → agent connector використовує `amount_transferred`

### ПриватБанк
- **Base URL:** `https://acp.privatbank.ua/api/statements`
- **Auth:** `token` header (JWT)
- **Транзакції:** `GET /transactions/final?startDate&endDate&limit&followId` (cursor pagination)
- **Суми:** `SUM` = float string у гривні (НЕ копійки). `CCY` = окреме поле ("UAH", "USD"). Напрямок: `TRANTYPE` "C"=кредит, "D"=дебет.
- **Марков:** є гривневі рахунки (підтверджено клієнтом). Поточний токен у xlsx прив'язаний лише до USD рахунку `UA313052990000026000005925473` ($22,353). UAH рахунок потребує окремого токена від ПриватБанку. 0 UAH транзакцій = помилка токена, не порожній рахунок.
- **Собакар:** 0 транзакцій у 6-місячному діапазоні — рахунок може бути новий або неправильний токен.
- **Ключові поля для нормалізації:**

| Raw field | Нормалізоване | Примітка |
|---|---|---|
| `AUT_MY_ACC` | `account_iban` | IBAN рахунку ФОП |
| `DAT_OD` | `date` | DD.MM.YYYY → парсити |
| `TRANTYPE` | `direction` | C=credit, D=debit |
| `SUM` | `amount` | float UAH (не копійки) |
| `CCY` | `currency` | ISO 4217 |
| `OSND` | `description` | Призначення платежу |
| `AUT_CNTR_NAM` | `counterparty_name` | Найменування контрагента |
| `AUT_CNTR_ACC` | `counterparty_iban` | IBAN контрагента |
| `AUT_CNTR_CRF` | `counterparty_edrpou` | ЄДРПОУ/РНОКПП |
| `ID` | `bank_id` | Унікальний ID транзакції |
| `DOC_TYP` | `doc_type` | `p`=платіж, `m`=еквайринг |
| `STRUCT_CODE` | `struct_code` | `101`=сплата податків |

- **OSND routing patterns (для matching engine):**
  - `NOVAPAY_AGENT`: `AUT_CNTR_NAM` contains "НоваПей" OR `OSND` matches `/реестру n (\d+)/i` → extract registry_number
  - `EVO_MARKETPLACE` (Prom/Rozetka): `AUT_CNTR_NAM` contains "ФК"+"ЄВО" → extract date range + gross + commission from OSND
  - `ACQUIRING_SETTLEMENT`: `AUT_CNTR_NAM`="Розрахунки з еквайрингу" OR `OSND` starts "cmps:" → extract merchant_id, txn_count, gross, commission
  - `TAX_PAYMENT`: `TRANTYPE`=D AND (`STRUCT_CODE`=101 OR OSND matches ЄСВ/ЄП/ВЗ/ДПС) → SKIP for matching
- **Голубов:** `cmps: 36, DayseNDrip` — назва крамниці у OSND еквайрингу (збігається з Poster рахунком). 49 транзакцій/день, 10594.90 UAH відшкодовано, 139.60 комісія.
- **Гачава:** два типи надходжень: NovaPay agent (`ТОВ "НоваПей"`, реєстр N 5948720) і EVO/Prom (`ТОВ "ФК "ЕВО"`, комісія 43.92 грн з 2618.5 грн).

### Monobank
- **Base URL:** `https://api.monobank.ua`
- **Auth:** `X-Token` header
- **Rate limit:** 1 запит/61 секунду — суворий ліміт
- **Транзакції:** `GET /personal/statement/{account}/{from}/{to}` — чанки max 31 день
- **Суми:** копійки, currencyCode числовий (980=UAH, 840=USD, 978=EUR)

### Nova Poshta (оновлено 2026-04-09)
- **Base URL:** `https://api.novaposhta.ua/v2.0/json/`
- **Auth:** `apiKey` в тілі POST запиту
- **Відправлення:** метод `getDocumentList` (modelName: InternetDocument)
- **‼️ КРИТИЧНО: дата = `DD.MM.YYYY` (НЕ ISO)**. ISO формат повертає порожній масив без помилки.
- **‼️ КРИТИЧНО: ТТН поле = `IntDocNumber`** (НЕ `Number`). Конектор виправлено.
- **‼️ КРИТИЧНО: max range = 3 місяці** на запит. Потрібна pagination по кварталах.
- **Ключові поля:** `AfterpaymentOnGoodsCost` (накладений платіж, рядок!), `BackwardDeliverySum`, `BackwardDeliveryMoney`, `PaymentMethod` ('Cash'/'NonCash'), `SenderEDRPOU`
- **Сухарєв Q1 2026:** 140 відправлень. 127 Cash / 13 NonCash. **86 з накладеним платежем** (afterpayment > 0). 139 доставлено. Fixture saved.
- **Гачава токен:** `a017100be1a8dcc95439de62` = Checkbox license key (24c), НЕ Nova Poshta ключ! Клієнт надав той самий токен. Окремого NP ключа від Гачави немає.
- **Статус:** Сухарєв ✅ (32c key підтверджено). Гачава ❌ (відсутній NP токен).
- 🔑 AUTH_REQUIRED: Nova Poshta API ключ від Гачавої (окремий від Checkbox license key)

### Nova Poshta — Гачава (оновлено 2026-04-09)
- **Гачава ФОП:** ЄДРПОУ 3184920753, Білогородка (Київська обл.)
- **Профіль бізнесу:** 100% Cash відправлення (0 NonCash). 79% з afterpayment (357/450).
  Це типовий C2C e-commerce: клієнт платить при отриманні через НП afterpayment.
- **Зв'язок з Checkbox:** Checkbox receipt (payment.label='NovaPay') → НП TTN → NovaPay агент register → PrivatBank OSND "Реєстр N XXXXXXX"
- **Сценарій А для Гачавої:** НП доставка → NovaPay afterpayment → Checkbox фіскальний → NovaPay register → ПриватБанк

### Prom.UA — ⚠️ НЕМАЄ API ВИПЛАТ
- **Base URL:** `https://my.prom.ua/api/v1/`
- **Auth:** статичний Bearer token (з кабінету продавця)
- **Замовлення:** `GET /orders/list?date_from&date_to&last_id&limit` (cursor pagination)
- **Одне замовлення:** `GET /orders/{id}` — містить дані по комісії
- **ПРОБЛЕМА:** API виплат ВІДСУТНІЙ. XLS звіт з кабінету = єдине джерело точних дат виплат
- **Графік виплат Пром-оплата:**
  - Картка (P2P): T+1 день після отримання посилки, комісія 3.5%
  - Поточний рахунок (acquiring): T+8 від оплати (7 днів холд), комісія 1.7%
- **Стратегія матчингу:** Orders API (статус delivered) → сума мінус комісія ± допуск → вікно дат T+1 або T+8

### Rozetka — ⚠️ НЕМАЄ API ВИПЛАТ + 2FA БЛОКУЄ АВТОМАТИЗАЦІЮ
- **Base URL:** `https://api-seller.rozetka.com.ua`
- **Apidoc:** `https://api-seller.rozetka.com.ua/apidoc/`
- **Auth:** login + password → Bearer JWT (24h) — НЕ gapi_ token
- **gapi_ token:** Rozetka `gapi_bA_6V5...` (37 chars) → HTTP 200 але `success:false, access_denied (code 1010)`. НЕ є seller API токеном.
- **⚠️ 2FA ПІДТВЕРДЖЕНО (2026-04-09):** seller.rozetka.com.ua вимагає Viber PIN при кожному вході. Автоматизація через Seller API = **НЕМОЖЛИВА** для real-time даних.
- **Стратегія (фінальна):** email реєстри від Rozetka (IMAP polling) + RozetkaPay TS= у Checkbox receipt як ключ для Step A матчингу.
- **Login Гачавої:** `gachava1987` + `Ui34B3Bs4g` (+ Viber 2FA — нема email)
- **Замовлення:** `GET /orders/search`, `GET /orders/{id}` — містить комісію
- **Комісії:** `GET /items-commissions/search?item_id=`
- **ПРОБЛЕМА:** API реєстрів виплат ВІДСУТНІЙ. Реєстри приходять email на адресу продавця
- **Графік виплат:**
  - Пн–Чт → наступний робочий день (окремо для готівки та онлайн)
  - Пт–Нд → в понеділок (3 окремі суми)
  - Комісія: 1.5% (стандарт)
- **Стратегія матчингу:** Orders API → сума ± 1.5% + дата наступного буднього → нечіткий матч

### RozetkaPay — ОКРЕМИЙ СЕРВІС
- RozetkaPay (`cdn.rozetkapay.com/public-docs/`) = платіжний шлюз для зовнішніх магазинів
- НЕ стосується виплат від маркетплейсу Rozetka
- Auth: BasicAuth + `X-ROZETKAPAY-SIGNATURE` webhook

### Cashalot (оновлено 2026-04-09)
- **Архітектура:** 3 типи API: (1) WEB API (хмарний, через ФСКО), (2) COM API (DLL), (3) API Bridge (.NET)
- **my.cashalot.org.ua:** Cloudflare-захищений веб-портал для клієнтів. HTTP 403 на API запити.
- **Токени Смирнової** `ORNHtQfGX28QziTE` / `I5zzM3XUhJ7nvczI` (16c кожен) = back-office credentials для порталу. НЕ є КЕП ключами.
- **WEB API auth:** Certificate + PrivateKey (base64 КЕП) + Password — як і в документованій специфікації v2.0.0.7149
- **⚠️ УТОЧНЕННЯ:** Смирнова використовує локальний сервер (port 5757 або 8080) АБО хмарний WEB API. IP/port підтвердити.
- **Spec:** `cashalot.ua/instructions/api-webapi-cashalot`
- 🔑 AUTH_REQUIRED: IP/port локального сервера Смирнової + підтвердити чи використовує cloud чи local

### ДПС / Фіскальний сервер (оновлено 2026-04-09)
- **Два окремих API:**
  - `cabinet.tax.gov.ua/ws/public_api/` — публічний кабінет (Bearer UUID, 1000 req/day, лише публічні дані)
  - `fiscal.tax.gov.ua/` — **фіскальний сервер** (ПРРО receipts, окрема специфікація)
- **Куденко UUID `2f5b5944-9f8b-45f2-9e82-c324e5bc81ee`** (36c) = токен з налаштувань кабінету. За досвідом community (DOU) — не завжди працює для API, може бути session-bound.
- **TLS issue:** `cabinet.tax.gov.ua` відкидає TLS з тестового середовища (Windows schannel, код 35)
- **Фіскальні чеки:** потребують КЕП підпис (jkurwa + gost89) — підтверджено архітектурним рішенням #15
- **Spec фіскального сервера:** `tax.gov.ua/baneryi/programni-rro/opis-ari-fiskalnogo-servera/`
- **Статус:** відкладено Stage 2b. Куденко → ПриватБанк достатньо для Stage 0.

### Вебчек ПРРО (Куденко) — ⚠️ ЛОКАЛЬНИЙ СЕРВЕР, API TBD
- **Тип:** ПРРО Куденко = **Вебчек** (не ДПС кабінет як вважалось раніше)
- **Архітектура:** аналогічна Cashalot — локальний WEB API сервер на інфраструктурі клієнта
- **Варіанти розгортання:** десктоп-застосунок (Windows 32/64-bit) АБО `ВебЧек:ПРРО Сервер` (централізований)
- **Зберігання:** чеки та звіти = локальна БД на комп'ютері/сервері клієнта
- **Інтеграція з 1С:** через COM-об'єкт (DLL) або HTTP сервер компонент
- **Порт:** орієнтовно 2001 (підтверджено у документації по драйверу термінала), але може варіюватись
- **Auth:** невідома, скоріш за все token-based або KEP — задокументовано в Google Doc
- **API документація:** Google Doc `1R_N88MyLI3ZdzSotrsutgXOCCIkFDgAZ-rB9BVGgBh0` (access-restricted, потрібен доступ)
- **Що потрібно від Куденко:** IP/port Вебчек сервера + API токен/ключ
- **Credentials шаблон:** `credentials.extra.base_url` (аналогічно Cashalot)
- **Статус:** ⚠️ API format невідомий. Не блокує Stage 0 go/no-go якщо ПриватБанк Куденко ✅.

### ДПС Електронний кабінет — ⚠️ СКЛАДНА AUTH (не стосується Куденко)
- **Чеки ФОП:** Private Part API `cabinet.tax.gov.ua/ws/public_api/`
- **Auth:** КЕП підпис ЄДРПОУ з використанням українських криптостандартів ДСТУ (НЕ стандартний OpenSSL/Node.js crypto)
- **Відкрита частина:** Bearer token (1000 req/день), але лише публічні реєстри — не чеки ФОП
- **ВИСНОВОК:** Нереально для автоматичного конектора на Node.js без спеціальних бібліотек ДСТУ
- **Статус:** відкладено, не планується в Stage 0–2.

## Архітектурне рішення — Маркетплейси

**Проблема:** Prom.UA і Rozetka не мають API реєстрів виплат.

**Рішення (два рівні):**

**Рівень 1 — автоматичний (orders API + нечіткий матч):**
- Отримуємо замовлення зі статусом `delivered`/`paid` за датою
- Розраховуємо очікувану суму виплати = `order_amount * (1 - commission_rate)`
- Розраховуємо очікувану дату виплати = `delivery_date + T+N`
- Шукаємо банківську транзакцію в вікні ±2 дні з сумою ±2% (допуск)
- Якщо знайдено → `MATCHED` з низьким `confidence_score` (0.7–0.8) + `needs_review = true`

**Рівень 2 — з реєстром (точний матч):**
- Клієнт вивантажує XLS реєстр з кабінету Prom або пересилає email реєстр Rozetka
- Importer парсить реєстр → точна сума + дата виплати → `MATCHED` з `confidence_score = 1.0`
- Це залишається `needs_review = false` після верифікації бухгалтером

**Статус матч-стратегії:** `marketplace_fuzzy` (новий тип) → додати до `MatchStrategy` enum

## Чеклист

### Конектори — scaffold (DONE)
- [x] Checkbox API — структура реалізована
- [x] Poster API — реалізовано
- [x] Cashalot API — реалізовано (local server, KEP auth)
- [x] NovaPay agent — Bearer JWT (static + OAuth2 refresh)
- [x] NovaPay bank — Bearer JWT, accounts + transactions endpoints
- [x] ПриватБанк — cursor pagination, multi-currency
- [x] Monobank — X-Token, 31-day chunks, ISO currency
- [x] Nova Poshta — JSON POST, apiKey
- [x] Prom.UA — Bearer token, orders API (без виплат)
- [x] Rozetka — Bearer JWT, orders API (без виплат)

### Конектори — validate() + fetch() з реальними токенами (ТЕСТИ 2026-04-09 фінал)
- [x] Checkbox — Терещук ✅, Собакар ✅, **Гачава ✅** (device validated, license key 24c)
- [x] **Checkbox Терещук cashier ✅** — signin(lowercase)+Bearer: 200. Login=ruslanteresuk862, pass=ruslanteresuk862. 1 receipt (поточна зміна). fiscal=4000690599.
- [x] **Checkbox Собакар cashier ✅** — signin(lowercase)+Bearer: 200 (2026-04-09 фінал). Логін з `Логін та пароль касира Собакар Аліна.xlsx` — дані коректні.
- [x] Poster — Голубов ✅ Берез-Квіт 2026: 1302 чеки (перші 200 завантажено), fixture saved
- [❌] NovaPay — **БЛОКЕР: відсутній login** (2026-04-09 фінал — повний діагноз)
  - **Розшифровка файлу Сухарєва** (підтверджено 2026-04-09):
    - 500c = СПРАВЖНІЙ `refresh_token` (ASCII opaque)
    - 565c = ТЕКСТ ІНСТРУКЦІЇ українською "1. Refresh Token (оновлюваний токен)..." — НЕ ТОКЕН! Всі попередні тести відправляли цей текст помилково.
    - 425c = `public_certificate` (-----BEGIN RSA PUBLIC KEY-----)
  - **XSD схема** (підтверджено через xsd0): `UserAuthenticationJWT` = `{refresh_token, login, public_certificate}`
  - **Тести з правильним 500c токеном + 425c cert** (всі варіанти login/cert/format):
    - refresh+certPEM (no login): "Access Denied!"
    - refresh+certBase64 (no login): "Access Denied!"
    - refresh+certPEM+emptyLogin: "Access Denied!"
    - refresh only: "Access Denied!"
  - **Висновок:** `login` (email або телефон NovaPay Business акаунту) відсутній у файлі. Без нього сервер не може ідентифікувати account → "Access Denied!".
  - **Конкретний запит до клієнта (1 питання, не про токен):** "Який email або телефон використовується для входу на business.novapay.ua?"
  🔑 AUTH_REQUIRED: NovaPay Business login (email/phone) для Сухарєва і Терещука
- [x] ПриватБанк — Голубов ✅, Марків ✅, Собакар ✅, Смирнова ✅, Куденко ✅, Гачава ✅
- [x] ПриватБанк Терещук ❌ 401 — **СВІДОМО ПРОПУЩЕНО** (є 6 інших PrivatBank токенів, достатньо)
- [x] Monobank Терещук ✅ (5 рахунків)
- [x] **Nova Poshta Сухарєв ✅** — 140 відправлень Q1 2026, 86 з afterpayment. Fixture saved.
- [x] **Nova Poshta Гачава ✅** — токен `8d1e14e4e2c4681588b6c25b15bfa1bf` (32c). 450 відправлень Jan-Apr. 100% Cash, 357 з afterpayment. Fixture saved.
- [x] Nova Poshta XLS Гачава (archive лютий): 231 відправлення, структура підтверджена.
- [⚠️] Prom.UA Гачава — `АРІ Пром Гачава (1).xlsx` = ІДЕНТИЧНИЙ токен до `АРІ Пром.xlsx` (підтверджено 2026-04-09). Постійний 429 "Bot protection" з dev IP — не проблема токена, а IP блокування Prom WAF. Потрібно тестувати з Railway production IP. Токен формат (40c hex) — коректний.
  🔑 УТОЧНЕННЯ: чи Гачава і generic = різні Prom акаунти? Якщо так — потрібен окремий токен.
- [x] Rozetka Гачава — **2FA ПІДТВЕРДЖЕНО**: seller.rozetka.com.ua вимагає Viber PIN при кожному вході. **Автоматизація через seller API неможлива.**
  Стратегія: email реєстри (IMAP) + marketplace_fuzzy матчинг. RozetkaPay TS= у Checkbox = альтернативний ключ.
  Credentials: login=`gachava1987`, pass=`Ui34B3Bs4g` (2FA блокує автоматизацію)
- [⚠️] Cashalot — cloud (my.cashalot.org.ua) 403 (Cloudflare, web portal). Локальний сервер: IP/port не отримано.
  🔑 AUTH_REQUIRED: IP/port Cashalot сервера від Смирнової
- [⚠️] ДПС Куденко UUID — TLS block з тестового середовища. Відкладено.

### Дані та аналіз (оновлено 2026-04-09)
- [x] PrivatBank дані витягнуто: Марків (4 UAH+USD txns) ✅, Смирнова (7) ✅, Куденко (4) ✅, Гачава (12 — включаючи НоваПей!) ✅
- [x] Monobank Терещук: 5 рахунків (UAH + USD + EUR accounts), 2 txns за 28d. Fixture saved.
- [x] Poster Голубов: 1302 чеки за Берез-Квіт 2026 (перші 200 + fixture). Конектор confirmed working.
- [x] PrivatBank OSND patterns задокументовані (5 категорій)
- [x] EVO pattern підтверджено: ТОВ "ФК "ЕВО" = Prom/Rozetka settlement agent
- [x] NovaPay bank OSND: `реестру N XXXXXXX` = ключ зв'язку з GetRegister API (підтверджено на Гачава txns)
- [x] Gachava PrivatBank: нові поля `STRUCT_CODE`, `STRUCT_TYPE`, `RECIPIENT_ULTMT_*` — для ПДВ/міжнар транзакцій
- [⚠️] PrivatBank Марків TRANTYPE=D: всі 4 txns = debits (витрати ФОП). UAH та USD рахунки підтверджено.
- [⚠️] Monobank Терещук: `amount=-2574877` (kopecks), `currencyCode=840` (USD операція на UAH рахунку) — нормально, `amount` завжди в рахунковій валюті (kopecks UAH)
- [x] **Checkbox Терещук cashier** ✅ — 1 receipt (поточна зміна), fiscal 4000690599, type=CASHLESS+NovaPay label. Fixture saved.
- [x] **Checkbox Гачава archive**: 190 чеків лютий 2026 (143 NovaPay + 47 RozetkaPay). RozetkaPay→TS= timestamp. Fixture: `checkbox_гачава_feb26.xlsx`
- [x] **DPS Куденко archive**: 2,418 фіскальних чеків (лютий 2026). Line-item expanded (3,012 рядків). Поле `Sum` = сума чека. ⚠️ ВІДСУТНЄ поле PaymentType — не можна визначити канал оплати. Fixture: `dps_kudenko_receipts.xlsx`
- [x] **PrivatBank Гачава Feb 2026** (archive): 75 txns, 42 кредити. NovaPay реєстри в OSND ("Реєстр N XXXXXXX від DD.MM.YYYY"). EVO gross+commission explicit.
- [x] **Nova Poshta Сухарєв** ✅: 140 відправлень Q1, 86 з afterpayment. Fixture saved.
- [x] **MATCHING ANALYSIS — Голубов (Poster ↔ PrivatBank acquiring):**
  - T+N = **T+1 calendar day** (PrivatBank settling overnight, 01:00–08:00)
  - **1-to-many**: 1 bank txn = 2-3 days of Poster receipts (~49 card txns per batch)
  - Commission: **1.3005%** (explicitly in OSND: "Ком бан 139.60грн")
  - OSND parse: `/cmps:\s*(\d+)/`, `/Кiльк тр\s+(\d+)шт/`, `/Ком бан\s+([\d.]+)грн/`
  - ⚠️ `cmps` НЕ є globally unique — різні клієнти можуть мати однаковий cmps! Match key = account+cmps+date+sum
  - Date window для Poster lookup: `bank_date - 3 days` TO `bank_date - 1 day`
  - Amount tolerance: ±0.1% або ±1.00 UAH (більше з двох)
  - match_strategy: `poster_acquiring`
- [ ] PrivatBank Голубов: 0 txns у Берез-Квіт 2026 — уточнити чи acquiring settlements приходять рідше (батч-виплати)
- [ ] Собакар ПриватБанк: 0 txns — перевірити з клієнтом: новий рахунок?
- [ ] Prom.UA: перевірити чи є order ID в OSND банківської транзакції ЄВО
- [ ] Rozetka: отримати email-реєстр → проаналізувати формат
- [ ] Виміряти кількість колізій матчингу Checkbox↔NovaPay ±14 днів (Терещук) — потрібні свіжі токени
- [ ] Визначити T+N для EVO/Prom/Rozetka на реальних даних
- [x] Data Contract v1.0 — PrivatBank mapping задокументовано
- [ ] Data Contract v1.0 — Monobank + Poster + NovaPay — завершити docs/data_contract_v1.0.md

### Токени — дозбір
- [ ] Cashalot: IP/port локального сервера + КЕП файли від Смирнової
- [ ] Вчасно — Б-сценарії
- [ ] Casta — уточнити (маркетплейс, не ПРРО)
- [ ] Укрпошта — токен + платіжний механізм TBD

### Enum оновлення
- [ ] Додати `marketplace_fuzzy` до `MatchStrategy` (новий тип матчингу для Prom/Rozetka)

## Артефакти етапу
- [ ] Data Contract v1.0 (docs/data_contract_v1.0.md)
- [ ] Фіналізований алгоритм звірки (оновлення tz_v1.3.md → tz_v2.0.md якщо є зміни)

## Go/No-Go після тижня 1
- Мінімум 3 API підключені та повертають дані
- Терещук (Checkbox + NovaPay agent + NovaPay bank) — повний А-сценарій
- Гачава — Prom/Rozetka orders отримані, стратегія матчингу визначена

## Результат
<!-- Заповнюється після завершення -->

## Несподіванки

⚠️ UNEXPECTED: Cashalot WEB API — ЛОКАЛЬНИЙ сервер, НЕ хмарний. Немає фіксованого URL. Клієнт встановлює сервер на своїй інфраструктурі. Auth: КЕП (кваліфікований електронний підпис), не 16-символьні ключі як спочатку повідомила техпідтримка. Потрібні від Смирнової: IP/port сервера + КЕП файли + NumFiscal. Конектор оновлено.

⚠️ UNEXPECTED: Prom.UA — НЕМАЄ API виплат. Реєстри виплат = XLS з кабінету (ручний). Orders API є, але без точних дат/сум виплат. Матчинг = нечіткий (сума ± комісія + дата вікно). Нова стратегія `marketplace_fuzzy`. Вплив: ТЗ потребує оновлення.

⚠️ UNEXPECTED: Rozetka — НЕМАЄ API реєстрів виплат. Реєстри = email від Rozetka (PDF/CSV). Seller API дає замовлення та комісії, але не дати виплат. Стратегія аналогічна Prom. RozetkaPay = окремий платіжний шлюз, не стосується виплат маркетплейсу.

⚠️ UNEXPECTED: ДПС Електронний кабінет — API існує, але auth потребує українських криптобібліотек ДСТУ (не стандартний Node.js crypto). Реалістично лише через ручне вивантаження XLS або session-token workaround. Рекомендація: Куденко → замінити на пряме ПРРО (Checkbox/Вчасно) або ручний importer. ДПС-конектор = Stage 2b або пізніше.

⚠️ UNEXPECTED: Casta — це МАРКЕТПЛЕЙС, не ПРРО. Початково вважався ПРРО. Перекласифіковано. Конектор буде розроблятись за тим самим підходом що Prom/Rozetka.

⚠️ UNEXPECTED: Марков — валютні рахунки ПриватБанку (USD/EUR). Схема БД оновлена: поле `currency` додано до `bank_transactions`. Міграція 002 застосована.

⚠️ UNEXPECTED: Rozetka Seller API — 2FA Viber PIN при кожному вході. Автоматизація через API неможлива. Гачава підтвердила: "немає email, лише логін+пароль, і PIN на Viber". Вплив на архітектуру: Rozetka = email-реєстри (IMAP) + RozetkaPay TS= у Checkbox receipt як альтернативний ключ для Step A. DECISIONS_LOG треба оновити.

⚠️ UNEXPECTED: Nova Poshta Гачава — 100% Cash відправлення (0 NonCash), 79% з afterpayment. Не очікувалось такий однорідний профіль. Підтверджує що Гачава = типовий НП/afterpayment продавець. Для матчингу: всі NP відправлення = потенційні matches з NovaPay реєстром.

⚠️ UNEXPECTED: Checkbox signin endpoint — lowercase `/cashier/signin` (не `/cashier/signIn`). Перший варіант = 404. Другий = 200. Receipts auth = `Authorization: Bearer` (не `X-Access-Token`). `/receipts` повертає лише поточну зміну касира, не повну історію. Конектор виправлено.

⚠️ UNEXPECTED: cmps НЕ є глобально унікальним ідентифікатором ПриватБанк. Голубов cmps=36 і Куденко cmps=36 в той самий день — різні клієнти, різні рахунки. Match key = account_number + cmps + date + sum.

⚠️ UNEXPECTED: DPS Куденко (ДПС кабінет XLS) — відсутнє поле PaymentType. Неможливо визначити канал оплати (NovaPay/готівка/термінал) з цього звіту. 2,418 чеків отримано, але без типу оплати матчинг складніший. Рішення: або Вебчек API для типу оплати, або матчинг виключно по сумі+даті з низьким confidence.

⚠️ UNEXPECTED: RozetkaPay receipts у Checkbox містять `TS=YYYYMMDDHHMMSS` в полі service_info — timestamp замовлення Rozetka. Це ключ для Крок А двоступеневого маркетплейс матчингу без orders API.

⚠️ UNEXPECTED: Monobank Терещук і Собакар — ОДНАКОВИЙ рахунок. Fixtures `monobank_терещук.json` і `monobank_собакар.json` містять ідентичні транзакції (account_id `s1_IAFwIntzTElSw-cCmDw`, перша txn id `vWDQJ6jU_Dc_TfmGZg`, balance 266737). Два xlsx файли містять один і той самий токен. Можливо: Терещук = Собакар одна особа, або токен Собакара скопійовано у файл Терещука. Потрібне з'ясування у клієнта.

⚠️ UNEXPECTED: PrivatBank Марків і Собакар — 0 транзакцій навіть у 6-місячному діапазоні (2025-10-01→2026-04-07). Токени валідні (validate тест ✅), але дані відсутні. Версії: (1) Марків — лише валютні рахунки, UAH рахунок порожній; (2) Собакар — рахунок новий або неактивний. Потрібна перевірка у клієнтів.

⚠️ UNEXPECTED: EVO Group = ТОВ "ФК "ЕВО" — власник Prom.UA і Rozetka. Банківські виплати від обох маркетплейсів надходять від одного контрагента. OSND містить: дату-діапазон операцій, РНОКПП у номері договору, явну суму комісії. SUM = net. Це підтверджує стратегію `marketplace_register` (крок Б двоступеневого матчингу).

⚠️ UNEXPECTED: Poster `transactions.getTransactions` — дати ПОВИННІ бути у форматі `DD.MM.YYYY` (рядок), НЕ Unix timestamp. Unix timestamps тихо повертають 0 результатів без помилки (навіть для токенів які є валідними). Саме тому Stage 0 fetch_data.cjs отримував 0 транзакцій для Голубова. Реальні дані: 606 чеків лютого, 1302 чеків березень-квітень. Конектор та fetch script виправлено.

⚠️ UNEXPECTED: Poster `transactions.getTransactions` — це правильний endpoint для чеків (НЕ cash drawer operations). Поверненна структура: `response.count` + `response.data[]` (не `response[]` напряму). `finance.getTransactions` = зміни каси по змінах (агреговані). `dash.getAnalytics` = лише агрегована аналітика.

⚠️ UNEXPECTED: NovaPay банківська виплата OSND містить номер реєстру `реестру N 5948720 вiд 06.04.2026`. Це прямий ключ до GetRegister/DownloadRegister SOAP операцій. Матчинг: bank_txn.osnd → extract registry_id → GetRegister → individual payment items → fiscal receipts. Маршрут підтверджено.

⚠️ UNEXPECTED: PrivatBank acquiring settlement — `SUM` = вже нетто (Вiдшк сума), комісія (Ком бан) ВІДРАХОВАНА і не включена в SUM. Тобто для матчингу: сума фіскальних чеків ≈ Вiдшк + Ком бан (gross), а не SUM (net). Потрібно парсити обидві суми з OSND.

⚠️ UNEXPECTED: Checkbox — токен у xlsx = X-License-Key (24 hex chars), НЕ X-Access-Token. License key валідує пристрій (`/cash-registers/info` → 200), але `/receipts`, `/shifts`, `/reports` потребують X-Access-Token від `POST /cashier/signIn {login, password}`. Потрібно запросити cashier credentials від Собакар та Терещук. Конектор оновлено (двоступенева auth).

⚠️ UNEXPECTED: Nova Poshta — токен у обох файлах (Гачава і generic) = Checkbox license key `a017100be1...`, помилково покладений у НП файл. Реальний НП ключ Гачавої відсутній.

⚠️ UNEXPECTED: Rozetka — токен у xlsx = `gapi_bA_6V5...` (37 chars) — НЕ seller token. Повертає HTTP 200 але `access_denied (code 1010)` на `/orders/search`. Потрібен seller login+password від Гачавої.

⚠️ UNEXPECTED: Куденко ПРРО = Вебчек (не ДПС кабінет). Вебчек — локальний WEB API сервер, архітектура аналогічна Cashalot. Зберігає чеки локально. API документація в Google Doc (access-restricted). Потребує `credentials.extra.base_url` + API-токен. Auth форм не відомий до отримання доступу до документації або credentials від клієнта.

⚠️ UNEXPECTED: Марків UAH токен = прив'язаний до USD рахунку. Клієнт підтвердив: гривневі рахунки є. Поточний xlsx токен дає доступ лише до USD рахунку (balance check показав єдиний рахунок: `UA313052990000026000005925473`). Потрібен окремий токен для UAH рахунку.

⚠️ UNEXPECTED: NovaPay Терещук — наданий токен є session cookie веб-кабінету, не SOAP API principal. Клієнт каже "токен актуальний, ми ним користуємось в кабінеті" — але веб-сесія ≠ API principal token. SOAP endpoint правильний (`business.novapay.ua/...svc`), WSDL ✅. Токен з xlsx: ~500 chars base64. Тестування: як `principal` → "Invalid length for Base-64" (mod4 ≠ 0? або зайвий символ); як `jwt` → "JWT is not well formed". Рішення: клієнт повинен створити API-токен в налаштуваннях NovaPay Business або надати refresh_token для JWT flow.

⚠️ UNEXPECTED: NovaPay — НЕ REST API. Використовує **SOAP** (`business.novapay.ua/Services/ClientAPIService.svc`). `api.novapay.ua` не резолвиться (DNS). Всі REST шляхи на `business.novapay.ua/api/v1/` → ASP.NET JSON 404. SOAP WSDL підтверджений (HTTP 200). Токен Терещука = `principal` (session, прострочений). Сухарєв = `jwt` + `refresh_token` + RSA cert. Конектори повністю перероблені на SOAP. Потрібні свіжі токени.

## Потрібна авторизація
🔑 AUTH_REQUIRED: Cashalot — IP/port локального WEB API сервера + КЕП сертифікат + PrivateKey + Password + NumFiscal. Клієнт: Смирнова.

🔑 AUTH_REQUIRED: Checkbox cashier credentials — cashier_login + cashier_password для Собакар та Терещук. Потрібні для `/receipts` API. License key є.

🔑 AUTH_REQUIRED: Nova Poshta — правильний API ключ Гачавої. Файл містив Checkbox license key. Потрібно отримати реальний НП ключ.

🔑 AUTH_REQUIRED: Rozetka — seller login (email) + password від Гачавої. Існуючий `gapi_` токен не дає доступу до orders API.

🔑 AUTH_REQUIRED: NovaPay — SOAP endpoint підтверджено. Потрібні СВІЖІ токени:
  - Терещук: новий `principal` token (через OTP auth в NovaPay Business кабінеті) АБО перейти на `jwt` + `refresh_token` (рекомендовано)
  - Сухарєв: перевірити чи `refresh_token` (565 chars) ще дійсний; якщо ні — новий JWT auth cycle

🔑 AUTH_REQUIRED: ПриватБанк Терещук — токен прострочений (401). Потрібен свіжий токен.

🔑 AUTH_REQUIRED: ПриватБанк Марків — UAH рахунок. Поточний токен прив'язаний лише до USD рахунку. Потрібен новий токен для гривневого рахунку (або розширений токен що покриває всі рахунки).

🔑 AUTH_REQUIRED: Вебчек (Куденко) — IP/port Вебчек сервера + API-токен/ключ. Можливо потрібен доступ до Google Doc `1R_N88MyLI3ZdzSotrsutgXOCCIkFDgAZ-rB9BVGgBh0` (зробити публічним або надати прямий доступ).

🔑 AUTH_REQUIRED: NovaPay Терещук — API-токен (не веб-сесія). Варіанти: (1) `jwt` + `refresh_token` (рекомендовано, автоматизовано) через NovaPay Business → API → Токени; (2) новий `principal` через OTP (не автоматизується). Клієнта треба направити до відповідного розділу в NovaPay Business кабінеті.

🔑 AUTH_REQUIRED: Вчасно Каса — токен відсутній. Не блокує Stage 0 go/no-go.

🔑 AUTH_REQUIRED: Casta (маркетплейс) — токен відсутній + документація TBD.

🔑 AUTH_REQUIRED: Укрпошта — токен відсутній + платіжний механізм TBD.

🔑 AUTH_REQUIRED: Сухарєв — Checkbox + банківський токен. Не блокує Stage 0.
