# Fixture — Сценарій В

| Поле | Значення |
|---|---|
| ПРРО | Checkbox |
| Канал | НП + Prom.UA |
| Оплата | NovaPay + Prom |
| Банк | ПриватБанк |

## Ланцюжок (змішаний)

```
Checkbox чек (payment_type=novapay)  → NovaPay реєстр → ПриватБанк
Checkbox чек (payment_type=prom)     → Prom.UA виплата → ПриватБанк
```

## Очікуваний результат матчингу

- NovaPay частина: `status = MATCHED_FULL`, `match_strategy = novapay_registry`
- Prom частина: `status = MATCHED_FULL`, `match_strategy = direct_bank` (або окрема стратегія після Stage 0)

## Файли (заповнити з реальних API у Stage 0)

- `checkbox_receipt_novapay.json`
- `checkbox_receipt_prom.json`
- `novapay_register.json`
- `privatbank_txn_novapay.json`
- `prom_payout.json` — якщо Prom API доступне (fallback TBD)

## ⚠️ Питання для Stage 0 (блокер)

- Чи є у клієнтів API Prom.UA? Якщо ні → визначити fallback стратегію.
- Як Prom виплати відображаються у банківській виписці (reference/description)?

## Статус

- [ ] Дані отримано з реального API
- [ ] Дані анонімізовано
- [ ] Матчинг вручну підтверджено
- [ ] Prom.UA fallback вирішено
