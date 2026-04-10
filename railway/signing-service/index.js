// ============================================================
// Railway Signing Service — КЕП / DSTU signing microservice
// Margo Portal — Stage 1
//
// Responsibilities:
//   1. Fetch encrypted КЕП key file from Supabase Storage
//   2. Decrypt key file via kms-service (envelope decryption)
//   3. Sign data with DSTU 4145 via jkurwa
//   4. Return base64(CMS_SignedData) for ДПС Authorization header
//
// Key file storage format in Supabase Storage (bucket: kep-keys):
//   Path: {business_entity_id}/{filename}
//   Content: JSON { encrypted: "<base64>", kms_data_key_encrypted: "<base64>" }
//   (Produced by the credentials upload API route in Next.js)
//
// Install: npm install
// Run:     node index.js (Railway auto-starts)
// Port:    process.env.PORT (Railway sets this automatically)
//
// Env vars required:
//   SUPABASE_URL             — Supabase project URL
//   SUPABASE_SERVICE_KEY     — service_role key
//   KMS_SERVICE_URL          — internal URL of kms-service (Railway private network)
//   PORT                     — set automatically by Railway
// ============================================================

'use strict'

const express = require('express')
const jk = require('jkurwa')
const { createClient } = require('@supabase/supabase-js')

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  KMS_SERVICE_URL,
  PORT = '3001',
} = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[signing-service] FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY are required')
  process.exit(1)
}
if (!KMS_SERVICE_URL) {
  console.error('[signing-service] FATAL: KMS_SERVICE_URL is required')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const KEP_BUCKET = 'kep-keys'

// ---- Storage helpers ----

/**
 * Fetch the encrypted КЕП key file from Supabase Storage.
 * Storage format: JSON { encrypted: base64, kms_data_key_encrypted: base64 }
 * Returns parsed JSON.
 */
async function fetchEncryptedKeyFile(keyRef) {
  const { data, error } = await supabase.storage
    .from(KEP_BUCKET)
    .download(keyRef)

  if (error) {
    throw new Error(`Storage fetch failed for key_ref '${keyRef}': ${error.message}`)
  }

  // Blob → text → JSON
  const text = await data.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Key file at '${keyRef}' is not valid JSON — may be unencrypted (Stage 0 format)`)
  }

  if (!parsed.encrypted || !parsed.kms_data_key_encrypted) {
    throw new Error(`Key file at '${keyRef}' missing required fields: encrypted, kms_data_key_encrypted`)
  }

  return parsed
}

/**
 * Call kms-service to decrypt the data key, then AES-decrypt the key file bytes.
 * Returns plaintext Buffer (the raw КЕП key file bytes).
 */
async function decryptKeyFile(encryptedKeyFile) {
  const res = await fetch(`${KMS_SERVICE_URL}/decrypt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      encrypted_token: encryptedKeyFile.encrypted,
      kms_data_key_encrypted: encryptedKeyFile.kms_data_key_encrypted,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`kms-service decrypt failed (${res.status}): ${body.message ?? body.error}`)
  }

  const { plaintext } = await res.json()
  // plaintext is the raw binary of the key file, base64-encoded by kms-service
  // The kms-service returns the plaintext as a UTF-8 string — for binary files
  // we stored them as base64 before encrypting, so decode here:
  return Buffer.from(plaintext, 'base64')
}

// ---- Express app ----

const app = express()
app.use(express.json({ limit: '64kb' }))

// Internal-only — Railway private networking means this is not public

/**
 * POST /sign
 * Body: {
 *   data: string,      // ЄДРПОУ or РНОКПП to sign (UTF-8)
 *   key_ref: string,   // path in Supabase Storage kep-keys bucket (e.g. "entity-uuid/key.dat")
 *   key_type: string,  // 'key6dat' | 'jks'
 *   password: string,  // КЕП key password
 * }
 * Response: { signature: string }  // base64(CMS_SignedData_DER)
 */
app.post('/sign', async (req, res) => {
  const { data, key_ref, password } = req.body

  if (!data || !key_ref || !password) {
    return res.status(400).json({ error: 'Missing required fields: data, key_ref, password' })
  }

  try {
    // 1. Fetch encrypted key file from Supabase Storage
    const encryptedKeyFile = await fetchEncryptedKeyFile(key_ref)

    // 2. Decrypt via kms-service
    const keyBuffer = await decryptKeyFile(encryptedKeyFile)

    // 3. Load КЕП key container (Key-6.dat or .jks)
    const box = new jk.Box()
    await box.load({ key: keyBuffer, password })

    // 4. Sign the ЄДРПОУ/РНОКПП bytes
    // CMS SignedData with embedded certificate (addCert: true)
    // Internal (attached) signature — required by ДПС
    const payload = Buffer.from(String(data), 'utf8')
    const signed = await box.sign(payload, { addCert: true, detached: false })

    // Return base64(DER) — used directly as Authorization header (no "Bearer" prefix)
    res.json({ signature: signed.toString('base64') })
  } catch (err) {
    // IMPORTANT: never log password or key contents
    console.error('[signing-service] Signing failed:', err.message)
    res.status(500).json({ error: 'Signing failed', message: err.message })
  }
})

/**
 * GET /health — Railway health check
 */
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'signing-service' }))

app.listen(PORT, () => {
  console.log(`[signing-service] Listening on port ${PORT}`)
  console.log(`[signing-service] KMS service: ${KMS_SERVICE_URL}`)
  console.log(`[signing-service] Supabase: ${SUPABASE_URL}`)
})
