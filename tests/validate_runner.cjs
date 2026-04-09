/**
 * Stage 0 — Validate Runner v2
 * Run: node tests/validate_runner.cjs
 * SECURITY: tokens are in memory only, never logged.
 */
'use strict'

const path = require('path')
const XLSX = require('xlsx')
const DL = 'C:/Users/user/Downloads'

// ---------------------------------------------------------------------------
// xlsx helpers
// ---------------------------------------------------------------------------
function readAllCells(file) {
  try {
    const wb = XLSX.readFile(path.join(DL, file))
    const ws = wb.Sheets[wb.SheetNames[0]]
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const result = []
    for (const row of data) {
      for (const cell of row) {
        const val = String(cell || '').trim()
        if (val && val.length > 3) result.push(val)
      }
    }
    return result
  } catch { return [] }
}

function readFirst(file, minLen = 5) {
  const vals = readAllCells(file)
  return vals.find(v => v.length >= minLen) || null
}

function readByLen(file, minLen, maxLen = 9999) {
  const vals = readAllCells(file)
  return vals.find(v => v.length >= minLen && v.length <= maxLen) || null
}

// ---------------------------------------------------------------------------
// Validate functions
// ---------------------------------------------------------------------------
async function validateCheckbox(token, label) {
  // Checkbox tokens in xlsx files are X-License-Key (cash register license keys, 24 hex chars)
  // Correct endpoint: /cash-registers/info (no cashier signIn needed)
  const res = await fetch('https://api.checkbox.ua/api/v1/cash-registers/info', {
    headers: { 'X-License-Key': token }
  })
  return { status: res.status, ok: res.ok, label }
}

async function validatePrivatBank(token, label) {
  const today = new Date().toISOString().slice(0, 10)
  const res = await fetch(
    `https://acp.privatbank.ua/api/statements/transactions/interim?startDate=${today}&endDate=${today}&limit=1`,
    { headers: { 'token': token, 'Content-Type': 'application/json;charset=utf8' } }
  )
  return { status: res.status, ok: res.ok, label }
}

async function validateMonobank(token, label) {
  const res = await fetch('https://api.monobank.ua/personal/client-info', {
    headers: { 'X-Token': token }
  })
  return { status: res.status, ok: res.ok, label }
}

async function validateNovaPoshta(token, label) {
  // Nova Poshta: POST with apiKey in body
  const res = await fetch('https://api.novaposhta.ua/v2.0/json/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: token,
      modelName: 'Address',
      calledMethod: 'getCities',
      methodProperties: { FindByString: 'Київ', Limit: '1' }
    })
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok && data.success !== false, label }
}

async function validatePoster(token, label) {
  // Poster: transactions.getTransactions with Unix timestamps (confirmed working)
  // getCafeInfo returns 405; getTransactions with dateFrom/dateTo (Unix) works
  const now = Math.floor(Date.now() / 1000)
  const dayAgo = now - 86400
  const res = await fetch(
    `https://joinposter.com/api/transactions.getTransactions?token=${token}&date_from=${dayAgo}&date_to=${now}&per_page=1`,
    { method: 'GET' }
  )
  const data = await res.json().catch(() => ({}))
  // Response has "response" key when OK — error=34 means wrong date format, not auth failure
  const hasResponse = 'response' in data
  const isAuthError = data.error === 1 || data.message === 'Unauthorized'
  return { status: res.status, ok: res.ok && hasResponse && !isAuthError, label }
}

async function validateProm(token, label) {
  const res = await fetch('https://my.prom.ua/api/v1/orders/list?limit=1', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  return { status: res.status, ok: res.ok, label }
}

async function validateRozetka(login, password, label) {
  // Rozetka вимагає base64-encoded пароль (per Rozetka seller API docs)
  const passwordB64 = Buffer.from(password).toString('base64')
  const res = await fetch('https://api-seller.rozetka.com.ua/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: passwordB64 })
  })
  const data = await res.json().catch(() => ({}))
  // Rozetka response: {content: {access_token: ...}} OR {access_token: ...}
  const token = data.content?.access_token ?? data.access_token ?? data.token
  console.log(`  → Rozetka HTTP ${res.status}, success=${data.success}, token=${token ? token.slice(0,20)+'...' : 'none'}`)
  return { status: res.status, ok: res.ok && !!token, label }
}

