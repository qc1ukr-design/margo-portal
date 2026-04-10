#!/usr/bin/env node
// ============================================================
// KMS Service — Local Crypto Smoke Test
// Margo Portal — Stage 1
//
// Tests AES-256-GCM envelope encryption logic WITHOUT AWS KMS.
// Simulates the KMS data key with a local random key.
// Run: node tests/kms-crypto-smoke.cjs
//
// Passes if all 6 cases show [PASS]. Exits 1 on any failure.
// ============================================================

'use strict'

const crypto = require('crypto')

// ---- Copy of the exact crypto functions from railway/kms-service/index.js ----
// (keep in sync if you change kms-service)

const AES_ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

function aesEncrypt(plaintext, dataKey) {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(AES_ALGO, dataKey, iv)
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  dataKey.fill(0) // wipe
  return Buffer.concat([iv, ciphertext, tag])
}

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
  dataKey.fill(0) // wipe
  return plaintext.toString('utf8')
}

// ---- Test helpers ----

let passed = 0
let failed = 0

function pass(label) {
  console.log(`[PASS] ${label}`)
  passed++
}

function fail(label, reason) {
  console.error(`[FAIL] ${label}: ${reason}`)
  failed++
}

function simulateKmsDataKey() {
  // Simulates AWS KMS GenerateDataKey (AES_256 = 32 bytes)
  return crypto.randomBytes(32)
}

// ---- Tests ----

// [1] Basic roundtrip
;(function testBasicRoundtrip() {
  const plaintext = 'test-api-token-abc123'
  const dataKey = simulateKmsDataKey()
  const dataKeyForDecrypt = Buffer.from(dataKey) // copy before encrypt wipes it
  const encrypted = aesEncrypt(plaintext, dataKey)
  const decrypted = aesDecrypt(Buffer.from(encrypted), dataKeyForDecrypt)
  if (decrypted === plaintext) {
    pass('Basic roundtrip')
  } else {
    fail('Basic roundtrip', `expected '${plaintext}', got '${decrypted}'`)
  }
})()

// [2] Unicode token (Cyrillic, emoji)
;(function testUnicode() {
  const plaintext = 'Марго-токен-12345-🔐'
  const dataKey = simulateKmsDataKey()
  const dataKeyForDecrypt = Buffer.from(dataKey)
  const encrypted = aesEncrypt(plaintext, dataKey)
  const decrypted = aesDecrypt(Buffer.from(encrypted), dataKeyForDecrypt)
  if (decrypted === plaintext) {
    pass('Unicode token roundtrip')
  } else {
    fail('Unicode token roundtrip', `mismatch`)
  }
})()

// [3] Long token (simulate JWT — up to 2048 chars)
;(function testLongToken() {
  const plaintext = crypto.randomBytes(1024).toString('base64')
  const dataKey = simulateKmsDataKey()
  const dataKeyForDecrypt = Buffer.from(dataKey)
  const encrypted = aesEncrypt(plaintext, dataKey)
  const decrypted = aesDecrypt(Buffer.from(encrypted), dataKeyForDecrypt)
  if (decrypted === plaintext) {
    pass('Long token (1024 bytes) roundtrip')
  } else {
    fail('Long token roundtrip', 'mismatch')
  }
})()

// [4] Wrong key produces authentication failure (GCM auth tag mismatch)
;(function testWrongKeyFails() {
  const plaintext = 'secret-token'
  const dataKey = simulateKmsDataKey()
  const encrypted = aesEncrypt(plaintext, dataKey)
  const wrongKey = simulateKmsDataKey() // different key
  try {
    aesDecrypt(Buffer.from(encrypted), wrongKey)
    fail('Wrong key rejection', 'should have thrown but did not')
  } catch (err) {
    pass('Wrong key correctly rejected (GCM auth tag)')
  }
})()

// [5] Tampered ciphertext produces authentication failure
;(function testTamperedCiphertextFails() {
  const plaintext = 'secret-token'
  const dataKey = simulateKmsDataKey()
  const encrypted = aesEncrypt(plaintext, dataKey)
  const dataKeyForDecrypt = Buffer.from(dataKey)
  // Flip a bit in the ciphertext (after IV, before tag)
  const tampered = Buffer.from(encrypted)
  tampered[IV_BYTES + 2] ^= 0x01
  try {
    aesDecrypt(tampered, dataKeyForDecrypt)
    fail('Tampered ciphertext rejection', 'should have thrown but did not')
  } catch (err) {
    pass('Tampered ciphertext correctly rejected (GCM auth tag)')
  }
})()

// [6] Data key is zeroed after encrypt (memory safety)
;(function testKeyWipedAfterEncrypt() {
  const dataKey = simulateKmsDataKey()
  const original = Buffer.from(dataKey)
  aesEncrypt('some-token', dataKey)
  const allZero = dataKey.every((b) => b === 0)
  if (allZero) {
    pass('Data key zeroed after encrypt')
  } else {
    fail('Data key zeroed after encrypt', 'key still contains non-zero bytes')
  }
})()

// ---- Results ----

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
} else {
  console.log('All crypto smoke tests PASSED ✓')
}
