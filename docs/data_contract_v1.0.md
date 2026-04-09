# Data Contract v1.0
> Stage 0 Discovery. Всі поля підтверджені на реальних даних (2026-04-08).

## 1. PrivatBank → `bank_transactions`

**Endpoint:** `GET /api/statements/transactions/final`
**Auth:** `token` header
**Pagination:** cursor (`followId`)

| Raw field | Нормалізоване | Тип | Примітки |
|---|---|---|---|
| `AUT_MY_ACC` | `account_iban` | string | IBAN власного рахунку ФОП |
| `DAT_OD` | `date` | date | DD.MM.YYYY → parseDate |
| `TIM_P` | `time` | string | HH:MM |
| `DATE_TIME_DAT_OD_TIM_P` | `datetime` | datetime | "DD.MM.YYYY HH:MM:SS" |
| `TRANTYPE` | `direction` | enum | `C`=credit, `D`=debit |
| `SUM` | `amount` | decimal | Float UAH (НЕ копійки). Для еквайрингу = вже нетто (без комісії) |
| `CCY` | `currency` | string | ISO 4217: `UAH`, `USD`, `EUR` |
| `OSND` | `description` | text | Призначення платежу — ключ для routing |
| `AUT_CNTR_NAM` | `counterparty_name` | string | Найменування контрагента |
| `AUT_CNTR_ACC` | `counterparty_iban` | string | IBAN контрагента |
| `AUT_CNTR_CRF` | `counterparty_edrpou` | string | ЄДРПОУ або РНОКПП |
| `ID` | `bank_id` | string | Унікальний ID транзакції |
| `REF` | `bank_ref` | string | Внутрішній REF ПриватБанку |
| `DOC_TYP` | `doc_type` | string | `p`=платіж, `m`=еквайринг |
| `STRUCT_CODE` | `struct_code` | string | `101`=податковий платіж |
| `NUM_DOC` | `doc_number` | string | Номер документу |

### OSND Routing Patterns

| Категорія | Detect | Extract | match_strategy |
|---|---|---|---|
| `NOVAPAY_AGENT` | `AUT_CNTR_NAM` ∋ "НоваПей" OR `OSND` ∋ `/реестру n (\d+)/i` | `registry_number` | `novapay_registry` |
| `EVO_MARKETPLACE` | `AUT_CNTR_NAM` ∋ "ФК"+"ЄВО" | date_range, gross (суму N грн), commission (винагор. M грн) | `marketplace_register` |
| `ACQUIRING_SETTLEMENT` | `AUT_CNTR_NAM`="Розрахунки з еквайрингу" OR `OSND` starts "cmps:" | merchant_id (`cmps: (\d+)`), gross (Вiдшк), commission (Ком бан) | `acquiring_batch` |
| `TAX_PAYMENT` | `TRANTYPE`=D AND (`STRUCT_CODE`=101 OR OSND ∋ ЄСВ/ЄП/ВЗ) | — | SKIP |
| `INCOME_TRANSFER` | `TRANTYPE`=C, `DOC_TYP`=p, решта | — | manual_review |

**Важливо для еквайрингу:**
`SUM` = Вiдшк (відшкодування, вже нетто).
Для матчингу: `∑ fiscal_receipts ≈ gross = SUM + commission (з OSND "Ком бан N грн")`.

**EVO delta:**
`gross` = з OSND "суму {N} грн", `commission` = "винагор. {M} грн".
`SUM` = gross - commission = net received.
`delta_amount` в matches ≈ commission — це НОРМА.

---

## 2. Monobank → `bank_transactions`

**Endpoint:** `GET /personal/statement/{account_id}/{from}/{to}`
**Auth:** `X-Token` header
**Rate limit:** 1 req / 61 sec per token
**Max range:** 31 днів (використовувати 28 для запасу)

| Raw field | Нормалізоване | Тип | Примітки |
|---|---|---|---|
| `id` | `bank_id` | string | Унікальний ID транзакції |
| `time` | `datetime` | datetime | Unix timestamp (секунди) → toISOString |
| `description` | `description` | text | Призначення (може бути пусте) |
| `mcc` | `mcc` | integer | Merchant Category Code |
| `amount` | `amount` | decimal | **Копійки** → ділити на 100. Від'ємне = дебет |
| `operationAmount` | `operation_amount` | decimal | Копійки, оригінальна сума операції |
| `currencyCode` | `currency` | string | `980`→UAH, `840`→USD, `978`→EUR |
| `commissionRate` | `commission_rate` | decimal | Комісія (копійки) |
| `cashbackAmount` | `cashback_amount` | decimal | Кешбек (копійки) |
| `balance` | `balance_after` | decimal | Залишок після операції (копійки) |
| `hold` | `is_hold` | boolean | true = утримання (ще не підтверджено) |
| `receiptId` | `fiscal_receipt_id` | string | ID чека ПРРО (якщо є) — потенційний прямий зв'язок |
| `_account_type` | — | string | Тип рахунку: `black`, `white`, `platinum` |
| `_currency_code` | — | integer | Числовий код валюти |

