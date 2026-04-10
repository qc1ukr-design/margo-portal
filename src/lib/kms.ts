// ============================================================
// KMS Service Client — Next.js / Vercel side
// Margo Portal — Stage 1
//
// Calls the Railway kms-service for envelope encryption/decryption.
// Token plaintext NEVER touches Vercel storage or logs.
//
// Usage:
//   const sealed = await kmsEncrypt(token)
//   // store sealed.encrypted_token, sealed.kms_data_key_encrypted, sealed.kms_key_id in api_credentials
//
//   const token = await kmsDecrypt(sealed)
//   // use token in-memory only — never log or persist
// ============================================================

function getKmsUrl(): string {
  const url = process.env.KMS_SERVICE_URL
  if (!url) {
    throw new Error('KMS_SERVICE_URL env var is not set')
  }
  return url
}

export interface SealedCredential {
  encrypted_token: string           // base64(iv+ciphertext+tag)
  kms_data_key_encrypted: string    // base64(KMS CiphertextBlob)
  kms_key_id: string                // KMS key ARN used for this credential
}

/**
 * Encrypt a plaintext API token via the kms-service.
 * Returns the sealed credential fields to store in api_credentials table.
 * NEVER log plaintext — pass it directly to this function.
 */
export async function kmsEncrypt(plaintext: string): Promise<SealedCredential> {
  const url = `${getKmsUrl()}/encrypt`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plaintext }),
    // Internal Railway network call — no auth header needed
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`kms-service encrypt failed (${res.status}): ${body.message ?? body.error ?? 'unknown'}`)
  }

  const data = await res.json()
  return {
    encrypted_token: data.encrypted_token,
    kms_data_key_encrypted: data.kms_data_key_encrypted,
    kms_key_id: data.kms_key_id,
  }
}

/**
 * Decrypt a sealed credential via the kms-service.
 * Returns the plaintext token — use in memory only, never log or persist.
 */
export async function kmsDecrypt(sealed: Pick<SealedCredential, 'encrypted_token' | 'kms_data_key_encrypted'>): Promise<string> {
  const url = `${getKmsUrl()}/decrypt`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      encrypted_token: sealed.encrypted_token,
      kms_data_key_encrypted: sealed.kms_data_key_encrypted,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`kms-service decrypt failed (${res.status}): ${body.message ?? body.error ?? 'unknown'}`)
  }

  const data = await res.json()
  return data.plaintext
}
