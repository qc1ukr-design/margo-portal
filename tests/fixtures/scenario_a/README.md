# Fixture — Сценарій А (найчастіший)

| Поле | Значення |
|---|---|
| ПРРО | Checkbox |
| Канал | НП доставка |
| Оплата | NovaPay |
| Банк | NovaPay-рахунок або ПриватБанк |

## Ланцюжок

```
Checkbox чек (payment_type=novapay)
  → NovaPay реєстр (BO-номер) з EN-номером
    → NovaPay банківська виписка (кредит)
```

## Очікуваний результат матчингу

- `status = MATCHED_FULL`
- `match_strategy = novapay_registry`

## Файли (заповнити з реальних API у Stage 0)

- `checkbox_receipt.json` — сирий відповідь Checkbox API (1 чек)
- `novapay_register.json` — сирий відповідь NovaPay agent API (1 реєстр з EN-рядками)
- `novapay_bank_txn.json` — сирий відповідь NovaPay bank API (відповідна транзакція)

## Статус

- [ ] Дані отримано з реального API
- [ ] Дані анонімізовано (ПІБ, ЄДРПОУ замінено)
- [ ] Матчинг вручну підтверджено бухгалтером
