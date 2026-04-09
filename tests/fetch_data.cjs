/**
 * Stage 0 — Data Fetch & Analysis
 * Fetches real data from working APIs, saves structure samples to fixtures.
 * Run: node tests/fetch_data.cjs
 * SECURITY: tokens in memory only. Fixtures contain anonymized structure only.
 */
'use strict'

const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')
const DL = 'C:/Users/user/Downloads'
const FIXTURES = path.join(__dirname, 'fixtures')

// ---------------------------------------------------------------------------
// xlsx helpers
// ---------------------------------------------------------------------------
function readByLen(file, minLen, maxLen = 9999) {
  try {
    const wb = XLSX.readFile(path.join(DL, file))
    const ws = wb.Sheets[wb.SheetNames[0]]
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const vals = []
    for (const row of data) for (const cell of row) { const v = String(cell || '').trim(); if (v && v.length > 3) vals.push(v) }
    return vals.find(v => v.length >= minLen && v.length <= maxLen) || null
  } catch { return null }
}

// ---------------------------------------------------------------------------
// Anonymize: keeps structure, removes PII
// ---------------------------------------------------------------------------
function anonymize(obj, depth = 0) {
  if (depth > 5) return obj
  if (Array.isArray(obj)) return obj.slice(0, 3).map(item => anonymize(item, depth + 1))
  if (obj && typeof obj === 'object') {
    const result = {}
    for (const [k, v] of Object.entries(obj)) {
      if (/name|pib|inn|edrpou|phone|email|iban|mfo/i.test(k)) {
        result[k] = '[REDACTED]'
      } else {
        result[k] = anonymize(v, depth + 1)
      }
    }
    return result
  }
  return obj
}

function saveFixture(folder, filename, data) {
  const dir = path.join(FIXTURES, folder)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), 'utf8')
  console.log(`  💾 saved → fixtures/${folder}/${filename}`)
}

// ---------------------------------------------------------------------------
// PrivatBank: fetch transactions (final statement)
// ---------------------------------------------------------------------------
async function fetchPrivatBank(token, label, dateFrom, dateTo) {
  const transactions = []
  let followId = null

  while (true) {
    const url = new URL('https://acp.privatbank.ua/api/statements/transactions/final')
    url.searchParams.set('startDate', dateFrom)
    url.searchParams.set('endDate', dateTo)
    url.searchParams.set('limit', '20')
    if (followId) url.searchParams.set('followId', followId)

    const res = await fetch(url.toString(), {
      headers: { 'token': token, 'Content-Type': 'application/json;charset=utf8' }
    })
    if (!res.ok) {
      console.log(`  ⚠️  PrivatBank ${label}: HTTP ${res.status}`)
      break
    }
    const data = await res.json()
    const items = data.transactions ?? data.data ?? []
    transactions.push(...items)

    console.log(`  PrivatBank ${label}: page +${items.length}, total ${transactions.length}, executionStatus=${data.executionStatus}`)

    if (data.executionStatus === 'EXECUTED' || !items.length || transactions.length >= 50) break
    followId = data.followId
    if (!followId) break
  }

  return transactions
}

