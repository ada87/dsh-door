import type { Config } from './config.js'
import { formatPairingCode, generatePairingCode, normalizePairingCode, safeEqual } from './util.js'

interface Attempts {
  count: number
  resetAt: number
}

export interface PairingView {
  code: string
  formatted: string
  expiresAt: number
  fixed: boolean
}

/**
 * One-time pairing code with a TTL and a bounded number of failures per client
 * address. The operator can pin a fixed code from the authenticated admin page;
 * fixed codes are persisted in the dsh credential store and remain valid until
 * changed.
 */
export class PairingManager {
  private code: string
  private expiresAt: number
  private fixedCode: string | null
  private readonly attempts = new Map<string, Attempts>()

  constructor(
    private readonly config: Config,
    private readonly logger: { info(message: string): void; warn(message: string): void },
    private readonly onRotate?: (code: string, expiresAt: number) => void,
    private readonly persist?: (fixedCode: string | null) => Promise<void> | void,
  ) {
    this.fixedCode = config.pairingCode === undefined ? null : normalizePairingCode(config.pairingCode)
    this.code = this.fixedCode ?? this.generate()
    this.expiresAt = this.fixedCode === null ? Date.now() + config.pairingTtlMs : Number.MAX_SAFE_INTEGER
  }

  /** Current code and expiry; may regenerate an expired code. */
  current(): PairingView {
    this.ensureValid()
    return {
      code: this.code,
      expiresAt: this.expiresAt,
      formatted: formatPairingCode(this.code),
      fixed: this.fixedCode !== null,
    }
  }

  /** Human-readable status for `/health`. */
  status(): { pairingOpen: boolean; expiresAt: number; fixed: boolean } {
    this.ensureValid()
    return { pairingOpen: true, expiresAt: this.expiresAt, fixed: this.fixedCode !== null }
  }

  isFixed(): boolean {
    return this.fixedCode !== null
  }

  /** Verify one submitted code; consumes it on success unless it is fixed. */
  verify(rawCode: string, clientAddress: string): { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'rate-limited' } {
    const now = Date.now()
    this.ensureValid()
    this.pruneAttempts(now)
    const record = this.attempts.get(clientAddress) ?? { count: 0, resetAt: now + this.config.pairingTtlMs }
    if (record.count >= this.config.pairingMaxAttempts) {
      return { ok: false, reason: 'rate-limited' }
    }
    if (this.fixedCode === null && now >= this.expiresAt) {
      record.count += 1
      this.attempts.set(clientAddress, record)
      return { ok: false, reason: 'expired' }
    }
    const submitted = normalizePairingCode(rawCode)
    if (!safeEqual(submitted, this.code)) {
      record.count += 1
      this.attempts.set(clientAddress, record)
      return { ok: false, reason: 'invalid' }
    }
    this.attempts.delete(clientAddress)
    if (this.fixedCode === null) this.rotate()
    return { ok: true }
  }

  /** Force a new one-time code; a fixed code is left untouched. */
  rotate(): PairingView {
    if (this.fixedCode === null) {
      this.code = this.generate()
      this.expiresAt = Date.now() + this.config.pairingTtlMs
      this.onRotate?.(this.code, this.expiresAt)
      this.logger.info(`[dsh-door] pairing code ${formatPairingCode(this.code)} (expires ${new Date(this.expiresAt).toISOString()})`)
    }
    return this.current()
  }

  /**
   * Pin a reusable code, or clear the pin and resume one-time rotation.
   * Persistence is best-effort: a failed credential write must not leave the
   * in-memory code unusable.
   */
  async setFixedCode(rawCode: string | null, persist = true): Promise<PairingView> {
    if (rawCode === null) {
      this.fixedCode = null
      this.code = this.generate()
      this.expiresAt = Date.now() + this.config.pairingTtlMs
      this.logger.info(`[dsh-door] fixed pairing code cleared; new one-time code ${formatPairingCode(this.code)}`)
      if (persist) await this.safePersist(null)
      return this.current()
    }
    const normalized = normalizePairingCode(rawCode)
    if (!/^[A-Z0-9]{4,32}$/.test(normalized)) {
      throw new Error('pairing code must be 4-32 letters/digits (dashes and spaces are ignored)')
    }
    this.fixedCode = normalized
    this.code = normalized
    this.expiresAt = Number.MAX_SAFE_INTEGER
    this.logger.warn(`[dsh-door] fixed pairing code set to ${formatPairingCode(normalized)}; it stays valid until changed`)
    if (persist) await this.safePersist(normalized)
    return this.current()
  }

  private generate(): string {
    return generatePairingCode(this.config.pairingCodeLength)
  }

  private ensureValid(): void {
    if (this.fixedCode === null && Date.now() >= this.expiresAt) this.rotate()
  }

  private async safePersist(fixedCode: string | null): Promise<void> {
    try {
      await this.persist?.(fixedCode)
    } catch (error) {
      this.logger.warn(`[dsh-door] could not persist the fixed pairing code: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private pruneAttempts(now: number): void {
    for (const [address, record] of this.attempts) {
      if (now >= record.resetAt) this.attempts.delete(address)
    }
  }
}
