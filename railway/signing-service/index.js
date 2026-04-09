// ============================================================
// Railway Signing Service — КЕП / DSTU signing microservice
// Margo Portal — Stage 0 scaffolding
//
// Responsibilities:
//   1. Load КЕП key file (Key-6.dat or .jks) from encrypted storage
//   2. Sign data with DSTU 4145 via jkurwa
//   3. Return base64(CMS_SignedData) for use as ДПС Authorization header
//
// Install: npm install jkurwa gost89 express
// Run:     node index.js (Railway auto-starts)
// Port:    process.env.PORT (Railway sets this automatically)
//
// TODO Stage 1: integrate with AWS KMS for key file decryption
// TODO Stage 1: integrate with Supabase Storage for key file retrieval
// ============================================================

const express = require('express')
const jk = require('jkurwa')

const app = express()
app.use(express.json())

// Internal-only — Railway private networking means this is not public
// No auth needed between Next.js and this service (Railway internal network)
// Reference: github.com/max1gu/e-rro/blob/master/e-rro.ts — jkurwa usage pattern

/**
 * POST /sign
 * Body: {
 *   data: string,      // ЄДРПОУ or РНОКПП to sign (UTF-8)
 *   key_ref: string,   // reference to encrypted key file in Supabase Storage
 *   key_type: string,  // 'key6dat' | 'jks'
 *   password: string,  // КЕП key password
 * }
 * Response: { signature: string }  // base64(CMS_SignedData_DER)
 */
app.post('/sign', async (req, res) => {
  const { data, key_ref, key_type, password } = req.body

  if (!data || !key_ref || !password) {
    return res.status(400).json({ error: 'Missing required fields: data, key_ref, password' })
  }

  try {
    // TODO Stage 1: fetch encrypted key file from Supabase Storage using key_ref
    // TODO Stage 1: decrypt key file using AWS KMS envelope decryption
    // For Stage 0 testing: load from local filesystem using key_ref as path
    const fs = require('fs')
    const keyBuffer = fs.readFileSync(key_ref)  // Stage 0: key_ref = local file path

    // Load КЕП key container (Key-6.dat or .jks)
    const box = new jk.Box()
    await box.load({ key: keyBuffer, password })

    // Sign the ЄДРПОУ/РНОКПП bytes
    // CMS SignedData with embedded certificate (addCert: true)
    // Internal (attached) signature — required by ДПС
    // Reference: github.com/max1gu/e-rro for jkurwa signing pattern
    const payload = Buffer.from(String(data), 'utf8')
    const signed = await box.sign(payload, { addCert: true, detached: false })

    // Return base64(DER) — used directly as Authorization header (no "Bearer" prefix)
    res.json({ signature: signed.toString('base64') })
  } catch (err) {
    // IMPORTANT: never log password or key contents
    console.error('Signing failed:', err.message)
    res.status(500).json({ error: 'Signing failed', message: err.message })
  }
})

/**
 * GET /health — Railway health check
 */
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Signing service listening on port ${PORT}`)
})
