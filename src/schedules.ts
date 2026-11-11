import type { HostContext } from './host.js'

export interface ScheduleListResponse {
  /** False when this dsh profile has no schedule service (older/minimal profiles). */
  available: boolean
  items: unknown[]
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

interface ScheduleServiceLike {
  catalog(): Promise<unknown>
}

function getScheduleService(ctx: HostContext): ScheduleServiceLike | undefined {
  try {
    return ctx.get('schedule') as ScheduleServiceLike | undefined
  } catch {
    return undefined
  }
}
