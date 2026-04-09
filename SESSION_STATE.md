НАСТУПНА ДІЯ: Prom Гачава ретест (ще rate limit) → або go/no-go assessment

Активний крок: Stage 0 — Discovery
Статус: IN PROGRESS (go/no-go criteria виконані на ~95%)

---

## Що зроблено в сесії 2026-04-09 (частина 4 — фінал)

### Нові підключення / виправлення
- **Checkbox Собакар cashier ✅** — signin(lowercase)+Bearer: HTTP 200. Receipts ✅.
- **Checkbox Терещук cashier ✅** — signin(lowercase)+Bearer: HTTP 200. Receipts ✅.
- **Nova Poshta Гачава ✅** — 450 відправлень Jan-Apr. 100% Cash, 357 afterpayment. Fixture saved.
- **Data Contract v1.0 ✅** — завершено (Checkbox+NP+Poster+маппінг+відкриті питання)
- **DECISIONS_LOG ✅** — DEC-017..020 (Rozetka 2FA, marketplace_fuzzy, Checkbox endpoints, NP date/fields)
- **MatchStrategy enum ✅** — `marketplace_fuzzy` додано в src/lib/types/index.ts

### NovaPay — фінальний діагноз (2026-04-09)
- 565c "токен" у файлі Сухарєва = ТЕКСТ ІНСТРУКЦІЇ, не токен (помилка архіву)
- Справжній refresh_token = 500c ASCII opaque рядок ✅
- Сертифікат = 425c RSA PEM ✅
- Протестовано: refresh+cert (PEM), refresh+certB64, refresh+emptyLogin — всі "Access Denied!"
- **Причина: `login` (email/phone NovaPay Business) відсутній у файлі**
- XSD підтверджує: `UserAuthenticationJWT(refresh_token, login, public_certificate)`
- Це НОВЕ КОНКРЕТНЕ питання до клієнта (не повтор про токен): "email або телефон для business.novapay.ua"

### Підсумок валідацій (поточний стан)
18/25 тестів ✅ (NovaPay, Prom 429, Cashalot WAF — відкладено)

---

## Поточний стан fixtures
| Файл | Клієнт | Записи |
|---|---|---|
| privatbank_голубов.json | Голубов | 10 txns |
| poster_holobov*.json | Голубов | 1302+606 receipts |
| privatbank_гачава*.json | Гачава | 12+75 txns |
| checkbox_гачава_feb26.xlsx | Гачава | 190 receipts |
| nova_poshta_гачава.json | Гачава | 450 shipments ✅ |
| nova_poshta_сухарєв.json | Сухарєв | 140 shipments |
| monobank_терещук.json | Терещук | 2 txns |
| checkbox_терещук.json | Терещук | 1 receipt |
| dps_kudenko_receipts.xlsx | Куденко | 2,418 receipts |

---

## Що залишається
1. **Prom Гачава** — ретест токену (429 rate limit, спробувати через ~1 годину)
2. **NovaPay** — login (email/phone) від Сухарєва і Терещука. НЕ-БЛОКЕР для go/no-go.

## Відкриті 🔑 AUTH_REQUIRED
- **NovaPay** — login (email або телефон NovaPay Business) — одне нове питання до клієнта
- Cashalot Смирнова — IP/port локального сервера
- Nova Poshta Гачава — окремий NP API ключ (поточний = Checkbox license key)

---

## Маппінг файлів (для PM v2.8)
- ROADMAP → docs/roadmap.md
- TECH_DOC → docs/tech_log/stage_0_discovery.md
- DECISIONS_LOG → DECISIONS_LOG.md

---
> Оновлювати після КОЖНОЇ сесії. НАСТУПНА ДІЯ — завжди першим рядком.
