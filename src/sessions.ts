import type { HostContext, SessionSummary, SessionEventsPage, SessionProjectionsValue } from './host.js'
import type { ProjectionValues, SessionListItem, SessionStateResponse, SessionTranscriptResponse, SessionVitals } from './protocol.js'

export interface SessionFacade {
  list(signal: AbortSignal): Promise<SessionListItem[]>
  transcript(sessionId: string, options: { beforeSeq?: number; maxMessages?: number }, signal: AbortSignal): Promise<SessionTranscriptResponse>
  state(sessionId: string, signal: AbortSignal): Promise<SessionStateResponse>
  create(input: { cwd?: string; workspaceId?: string; agentPreset?: string }): Promise<{ sessionId: string }>
  prompt(sessionId: string, input: { requestId: string; text: string; mode: 'queue' | 'steer'; clientTimeZone?: string; attachments?: string[] }, signal: AbortSignal): Promise<{ accepted: true }>
  rename(sessionId: string, title: string): Promise<{ title: string; seq: number }>
  fork(sessionId: string, atSeq?: number): Promise<{ sessionId: string }>
  cancel(sessionId: string): { accepted: true }
  follow(sessionId: string, signal: AbortSignal): AsyncIterable<unknown>
  titleOf(sessionId: string, signal: AbortSignal): Promise<string | null>
}

/** Read the projection record and its log watermark without activating a cold Session. */
export async function readProjectionSnapshot(
  ctx: HostContext,
  sessionId: string,
  signal: AbortSignal,
): Promise<{ values: ProjectionValues; asOfSeq?: number }> {
  try {
    const value = await ctx.sessionController.projections({ sessionId }, signal)
    if (value === null) return { values: {} }
    return {
      values: normalizeProjections(value),
      ...(typeof value.asOfSeq === 'number' ? { asOfSeq: value.asOfSeq } : {}),
    }
  } catch {
    return { values: {} }
  }
}

export async function readProjections(
  ctx: HostContext,
  sessionId: string,
  signal: AbortSignal,
): Promise<ProjectionValues> {
  return (await readProjectionSnapshot(ctx, sessionId, signal)).values
}

export function normalizeProjections(value: SessionProjectionsValue | null | undefined): ProjectionValues {
  const values = value?.values
  if (values === undefined || values === null) return {}
  return values as ProjectionValues
}

export function createSessionFacade(ctx: HostContext): SessionFacade {
  const controller = ctx.sessionController

  return {
    async list(signal) {
      const value = await controller.list({}, signal)
      return Promise.all(value.items.map(item => toListItem(ctx, item, signal)))
    },

    async transcript(sessionId, options, signal) {
      const snapshot = await readProjectionSnapshot(ctx, sessionId, signal)
      const projections = snapshot.values
      const cut = snapshot.asOfSeq
      const maxMessages = options.maxMessages ?? 50
      const minMessages = Math.min(20, maxMessages)
      let page: SessionEventsPage | undefined
      try {
        page = await controller.page({
          address: { kind: 'session', sessionId: sessionId as never },
          ...(cut === undefined ? {} : { throughSeq: cut }),
          ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
          maxMessages,
          turnWindow: { minMessages, minTurns: 1 },
        }, signal)
      } catch (error) {
        if (options.beforeSeq === undefined) {
          // A blank Session has no log page yet; an empty transcript is the
          // honest answer, not an error.
          if (isNotFound(error)) {
            return {
              sessionId,
              title: null,
              records: [],
              hasMore: false,
              cursor: 0,
              projections,
            }
          }
        }
        throw error
      }
      return {
        sessionId,
        title: typeof projections.title === 'string' ? projections.title : null,
        records: page.records,
        hasMore: page.hasMore,
        // 0.2.1 omits the inclusive cursor; the projection watermark is the
        // same cut the page was read at.
        cursor: page.cursor ?? options.beforeSeq ?? cut ?? 0,
        projections,
      }
    },

    async state(sessionId, signal) {
      const [snapshot, list] = await Promise.all([
        readProjectionSnapshot(ctx, sessionId, signal),
        controller.list({}, signal),
      ])
      const projections = snapshot.values
      const summary = list.items.find(item => item.sessionId === sessionId)
      const nativeState = typeof controller.state === 'function'
        ? await controller.state({ sessionId }, signal)
        : undefined
      // 0.2.1 has no state() endpoint. Synthesize the fields the mobile UI
      // needs from projections + list; queue details are unavailable there.
      const state = nativeState ?? {
        cursor: snapshot.asOfSeq ?? 0,
        active: summary?.agentAvailable === true,
        running: summary?.running === true,
        queue: null,
        pendingInput: [] as readonly string[],
      }
      return {
        state: {
          cursor: state.cursor,
          active: state.active,
          running: state.running,
          queue: state.queue,
          pendingInput: [...state.pendingInput],
        },
        projections,
        session: summary === undefined
          ? {
            id: sessionId,
            title: typeof projections.title === 'string' ? projections.title : null,
            updatedAt: Date.now(),
            running: state.running,
            agentAvailable: state.active,
            blank: false,
          }
          : await toListItem(ctx, summary, signal),
      }
    },

    create(input) {
      return controller.create(input)
    },

    prompt(sessionId, input, signal) {
      const attachments = (input.attachments ?? [])
        .filter(receiptId => receiptId.length > 0)
        .map(receiptId => ({ type: 'file' as const, receiptId }))
      const content: Array<{ type: 'text'; text: string } | { type: 'file'; receiptId: string }> = [...attachments]
      if (input.text.trim().length > 0) content.push({ type: 'text', text: input.text })
      return controller.prompt({
        requestId: input.requestId as never,
        sessionId: sessionId as never,
        mode: input.mode,
        content,
        ...(input.clientTimeZone === undefined ? {} : { clientTimeZone: input.clientTimeZone }),
      }, signal)
    },

    rename(sessionId, title) {
      return controller.rename({ sessionId: sessionId as never, title })
    },

    fork(sessionId, atSeq) {
      if (typeof controller.fork !== 'function') {
        throw new Error('this dsh version does not expose session/fork')
      }
      return controller.fork({
        sessionId: sessionId as never,
        ...(atSeq === undefined ? {} : { atSeq }),
      })
    },

    cancel(sessionId) {
      return controller.cancel({ sessionId: sessionId as never })
    },

    follow(sessionId, signal) {
      return controller.follow({
        address: { kind: 'session', sessionId: sessionId as never },
        activate: true,
        assistantStream: true,
        maxMessages: 200,
        turnWindow: { minMessages: 20, minTurns: 1 },
      }, signal) as AsyncIterable<unknown>
    },

    async titleOf(sessionId, signal) {
      const projections = await readProjections(ctx, sessionId, signal)
      return typeof projections.title === 'string' ? projections.title : null
    },
  }
}