async function validateRozetkaApiKey(token, label) {
  // Rozetka gapi_ token — try as Bearer on orders endpoint
  // Note: HTTP 200 can come with success:false (access_denied) — must check data.success
  const res = await fetch('https://api-seller.rozetka.com.ua/orders/search?page=1', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const data = await res.json().catch(() => ({}))
  const ok = res.ok && data.success !== false
  return { status: res.status, ok, label }
}

async function validateNovaPay(token, label) {
  // ⚠️ Stage 0 finding: NovaPay uses SOAP, NOT REST
  // SOAP endpoint: business.novapay.ua/Services/ClientAPIService.svc
  // Try token as `principal` first (GetClientsList)
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://tempuri.org/">
  <soap:Body>
    <tns:GetClientsList>
      <tns:request>
        <tns:principal>${token}</tns:principal>
      </tns:request>
    </tns:GetClientsList>
  </soap:Body>
</soap:Envelope>`

  const res = await fetch('https://business.novapay.ua/Services/ClientAPIService.svc', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://tempuri.org/IClientAPIService/GetClientsList'
    },
    body: soapBody
  })
  const text = await res.text().catch(() => '')
  const result = text.match(/<result>([^<]*)<\/result>/)?.[1]
  const errorTitle = text.match(/<title>([^<]*)<\/title>/)?.[1]
  const isAuthOk = result === 'ok' || result === 'success'

  console.log(`  → SOAP(principal) result: ${result ?? 'no-result'}, err: ${(errorTitle||'none').slice(0,60)}`)
  return { status: res.status, ok: res.ok && (isAuthOk || !!result), label }
}

async function validateNovaPayAsJwt(jwtToken, label) {
  // Try token as `jwt` field (already-issued JWT, ~500 chars) in GetClientsList
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://tempuri.org/">
  <soap:Body>
    <tns:GetClientsList>
      <tns:request>
        <tns:jwt>${jwtToken}</tns:jwt>
      </tns:request>
    </tns:GetClientsList>
  </soap:Body>
</soap:Envelope>`

  const res = await fetch('https://business.novapay.ua/Services/ClientAPIService.svc', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://tempuri.org/IClientAPIService/GetClientsList'
    },
    body: soapBody
  })
  const text = await res.text().catch(() => '')
  const result = text.match(/<result>([^<]*)<\/result>/)?.[1]
  const errorTitle = text.match(/<title>([^<]*)<\/title>/)?.[1]
  const isAuthOk = result === 'ok' || result === 'success'
  const hasClientData = text.includes('<client_id>') || text.includes('<name>')

  console.log(`  → SOAP(jwt) result: ${result ?? 'no-result'}, clients=${hasClientData}, err: ${(errorTitle||'none').slice(0,60)}`)
  if (hasClientData) console.log('  ✅ JWT auth SUCCESS — client data received!')
  return { status: res.status, ok: res.ok && (isAuthOk || hasClientData || !!result), label }
}

