# Fixture — Сценарій Д

| Поле | Значення |
|---|---|
| ПРРО | Будь-який (Checkbox / Вчасно) |
| Канал | Онлайн |
| Оплата | LiqPay |
| Банк | ПриватБанк або Monobank |

## Ланцюжок

```
Чек (payment_type=liqpay)
  → LiqPay report API (транзакція)
    → ПриватБанк або Monobank виписка
```

## Очікуваний результат матчингу

- `status = MATCHED_FULL`
- `match_strategy = liqpay`

## Файли (заповнити з реальних API у Stage 0)

- `checkbox_receipt_liqpay.json`
- `liqpay_txn.json` — звіт з LiqPay API
- `privatbank_txn.json` або `monobank_txn.json`

## ⚠️ Питання для Stage 0

- Як виглядає LiqPay у банківській виписці? (reference, description)
- Пакетні чи поштучні виплати LiqPay?
- Скільки клієнтів мають LiqPay? (пріоритет для Stage 2b)

## Статус

- [ ] Дані отримано з реального API
- [ ] Дані анонімізовано
- [ ] Матчинг вручну підтверджено
