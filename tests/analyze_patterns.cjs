/**
 * Stage 0 — Extended Data Analysis
 * Fetches broader date ranges for clients with 0 transactions.
 * Analyzes OSND patterns across all PrivatBank clients.
 * Run: node tests/analyze_patterns.cjs
 */
'use strict'

const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')
const DL = 'C:/Users/user/Downloads'
const FIXTURES = path.join(__dirname, 'fixtures')

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

function saveFixture(folder, filename, data) {
  const dir = path.join(FIXTURES, folder)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), 'utf8')
  console.log(`  💾 saved → fixtures/${folder}/${filename}`)
}

// ---------------------------------------------------------------------------
// PrivatBank paginated fetch
// ---------------------------------------------------------------------------
async function fetchPrivatBank(token, label, dateFrom, dateTo, maxTxns = 200) {
  const transactions = []
  let followId = null

  while (true) {
    const url = new URL('https://acp.privatbank.ua/api/statements/transactions/final')
    url.searchParams.set('startDate', dateFrom)
    url.searchParams.set('endDate', dateTo)
    url.searchParams.set('limit', '50')
    if (followId) url.searchParams.set('followId', followId)

    const res = await fetch(url.toString(), {
      headers: { 'token': token, 'Content-Type': 'application/json;charset=utf8' }
    })
    if (!res.ok) { console.log(`  ⚠️  PrivatBank ${label}: HTTP ${res.status}`); break }
    const data = await res.json()
    const items = data.transactions ?? data.data ?? []
    transactions.push(...items)

    process.stdout.write(`  PB ${label}: +${items.length} (total ${transactions.length})\r`)

    if (data.executionStatus === 'EXECUTED' || !items.length || transactions.length >= maxTxns) break
    followId = data.followId
    if (!followId) break
  }
  console.log()
  return transactions
}

// ---------------------------------------------------------------------------
// OSND pattern classifier
// ---------------------------------------------------------------------------
function classifyOSND(txn) {
  const osnd = (txn.OSND || '').toLowerCase()
  const counterparty = (txn.AUT_CNTR_NAM || '').toLowerCase()
  const type = txn.TRANTYPE // C or D
  const docType = txn.DOC_TYP

  if (type === 'D' && /єсв|єдиний податок|впз|взнес|вз з фоп|101|ДПС|гудкс|гук у|держказначейс/i.test(txn.OSND + txn.AUT_CNTR_NAM)) {
    return 'TAX_PAYMENT'
  }
  if (/новапей|новапай/i.test(counterparty) || /реестру n \d+/i.test(txn.OSND)) {
    return 'NOVAPAY_AGENT'
  }
  if (/фк.{0,5}єво|ево/i.test(counterparty)) {
    return 'EVO_MARKETPLACE'  // Prom.UA or Rozetka payout
  }
  if (/розрахунки з еквайрингу/i.test(counterparty) || /cmps:/i.test(txn.OSND)) {
    return 'ACQUIRING_SETTLEMENT'
  }
  if (/фк.{0,5}єво|prom|rozetka/i.test(counterparty)) {
    return 'EVO_MARKETPLACE'
  }
  if (type === 'C' && docType === 'p') return 'INCOME_TRANSFER'
  if (type === 'D') return 'OUTGOING'
  return 'OTHER'
}

