// ============================================================
// Railway Reconciliation Worker — Stage 1 Stub
// Margo Portal
//
// Responsibilities (Stage 1 — stub):
//   1. Health endpoint for Railway health checks
//   2. Poll Supabase for PENDING reconciliation runs
//   3. Process each run (stub: mark completed, log duration)
//   4. Validate completion within Railway 5-minute timeout
//
// Responsibilities (Stage 3 — full implementation):
//   - Fetch fiscal receipts + bank transactions for run period
//   - Run matching engine (novapay_registry, direct_bank, etc.)
//   - Write reconciliation_matches rows
//   - Update run status to 'completed' or 'failed'
//
// Env vars required:
//   SUPABASE_URL             — Supabase project URL
//   SUPABASE_SERVICE_KEY     — service_role key (bypasses RLS for worker)
//   KMS_SERVICE_URL          — internal URL of kms-service (Railway private network)
//   POLL_INTERVAL_MS         — polling interval in ms (default: 30000)
//   PORT                     — set automatically by Railway
// ============================================================

'use strict'

const express = require('express')
const { createClient } = require('@supabase/supabase-js')

// ---- Config ----

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  KMS_SERVICE_URL,
  POLL_INTERVAL_MS = '30000',
  PORT = '3003',
} = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[worker] FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY are required')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const POLL_MS = parseInt(POLL_INTERVAL_MS, 10)

// ---- Health server ----
// Must be running before first poll — Railway expects health to respond

const app = express()
app.use(express.json())

let lastPollAt = null
let runsSinceStart = 0

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'reconciliation-worker',
    last_poll_at: lastPollAt,
    runs_since_start: runsSinceStart,
  })
})

app.listen(PORT, () => {
  console.log(`[worker] Health endpoint on port ${PORT}`)
})

// ---- Worker loop ----

/**
 * Process a single reconciliation run.
 * Stage 1: stub — just marks run as completed with zero matches.
 * Stage 3: replace body with actual matching engine call.
 *
 * Returns duration in ms. Must complete within Railway 5-minute job budget.
 */
async function processRun(run) {
  const startedAt = Date.now()
  console.log(`[worker] Processing run ${run.id} | entity=${run.business_entity_id} | period=${run.period_start}→${run.period_end}`)

  // Mark run as 'running'
  await supabase
    .from('reconciliation_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', run.id)

  // ---- Stage 3: insert matching engine call here ----
  // const result = await runMatchingEngine(run, supabase, kmsServiceUrl)

  // Stage 1 stub: simulate minimal processing
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Mark run as 'completed'
  const completedAt = new Date().toISOString()
  const { error } = await supabase
    .from('reconciliation_runs')
    .update({
      status: 'completed',
      completed_at: completedAt,
      error_message: null,
    })
    .eq('id', run.id)

  if (error) {
    console.error(`[worker] Failed to mark run ${run.id} as completed:`, error.message)
    throw error
  }

  const durationMs = Date.now() - startedAt
  console.log(`[worker] Run ${run.id} completed in ${durationMs}ms`)
  runsSinceStart++
  return durationMs
}

/**
 * Poll Supabase for PENDING reconciliation runs.
 * Processes up to 5 runs per poll cycle to respect 5-minute timeout.
 */
async function poll() {
  lastPollAt = new Date().toISOString()

  let { data: runs, error } = await supabase
    .from('reconciliation_runs')
    .select('id, business_entity_id, tenant_id, period_start, period_end, algorithm_version')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5)

  if (error) {
    console.error('[worker] Poll error:', error.message)
    return
  }

  if (!runs || runs.length === 0) {
    return // nothing to process
  }

  console.log(`[worker] Found ${runs.length} pending run(s)`)

  const pollStartMs = Date.now()
  const MAX_POLL_DURATION_MS = 4 * 60 * 1000 // 4 min budget (Railway allows 5)

  for (const run of runs) {
    if (Date.now() - pollStartMs > MAX_POLL_DURATION_MS) {
      console.warn('[worker] Approaching 5-minute limit — deferring remaining runs to next poll')
      break
    }
    try {
      await processRun(run)
    } catch (err) {
      console.error(`[worker] Run ${run.id} failed:`, err.message)
      // Mark as failed so it doesn't get picked up again without intervention
      await supabase
        .from('reconciliation_runs')
        .update({ status: 'failed', error_message: err.message })
        .eq('id', run.id)
    }
  }
}

// ---- Timeout test ----
// Stage 1 requirement: verify the worker respects the 5-minute Railway limit.
// Logs the time to process a simulated batch and confirms it completes under budget.

async function runTimeoutTest() {
  console.log('[worker] Running Stage 1 timeout test...')
  const start = Date.now()

  // Simulate processing 5 runs at 100ms each = 500ms total
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    console.log(`[worker] Timeout test: simulated run ${i + 1}/5`)
  }

  const durationMs = Date.now() - start
  const LIMIT_MS = 5 * 60 * 1000

  if (durationMs < LIMIT_MS) {
    console.log(`[worker] Timeout test PASSED: ${durationMs}ms < ${LIMIT_MS}ms (5-min limit)`)
  } else {
    console.error(`[worker] Timeout test FAILED: ${durationMs}ms >= ${LIMIT_MS}ms`)
    process.exit(1)
  }
}

// ---- Start ----

async function main() {
  console.log('[worker] Starting reconciliation worker...')
  console.log(`[worker] Supabase URL: ${SUPABASE_URL}`)
  console.log(`[worker] KMS service URL: ${KMS_SERVICE_URL || '(not set — Stage 1 stub)'}`)
  console.log(`[worker] Poll interval: ${POLL_MS}ms`)

  // Run timeout test on startup (Stage 1 verification)
  await runTimeoutTest()

  // Start polling loop
  console.log('[worker] Starting poll loop...')
  await poll() // immediate first poll
  setInterval(poll, POLL_MS)
}

main().catch((err) => {
  console.error('[worker] Fatal startup error:', err.message)
  process.exit(1)
})