// ---------------------------------------------------------------------------
// Monobank: fetch statement (rate limit: 1 req / 61s per token)
// ---------------------------------------------------------------------------
async function fetchMonobank(token, label, dateFrom, dateTo) {
  const fromTs = Math.floor(new Date(dateFrom).getTime() / 1000)
  const toTs = Math.floor(new Date(dateTo).getTime() / 1000)

  // First get account list
  const clientRes = await fetch('https://api.monobank.ua/personal/client-info', {
    headers: { 'X-Token': token }
  })
  if (!clientRes.ok) {
    console.log(`  ⚠️  Monobank ${label}: client-info HTTP ${clientRes.status}`)
    return []
  }
  const clientInfo = await clientRes.json()
  const accounts = clientInfo.accounts ?? []
  console.log(`  Monobank ${label}: ${accounts.length} accounts`)

  if (!accounts.length) return []

  // Prefer UAH (980) account; fallback to first
  const uahAcc = accounts.find(a => a.currencyCode === 980) ?? accounts[0]
  console.log(`  Monobank ${label}: fetching account ${uahAcc.id} (${uahAcc.type}, currencyCode=${uahAcc.currencyCode})`)
  console.log(`  Monobank ${label}: all accounts: ${accounts.map(a=>a.type+'/'+a.currencyCode).join(', ')}`)

  // Monobank max range = 31 days. Use last 28 days to be safe.
  const safeFrom = Math.floor((Date.now() - 28 * 86400 * 1000) / 1000)
  const safeTo = Math.floor(Date.now() / 1000)

  // Rate limit: 1 req/61s per token
  await new Promise(r => setTimeout(r, 1500))

  const stmtRes = await fetch(
    `https://api.monobank.ua/personal/statement/${uahAcc.id}/${safeFrom}/${safeTo}`,
    { headers: { 'X-Token': token } }
  )
  if (stmtRes.status === 429) {
    console.log(`  ⚠️  Monobank ${label}: rate limited (429) — skip`)
    return []
  }
  if (!stmtRes.ok) {
    const body = await stmtRes.text().catch(() => '')
    console.log(`  ⚠️  Monobank ${label}: statement HTTP ${stmtRes.status} ${body.slice(0,100)}`)
    return []
  }

  const txns = await stmtRes.json()
  console.log(`  Monobank ${label}: ${txns.length} transactions (last 28 days)`)
  return txns.map(t => ({ ...t, _account_type: uahAcc.type, _currency_code: uahAcc.currencyCode }))
}

// ---------------------------------------------------------------------------
// Poster: fetch transactions
// CRITICAL: date_from/date_to must be DD.MM.YYYY strings (NOT Unix, NOT ISO)
// Unix timestamps silently return 0 results (confirmed Stage 0 bug)
// ---------------------------------------------------------------------------
function toPosterDate(isoStr) {
  const d = new Date(isoStr)
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`
}

async function fetchPoster(token, label, dateFrom, dateTo) {
  const fromStr = toPosterDate(dateFrom)
  const toStr = toPosterDate(dateTo)

  const transactions = []
  let page = 1

  while (true) {
    const res = await fetch(
      `https://joinposter.com/api/transactions.getTransactions?token=${token}&date_from=${fromStr}&date_to=${toStr}&per_page=50&page=${page}`
    )
    if (!res.ok) {
      console.log(`  ⚠️  Poster ${label}: HTTP ${res.status}`)
      break
    }
    const data = await res.json()
    if (!('response' in data)) {
      console.log(`  ⚠️  Poster ${label}: no response key, error=${data.error}`)
      break
    }
    // Response: { response: { count, page: {...}, data: [...] } }
    const items = data.response?.data ?? (Array.isArray(data.response) ? data.response : [])
    const totalCount = data.response?.count ?? 0
    transactions.push(...items)
    console.log(`  Poster ${label}: page ${page} +${items.length}, total ${transactions.length} / ${totalCount}`)
    if (items.length < 50 || transactions.length >= totalCount) break
    page++
    if (transactions.length >= 200) break
  }
  return transactions
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------
function analyzeSchema(items, source) {
  if (!items || !items.length) return { count: 0, source, fields: [], date_fields: [], numeric_fields: [], sample_amounts: [] }
  const sample = items[0]
  const fields = Object.keys(sample)
  const numericFields = fields.filter(k => typeof sample[k] === 'number')
  const dateFields = fields.filter(k => {
    const v = String(sample[k] || '')
    return /\d{4}[-\/]\d{2}|T\d{2}:|^\d{10}$|\d{2}\.\d{2}\.\d{4}/.test(v)
  })

  return {
    source,
    count: items.length,
    fields,
    sample_amounts: items.slice(0, 5).map(i => {
      const amtField = numericFields.find(f => /amount|sum|credit|debit|balance/i.test(f))
      return amtField ? i[amtField] : null
    }).filter(Boolean),
    date_fields: dateFields,
    numeric_fields: numericFields,
  }
}