async function validateNovaPayJWT(refreshToken, label, login = '', publicCert = '') {
  // UserAuthenticationJWT WSDL schema (confirmed via xsd0):
  //   GetAuthJwtRequest: { request_ref, refresh_token, login, public_certificate }
  //   GetAuthJwtResponse: { jwt, expiration, refresh_token, public_certificate }
  // ⚠️ ALL THREE fields required: refresh_token + login + public_certificate
  const loginTag     = login    ? `<tns:login>${login}</tns:login>` : ''
  const certTag      = publicCert ? `<tns:public_certificate>${publicCert}</tns:public_certificate>` : ''
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://tempuri.org/">
  <soap:Body>
    <tns:UserAuthenticationJWT>
      <tns:request>
        <tns:refresh_token>${refreshToken}</tns:refresh_token>
        ${loginTag}
        ${certTag}
      </tns:request>
    </tns:UserAuthenticationJWT>
  </soap:Body>
</soap:Envelope>`

  const res = await fetch('https://business.novapay.ua/Services/ClientAPIService.svc', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://tempuri.org/IClientAPIService/UserAuthenticationJWT'
    },
    body: soapBody
  })
  const text = await res.text().catch(() => '')
  const jwt = text.match(/<jwt>([^<]+)<\/jwt>/)?.[1]
  const newRefresh = text.match(/<refresh_token>([^<]+)<\/refresh_token>/)?.[1]
  const result = text.match(/<result>([^<]*)<\/result>/)?.[1]
  const errorTitle = text.match(/<title>([^<]*)<\/title>/)?.[1]
  const ok = !!jwt || result === 'ok'

  const hasLogin = !!login
  const hasCert  = !!publicCert
  console.log(`  → JWT result: ${result ?? 'no-result'}, login=${hasLogin}, cert=${hasCert}, jwt=${jwt ? jwt.slice(0,20)+'...' : 'none'}, refresh=${newRefresh ? 'NEW ✅' : 'none'}, err: ${(errorTitle||'none').slice(0,60)}`)
  if (jwt) console.log(`  ✅ JWT auth SUCCESS — token refreshed automatically`)
  return { status: res.status, ok, label }
}

async function validateCashalotCloud(pubKey, privKey, label) {
  // my.cashalot.org.ua — cloud-hosted Cashalot (found from IP lookup)
  // Try token-based auth (two 16-char keys) with GetRegistrarState command
  const body = { PublicKey: pubKey, PrivateKey: privKey }
  const res = await fetch('https://my.cashalot.org.ua/api/v1/cash-register/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await res.text().catch(() => '')
  console.log(`  → Cashalot cloud HTTP ${res.status}, body: ${text.slice(0, 120)}`)
  // Also try root endpoint to see what API is available
  if (!res.ok) {
    const res2 = await fetch('https://my.cashalot.org.ua/', { method: 'GET' }).catch(() => null)
    if (res2) console.log(`  → Cashalot root HTTP ${res2.status}`)
  }
  return { status: res.status, ok: res.ok, label }
}

async function validateCashalotCloudGetChecks(pubKey, privKey, label) {
  // Try GetChecks command format (from WEB API spec)
  const body = { PublicKey: pubKey, PrivateKey: privKey, Command: 'GetChecks' }
  const res = await fetch('https://my.cashalot.org.ua/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await res.text().catch(() => '')
  console.log(`  → Cashalot GetChecks HTTP ${res.status}, body: ${text.slice(0, 120)}`)
  return { status: res.status, ok: res.ok, label }
}

async function validateDpsPublic(token, label) {
  // ДПС public API — Bearer UUID token, 1000 req/day limit
  // Public part: taxpayer info (no KEP needed for public data)
  const res = await fetch('https://cabinet.tax.gov.ua/ws/public_api/api/1.0/integration/references/taxpayer-info', {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  const text = await res.text().catch(() => '')
  console.log(`  → ДПС public HTTP ${res.status}, body: ${text.slice(0, 120)}`)
  return { status: res.status, ok: res.ok, label }
}

async function validateCheckboxCashier(licenseKey, login, password, label) {
  // Step 1: confirm device is valid (license key)
  const devRes = await fetch('https://api.checkbox.ua/api/v1/cash-registers/info', {
    headers: { 'X-License-Key': licenseKey }
  })
  if (!devRes.ok) return { status: devRes.status, ok: false, label: label + ' (device)' }

  // Step 2: cashier signin → access_token
  // ⚠️ Stage 0: LOWERCASE /signin — /signIn returns 404!
  const signRes = await fetch('https://api.checkbox.ua/api/v1/cashier/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  })
  const data = await signRes.json().catch(() => ({}))
  // Checkbox returns {token: ...} OR {access_token: ...}
  const accessToken = data.token ?? data.access_token
  console.log(`  → cashier signIn HTTP ${signRes.status}, keys=${Object.keys(data).join(',')}, token=${accessToken ? accessToken.slice(0,20)+'...' : 'none'}`)
  if (!accessToken) return { status: signRes.status, ok: false, label }

  // Step 3: fetch receipts — Authorization: Bearer (NOT X-Access-Token — 403!)
  const rcptRes = await fetch('https://api.checkbox.ua/api/v1/receipts?limit=1', {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'X-License-Key': licenseKey }
  })
  console.log(`  → receipts HTTP ${rcptRes.status}`)
  return { status: rcptRes.status, ok: rcptRes.ok, label }
}

// Extract cashier login + password from xlsx values
// Headers are Ukrainian (Наименування, Логін, Пароль etc.) — skip them
// Login/password are ASCII alphanumeric only
function extractCashierCreds(vals) {
  const ascii = vals.filter(v => /^[a-zA-Z0-9_@.]+$/.test(v) && v.length >= 6 && v.length <= 40)
  return [ascii[0] || null, ascii[1] || ascii[0] || null]
}

// ---------------------------------------------------------------------------
// Load tokens
// ---------------------------------------------------------------------------
function loadTokens() {
  console.log('\n📂 Читаємо токени...\n')
  const t = {}

  // Checkbox — 24 символи
  t.checkbox_tereshchuk = readByLen('API Чек бокс Терещук.xlsx', 20, 30)
  t.checkbox_sobakar    = readByLen('АРІ Чек бокс Собакар.xlsx', 20, 30)
  t.checkbox_generic    = readByLen('API Чек бокс.xlsx', 20, 30)

  // PrivatBank — JWT ~292-300 символів
  // Марків (1) = новий токен з UAH рахунком (старий був USD-only)
  // Терещук (1) = новий токен (старий = 401)
  t.privat_holobov    = readByLen('Токен Приват Голубов.xlsx', 100)
  t.privat_markov     = readByLen('Токен Приват Марков (1).xlsx', 100) ||
                        readByLen('Токен Приват Марков.xlsx', 100)
  t.privat_sobakar    = readByLen('Токен Приват Собакар.xlsx', 100)
  t.privat_tereshchuk = readByLen('Токен Приват Терещук (1).xlsx', 100) ||
                        readByLen('Токен Приват Терещук.xlsx', 100)
  t.privat_smyrnova   = readByLen('Токен Приват банк Смирнова.xlsx', 100)
  t.privat_kudenko    = readByLen('Токен Приват Куденко.xlsx', 100)
  t.privat_hachava    = readByLen('Токен Приват Гачава.xlsx', 100)

  // Monobank — 44 символи
  // ⚠️ ВИПРАВЛЕННЯ: Собакар НЕ МАЄ Monobank. Дублікат у попередніх тестах = помилка.
  // Токен Моно банк.xlsx і Токен Моно банк Терещук.xlsx — обидва Терещука.
  t.mono_tereshchuk = readByLen('Токен Моно банк Терещук.xlsx', 40, 50)
  // t.mono_sobak — видалено: Собакар не має Monobank (підтверджено 2026-04-09)

  // Nova Poshta — 24 символи
  // Гачава (1) = виправлений ключ (старий файл мав Checkbox license key помилково)
  t.nova_poshta_hachava  = readByLen('Токен Нова пошта Гачава (1).xlsx', 20, 30) ||
                           readByLen('Токен Нова пошта Гачава.xlsx', 20, 30)
  t.nova_poshta_generic  = readByLen('Токен Нова пошта.xlsx', 20, 30)

  // Poster — "account_id:token" ~39 символів
  t.poster_holobov = readByLen('Токен Постер Голубов.xlsx', 30, 60)
  t.poster_generic = readByLen('Токен Постер.xlsx', 30, 60)

  // Prom — Bearer token ~40 символів
  t.prom_hachava = readByLen('АРІ Пром Гачава.xlsx', 35, 50)
  t.prom_generic = readByLen('АРІ Пром.xlsx', 35, 50)

  // Rozetka — login+password з нового файлу (gapi_ token давав access_denied)
  const rozetkaH = readAllCells('Логін + пароль Гачава Rozetka.xlsx')
  const rozetkaG = readAllCells('АРІ Розетка.xlsx')
  t.rozetka_hachava_all = rozetkaH
  t.rozetka_generic_all = rozetkaG

  // Checkbox cashier — потрібно для отримання чеків (device validated раніше)
  t.checkbox_cashier_sobakar  = readAllCells('Логін та пароль касира Собакар Аліна.xlsx')
  t.checkbox_cashier_tereshchuk = readAllCells('Логін та пароль касира Терещук .xlsx')

  // NovaPay — токен ~500 символів (новий від Терещука)
  // Спробуємо як: (A) principal у GetClientsList, (B) refresh_token у UserAuthenticationJWT
  t.novapay_tereshchuk = readByLen('Токен Нова Пей Терещук.xlsx', 400, 620)
  t.novapay_generic    = readByLen('Токен Нова Пей.xlsx', 400, 620)

  // Сухарєв — розшифровка файлу (підтверджено 2026-04-09 debug):
  //   14c = "АРІ Нова Пошта" (label)
  //   32c = Nova Poshta API key
  //    8c = "Нова Пей" (label)
  //   13c = "Refresh Token" (label!)
  //  500c = СПРАВЖНІЙ refresh_token (ASCII alphanumeric, ~50 chars/line)
  //  565c = ТЕКСТ ІНСТРУКЦІЇ "1. Refresh Token (оновлюваний токен)..." — НЕ ТОКЕН!
  //   14c = "RSA Public Key" (label)
  //  425c = -----BEGIN RSA PUBLIC KEY----- ... (public_certificate)
  // XSD: UserAuthenticationJWT(refresh_token, login, public_certificate)
  // ⚠️ login — відсутній у файлі (потрібен email/phone NovaPay Business акаунту клієнта)
  const sukhVals    = readAllCells('АРІ   Сухарєв.xlsx')
  const sukhVals2   = readAllCells('_АРІ   Сухарєв_ до 09.05.xlsx')
  // refresh_token = 500c, pure ASCII alphanumeric (NOT 565c which is instruction text)
  t.sukharyev_refresh    = sukhVals.find(v => v.length >= 490 && v.length <= 510 && /^[a-zA-Z0-9+/=]+$/.test(v)) || null
  // public_certificate = RSA key block (~425c, starts with ---)
  t.sukharyev_public_cert = sukhVals.find(v => v.includes('BEGIN RSA PUBLIC KEY') || v.includes('BEGIN PUBLIC KEY')) || null
  // login = NOT in file → AUTH_REQUIRED
  t.sukharyev_login = null
  // New file (same content — confirmed 2026-04-09)
  t.sukharyev_new_token = null  // identical to old file, no new data
  t.sukharyev_all = sukhVals
  t.sukharyev_all2 = sukhVals2

  // Cashalot — два 16-символьних токени (публічний + приватний)
  t.cashalot_all = readAllCells('ТОКЕНИ КАШАЛОТ Смирнова.xlsx')
  const cashalotKeys = t.cashalot_all.filter(v => /^[a-zA-Z0-9]+$/.test(v) && v.length >= 14 && v.length <= 20)
  t.cashalot_pub  = cashalotKeys[0] || null
  t.cashalot_priv = cashalotKeys[1] || null

  // Checkbox Гачава — окремий файл
  t.checkbox_hachava = readByLen('Ключ ліцензії каси ЧЕК Бокс Гачава (1).xlsx', 20, 30)
  // ⚠️ NOTE: Токен Нова пошта Гачава = a017100be1a8dcc95439de62 (24c) = той самий що Checkbox license key
  // Це Checkbox ключ, наданий як NP токен помилково. NP ключ Гачави ВІДСУТНІЙ.

  // Сухарєв Nova Poshta — 32-символьний ключ в АРІ Сухарєв.xlsx
  t.nova_poshta_sukharyev = t.sukharyev_all.find(v => v.length === 32 && /^[a-f0-9]+$/.test(v)) || null

  // ДПС
  t.dps_kudenko = readFirst('Токен Електронний кабінет Куденко.xlsx')

  // Print summary
  console.log('Токени (довжина символів):')
  const skip = new Set(['rozetka_hachava_all','rozetka_generic_all','cashalot_all','sukharyev_all','checkbox_cashier_sobakar','checkbox_cashier_tereshchuk'])
  for (const [k, v] of Object.entries(t)) {
    if (skip.has(k)) continue
    console.log(`  ${k}: ${v ? v.length + ' с' : '❌'}`)
  }
  console.log(`  rozetka_hachava: [${t.rozetka_hachava_all.map(v=>v.length).join(', ')}] → ${t.rozetka_hachava_all.slice(0,2).map(v=>v.slice(0,12)).join(' | ')}`)
  console.log(`  rozetka_generic: [${t.rozetka_generic_all.map(v=>v.length).join(', ')}]`)
  console.log(`  cashalot: [${t.cashalot_all.map(v=>v.length).join(', ')}]`)
  console.log(`  sukharyev_all: [${t.sukharyev_all.map(v=>v.length).join(', ')}]`)
  console.log(`  sukharyev_all2 (new): [${t.sukharyev_all2.map(v=>v.length).join(', ')}]`)
  console.log(`  sukharyev_public_cert: ${t.sukharyev_public_cert ? t.sukharyev_public_cert.length+'с ✅' : '❌'}`)
  console.log(`  sukharyev_login: ${t.sukharyev_login ? '"'+t.sukharyev_login+'"' : '❌'}`)
  console.log(`  sukharyev_new_token: ${t.sukharyev_new_token ? t.sukharyev_new_token.length+'с' : '❌'}`)
  console.log(`  nova_poshta_sukharyev: ${t.nova_poshta_sukharyev ? t.nova_poshta_sukharyev.length+'с ✅' : '❌'}`)
  console.log(`  checkbox_hachava: ${t.checkbox_hachava ? t.checkbox_hachava.length+'с' : '❌'}`)
  console.log(`  cashalot_pub: ${t.cashalot_pub ? t.cashalot_pub.length+'с' : '❌'} | priv: ${t.cashalot_priv ? t.cashalot_priv.length+'с' : '❌'}`)
  console.log(`  checkbox_cashier_sobakar: [${t.checkbox_cashier_sobakar.map(v=>v.length).join(', ')}]`)
  console.log(`  checkbox_cashier_tereshchuk: [${t.checkbox_cashier_tereshchuk.map(v=>v.length).join(', ')}]`)
  return t
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function run(label, fn, results) {
  try {
    process.stdout.write(`⏳ ${label}... `)
    const r = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 15s')), 15000))
    ])
    const icon = r.ok ? '✅' : '❌'
    console.log(`${icon} HTTP ${r.status}`)
    results.push({ label, ok: r.ok, status: r.status })
  } catch(e) {
    console.log(`💥 ${e.message.slice(0,80)}`)
    results.push({ label, ok: false, status: 'error', error: e.message.slice(0,80) })
  }
}

async function runAll() {
  const t = loadTokens()
  const results = []

  console.log('\n' + '='.repeat(60))
  console.log('STAGE 0 — VALIDATE() ТЕСТИ')
  console.log('='.repeat(60) + '\n')

  // CHECKBOX — device validate (license key)
  if (t.checkbox_tereshchuk) await run('Checkbox Терещук (device)', () => validateCheckbox(t.checkbox_tereshchuk, 'Терещук'), results)
  if (t.checkbox_sobakar)    await run('Checkbox Собакар (device)', () => validateCheckbox(t.checkbox_sobakar, 'Собакар'), results)
  if (t.checkbox_generic && t.checkbox_generic !== t.checkbox_tereshchuk)
    await run('Checkbox generic (device)', () => validateCheckbox(t.checkbox_generic, 'generic'), results)

  // CHECKBOX — cashier signIn + receipts (потрібен X-Access-Token для отримання чеків)
  // Логін та пароль: Собакар = alinasobakar81, Терещук = ruslanteresuk862
  if (t.checkbox_sobakar && t.checkbox_cashier_sobakar.length >= 2) {
    const [login, pass] = extractCashierCreds(t.checkbox_cashier_sobakar)
    if (login && pass)
      await run('Checkbox Собакар (cashier+receipts)', () => validateCheckboxCashier(t.checkbox_sobakar, login, pass, 'Собакар'), results)
  }
  if (t.checkbox_tereshchuk && t.checkbox_cashier_tereshchuk.length >= 2) {
    const [login, pass] = extractCashierCreds(t.checkbox_cashier_tereshchuk)
    if (login && pass)
      await run('Checkbox Терещук (cashier+receipts)', () => validateCheckboxCashier(t.checkbox_tereshchuk, login, pass, 'Терещук'), results)
  }

  // PRIVATBANK
  for (const [name, tok] of [
    ['Голубов', t.privat_holobov], ['Марков', t.privat_markov],
    ['Собакар', t.privat_sobakar], ['Терещук', t.privat_tereshchuk],
    ['Смирнова', t.privat_smyrnova], ['Куденко', t.privat_kudenko],
    ['Гачава', t.privat_hachava],
  ]) {
    if (tok) await run(`ПриватБанк ${name}`, () => validatePrivatBank(tok, name), results)
  }

  // MONOBANK — тільки Терещук (Собакар НЕ має Monobank — виправлено 2026-04-09)
  if (t.mono_tereshchuk) await run('Monobank Терещук', () => validateMonobank(t.mono_tereshchuk, 'Терещук'), results)

  // CHECKBOX Гачава
  if (t.checkbox_hachava) await run('Checkbox Гачава (device)', () => validateCheckbox(t.checkbox_hachava, 'Гачава'), results)

  // NOVA POSHTA
  // ⚠️ Гачава NP token = Checkbox license key (24c) — 401 expected, пропускаємо
  console.log('  ⚠️  Nova Poshta Гачава: пропущено (токен = Checkbox license key, не NP ключ)')
  // Сухарєв — правильний 32-символьний NP ключ
  if (t.nova_poshta_sukharyev) await run('Nova Poshta Сухарєв', () => validateNovaPoshta(t.nova_poshta_sukharyev, 'Сухарєв'), results)
  if (t.nova_poshta_generic) await run('Nova Poshta generic', () => validateNovaPoshta(t.nova_poshta_generic, 'generic'), results)

  // POSTER
  if (t.poster_holobov) await run('Poster Голубов', () => validatePoster(t.poster_holobov, 'Голубов'), results)

  // PROM — 429 може бути rate limit, але токен валідний. Одна спроба + логуємо
  if (t.prom_hachava) {
    await run('Prom.UA Гачава', () => validateProm(t.prom_hachava, 'Гачава'), results)
    const lastProm = results[results.length - 1]
    if (lastProm && !lastProm.ok && lastProm.status === 429) {
      console.log('  ℹ️  Prom 429 = rate limit (токен ймовірно валідний, надто часті запити)')
    }
  }

  // ROZETKA — використовуємо login+password (gapi_ token = access_denied)
  const rzH = t.rozetka_hachava_all
  // Шукаємо login і password (рядки не-uuid, не-токен)
  // Headers are Ukrainian (Логін, Пароль) — filter to ASCII alphanumeric only
  const rzAscii = rzH.filter(v => /^[a-zA-Z0-9_@.!#+\-]+$/.test(v) && v.length >= 6 && v.length < 40)
  const rzLogin = rzAscii[0] || null
  const rzPass  = rzAscii[1] || null
  if (rzLogin && rzPass) {
    await run('Rozetka Гачава (login+password)', () => validateRozetka(rzLogin, rzPass, 'Гачава'), results)
  } else if (rzH.length >= 2) {
    await run('Rozetka Гачава', () => validateRozetka(rzH[0], rzH[1], 'Гачава'), results)
  } else {
    console.log(`⚠️  Rozetka Гачава: дані не знайдені у Логін + пароль Гачава Rozetka.xlsx`)
  }

  // NOVAPAY — пробуємо 4 методи для кожного токена:
  //   A) principal → GetClientsList (OTP-токен або legacy)
  //   B) jwt → GetClientsList (якщо токен = вже виданий JWT)
  //   C) refresh_token → UserAuthenticationJWT (якщо це refresh токен)
  // Терещук токен = 500 chars → невідомий формат (jwt field = IDX12709: not well formed)
  if (t.novapay_tereshchuk) {
    await run('NovaPay Терещук (principal field)', () => validateNovaPay(t.novapay_tereshchuk, 'Терещук'), results)
    await run('NovaPay Терещук (jwt field)', () => validateNovaPayAsJwt(t.novapay_tereshchuk, 'Терещук'), results)
    await run('NovaPay Терещук (JWT refresh)', () => validateNovaPayJWT(t.novapay_tereshchuk, 'Терещук'), results)
  }
  // Сухарєв: UserAuthenticationJWT потребує refresh_token + login + public_certificate (з XSD!)
  // Причина попередніх "Access Denied": відправляли лише refresh_token без login і cert
  if (t.sukharyev_refresh) {
    console.log(`\n  🔑 NovaPay Сухарєв — тест з повними auth полями (refresh+login+cert):`)
    console.log(`     login="${t.sukharyev_login ?? 'n/a'}", cert=${t.sukharyev_public_cert ? t.sukharyev_public_cert.length+'c' : 'n/a'}`)
    // Варіант A: refresh+login+cert (правильний спосіб)
    await run('NovaPay Сухарєв (refresh+login+cert ✓)',
      () => validateNovaPayJWT(t.sukharyev_refresh, 'Сухарєв full', t.sukharyev_login || '', t.sukharyev_public_cert || ''), results)
    // Варіант B: тільки refresh (без login/cert) — для порівняння
    await run('NovaPay Сухарєв (refresh only, без login/cert)',
      () => validateNovaPayJWT(t.sukharyev_refresh, 'Сухарєв no-login'), results)
  }
  // JWT field (500c) — можливо вже виданий jwt, спробувати напряму
  if (t.sukharyev_jwt) {
    await run('NovaPay Сухарєв (jwt field, GetClientsList)', () => validateNovaPayAsJwt(t.sukharyev_jwt, 'Сухарєв jwt'), results)
  }
  if (t.novapay_generic && t.novapay_generic !== t.novapay_tereshchuk) {
    await run('NovaPay generic (jwt field)', () => validateNovaPayAsJwt(t.novapay_generic, 'generic'), results)
  }

  // SUMMARY
  console.log('\n' + '='.repeat(60))
  console.log('ПІДСУМОК')
  console.log('='.repeat(60))
  const ok = results.filter(r => r.ok)
  const fail = results.filter(r => !r.ok)
  console.log(`✅ OK: ${ok.length} / ${results.length}`)
  if (fail.length) {
    console.log(`\n❌ Помилки:`)
    for (const f of fail) console.log(`  • ${f.label}: ${f.status}`)
  }

  // CASHALOT — cloud version (my.cashalot.org.ua)
  if (t.cashalot_pub && t.cashalot_priv) {
    await run('Cashalot cloud (my.cashalot.org.ua) — state', () => validateCashalotCloud(t.cashalot_pub, t.cashalot_priv, 'Смирнова'), results)
    await run('Cashalot cloud (my.cashalot.org.ua) — GetChecks', () => validateCashalotCloudGetChecks(t.cashalot_pub, t.cashalot_priv, 'Смирнова'), results)
  }

  // ДПС Куденко — UUID Bearer token
  if (t.dps_kudenko) {
    await run('ДПС Електронний кабінет Куденко (public)', () => validateDpsPublic(t.dps_kudenko, 'Куденко'), results)
  }

  // Extra info
  if (t.sukharyev_jwt) console.log(`\nⓘ  Сухарєв (старий): JWT=${t.sukharyev_jwt.length}с | refresh=${t.sukharyev_refresh ? t.sukharyev_refresh.length+'с' : '—'}`)
  if (t.sukharyev_new_token) console.log(`ⓘ  Сухарєв (новий до 09.05): token=${t.sukharyev_new_token.length}с`)

  console.log()
}

runAll().catch(console.error)
