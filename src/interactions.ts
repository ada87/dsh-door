import type { Config } from './config.js'
import type { AgentLike, HostContext } from './host.js'
import type { ApprovalItem, ApprovalDecision, ApprovalPreview, QuestionItem, QuestionItemEnvelope } from './protocol.js'
import type { SseHub } from './streams.js'
import { newId, shortError } from './util.js'

interface PendingApproval {
  id: string
  sessionId: string
  toolName: string
  callId?: string
  reason?: string
  displayReason?: { en: string; [locale: string]: string }
  preview?: ApprovalPreview
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
    const preview = await this.buildApprovalPreview(sessionId, req)
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
        ...(preview === undefined ? {} : { preview }),
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

  /**
   * Read the approval's `tool/call` event and produce a small presentation
   * preview. This is best-effort: a missing/old page must never delay or block
   * the approval itself.
   */
  private async buildApprovalPreview(sessionId: string, req: ApprovalRequestLike): Promise<ApprovalPreview | undefined> {
    const controller = this.ctx.sessionController
    if (controller === undefined || req.callId === undefined) return undefined
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 700)
    timer.unref?.()
    try {
      const page = await controller.page({
        address: { kind: 'session', sessionId: sessionId as never },
        maxMessages: 120,
        turnWindow: { minMessages: 20, minTurns: 1 },
      }, abort.signal)
      const events = page.records.map(entry => entry.event)
      let call = events.find(event => event.type === 'tool/call'
        && String((event.data as { callId?: unknown } | undefined)?.callId ?? '') === req.callId)
      if (call === undefined) {
        for (let index = events.length - 1; index >= 0; index -= 1) {
          const event = events[index]!
          if (event.type === 'tool/call'
            && String((event.data as { name?: unknown } | undefined)?.name ?? '') === req.toolName) {
            call = event
            break
          }
        }
      }
      if (call === undefined) return undefined
      return previewToolCall(req.toolName, call.data)
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
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
    ...(pending.preview === undefined ? {} : { preview: pending.preview }),
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
  }
}

export function previewToolCall(toolName: string, value: unknown): ApprovalPreview | undefined {
  const data = asRecord(value)
  if (data === null) return undefined
  const raw = typeof data.arguments === 'string'
    ? data.arguments
    : data.arguments === undefined ? undefined : safeStringify(data.arguments)
  const args = parseArgs(raw)
  const path = firstString(args, ['file_path', 'path', 'file'])
  const command = firstString(args, ['command', 'cmd'])

  if (toolName === 'bash' || toolName === 'pwsh' || toolName === 'shell') {
    if (command === null) return undefined
    return { kind: 'command', title: '执行命令', detail: `$ ${truncate(command, 1200)}` }
  }

  if (toolName === 'edit' || toolName === 'apply_patch' || toolName === 'write') {
    const oldText = firstString(args, ['old_string', 'oldString', 'old_text', 'oldText'])
    const newText = firstString(args, ['new_string', 'newString', 'new_text', 'newText'])
    const patch = firstString(args, ['patch', 'diff'])
    if (oldText !== null && newText !== null) {
      const removed = oldText.length === 0 ? 0 : oldText.split('\n').length
      const added = newText.length === 0 ? 0 : newText.split('\n').length
      const detail = [
        path === null ? 'file' : path,
        '--- old',
        ...oldText.split('\n').map(line => `- ${line}`),
        '+++ new',
        ...newText.split('\n').map(line => `+ ${line}`),
      ].join('\n')
      return { kind: 'diff', title: path === null ? '修改文件' : `修改 ${path}`, detail: truncate(detail, 1600), added, removed }
    }
    if (patch !== null) {
      return { kind: 'diff', title: path === null ? '应用补丁' : `修改 ${path}`, detail: truncate(patch, 1600) }
    }
    const content = firstString(args, ['content'])
    if (toolName === 'write' && content !== null) {
      return {
        kind: 'diff',
        title: path === null ? '写入文件' : `写入 ${path}`,
        detail: truncate(content, 1000),
        added: content.length === 0 ? 0 : content.split('\n').length,
        removed: 0,
      }
    }
    if (path !== null) return { kind: 'path', title: `修改 ${path}`, detail: path }
    return undefined
  }

  if (toolName === 'read' || toolName === 'grep' || toolName === 'glob') {
    const pattern = firstString(args, ['pattern'])
    return {
      kind: 'path',
      title: toolName === 'read' ? '读取文件' : toolName === 'grep' ? '搜索文本' : '查找文件',
      ...(path !== null ? { detail: path } : pattern !== null ? { detail: pattern } : {}),
    }
  }

  if (toolName === 'web_search') {
    const query = firstString(args, ['query', 'q'])
    return query === null ? undefined : { kind: 'text', title: '联网搜索', detail: query }
  }

  if (toolName === 'web_fetch' || toolName === 'fetch' || toolName === 'browser') {
    const url = firstString(args, ['url', 'href'])
    return url === null ? undefined : { kind: 'url', title: '打开网页', detail: url }
  }

  if (raw === undefined || raw.length === 0) return undefined
  return { kind: 'text', title: toolName, detail: truncate(raw, 1000) }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseArgs(raw: string | undefined): Record<string, unknown> | null {
  if (raw === undefined || raw.trim().length === 0) return null
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return null
  }
}

function firstString(args: Record<string, unknown> | null, keys: string[]): string | null {
  if (args === null) return null
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
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
