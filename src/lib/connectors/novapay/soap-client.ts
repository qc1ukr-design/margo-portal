// ============================================================
// NovaPay SOAP Client Helper
// WSDL: https://business.novapay.ua/Services/ClientAPIService.svc?wsdl
// Namespace: http://tempuri.org/
//
// SOAP Operations (confirmed from WSDL v2.37.2.6):
//   UserAuthenticationJWT(refresh_token) → jwt + new refresh_token (automated auth)
//   GetClientsList(principal|jwt) → client IDs
//   GetAccountsList(principal|jwt, client_id) → account IDs
//   GetPaymentsList(principal|jwt, account_id, date_from, date_to, date_type) → payments
//   GetAccountExtract(principal|jwt, account_id, date_from, date_to) → bank statement
//   GetRegister(principal|jwt, Type, ClientId, From, Into, FileExtension) → register file
//
// AUTH — two methods:
//   1. principal: from manual OTP-based UserAuthentication (session-based, expires)
//   2. jwt: from UserAuthenticationJWT using refresh_token (automated, refreshable)
//
// CREDENTIALS:
//   credentials.token                 = principal OR jwt (current active token)
//   credentials.extra.refresh_token   = refresh token for JWT renewal (Сухарєв type)
//   credentials.extra.client_id       = NovaPay client ID (cached after GetClientsList)
//   credentials.extra.account_id      = primary account ID (cached after GetAccountsList)
//   credentials.extra.token_type      = 'principal' | 'jwt' (defaults to 'jwt' if refresh_token exists)
// ============================================================

import type { ConnectorCredentials } from '../../types'
import { ConnectorAuthError, ConnectorError } from '../base'

const SOAP_ENDPOINT = 'https://business.novapay.ua/Services/ClientAPIService.svc'
const SOAP_NS = 'http://tempuri.org/'

// ------ JWT Cache ------

interface JwtCache {
  jwt: string
  refresh_token: string
  expires_at: number  // Unix ms (estimate — NovaPay doesn't provide expires_in)
}

const jwtCache = new Map<string, JwtCache>()

// ------ Core SOAP caller ------

