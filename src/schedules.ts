import type { HostContext } from './host.js'

export interface ScheduleListResponse {
  /** False when this dsh profile has no schedule service (older/minimal profiles). */
  available: boolean
  items: unknown[]
}

export interface SessionScheduleMarks {
  items: Array<{ sessionId: string; count: number }>
}

interface CatalogTaskLike {
  status?: unknown
  target?: { kind?: unknown; sessionId?: unknown }
  involvedSessionIds?: unknown
  lastDelivery?: { targetSessionId?: unknown }
}

interface ScheduleServiceLike {
  catalog(): Promise<unknown>
  view?(request: { id: string }): Promise<unknown>
  history?(request: { id: string; limit: number; before?: string }): Promise<unknown>
  run?(request: { id: string }, signal?: AbortSignal): Promise<unknown>
  edit?(request: unknown, actorSessionId?: unknown, signal?: AbortSignal): Promise<unknown>
}

/** Read-only catalog for the phone; never activates the target Session. */
export async function listSchedules(ctx: HostContext, _signal: AbortSignal): Promise<ScheduleListResponse> {
  const service = getScheduleService(ctx)
  if (service === undefined || typeof service.catalog !== 'function') {
    return { available: false, items: [] }
  }
  try {
    const items = await service.catalog()
    return { available: true, items: Array.isArray(items) ? items : [] }
  } catch {
    // A profile with a broken schedule plugin should not take down session reads.
    return { available: false, items: [] }
  }
}

export function schedulesAvailable(ctx: HostContext): boolean {
  const service = getScheduleService(ctx)
  return service !== undefined && typeof service.catalog === 'function'
}

/**
 * Active task counts per Session, for the drawer's clock mark.
 *
 * Mirrors dsh Web: a task counts when `status === 'active'` and it either
 * targets the Session (`session` target or a `new` target's last delivery) or
 * names it in `involvedSessionIds`.
 */
export async function sessionScheduleMarks(
  ctx: HostContext,
  _signal: AbortSignal,
): Promise<SessionScheduleMarks> {
  const service = getScheduleService(ctx)
  if (service === undefined || typeof service.catalog !== 'function') return { items: [] }
  try {
    const catalog = await service.catalog()
    if (!Array.isArray(catalog)) return { items: [] }
    const counts = new Map<string, number>()
    const add = (id: unknown): void => {
      if (typeof id !== 'string' || id.length === 0) return
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const raw of catalog) {
      if (typeof raw !== 'object' || raw === null) continue
      const task = raw as CatalogTaskLike
      if (task.status !== 'active') continue
      const target = task.target
      if (target?.kind === 'session') add(target.sessionId)
      if (target?.kind === 'new') add(task.lastDelivery?.targetSessionId)
      if (Array.isArray(task.involvedSessionIds)) {
        for (const id of task.involvedSessionIds) add(id)
      }
    }
    return {
      items: [...counts.entries()].map(([sessionId, count]) => ({ sessionId, count })),
    }
  } catch {
    return { items: [] }
  }
}

export function scheduleActionsAvailable(ctx: HostContext): boolean {
  const service = getScheduleService(ctx)
  return service !== undefined
    && typeof service.view === 'function'
    && typeof service.run === 'function'
    && typeof service.edit === 'function'
}

export function scheduleHistoryAvailable(ctx: HostContext): boolean {
  return typeof getScheduleService(ctx)?.history === 'function'
}

export async function viewSchedule(
  ctx: HostContext,
  id: string,
  signal?: AbortSignal,
): Promise<unknown | undefined> {
  const service = getScheduleService(ctx)
  if (service?.view === undefined) return undefined
  return service.view({ id })
}

export async function scheduleHistory(
  ctx: HostContext,
  id: string,
  limit: number,
  before?: string,
  signal?: AbortSignal,
): Promise<unknown | undefined> {
  const service = getScheduleService(ctx)
  if (service?.history === undefined) return undefined
  return service.history(before === undefined ? { id, limit } : { id, limit, before })
}

export async function runSchedule(
  ctx: HostContext,
  id: string,
  signal?: AbortSignal,
): Promise<unknown | undefined> {
  const service = getScheduleService(ctx)
  if (service?.run === undefined) return undefined
  return service.run({ id }, signal)
}

export async function editSchedule(
  ctx: HostContext,
  id: string,
  patch: Record<string, unknown>,
  expectedUpdatedAt?: string | null,
  signal?: AbortSignal,
): Promise<unknown | undefined> {
  const service = getScheduleService(ctx)
  if (service?.edit === undefined) return undefined
  return service.edit({
    id,
    action: 'update',
    patch,
    ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
  }, undefined, signal)
}

export async function deleteSchedule(
  ctx: HostContext,
  id: string,
  expectedUpdatedAt?: string | null,
  signal?: AbortSignal,
): Promise<unknown | undefined> {
  const service = getScheduleService(ctx)
  if (service?.edit === undefined) return undefined
  return service.edit({
    id,
    action: 'delete',
    ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
  }, undefined, signal)
}

function getScheduleService(ctx: HostContext): ScheduleServiceLike | undefined {
  try {
    return ctx.get('schedule') as ScheduleServiceLike | undefined
  } catch {
    return undefined
  }
}
