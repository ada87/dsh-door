import type { Config } from './config.js'
import type { AgentLike, HostContext } from './host.js'
import type { ApprovalItem, ApprovalDecision, QuestionItem, QuestionItemEnvelope } from './protocol.js'
import type { SseHub } from './streams.js'
import { newId, shortError } from './util.js'

interface PendingApproval {
  id: string
  sessionId: string
  toolName: string
  callId?: string
  reason?: string
  displayReason?: { en: string; [locale: string]: string }
  createdAt: number
  expiresAt: number
  resolve(decision: ApprovalDecision | 'timeout'): void
  timer: NodeJS.Timeout
}

interface PendingQuestion {
  id: string
  sessionId: string
  callId?: string
  questions: QuestionItem[]
  createdAt: number
  expiresAt: number
  resolve(answer: QuestionAnswer | 'timeout'): void
  timer: NodeJS.Timeout
}

export interface QuestionAnswer {
  answers: Array<{ id: string; selected: string[]; custom?: string }>
}

interface ApprovalRequestLike {
  agent?: AgentLike
  toolName: string
  callId?: string
  reason?: string
  displayReason?: { en: string; [locale: string]: string }
  signal?: AbortSignalLike
}

interface QuestionRequestLike {
  questions: QuestionItem[]
  agent?: AgentLike
  signal?: AbortSignalLike
  wait?: { callId: string; timed?: boolean }
}

interface AbortSignalLike {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

type Next<T> = () => Promise<T>

/**
 * Owns the human-interaction seams. The policy is fixed:
 *
 * - a live browser Client answers first, so the plugin always calls `next()`
 *   while one is connected;
 * - otherwise the request is claimed, pushed to the app, and held until the
 *   app answers or the configured timeout elapses;
 * - timeout and cancellation fall back to `next()`, restoring dsh's own
 *   fail-closed behavior instead of inventing an outcome.
 */
export class InteractionBroker {
  private readonly approvals = new Map<string, PendingApproval>()
  private readonly questions = new Map<string, PendingQuestion>()
  private readonly grants = new Set<string>()

  constructor(
    private readonly ctx: HostContext,
    private readonly config: Config,
    private readonly hub: SseHub,
    private readonly push: { isConfigured(): boolean; notify(kind: 'approval' | 'question', payload: unknown): void },
    private readonly logger: { info(message: string): void; warn(message: string): void },
  ) {}

  register(): void {
    this.ctx.on('approval/request', async (...args: unknown[]) => {
      const req = args[0] as ApprovalRequestLike
      const next = args[1] as Next<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
      return this.handleApproval(req, next)
    })
    this.ctx.on('user-questions/request', async (...args: unknown[]) => {
      const req = args[0] as QuestionRequestLike
      const next = args[1] as Next<QuestionAnswer>
      return this.handleQuestion(req, next)
    })
  }

  listApprovals(): ApprovalItem[] {
    return [...this.approvals.values()].map(toApprovalItem)
  }

  /** Create a synthetic approval for the authenticated debug route. */
  createDebugApproval(input: {
    sessionId?: string
    toolName?: string
    reason?: string
    displayReason?: { en: string; [locale: string]: string }
  }): ApprovalItem {
    const id = newId()
    const createdAt = Date.now()
    const expiresAt = createdAt + this.config.approvalWaitTimeoutMs
    const timer = setTimeout(() => {
      this.approvals.delete(id)
      this.hub.broadcast('approval-resolved', { id, decision: 'timeout', source: 'timeout' })
    }, this.config.approvalWaitTimeoutMs)
    timer.unref?.()
    const pending: PendingApproval = {
      id,
      sessionId: input.sessionId ?? 'debug-session',
      toolName: input.toolName ?? 'bash',
      reason: input.reason ?? 'Debug approval from the mobile app',
      displayReason: input.displayReason ?? { en: 'Run a command', zh: '执行一条命令' },
      createdAt,
      expiresAt,
      resolve: () => undefined,
      timer,
    }
    this.approvals.set(id, pending)
    this.hub.broadcast('approval', toApprovalItem(pending))
    return toApprovalItem(pending)
  }