**Важливо:**
- `amount < 0` = витрата (дебет), `amount > 0` = надходження (кредит)
- `hold = true` → транзакція ще в обробці, може бути скасована → `is_hold=true`, не включати в sound reconciliation до підтвердження
- `receiptId` — якщо заповнено, може бути прямим посиланням на чек ПРРО. **Потребує перевірки на реальних чекових даних.**

### Account Fetch Order
1. Отримати список рахунків: `GET /personal/client-info`
2. Пріоритет: `currencyCode === 980` (UAH). Fallback: перший рахунок.
3. Окремо фетчити кожен рахунок (black, white, savings) — різні `account_id`.

---

## 3. Poster → `fiscal_receipts`

**Endpoint:** `GET /api/transactions.getTransactions`
**Auth:** `?token={account_id}:{access_token}` query param
**Date params:** `date_from` / `date_to` = **`DD.MM.YYYY` string** (NOT Unix, NOT ISO — Unix silently returns 0!)
**Response:** `{ response: { count: N, page: {...}, data: [...] } }` (NOT `response[]` directly)

| Raw field | Нормалізоване | Тип | Примітки |
|---|---|---|---|
| `transaction_id` | `external_id` | integer | Receipt/order ID |
| `date_close` | `fiscal_date` | string | "YYYY-MM-DD HH:MM:SS" — when paid |
| `payed_sum` | `amount` | decimal | **UAH string** "130.00" (NOT kopecks) |
| `payed_cash` | — | decimal | Cash portion UAH |
| `payed_card` | — | decimal | Card portion UAH |
| `payed_third_party` | — | decimal | Third-party (LiqPay?) UAH |
| `sum` | — | decimal | Pre-discount amount UAH |
| `reason` | `transaction_type` | integer | 0=sale, 1=return |
| `print_fiscal` | `is_fiscal` | integer | 1 = fiscal receipt printed |
| `spot_id` | — | integer | Venue ID (1=DiceNDrip) |
| `products[]` | — | array | Line items (product_id, num, payed_sum) |
| `total_profit` | — | integer | **Kopecks** (inconsistent with string fields!) |

**Payment type routing:**
- `payed_card > 0` AND `payed_cash = 0` → `terminal` (→ PrivatBank acquiring batch)
- `payed_cash > 0` AND `payed_card = 0` → `cash`
- `payed_third_party > 0` → `liqpay` (or NovaPay — verify in Stage 2)
- Both > 0 → `mixed`

**Confirmed Feb 2026 data:** 606 receipts, 130,667.00 UAH (508 card, 94 cash, 4 other). Matches XLS report exactly.

**Spot:** spot_id=1, name="DiceNDrip" (= "DayseNDrip" in PrivatBank OSND — acquiring terminal name).

---

## 4. Checkbox → `fiscal_receipts`

**Base URL:** `https://api.checkbox.ua/api/v1`
**Auth flow (two-step, confirmed Stage 0):**
1. `GET /cash-registers/info` + `X-License-Key: {24-hex-char}` → validate device
2. `POST /cashier/signin` (⚠️ lowercase! `/signIn` → **404**) + `{login, password}` → `access_token`
3. `GET /receipts` + `Authorization: Bearer {access_token}` (⚠️ NOT `X-Access-Token` → **403**)

**Pagination:** `?offset=N&limit=100&from_date=ISO&to_date=ISO`
**Scope:** `/receipts` → лише поточна зміна касира. Для повної історії → `/reports` або XLS export.

| Raw field | Нормалізоване | Тип | Примітки |
|---|---|---|---|
| `id` | `external_id` | string | UUID чека |
| `fiscal_code` | `receipt_number` | string | Фіскальний номер ПРРО |
| `serial` | `serial` | integer | Серійний номер чека |
| `created_at` | `datetime` | datetime | ISO 8601 |
| `fiscal_date` | `fiscal_date` | datetime | ISO 8601 (може бути null → fallback до created_at) |
| `total_sum` | `amount` | decimal | ⚠️ **Копійки → ÷100 UAH** |
| `type` | `transaction_type` | enum | `SELL`→sale, `RETURN`→return, `SERVICE_IN`, `SERVICE_OUT` |
| `payments[]` | — | array | Масив платежів (type + value + label) |
| `payments[].type` | — | enum | `CASH`, `CASHLESS` |
| `payments[].label` | `payment_type` | string | Назва способу (ключ для routing) |
| `payments[].value` | `payment_amount` | decimal | Копійки → ÷100 |
| `goods[]` | — | array | Товари: name, price, quantity, total_sum |

