import type { CredentialProviderService } from './host.js'

/** Credential record key owned by this plugin. */
const READ_STATE_KEY = 'dsh-door/read-state' as unknown

/** Keep the shared map small; the drawer only ever shows recent Sessions. */
const MAX_ENTRIES = 500

/**
 * One Session's read state, shared by every paired device.
 *
 * - `readAt`: last time the Session was opened or explicitly marked read.
 * - `unread`: explicit "mark unread" from the drawer, cleared by the next read.
 * - `at`: when the entry last changed. Merges pick the newest entry, so a stale
 *   device cannot roll back what another device already did.
 */
export interface ReadStateEntry {
  readAt: number
  unread: boolean
  at: number
}

export type ReadStateMap = Record<string, ReadStateEntry>

export interface ReadStateResponse {
  sessions: ReadStateMap
  /** Host clock, so clients can spot a badly skewed local clock. */
  serverTime: number
}

/**
 * Durable read watermarks. Like the device registry, records live in the dsh
 * credential store so they survive a Host restart without touching config.
 */
export class ReadStateStore {
  private readonly entries = new Map<string, ReadStateEntry>()
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly credentials: CredentialProviderService | undefined) {}

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    if (this.credentials === undefined) return
    try {
      const record = await this.credentials.readRecord(READ_STATE_KEY)
      const sessions = asRecord(record?.payload)?.sessions
      for (const [id, value] of Object.entries(asRecord(sessions) ?? {})) {
        const entry = normalizeEntry(value)
        if (entry !== undefined) this.entries.set(id, entry)
      }
    } catch {
      // A missing or unreadable record just means "nothing marked yet".
    }
  }

  snapshot(): ReadStateMap {
    return Object.fromEntries(this.entries)
  }

  /**
   * Merge client entries into the shared map and return the result. A newer
   * `at` wins, so concurrent devices converge on the last action rather than
   * on whichever request arrived last.
   */
  async merge(incoming: ReadStateMap): Promise<ReadStateMap> {
    const ceiling = Date.now() + 60_000
    let changed = false
    for (const [id, value] of Object.entries(incoming)) {
      const entry = normalizeEntry(value)
      if (entry === undefined) continue
      const next: ReadStateEntry = { ...entry, at: Math.min(entry.at, ceiling) }
      const current = this.entries.get(id)
      if (current !== undefined && current.at >= next.at) continue
      this.entries.set(id, next)
      changed = true
    }
    if (changed) {
      this.prune()
      await this.persist()
    }
    return this.snapshot()
  }

  private prune(): void {
    if (this.entries.size <= MAX_ENTRIES) return
    const keep = [...this.entries.entries()]
      .sort((left, right) => right[1].at - left[1].at)
      .slice(0, MAX_ENTRIES)
    this.entries.clear()
    for (const [id, entry] of keep) this.entries.set(id, entry)
  }

  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        if (this.credentials === undefined) return
        await this.credentials.modifyRecord(READ_STATE_KEY, async () => ({
          kind: 'grant',
          payload: { version: 1, sessions: Object.fromEntries(this.entries) },
        }))
      })
    return this.writeQueue
  }
}

/** Validate the POST body's `sessions` field. */
export function parseReadState(value: unknown): ReadStateMap | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const sessions: ReadStateMap = {}
  for (const [id, entry] of Object.entries(record)) {
    const normalized = normalizeEntry(entry)
    if (normalized !== undefined) sessions[id] = normalized
  }
  return sessions
}

function normalizeEntry(value: unknown): ReadStateEntry | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const readAt = record.readAt
  const at = record.at
  if (typeof readAt !== 'number' || !Number.isFinite(readAt) || readAt < 0) return undefined
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return undefined
  return { readAt, unread: record.unread === true, at }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
