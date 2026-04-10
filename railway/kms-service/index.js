// ============================================================
// Railway KMS Service — Envelope Encryption Microservice
// Margo Portal — Stage 1
//
// Responsibilities:
//   1. POST /encrypt — generate data key via AWS KMS,
//      encrypt plaintext token with AES-256-GCM,
//      return { encrypted_token, kms_data_key_encrypted, kms_key_id }
//   2. POST /decrypt — decrypt data key via AWS KMS,
//      decrypt token with AES-256-GCM, return { plaintext }
//   3. GET  /health  — Railway health check
//
// Envelope encryption pattern:
//   - AWS KMS generates a data key (GenerateDataKey)
//   - Plaintext data key encrypts the token (AES-256-GCM, in memory only)
//   - Encrypted data key stored alongside ciphertext (safe to store)
//   - Plaintext data key NEVER persisted — cleared after use
//
// Internal-only: Railway private networking — not publicly accessible
// No inter-service auth needed (Railway internal network)
//
// Env vars required:
//   AWS_REGION               — e.g. us-east-1
//   AWS_ACCESS_KEY_ID        — IAM user margo-portal-kms
//   AWS_SECRET_ACCESS_KEY    — IAM user margo-portal-kms
//   KMS_KEY_ID               — ARN or alias of the CMK
//   PORT                     — set automatically by Railway
// ============================================================

'use strict'

const express = require('express')
const crypto = require('crypto')
const { KMSClient, GenerateDataKeyCommand, DecryptCommand } = require('@aws-sdk/client-kms')

// ---- Config ----

const KMS_KEY_ID = process.env.KMS_KEY_ID
const PORT = process.env.PORT || 3002

if (!KMS_KEY_ID) {
  console.error('[kms-service] FATAL: KMS_KEY_ID env var is required')
  process.exit(1)
}

const kmsClient = new KMSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined, // falls back to IAM role / instance profile if not set
})

// ---- AES-256-GCM helpers ----

const AES_ALGO = 'aes-256-gcm'
const IV_BYTES = 12   // 96-bit IV — standard for GCM
const TAG_BYTES = 16  // 128-bit auth tag

/**
 * Encrypt plaintext string with AES-256-GCM.
 * Returns a single Buffer: [ IV (12) | ciphertext | auth tag (16) ]
 * The data key Buffer is zeroed after use.
 */
function aesEncrypt(plaintext, dataKey) {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(AES_ALGO, dataKey, iv)
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  dataKey.fill(0) // wipe key material from memory
  return Buffer.concat([iv, ciphertext, tag])
}

/**
 * Decrypt ciphertext produced by aesEncrypt.
 * Expects Buffer: [ IV (12) | ciphertext | auth tag (16) ]
 * The data key Buffer is zeroed after use.
 * Returns plaintext string.
 */
