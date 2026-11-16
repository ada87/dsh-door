import type { HostContext } from './host.js'

/**
 * Read watermarks live in dsh-tag: the tag snapshot is the one place that
 * already owns the Session's appearance (colour, and now weight). dsh-door
 * stays the authenticated edge the phone talks to and forwards the changes.
 */
export interface ReadEntry {
  readAt: number
  unread: boolean
  at: number
}

export interface ReadStateMap {
  [sessionId: string]: ReadEntry
}

/** Structural view of the `dsh-tag` service provided by that plugin. */
export interface TagReadService {
  reads(): ReadStateMap
  mergeReads(input: unknown): ReadStateMap
}

export interface ReadStateResponse {
  sessions: ReadStateMap
  /** Host clock, so clients can spot a badly skewed local clock. */
  serverTime: number
}

/**
 * Resolve dsh-tag lazily: the plugin may load after dsh-door, and the phone
 * must keep working (without unread) when it is not installed at all.
 */
export function tagReadService(ctx: HostContext): TagReadService | undefined {
  let candidate: unknown
  try {
    candidate = ctx.get('dsh-tag')
  } catch {
    return undefined
  }
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const api = candidate as Partial<TagReadService>
  if (typeof api.reads !== 'function' || typeof api.mergeReads !== 'function') return undefined
  return candidate as TagReadService
}

/** Validate a POST body's `sessions` field before handing it to dsh-tag. */
export function parseReadState(value: unknown): ReadStateMap | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const sessions: ReadStateMap = {}
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const readAt = record.readAt
    const at = record.at
    if (typeof readAt !== 'number' || !Number.isFinite(readAt) || readAt < 0) continue
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) continue
    sessions[id] = { readAt, unread: record.unread === true, at }
  }
  return sessions
}