async function toListItem(ctx: HostContext, summary: SessionSummary, signal: AbortSignal): Promise<SessionListItem> {
  const projections = await readProjections(ctx, summary.sessionId, signal)
  const vitals = toVitals(projections)
  return {
    id: summary.sessionId,
    title: typeof projections.title === 'string' ? projections.title : null,
    updatedAt: summary.updatedAt,
    running: summary.running,
    agentAvailable: summary.agentAvailable,
    blank: summary.blank,
    ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
    ...(summary.parentSessionId === undefined ? {} : { parentSessionId: summary.parentSessionId }),
    ...(summary.origin === undefined ? {} : { origin: summary.origin }),
    ...(summary.formatStatus === undefined ? {} : { formatStatus: summary.formatStatus }),
    ...(vitals === undefined ? {} : { vitals }),
  }
}

/**
 * Projection values arrive as `unknown` from the Host. Read only numbers and
 * enums we can render, and omit the whole object when nothing is present, so a
 * blank Session does not grow the list payload.
 */
function toVitals(projections: ProjectionValues): SessionVitals | undefined {
  const pressure = asRecord(projections.contextPressure)
  const usage = asRecord(projections.tokenUsage)
  const stats = asRecord(projections.sessionStats)
  const selection = asRecord(projections.modelSelection)
  const lastUsed = asRecord(selection?.lastUsed)
  const goal = asRecord(projections.goal)
  const goalBody = asRecord(goal?.goal)
  const plan = asRecord(projections.plan)

  const contextWindow = numberOrNull(pressure?.contextWindow)
  const contextTokens = numberOrNull(pressure?.projectedTokens)
  const todos = Array.isArray(projections.todos) ? projections.todos : null
  const todoTotal = todos?.length ?? null
  const todoDone = todos === null
    ? null
    : todos.filter(todo => asRecord(todo)?.status === 'completed').length
  const goalPhase = isGoalPhase(goalBody?.phase) ? goalBody.phase : null
  const provider = typeof lastUsed?.provider === 'string' ? lastUsed.provider : null
  const model = typeof lastUsed?.model === 'string' ? lastUsed.model : null
  const modelLabel = model === null ? null : provider === null ? model : `${provider}/${model}`
  const planActive = plan?.active === true

  const vitals: SessionVitals = {
    contextTokens,
    contextWindow,
    contextPercent: contextTokens !== null && contextWindow !== null && contextWindow > 0
      ? Math.round((contextTokens / contextWindow) * 1000) / 10
      : null,
    outputTokens: numberOrNull(usage?.outputTokens),
    turns: numberOrNull(stats?.turns),
    todoDone,
    todoTotal,
    goalPhase,
    planActive,
    model: modelLabel,
  }
  const empty = vitals.contextTokens === null
    && vitals.outputTokens === null
    && vitals.turns === null
    && vitals.todoTotal === null
    && vitals.goalPhase === null
    && vitals.model === null
    && !vitals.planActive
  return empty ? undefined : vitals
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isGoalPhase(value: unknown): value is SessionVitals['goalPhase'] & string {
  return value === 'active' || value === 'paused' || value === 'blocked' || value === 'complete'
}


export function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: unknown; message?: unknown }
  return candidate.code === 'session/not-found'
    || (typeof candidate.message === 'string' && candidate.message.includes('not found'))
}