function analyzeOSNDPatterns(transactions, label) {
  console.log(`\n  📋 OSND Pattern Analysis — ${label} (${transactions.length} txns)`)
  const byType = {}
  for (const txn of transactions) {
    const category = classifyOSND(txn)
    if (!byType[category]) byType[category] = []
    byType[category].push(txn)
  }

  for (const [cat, txns] of Object.entries(byType)) {
    const totalSum = txns.reduce((s, t) => s + parseFloat(t.SUM || 0) * (t.TRANTYPE === 'D' ? -1 : 1), 0)
    console.log(`\n  [${cat}] × ${txns.length} | net ${totalSum.toFixed(2)} UAH`)
    // Show up to 3 unique OSND examples
    const shown = new Set()
    for (const t of txns) {
      const key = t.OSND?.slice(0, 60)
      if (!shown.has(key) && shown.size < 3) {
        shown.add(key)
        console.log(`    • ${t.DAT_OD} ${t.TRANTYPE} ${t.SUM} UAH | ${t.AUT_CNTR_NAM?.slice(0,40)}`)
        console.log(`      OSND: ${t.OSND?.slice(0, 100)}`)
      }
    }
  }
  return byType
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  console.log('\n🔍 Extended PrivatBank Analysis\n' + '='.repeat(60))

  const tokens = {
    'Голубов':  readByLen('Токен Приват Голубов.xlsx', 100),
    'Марков':   readByLen('Токен Приват Марков.xlsx', 100),
    'Собакар':  readByLen('Токен Приват Собакар.xlsx', 100),
    'Смирнова': readByLen('Токен Приват банк Смирнова.xlsx', 100),
    'Куденко':  readByLen('Токен Приват Куденко.xlsx', 100),
    'Гачава':   readByLen('Токен Приват Гачава.xlsx', 100),
  }

  // Wide range: last 6 months (2025-10-01 → 2026-04-07)
  const WIDE_FROM = '2025-10-01'
  const WIDE_TO = '2026-04-07'
  // Narrow range that already worked
  const NARROW_FROM = '2026-03-01'
  const NARROW_TO = '2026-04-07'

  const summary = {}

  for (const [name, token] of Object.entries(tokens)) {
    if (!token) { console.log(`\n⏭️  ${name}: токен відсутній`); continue }
    console.log(`\n⏳ PrivatBank ${name} (wide range ${WIDE_FROM}→${WIDE_TO})...`)

    try {
      const txns = await fetchPrivatBank(token, name, WIDE_FROM, WIDE_TO, 200)
      console.log(`  ✅ ${name}: ${txns.length} transactions in 6-month range`)

      if (txns.length) {
        const patterns = analyzeOSNDPatterns(txns, name)
        summary[name] = {
          count: txns.length,
          categories: Object.fromEntries(Object.entries(patterns).map(([k, v]) => [k, v.length]))
        }

        // Save full fixture with all transactions (no slice)
        const anonymized = txns.slice(0, 10).map(t => {
          const result = {}
          for (const [k, v] of Object.entries(t)) {
            result[k] = /name|pib|inn|edrpou|phone|email|iban|mfo|crf|nam/i.test(k)
              ? '[REDACTED]'
              : v
          }
          return result
        })
        saveFixture('raw_samples', `privatbank_${name.toLowerCase()}_wide.json`, {
          source: 'privatbank',
          client: name,
          period: `${WIDE_FROM}/${WIDE_TO}`,
          count: txns.length,
          schema: txns.length ? Object.keys(txns[0]) : [],
          osnd_categories: Object.fromEntries(Object.entries(patterns).map(([k, v]) => [k, v.length])),
          sample: anonymized
        })
      } else {
        console.log(`  ℹ️  ${name}: 0 transactions even in 6-month range`)
        summary[name] = { count: 0, categories: {} }
      }
    } catch (e) {
      console.log(`  ❌ ${name}: ${e.message}`)
    }

    // Respect rate limits
    await new Promise(r => setTimeout(r, 500))
  }

  // ---------------------------------------------------------------------------
  // Summary table
  // ---------------------------------------------------------------------------
  console.log('\n\n' + '='.repeat(60))
  console.log('📊 SUMMARY — PrivatBank OSND Category Distribution\n')
  console.log(`${'Client'.padEnd(12)} ${'Total'.padStart(6)} ${'NOVAPAY'.padStart(9)} ${'EVO'.padStart(5)} ${'ACQUIR'.padStart(8)} ${'TAX'.padStart(6)} ${'INCOME'.padStart(8)} ${'OTHER'.padStart(7)}`)
  console.log('-'.repeat(65))
  for (const [name, s] of Object.entries(summary)) {
    const c = s.categories
    console.log(
      `${name.padEnd(12)} ${String(s.count).padStart(6)} ` +
      `${String(c.NOVAPAY_AGENT || 0).padStart(9)} ` +
      `${String(c.EVO_MARKETPLACE || 0).padStart(5)} ` +
      `${String(c.ACQUIRING_SETTLEMENT || 0).padStart(8)} ` +
      `${String(c.TAX_PAYMENT || 0).padStart(6)} ` +
      `${String(c.INCOME_TRANSFER || 0).padStart(8)} ` +
      `${String(c.OTHER || 0).padStart(7)}`
    )
  }

  // ---------------------------------------------------------------------------
  // Data Contract v1.0 print
  // ---------------------------------------------------------------------------
  console.log('\n\n' + '='.repeat(60))
  console.log('📄 PrivatBank → bank_transactions Data Contract\n')
  console.log('  Field mapping (PrivatBank raw → normalized):')
  const mapping = [
    ['AUT_MY_ACC',             'account_iban',        'string',  'Own IBAN'],
    ['DAT_OD',                 'date',                'date',    'DD.MM.YYYY → parse to DATE'],
    ['TIM_P',                  'time',                'time',    'HH:MM string'],
    ['DATE_TIME_DAT_OD_TIM_P', 'datetime',            'datetime','Full datetime string'],
    ['TRANTYPE',               'direction',           'enum',    'C=credit, D=debit'],
    ['SUM',                    'amount',              'decimal', 'UAH float (not kopecks)'],
    ['CCY',                    'currency',            'string',  'ISO 4217: UAH, USD, EUR'],
    ['OSND',                   'description',         'text',    'Full payment purpose text'],
    ['AUT_CNTR_NAM',           'counterparty_name',   'string',  'Counterparty legal name'],
    ['AUT_CNTR_ACC',           'counterparty_iban',   'string',  'Counterparty IBAN'],
    ['AUT_CNTR_CRF',           'counterparty_edrpou', 'string',  'ЄДРПОУ or РНОКПП'],
    ['REF',                    'bank_ref',            'string',  'PrivatBank internal ref'],
    ['ID',                     'bank_id',             'string',  'Unique txn ID'],
    ['DOC_TYP',                'doc_type',            'string',  'p=payment, m=merchant acquiring'],
    ['STRUCT_CODE',            'struct_code',         'string',  '101=tax payment'],
  ]
  console.log(`  ${'Raw Field'.padEnd(30)} ${'Normalized'.padEnd(22)} ${'Type'.padEnd(10)} Note`)
  console.log('  ' + '-'.repeat(85))
  for (const [raw, norm, type, note] of mapping) {
    console.log(`  ${raw.padEnd(30)} ${norm.padEnd(22)} ${type.padEnd(10)} ${note}`)
  }

  console.log('\n\n📋 OSND Routing Patterns (for matching engine):')
  console.log(`
  1. NOVAPAY_AGENT
     Detect:  AUT_CNTR_NAM contains "НоваПей" OR OSND matches /реестру n (\\d+)/i
     Extract: registry_number = OSND match[1]
     Link to: novapay agent registry → individual fiscal receipts
     Delta:   commission deducted before transfer (not visible in bank OSND)

  2. EVO_MARKETPLACE (Prom.UA / Rozetka)
     Detect:  AUT_CNTR_NAM contains "ФК" + "ЄВО" (or EVO)
     Extract: date_from/date_to from OSND "за операції DD.MM.YYYY-DD.MM.YYYY"
              gross = OSND "суму {N} грн"
              commission = OSND "винагор. {M} грн"
     SUM field = net (gross - commission) ← matches_delta = commission amount
     Link to: marketplace email register for the same period
     Delta:   NORMAL — delta_amount ≈ commission (3.5% Prom card, 1.7% Prom acct, 1.5% Rozetka)

  3. ACQUIRING_SETTLEMENT (PrivatBank POS terminals)
     Detect:  AUT_CNTR_NAM = "Розрахунки з еквайрингу" OR OSND starts with "cmps:"
     Extract: merchant_id = OSND "cmps: (\\d+)"
              txn_count = OSND "Кiльк тр (\\d+)шт"
              gross = OSND "Вiдшк (\\d+\\.\\d+)грн"  (= SUM, already net)
              commission = OSND "Ком бан (\\d+\\.\\d+)грн"
     SUM field = reimbursement = gross - commission already deducted
     Link to: DPS cabinet receipts with matching merchant_id + date + sum
     Strategy: "acquiring_batch" — match sum of receipts ≈ gross (Вiдшк + Ком бан)

  4. TAX_PAYMENT
     Detect:  TRANTYPE=D AND (STRUCT_CODE=101 OR OSND matches /єсв|єдиний податок|вз з фоп/)
     Action:  SKIP — not a fiscal receipt match candidate
     Record:  bank_transactions.category = 'tax_payment', needs_review = false

  5. INCOME_TRANSFER / OTHER
     Action:  Flag for manual review if no matching receipt found
  `)

  console.log('='.repeat(60))
  console.log('✅ Pattern analysis complete.')
  console.log()
}

run().catch(console.error)