**payment_type routing** (via `payments[].label`, case-insensitive):
| Label pattern | payment_type | match_strategy |
|---|---|---|
| contains "novapay" або "новапей" або "нп" | `novapay` | `novapay_registry` |
| contains "liqpay" | `liqpay` | `liqpay_direct` |
| contains "rozetka" | `rozetka_pay` | `marketplace_order` |
| contains "prom" | `prom` | `marketplace_order` |
| type=`CASH` (якщо label не підходить) | `cash` | none |
| type=`CASHLESS` (термінал) | `terminal` | `acquiring_batch` |

**Rozetka receipts:** `service_info` field містить `TS=YYYYMMDDHHMMSS` = timestamp замовлення Rozetka → ключ для Step A marketplace матчингу.

**Confirmed data:**
- Терещук: 1 receipt (current shift), fiscal=4000690599, CASHLESS/NovaPay ✅
- Гачава Feb 2026 (XLS archive): 190 receipts, 143 NovaPay + 47 RozetkaPay, 63,376 UAH ✅
- Собакар + Терещук: cashier signin ✅ (2026-04-09)

---

## 5. Nova Poshta → `shipments` (допоміжна таблиця для linking)

**Base URL:** `https://api.novaposhta.ua/v2.0/json/`
**Method:** POST з JSON body (не REST)
**Auth:** `apiKey` в тілі кожного запиту (32 hex chars)

**Запит відправлень:**
```json
{
  "apiKey": "{token}",
  "modelName": "InternetDocument",
  "calledMethod": "getDocumentList",
  "methodProperties": {
    "DateTimeFrom": "01.02.2026",   // ⚠️ DD.MM.YYYY тільки! ISO → порожньо без помилки
    "DateTimeTo": "28.02.2026",
    "Page": 1,
    "Limit": 200,                   // max per page (підтверджено)
    "GetFullList": 1
  }
}
```
⚠️ **Max range = 3 місяці** на запит. При більшому діапазоні → помилка API.

| Raw field | Нормалізоване | Тип | Примітки |
|---|---|---|---|
| `IntDocNumber` | `en_number` | string | ⚠️ **НЕ `Number`** — TTН номер (20 цифр) |
| `Ref` | `ref` | string | GUID (внутрішній ключ НП) |
| `DateTime` | `created_date` | string | "YYYY-MM-DD HH:mm:ss" |
| `RecipientDateTime` | `delivered_date` | string/null | "DD.MM.YYYY HH:mm:ss" (дата вручення) |
| `Cost` | `cost` | decimal | Оголошена вартість (UAH) |
| `PaymentMethod` | `payment_method` | string | `Cash` або `NonCash` |
| `AfterpaymentOnGoodsCost` | `afterpayment_amount` | decimal/null | Сума накладеного платежу (рядок → парсити!) |
| `BackwardDeliverySum` | `backward_delivery_sum` | decimal/null | Зворотня доставка |
| `BackwardDeliveryMoney` | `backward_delivery_money` | decimal/null | Гроші зворотньої доставки |
| `StateName` | `state` | string | Стан доставки (текст) |
| `State` | `state_code` | string | Код стану |
| `SenderEDRPOU` | `sender_edrpou` | string | ЄДРПОУ відправника |

**Ключ зв'язку з NovaPay:**
`IntDocNumber` (ТТН) → NovaPay payment `en_number` → `GetPaymentsList` result → Checkbox receipt

**Confirmed data:**
- Сухарєв Q1 2026: 140 відправлень, 127 Cash / 13 NonCash, 86 з afterpayment ✅
- Гачава Jan-Apr 2026: 450 відправлень, 100% Cash, 357 з afterpayment ✅

---

## 6. NovaPay Agent → `fiscal_receipts` + `bank_transactions`

**Protocol:** SOAP 1.1
**Endpoint:** `https://business.novapay.ua/Services/ClientAPIService.svc`
**WSDL namespace:** `http://tempuri.org/`

### Джерела даних