async function callSoap(action: string, bodyXml: string): Promise<string> {
  const res = await fetch(SOAP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `${SOAP_NS}IClientAPIService/${action}`,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="${SOAP_NS}">
  <soap:Body>${bodyXml}</soap:Body>
</soap:Envelope>`,
  })

  const text = await res.text()
  if (text.includes('<s:Fault>') || text.includes('Fault>')) {
    const faultMsg = text.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/)?.[1]
      ?? text.match(/<title>([^<]+)<\/title>/)?.[1]
      ?? 'SOAP Fault'
    throw new ConnectorError('novapay_agent', `SOAP fault: ${faultMsg}`)
  }
  return text
}

// ------ Auth helpers ------

/**
 * Returns active auth token (jwt preferred if refresh_token available).
 * Automatically refreshes jwt via UserAuthenticationJWT if expired.
 * IMPORTANT: refresh_token stored in credentials.extra is updated in-place after refresh —
 * caller must persist updated credentials to DB.
 */
export async function getNovapayToken(credentials: ConnectorCredentials): Promise<{ token: string; tokenType: 'principal' | 'jwt' }> {
  const hasRefreshToken = !!credentials.extra?.refresh_token

  if (!hasRefreshToken) {
    // Static principal or static JWT — use as-is (Терещук type)
    return { token: credentials.token, tokenType: 'principal' }
  }

  // JWT with refresh token (Сухарєв type)
  const refreshToken = credentials.extra!.refresh_token as string
  const cacheKey = refreshToken.slice(-20)
  const cached = jwtCache.get(cacheKey)

  if (cached && cached.expires_at > Date.now() + 60_000) {
    return { token: cached.jwt, tokenType: 'jwt' }
  }

  // Refresh the JWT
  // IMPORTANT: refresh_token in memory only — never log
  const xml = await callSoap('UserAuthenticationJWT', `
    <tns:UserAuthenticationJWT>
      <tns:request>
        <tns:refresh_token>${refreshToken}</tns:refresh_token>
      </tns:request>
    </tns:UserAuthenticationJWT>`)

  const result = extractElement(xml, 'UserAuthenticationJWTResult')
  if (!result || extractElement(result, 'result') === 'error') {
    const title = extractElement(result ?? xml, 'title') ?? 'refresh failed'
    throw new ConnectorAuthError('novapay_agent')
  }

  const newJwt = extractElement(result, 'jwt') ?? ''
  const newRefresh = extractElement(result, 'refresh_token') ?? refreshToken

  // Cache for 23h (NovaPay JWT likely 24h, refresh 23h to be safe)
  jwtCache.set(cacheKey, {
    jwt: newJwt,
    refresh_token: newRefresh,
    expires_at: Date.now() + 23 * 60 * 60 * 1000,
  })

  // Update in-memory credentials for this request cycle
  credentials.extra!.refresh_token = newRefresh

  return { token: newJwt, tokenType: 'jwt' }
}

/**
 * Builds the auth portion of a BaseClientApiRequest.
 */
export function authFields(token: string, tokenType: 'principal' | 'jwt'): string {
  return tokenType === 'jwt'
    ? `<tns:jwt>${escapeXml(token)}</tns:jwt>`
    : `<tns:principal>${escapeXml(token)}</tns:principal>`
}

// ------ Helper: Extract XML element value ------

export function extractElement(xml: string, tag: string): string | null {
  // Try with namespace prefix variations
  const patterns = [
    new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'm'),
    new RegExp(`<[^:]+:${tag}>([\\s\\S]*?)<\\/[^:]+:${tag}>`, 'm'),
  ]
  for (const p of patterns) {
    const m = xml.match(p)
    if (m) return m[1].trim()
  }
  return null
}

/**
 * Extracts a list of repeating elements from XML.
 * Returns array of raw XML strings for each occurrence.
 */
export function extractElements(xml: string, tag: string): string[] {
  const results: string[] = []
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gm')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    results.push(m[0])
  }
  return results
}

// ------ GetClientsList ------

export async function getClientId(credentials: ConnectorCredentials): Promise<number> {
  if (credentials.extra?.client_id) {
    return Number(credentials.extra.client_id)
  }

  const { token, tokenType } = await getNovapayToken(credentials)
  const xml = await callSoap('GetClientsList', `
    <tns:GetClientsList>
      <tns:request>
        ${authFields(token, tokenType)}
      </tns:request>
    </tns:GetClientsList>`)

  const clientId = extractElement(xml, 'client_id')
  if (!clientId) throw new ConnectorError('novapay_agent', 'No client_id in GetClientsList response')
  credentials.extra = credentials.extra ?? {}
  credentials.extra.client_id = clientId
  return Number(clientId)
}

// ------ GetAccountsList ------

export async function getAccountId(credentials: ConnectorCredentials): Promise<string> {
  if (credentials.extra?.account_id) {
    return String(credentials.extra.account_id)
  }

  const { token, tokenType } = await getNovapayToken(credentials)
  const clientId = await getClientId(credentials)

  const xml = await callSoap('GetAccountsList', `
    <tns:GetAccountsList>
      <tns:request>
        ${authFields(token, tokenType)}
        <tns:client_id>${clientId}</tns:client_id>
      </tns:request>
    </tns:GetAccountsList>`)

  const accountId = extractElement(xml, 'account_id')
  if (!accountId) throw new ConnectorError('novapay_agent', 'No account_id in GetAccountsList response')
  credentials.extra = credentials.extra ?? {}
  credentials.extra.account_id = accountId
  return accountId
}

// ------ XML escaping ------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export { callSoap, SOAP_ENDPOINT }
