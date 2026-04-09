// ============================================================
// Base Connector Interface
// Every connector implements this contract.
// ============================================================

import type { ConnectorCredentials, FetchParams } from '../types'

/**
 * Result of a connector fetch — raw API response + normalized records.
 * TRaw: the shape returned directly by the external API (for raw_data storage).
 * TNormalized: the shape ready to upsert into the DB.
 */
export interface ConnectorResult<TRaw, TNormalized> {
  raw: TRaw[]
  normalized: TNormalized[]
  /** How many records fetched from API */
  fetched: number
  /** ISO timestamp of fetch */
  fetched_at: string
}

/**
 * Every connector must implement this interface.
 * - fetch()     — calls the external API, returns raw + normalized data
 * - validate()  — verifies credentials are working (smoke-test)
 */
export interface BaseConnector<TRaw, TNormalized> {
  readonly source: string

  fetch(
    credentials: ConnectorCredentials,
    params: FetchParams,
  ): Promise<ConnectorResult<TRaw, TNormalized>>

  /** Quick credential check — throws ConnectorAuthError if invalid */
  validate(credentials: ConnectorCredentials): Promise<void>
}

// ------ Connector errors ------

export class ConnectorError extends Error {
  constructor(
    public readonly source: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${source}] ${message}`)
    this.name = 'ConnectorError'
  }
}

export class ConnectorAuthError extends ConnectorError {
  constructor(source: string, message = 'Invalid or expired credentials') {
    super(source, message)
    this.name = 'ConnectorAuthError'
  }
}

export class ConnectorRateLimitError extends ConnectorError {
  constructor(
    source: string,
    public readonly retryAfterMs?: number,
  ) {
    super(source, `Rate limit exceeded${retryAfterMs ? ` — retry after ${retryAfterMs}ms` : ''}`)
    this.name = 'ConnectorRateLimitError'
  }
}

// ------ Retry helper ------

const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 9000]

export async function withRetry<T>(
  fn: () => Promise<T>,
  source: string,
  delays = DEFAULT_RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn()
    } catch (err) {
      // Do not retry auth errors
      if (err instanceof ConnectorAuthError) throw err
      lastError = err
      if (attempt < delays.length) {
        await sleep(delays[attempt])
      }
    }
  }
  throw new ConnectorError(source, `Failed after ${delays.length + 1} attempts`, lastError)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