| Операція | Тип даних | Нормалізація |
|---|---|---|
| `GetPaymentsList` | Платежі агента (отримані кошти від покупців) → `fiscal_receipts` (або збагачення) | Per-payment: amount, date, order_id |
| `GetAccountExtract` | Банківська виписка (рахунок НоваПей) → `bank_transactions` | Source: `novapay_bank` |
| `GetRegister` | Реєстр виплат → ключ для матчингу | registry_id → mapping до payments |
| `DownloadRegister` | Файл реєстру (CSV/XLS) | Парсинг → amount_per_payment |

### Ключ зв'язку: registry_id

```
bank_transaction (ПриватБанк OSND "реестру N {id}")
  → GetRegister(registry_id)
  → RegisterItem[].payment_id
  → GetPaymentsList matches payment_id
  → fiscal receipt
```

**Auth:**
- `jwt` token (автоматичний, preferred): `UserAuthenticationJWT(refresh_token)` → jwt
- `principal` token (сесійний): через OTP, не автоматизується

---

## 7. Prom.UA / Rozetka → `fiscal_receipts` (two-step)

### Крок А — замовлення → чек
| Source | API | Fields |
|---|---|---|
| Prom.UA | `GET /orders/list` | `id`, `date_payment`, `price` (gross), `status` |
| Rozetka | `GET /orders/search` | `id`, `created_at`, `amount`, `status` |

### Крок Б — реєстр виплат → банк
- **Prom.UA:** XLS з кабінету або email-реєстр. Bank counterparty: `ТОВ "ФК "ЄВО"`. OSND pattern: "за операції DD.MM.YYYY-DD.MM.YYYY ... суму {gross} ... винагор. {commission}"
- **Rozetka:** email реєстр (PDF/CSV). Bank counterparty: ймовірно також ФК ЄВО.

### Commission Rates (для validation delta)
| Платформа | Метод | Комісія |
|---|---|---|
| Prom.UA | Карта (P2P) | 3.5% |
| Prom.UA | Рахунок (acquiring) | 1.7% |
| Rozetka | Стандарт | 1.5% |

---

## 8. Зведена таблиця джерел для матчингу

| source | match_strategy | Ключ зв'язку |
|---|---|---|
| `privatbank` (NOVAPAY_AGENT) | `novapay_registry` | OSND registry_number → NovaPay GetRegister |
| `privatbank` (EVO_MARKETPLACE) | `marketplace_register` | OSND date_range + gross ↔ email register |
| `privatbank` (ACQUIRING_SETTLEMENT) | `acquiring_batch` | merchant_id + date + ∑gross → Checkbox/ДПС чеки |
| `monobank` | `direct_amount` | amount (kopecks÷100) + date ± 1d |
| `checkbox` | `novapay_registry` OR `direct_amount` | per payment_type |
| `poster` | `direct_amount` | transaction_id + amount + date |
| `novapay_agent` | `novapay_registry` | registry_id |
| `novapay_bank` | `novapay_bank_extract` | account extract |
| `prom` | `marketplace_order` + `marketplace_register` + `marketplace_fuzzy` | order_id + date_range; fuzzy = сума±2% + вікно T+N |
| `rozetka` | `marketplace_order` + `marketplace_register` + `marketplace_fuzzy` | order_id + TS= timestamp; fuzzy = сума±1.5% + next business day |
| `nova_poshta` | — (допоміжна, не матчиться самостійно) | IntDocNumber → NovaPay payment → Checkbox |

---

## Відкриті питання (Stage 0)

1. **Monobank `receiptId`** — чи це фіскальний номер ПРРО? Потрібен тест: зіставити з Checkbox `fiscal_code`.
2. **NovaPay GetPaymentsList response** — схема payload (ще не отримано). Чи є `en_number` (ТТН) у кожному payment item? Очікується.
3. **PrivatBank Марків/Собакар** — 0 txns у 6 місяців. З'ясувати з клієнтом (може бути новий рахунок або неправильний токен).
4. **EVO email register format** — PDF чи CSV? Поля: дата, сума, номер замовлення.
5. **Acquiring batch: cmps: 36** — merchant_id Голубова. Чи є у інших клієнтів окремі cmps коди?
6. **Nova Poshta AfterpaymentOnGoodsCost** — рядок або число? Виявлено: рядок (може бути "0" або "") → парсити `Number(val) || null`.
7. **Prom.UA** — після підтвердження нового токена (поточний 429): схема response `orders` — чи є `payment_date` у виплаті?

> **Версія контракту:** v1.0 (фінал Stage 0, 2026-04-09). Наступне оновлення — Stage 2a після отримання реальних NovaPay даних.