  /** Create a synthetic question for the authenticated debug route. */
  createDebugQuestion(input: {
    sessionId?: string
    questions?: QuestionItem[]
  }): QuestionItemEnvelope {
    const id = newId()
    const createdAt = Date.now()
    const expiresAt = createdAt + this.config.questionWaitTimeoutMs
    const questions = input.questions ?? [{
      id: 'debug-choice',
      header: '调试问题',
      question: '这条消息只用于验证手机端的提问卡片，选一个即可。',
      options: [{ label: '继续' }, { label: '取消' }],
    }]
    const timer = setTimeout(() => {
      this.questions.delete(id)
      this.hub.broadcast('question-resolved', { id, decision: 'timeout', source: 'timeout' })
    }, this.config.questionWaitTimeoutMs)
    timer.unref?.()
    const pending: PendingQuestion = {
      id,
      sessionId: input.sessionId ?? 'debug-session',
      questions,
      createdAt,
      expiresAt,
      resolve: () => undefined,
      timer,
    }
    this.questions.set(id, pending)
    const envelope: QuestionItemEnvelope = {
      id,
      sessionId: pending.sessionId,
      questions,
      createdAt,
      expiresAt,
    }
    this.hub.broadcast('question', envelope)
    return envelope
  }

  listQuestions(): QuestionItemEnvelope[] {
    return [...this.questions.values()].map(item => ({
      id: item.id,
      sessionId: item.sessionId,
      callId: item.callId,
      questions: item.questions,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
    }))
  }

  decideApproval(id: string, decision: ApprovalDecision): ApprovalItem | undefined {
    const pending = this.approvals.get(id)
    if (pending === undefined) return undefined
    clearTimeout(pending.timer)
    this.approvals.delete(id)
    if (decision === 'always' && this.config.allowSessionWideGrants) {
      this.grants.add(grantKey(pending.sessionId, pending.toolName))
    }
    pending.resolve(decision)
    this.hub.broadcast('approval-resolved', {
      id,
      sessionId: pending.sessionId,
      decision,
      source: 'app',
    })
    return toApprovalItem(pending)
  }

  answerQuestion(id: string, answer: QuestionAnswer): QuestionItemEnvelope | undefined {
    const pending = this.questions.get(id)
    if (pending === undefined) return undefined
    clearTimeout(pending.timer)
    this.questions.delete(id)
    pending.resolve(answer)
    this.hub.broadcast('question-resolved', {
      id,
      sessionId: pending.sessionId,
      callId: pending.callId,
      source: 'app',
    })
    return {
      id: pending.id,
      sessionId: pending.sessionId,
      callId: pending.callId,
      questions: pending.questions,
      createdAt: pending.createdAt,
      expiresAt: pending.expiresAt,
    }
  }

  /**
   * Answer a question that outlived its foreground wait. dsh records the
   * answer as a `user-question-reply` steered into the agent; the projection
   * then closes the call.
   */
  async answerContinued(sessionId: string, callId: string, answer: QuestionAnswer): Promise<boolean> {
    const questions = getService<NonNullable<HostContext['userQuestions']>>(this.ctx, 'userQuestions')
    const controller = this.ctx.sessionController
    if (questions === undefined || controller === undefined) return false
    const resolved = await controller.resolveAgent(sessionId)
    const agent = resolved.agent
    if (agent === undefined) throw new Error(resolved.error?.message ?? 'session is not available')
    return questions.answer(agent, callId as never, answer)
  }

  hasGrant(sessionId: string, toolName: string): boolean {
    return this.grants.has(grantKey(sessionId, toolName))
  }

  private async handleApproval(
    req: ApprovalRequestLike,
    next: Next<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>,
  ): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'> {
    const sessionId = req.agent?.id ?? 'unknown'
    if (this.hasGrant(sessionId, req.toolName)) {
      this.hub.broadcast('approval-resolved', {
        id: `grant:${newId()}`,
        sessionId,
        toolName: req.toolName,
        decision: 'always',
        source: 'grant',
      })
      return 'allowed-once'
    }
    if (this.browserWins()) return next()
    if (!this.appCanAnswer()) {
      // Nothing can answer: keep dsh's fail-closed path instead of holding a
      // turn for two minutes for an app that is not connected.
      return next()
    }
    if (req.signal?.aborted === true) return 'cancelled'

