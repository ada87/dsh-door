import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

/** URL-safe random token with a recognisable prefix. */
export function randomToken(prefix = 'dshm'): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`
}

/** A UUID for request identities and pending interaction ids. */
export function newId(): string {
  return randomUUID()
}

/** SHA-256 hex digest. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Constant-time comparison for equal-length secrets. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** A short, human-checkable fingerprint of a public key or token. */
export function fingerprint(publicKey: string): string {
  return sha256(publicKey).slice(0, 32)
}

/** Generate a pairing code without visually ambiguous characters. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generatePairingCode(length: number): string {
  const bytes = randomBytes(length)
  let code = ''
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[bytes[index]! % CODE_ALPHABET.length]
  }
  return code
}

/** Render a code as `ABCD-EFGH` for reading aloud. */
export function formatPairingCode(code: string): string {
  const half = Math.ceil(code.length / 2)
  return `${code.slice(0, half)}-${code.slice(half)}`
}

/** Normalise a user-entered code: uppercase, strip spaces and dashes. */
export function normalizePairingCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase()
}

/** Keep only a short, log-safe reason. */
export function shortError(error: unknown, max = 300): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > max ? `${message.slice(0, max - 1)}…` : message
}