function printAnalysis(analysis) {
  console.log(`\n  📊 Schema Analysis (${analysis.source}):`)
  console.log(`     Count: ${analysis.count}`)
  console.log(`     Fields: ${analysis.fields.join(', ')}`)
  console.log(`     Date fields: ${analysis.date_fields.join(', ')}`)
  console.log(`     Numeric fields: ${analysis.numeric_fields.join(', ')}`)
  if (analysis.sample_amounts?.length) {
    console.log(`     Sample amounts: ${analysis.sample_amounts.join(', ')}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  const DATE_FROM = '2026-03-01'
  const DATE_TO = '2026-04-07'

  console.log(`\n📅 Fetching data: ${DATE_FROM} → ${DATE_TO}\n`)
  console.log('='.repeat(60))

  // ---- PRIVATBANK ----
  console.log('\n🏦 ПРИВАТБАНК\n')
  // Марків (1) = новий токен з UAH рахунком (старий = USD-only)
  // Терещук (1) = новий токен (старий = 401)
  const privatTokens = [
    ['Голубов',   readByLen('Токен Приват Голубов.xlsx', 100)],
    ['Марків',    readByLen('Токен Приват Марков (1).xlsx', 100) || readByLen('Токен Приват Марков.xlsx', 100)],
    ['Собакар',   readByLen('Токен Приват Собакар.xlsx', 100)],
    ['Терещук',   readByLen('Токен Приват Терещук (1).xlsx', 100) || readByLen('Токен Приват Терещук.xlsx', 100)],
    ['Смирнова',  readByLen('Токен Приват банк Смирнова.xlsx', 100)],
    ['Куденко',   readByLen('Токен Приват Куденко.xlsx', 100)],
    ['Гачава',    readByLen('Токен Приват Гачава.xlsx', 100)],
  ]

  for (const [name, token] of privatTokens) {
    if (!token) { console.log(`  ⏭️  ${name}: токен відсутній`); continue }
    console.log(`\n⏳ PrivatBank ${name}...`)
    try {
      const txns = await fetchPrivatBank(token, name, DATE_FROM, DATE_TO)
      const analysis = analyzeSchema(txns, `privatbank_${name.toLowerCase()}`)
      printAnalysis(analysis)

      if (txns.length) {
        // Show first transaction structure
        console.log(`\n  Sample transaction (${name}):`)
        const sample = txns[0]
        for (const [k, v] of Object.entries(sample)) {
          if (!/name|pib|inn/i.test(k)) console.log(`    ${k}: ${String(v).slice(0, 80)}`)
        }
        saveFixture('raw_samples', `privatbank_${name.toLowerCase()}.json`, {
          source: 'privatbank',
          client: name,
          period: `${DATE_FROM}/${DATE_TO}`,
          count: txns.length,
          schema: Object.keys(sample),
          sample: anonymize(txns.slice(0, 3))
        })
      }
    } catch (e) {
      console.log(`  ❌ ${name}: ${e.message}`)
    }
  }

  // ---- MONOBANK ----
  console.log('\n\n🏦 MONOBANK\n')
  // ⚠️ ВИПРАВЛЕННЯ 2026-04-09: Собакар НЕ має Monobank.
  // Попередній fixture monobank_собакар.json = дублікат рахунку Терещука (помилка)
  const monoTokens = [
    ['Терещук', readByLen('Токен Моно банк Терещук.xlsx', 40, 50)],
  ]

  for (const [name, token] of monoTokens) {
    if (!token) { console.log(`  ⏭️  ${name}: токен відсутній`); continue }
    console.log(`\n⏳ Monobank ${name}...`)
    try {
      const txns = await fetchMonobank(token, name, DATE_FROM, DATE_TO)
      const analysis = analyzeSchema(txns, `monobank_${name.toLowerCase()}`)
      printAnalysis(analysis)

      if (txns.length) {
        console.log(`\n  Sample transaction (${name}):`)
        const sample = txns[0]
        for (const [k, v] of Object.entries(sample)) {
          if (!/description|comment/i.test(k) || k === '_account_type') {
            console.log(`    ${k}: ${String(v).slice(0, 80)}`)
          }
        }
        saveFixture('raw_samples', `monobank_${name.toLowerCase()}.json`, {
          source: 'monobank',
          client: name,
          period: `${DATE_FROM}/${DATE_TO}`,
          count: txns.length,
          schema: Object.keys(sample),
          sample: anonymize(txns.slice(0, 3))
        })
      }
    } catch (e) {
      console.log(`  ❌ ${name}: ${e.message}`)
    }
    // Mandatory delay between Monobank tokens (1 req/61s per token, but different tokens = ok)
    await new Promise(r => setTimeout(r, 2000))
  }

  // ---- POSTER ----
  console.log('\n\n🧾 POSTER (Голубов)\n')
  const posterToken = readByLen('Токен Постер Голубов.xlsx', 30, 60)
  if (posterToken) {
    console.log('⏳ Poster Голубов...')
    try {
      const txns = await fetchPoster(posterToken, 'Голубов', DATE_FROM, DATE_TO)
      const analysis = analyzeSchema(txns, 'poster_holobov')
      printAnalysis(analysis)

      if (txns.length) {
        console.log(`\n  Sample transaction (Голубов):`)
        const sample = txns[0]
        for (const [k, v] of Object.entries(sample).slice(0, 20)) {
          console.log(`    ${k}: ${String(v).slice(0, 80)}`)
        }
        saveFixture('raw_samples', 'poster_holobov.json', {
          source: 'poster',
          client: 'Голубов',
          period: `${DATE_FROM}/${DATE_TO}`,
          count: txns.length,
          schema: Object.keys(sample),
          sample: anonymize(txns.slice(0, 3))
        })
      } else {
        // Голубов = щоденно працюючий ПРРО. Якщо 0 за поточний діапазон — пробуємо ширше
        console.log('  ℹ️  Немає транзакцій за цей período — спробуємо квітень 2026')
        const txnsApr = await fetchPoster(posterToken, 'Голубов (квіт26)', '2026-04-01', '2026-04-09')
        if (txnsApr.length) {
          printAnalysis(analyzeSchema(txnsApr, 'poster_holobov_apr26'))
          saveFixture('raw_samples', 'poster_holobov.json', {
            source: 'poster', client: 'Голубов', period: '2026-04-01/2026-04-09',
            count: txnsApr.length, schema: Object.keys(txnsApr[0]), sample: anonymize(txnsApr.slice(0, 3))
          })
        } else {
          // Fallback лютий (відомий робочий місяць — 606 чеків)
          console.log('  ℹ️  Квітень теж 0 — fallback лютий 2026')
          const txnsFeb = await fetchPoster(posterToken, 'Голубов (лют26)', '2026-02-01', '2026-02-28')
          if (txnsFeb.length) {
            saveFixture('raw_samples', 'poster_holobov_feb26.json', {
              source: 'poster', client: 'Голубов', period: '2026-02-01/2026-02-28',
              count: txnsFeb.length, schema: Object.keys(txnsFeb[0]), sample: anonymize(txnsFeb.slice(0, 3))
            })
          } else {
            console.log('  ❌ Poster Голубов: 0 чеків у всіх діапазонах — перевірити токен або API')
          }
        }
      }
    } catch (e) {
      console.log(`  ❌ Poster Голубов: ${e.message}`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('✅ Data fetch complete. Fixtures saved to tests/fixtures/raw_samples/')
  console.log()
}

run().catch(console.error)