function aesDecrypt(encryptedBuffer, dataKey) {
  if (encryptedBuffer.length < IV_BYTES + TAG_BYTES + 1) {
    dataKey.fill(0)
    throw new Error('Encrypted buffer too short')
  }
  const iv = encryptedBuffer.subarray(0, IV_BYTES)
  const tag = encryptedBuffer.subarray(encryptedBuffer.length - TAG_BYTES)
  const ciphertext = encryptedBuffer.subarray(IV_BYTES, encryptedBuffer.length - TAG_BYTES)

  const decipher = crypto.createDecipheriv(AES_ALGO, dataKey, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  dataKey.fill(0) // wipe key material from memory
  return plaintext.toString('utf8')
}

// ---- Express app ----

const app = express()
app.use(express.json({ limit: '64kb' }))

/**
 * POST /encrypt
 * Body: { plaintext: string }
 * Response: {
 *   encrypted_token: string,           // base64(iv+ciphertext+tag)
 *   kms_data_key_encrypted: string,    // base64(KMS CiphertextBlob)
 *   kms_key_id: string                 // KMS key ARN or alias used
 * }
 * IMPORTANT: never log plaintext or data key material
 */
app.post('/encrypt', async (req, res) => {
  const { plaintext } = req.body

  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return res.status(400).json({ error: 'plaintext must be a non-empty string' })
  }
  if (plaintext.length > 8192) {
    return res.status(400).json({ error: 'plaintext exceeds maximum length (8192 chars)' })
  }

  let plaintextDataKey = null
  try {
    // 1. Ask KMS to generate a 256-bit data key
    const genCmd = new GenerateDataKeyCommand({
      KeyId: KMS_KEY_ID,
      KeySpec: 'AES_256',
    })
    const { Plaintext: rawKey, CiphertextBlob: encryptedKey, KeyId: usedKeyId } =
      await kmsClient.send(genCmd)

    // 2. Copy plaintext key into a mutable Buffer so we can wipe it later
    plaintextDataKey = Buffer.from(rawKey)

    // 3. AES-256-GCM encrypt the token (wipes plaintextDataKey internally)
    const encryptedBuffer = aesEncrypt(plaintext, plaintextDataKey)
    plaintextDataKey = null // already zeroed inside aesEncrypt

    return res.json({
      encrypted_token: encryptedBuffer.toString('base64'),
      kms_data_key_encrypted: Buffer.from(encryptedKey).toString('base64'),
      kms_key_id: usedKeyId,
    })
  } catch (err) {
    if (plaintextDataKey) {
      plaintextDataKey.fill(0)
      plaintextDataKey = null
    }
    console.error('[kms-service] encrypt error:', err.message)
    return res.status(500).json({ error: 'Encryption failed', message: err.message })
  }
})

/**
 * POST /decrypt
 * Body: {
 *   encrypted_token: string,           // base64(iv+ciphertext+tag)
 *   kms_data_key_encrypted: string,    // base64(KMS CiphertextBlob)
 * }
 * Response: { plaintext: string }
 * IMPORTANT: never log plaintext or data key material
 */
app.post('/decrypt', async (req, res) => {
  const { encrypted_token, kms_data_key_encrypted } = req.body

  if (typeof encrypted_token !== 'string' || !encrypted_token) {
    return res.status(400).json({ error: 'encrypted_token is required' })
  }
  if (typeof kms_data_key_encrypted !== 'string' || !kms_data_key_encrypted) {
    return res.status(400).json({ error: 'kms_data_key_encrypted is required' })
  }

  let plaintextDataKey = null
  try {
    // 1. Ask KMS to decrypt the data key
    const decCmd = new DecryptCommand({
      KeyId: KMS_KEY_ID,
      CiphertextBlob: Buffer.from(kms_data_key_encrypted, 'base64'),
    })
    const { Plaintext: rawKey } = await kmsClient.send(decCmd)

    // 2. Copy into mutable Buffer
    plaintextDataKey = Buffer.from(rawKey)

    // 3. AES-256-GCM decrypt (wipes plaintextDataKey internally)
    const encryptedBuffer = Buffer.from(encrypted_token, 'base64')
    const plaintext = aesDecrypt(encryptedBuffer, plaintextDataKey)
    plaintextDataKey = null // already zeroed inside aesDecrypt

    return res.json({ plaintext })
  } catch (err) {
    if (plaintextDataKey) {
      plaintextDataKey.fill(0)
      plaintextDataKey = null
    }
    // Do NOT log the encrypted_token — it may contain sensitive routing info
    console.error('[kms-service] decrypt error:', err.message)
    return res.status(500).json({ error: 'Decryption failed', message: err.message })
  }
})

/**
 * GET /health — Railway health check
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'kms-service' })
})

app.listen(PORT, () => {
  console.log(`[kms-service] Listening on port ${PORT}`)
  console.log(`[kms-service] KMS key configured: ${KMS_KEY_ID.includes('alias/') ? KMS_KEY_ID : '[ARN set]'}`)
})
