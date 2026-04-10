# Stage 1 — Infrastructure & Security Checklist

## Reality Checker — Автоматична перевірка

### Завжди (всі stages)

| # | Перевірка | Статус | Деталі |
|---|-----------|--------|--------|
| 1 | Всі локальні тести проходять | ✅ PASS | `node tests/kms-crypto-smoke.cjs` → 6/6 |
| 2 | Нуль TypeScript помилок | ⏳ PENDING | Потребує `npm ci` + `tsc --noEmit` (після підключення Railway) |
| 3 | API endpoints відповідають контракту | ✅ PASS | kms-service: /encrypt, /decrypt, /health — відповідно до архітектури |
| 4 | Нуль секретів у коді | ✅ PASS | Всі credentials — через process.env; secret scan у CI |
| 5 | Fixtures у tests/fixtures/ | ✅ N/A | Stage 1 не потребує нових fixtures (Stage 0 fixtures збережено) |

### Stage 1 додатково

| # | Перевірка | Статус | Деталі |
|---|-----------|--------|--------|
| 6 | Негативний тест: Tenant A НЕ бачить Tenant B | ⏳ PENDING | `tests/stage-1-rls-isolation.sql` написано, потребує виконання в Supabase |
| 7 | Негативний тест: CLIENT не бачить іншого client_group | ⏳ PENDING | Тест [3] у stage-1-rls-isolation.sql |
| 8 | Розшифрований токен НЕ логується | ✅ PASS | kms-service: логуються тільки err.message; plaintext/dataKey ніколи в console.log |
| 9 | Rate limiting на /api/credentials | ⏳ PENDING | Next.js API routes ще не створено (Stage 2). Додати при першому route для credentials. |

---

## Власноруч (AUTH_REQUIRED)

| # | Дія | Статус |
|---|-----|--------|
| A | Supabase: виконати `005_rls_policies.sql` | ⏳ Очікує власника |
| B | Supabase: виконати `tests/stage-1-rls-isolation.sql` → [PASS] x6 | ⏳ Очікує дії A |
| C | AWS IAM: додати `kms:GenerateDataKey, kms:Decrypt, kms:DescribeKey` до `margo-portal-kms` | ⏳ Очікує власника |
| D | Railway: підключити GitHub repo → 3 сервіси → налаштувати env vars | ⏳ Очікує власника |
| E | Railway: підтвердити що сервіси деплоїлись і /health повертає `{"status":"ok"}` | ⏳ Очікує дії D |

---

## Smoke Test (після Railway deploy)

Виконати вручну або через curl після деплою kms-service:

```bash
# 1. Health check
curl https://<kms-service-url>/health
# Expected: {"status":"ok","service":"kms-service"}

# 2. Encrypt a test token
RESULT=$(curl -s -X POST https://<kms-service-url>/encrypt \
  -H "Content-Type: application/json" \
  -d '{"plaintext":"test-smoke-token-123"}')
echo $RESULT
# Expected: {"encrypted_token":"...","kms_data_key_encrypted":"...","kms_key_id":"arn:aws:kms:..."}

# 3. Decrypt it back
curl -X POST https://<kms-service-url>/decrypt \
  -H "Content-Type: application/json" \
  -d "{\"encrypted_token\":$(echo $RESULT | jq .encrypted_token),\"kms_data_key_encrypted\":$(echo $RESULT | jq .kms_data_key_encrypted)}"
# Expected: {"plaintext":"test-smoke-token-123"}
```

**КРИТЕРІЙ:** `plaintext` у відповіді = `test-smoke-token-123` → smoke test PASSED.

---

## Security Checklist (Stage 1)

| Пункт | Статус |
|-------|--------|
| API tokens зашифровані (envelope encryption, не plain text) | ✅ Реалізовано в kms-service |
| Жодних secrets у репозиторії (`.env`, tokens, keys) | ✅ Перевірено — тільки process.env |
| KMS envelope encryption активний | ✅ kms-service використовує GenerateDataKey |
| Plaintext data key не зберігається і зітирається після використання | ✅ dataKey.fill(0) після кожної операції |
| Rate limiting на публічних endpoints | ⏳ N/A для Stage 1 (Railway internal only) |
| Sensitive data не логується | ✅ Підтверджено в kms-service та signing-service |

---

## Умова переходу до Stage 2

**НУЛЬ БЛОКУЮЧИХ** = всі ⏳ PENDING → ✅ PASS або N/A (задокументовано).

Блокуючі пункти на зараз:
- [ ] AUTH_REQUIRED A, B, C, D, E — виконати власником
- [ ] Smoke test після Railway deploy
- [ ] RLS isolation tests [PASS] x6 в Supabase

Після виконання → PM Review → `git tag stage-1-complete`.
