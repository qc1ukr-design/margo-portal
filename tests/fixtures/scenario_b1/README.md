# Fixture — Сценарій Б1

| Поле | Значення |
|---|---|
| ПРРО | Вчасно Каса |
| Канал | НП доставка |
| Оплата | NovaPay |
| Банк | ПриватБанк або Monobank |

## Ланцюжок

```
Вчасно чек (payment_type=novapay)
  → NovaPay реєстр (BO-номер) з EN-номером
    → ПриватБанк або Monobank виписка (кредит)
```

## Очікуваний результат матчингу

- `status = MATCHED_FULL`
- `match_strategy = novapay_registry`

## Файли (заповнити з реальних API у Stage 0)

- `vchasno_receipt.json` — сирий відповідь Вчасно API (1 чек)
- `novapay_register.json` — NovaPay agent (реєстр з EN-рядками)
- `privatbank_txn.json` або `monobank_txn.json`

## Статус

- [ ] Дані отримано з реального API
- [ ] Дані анонімізовано
- [ ] Матчинг вручну підтверджено