    const id = newId()
    const createdAt = Date.now()
    const expiresAt = createdAt + this.config.approvalWaitTimeoutMs
    const decision = await new Promise<ApprovalDecision | 'timeout'>((resolve) => {
      const timer = setTimeout(() => {
        this.approvals.delete(id)
        this.hub.broadcast('approval-resolved', { id, sessionId, decision: 'timeout', source: 'timeout' })
        resolve('timeout')
      }, this.config.approvalWaitTimeoutMs)
      timer.unref?.()
      const pending: PendingApproval = {
        id,
        sessionId,
        toolName: req.toolName,
        callId: req.callId,
        reason: req.reason,
        displayReason: req.displayReason,
        createdAt,
        expiresAt,
        resolve,
        timer,
      }
      this.approvals.set(id, pending)
      this.hub.broadcast('approval', toApprovalItem(pending))
      this.push.notify('approval', toApprovalItem(pending))
      req.signal?.addEventListener('abort', () => {
        if (!this.approvals.has(id)) return
        clearTimeout(timer)
        this.approvals.delete(id)
        this.hub.broadcast('approval-resolved', { id, sessionId, decision: 'cancelled', source: 'signal' })
        resolve('timeout')
      }, { once: true })
      this.logger.info(`[dsh-door] approval ${id} for ${req.toolName} in ${sessionId}`)
    })

    if (decision === 'timeout') {
      // Delegate to the next listener; with no browser this becomes dsh's
      // fail-closed `unavailable`.
      return next()
    }
    if (decision === 'deny') return 'rejected'
    return 'allowed-once'
  }

  private async handleQuestion(req: QuestionRequestLike, next: Next<QuestionAnswer>): Promise<QuestionAnswer> {
    const sessionId = req.agent?.id ?? 'unknown'
    if (this.browserWins()) return next()
    if (!this.appCanAnswer()) return next()
    if (req.signal?.aborted === true) return next()

    const id = newId()
    const createdAt = Date.now()
    const expiresAt = createdAt + this.config.questionWaitTimeoutMs
    const answer = await new Promise<QuestionAnswer | 'timeout'>((resolve) => {
      const timer = setTimeout(() => {
        this.questions.delete(id)
        this.hub.broadcast('question-resolved', { id, sessionId, callId: req.wait?.callId, decision: 'timeout', source: 'timeout' })
        resolve('timeout')
      }, this.config.questionWaitTimeoutMs)
      timer.unref?.()
      const pending: PendingQuestion = {
        id,
        sessionId,
        callId: req.wait?.callId,
        questions: req.questions,
        createdAt,
        expiresAt,
        resolve,
        timer,
      }
      this.questions.set(id, pending)
      const envelope: QuestionItemEnvelope = {
        id,
        sessionId,
        callId: req.wait?.callId,
        questions: req.questions,
        createdAt,
        expiresAt,
      }
      this.hub.broadcast('question', envelope)
      this.push.notify('question', envelope)
      req.signal?.addEventListener('abort', () => {
        if (!this.questions.has(id)) return
        clearTimeout(timer)
        this.questions.delete(id)
        this.hub.broadcast('question-resolved', { id, sessionId, callId: req.wait?.callId, decision: 'cancelled', source: 'signal' })
        resolve('timeout')
      }, { once: true })
      this.logger.info(`[dsh-door] question ${id} in ${sessionId}`)
    })

    if (answer === 'timeout') return next()
    return answer
  }

  private browserWins(): boolean {
    const gateway = getService<NonNullable<HostContext['typertGateway']>>(this.ctx, 'typertGateway')
    return gateway?.hasLiveClient() === true
  }

  private appCanAnswer(): boolean {
    return this.hub.hasClients() || this.push.isConfigured()
  }

  dispose(): void {
    for (const pending of this.approvals.values()) {
      clearTimeout(pending.timer)
      pending.resolve('timeout')
    }
    this.approvals.clear()
    for (const pending of this.questions.values()) {
      clearTimeout(pending.timer)
      pending.resolve('timeout')
    }
    this.questions.clear()
  }

  logFailure(error: unknown): void {
    this.logger.warn(`[dsh-door] interaction failed: ${shortError(error)}`)
  }
}

function toApprovalItem(pending: PendingApproval): ApprovalItem {
  return {
    id: pending.id,
    sessionId: pending.sessionId,
    toolName: pending.toolName,
    callId: pending.callId,
    reason: pending.reason,
    displayReason: pending.displayReason,
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
  }
}

function grantKey(sessionId: string, toolName: string): string {
  return `${sessionId}\u0000${toolName}`
}

/** Resolve an optional Cordis service without reading its property. */
function getService<T>(ctx: HostContext, name: string): T | undefined {
  try {
    return ctx.get(name) as T | undefined
  } catch {
    return undefined
  }
}
