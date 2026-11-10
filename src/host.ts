/**
 * Minimal structural view of the dsh Host services this plugin consumes.
 *
 * The plugin deliberately does not import dsh implementation modules at
 * runtime: the Host owns their instances, and a second copy loaded from the
 * plugin graph would be a different Cordis tree. Type-only imports keep the
 * build honest, while these shapes document exactly what the plugin needs.
 */

export interface AbortSignalLike {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

export interface HostRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string; remotePort?: number }
  on(event: 'close' | 'aborted', listener: () => void): void
  off?(event: 'close' | 'aborted', listener: () => void): void
  resume?(): void
}

export interface HostResponse {
  statusCode: number
  headersSent: boolean
  setHeader(name: string, value: string | string[]): void
  writeHead(status: number, headers?: Record<string, string | string[]>): void
  write(chunk: string): boolean
  end(chunk?: string): void
  readonly writableEnded: boolean
  readonly destroyed?: boolean
  on(event: 'close' | 'error', listener: () => void): void
  flushHeaders?(): void
}

export interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: HostRequest, res: HostResponse) => void | Promise<void>
}

export interface WebServerService {
  register(route: WebRoute): () => void
  readonly host?: string
  readonly port?: number
  readonly protocol?: 'http:' | 'https:'
  getOrigin?(): string
}

export interface SessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  agentAvailable: boolean
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  formatStatus?: 'current' | 'migration-required'
}

export interface SessionListValue {
  items: SessionSummary[]
}

export interface SessionAddress {
  kind: 'session'
  sessionId: string
}

export interface SessionEventEntry {
  type: 'event'
  event: {
    type: string
    seq: number
    time: number
    data: unknown
    surfaceOp?: unknown
    sourceEventSeqs?: unknown
    ignorable?: true
  }
}

export interface SessionEventsPage {
  records: SessionEventEntry[]
  hasMore: boolean
  /** 0.2.2 returns this; 0.2.1 omits it, so callers fall back to the cut. */
  cursor?: number
}

export interface SessionStateValue {
  cursor: number
  active: boolean
  running: boolean
  queue: unknown[] | null
  pendingInput: readonly string[]
}

export interface SessionProjectionsValue {
  kind?: 'sequenced' | 'migration-required' | null
  asOfSeq?: number
  values?: Record<string, unknown> | null
}

export interface SessionFollowSnapshot {
  type: 'snapshot'
  header: {
    version: number
    id: string
    createdAt: number
    cwd?: string
    parentSession?: string
    isSeeded: boolean
    origin?: 'subagent'
    delegationDepth?: number
    agentPreset?: string
  }
  cursor: number
  records: SessionEventEntry[]
  hasMore: boolean
  projections: { asOfSeq: number; values: Record<string, unknown> }
}

export type SessionFollowFrame = SessionFollowSnapshot | SessionEventEntry

export interface AgentLike {
  readonly id: string
  readonly session: { readonly id?: string; header?: { id?: string; cwd?: string } }
}

export interface ResolveAgentResult {
  agent?: AgentLike
  error?: { code?: string; message?: string }
}

export interface SessionControllerService {
  list(request: { cursor?: string }, signal: AbortSignal): Promise<SessionListValue>
  create(request: { cwd?: string; workspaceId?: string; agentPreset?: string; sessionId?: string }): Promise<{ sessionId: string }>
  rename(request: { sessionId: string; title: string }): Promise<{ title: string; seq: number }>
  page(request: {
    address: SessionAddress
    beforeSeq?: number
    throughSeq?: number
    maxMessages?: number
    turnWindow?: { minMessages: number; minTurns: number }
  }, signal: AbortSignal): Promise<SessionEventsPage>
  /** Present in 0.2.2; absent in 0.2.1 (synthesized by the facade). */
  state?(request: { sessionId: string }, signal: AbortSignal): Promise<SessionStateValue>
  projections(request: { sessionId: string }, signal: AbortSignal): Promise<SessionProjectionsValue | null>
  follow(request: {
    address: SessionAddress
    activate?: boolean
    assistantStream?: true
    maxMessages?: number
    turnWindow?: { minMessages: number; minTurns: number }
  }, signal: AbortSignal): AsyncIterable<SessionFollowFrame>
  prompt(request: {
    requestId: string
    sessionId: string
    mode: 'queue' | 'steer'
    content: Array<{ type: 'text'; text: string }>
    clientTimeZone?: string
  }, signal: AbortSignal): Promise<{ accepted: true }>
  cancel(request: { sessionId: string }): { accepted: true }
  updateQueue(request: { sessionId: string; itemId: string; action: unknown }): Promise<{ accepted: true }>
  resolveAgent(sessionId: string): Promise<ResolveAgentResult>
}

export interface CredentialKey {
  readonly __credentialKey?: never
}

export interface CredentialProviderService {
  readRecord(key: unknown): Promise<{ kind: string; payload?: unknown } | undefined>
  modifyRecord(
    key: unknown,
    mutate: (current: { kind: string; payload?: unknown } | undefined) => Promise<{ kind: string; payload?: unknown } | undefined>,
  ): Promise<{ kind: string; payload?: unknown } | undefined>
  deleteRecord(key: unknown): Promise<void>
}

export interface UserQuestionsService {
  answer(agent: AgentLike, callId: unknown, answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> }): boolean
}

export interface TypertGatewayService {
  hasLiveClient(): boolean
}

export interface ConnectionService {
  /** Validate a dsh browser/API credential from request headers. */
  admit(request: { headers: Record<string, string | string[] | undefined> }): { peer?: unknown; rejection?: number }
}

export interface SubprocessTerminalHandle {
  readonly pid: number
  readonly output: import('node:stream').Readable
  readonly done: Promise<{ exitCode: number | null; signal: string | null }>
  write(data: string): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  terminate(): Promise<void>
}

/** The Host's PTY provider. Optional: headless profiles may not mount it. */
export interface SubprocessService {
  terminalEnvironment(signal?: AbortSignal): Promise<{
    platform: 'posix' | 'windows'
    defaultShell?: string
  }>
  resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string>
  spawnTerminal(spec: {
    argv: readonly string[]
    cwd: string
    env?: Record<string, string>
    rows: number
    cols: number
    terminalType: string
    shellActivity?: boolean
    graceMs: number
    signal?: AbortSignal
  }): Promise<SubprocessTerminalHandle>
}

export interface HostContext {
  webServer: WebServerService
  sessionController: SessionControllerService
  credentials?: CredentialProviderService
  userQuestions?: UserQuestionsService
  typertGateway?: TypertGatewayService
  subprocess?: SubprocessService
  on(event: string, listener: (...args: unknown[]) => unknown, options?: Record<string, unknown>): () => void
  effect(setup: () => (() => void) | void, label?: string): () => void
  get(name: string): unknown
  inject?(deps: string[], callback: (ctx: HostContext) => void | (() => void)): Promise<unknown> | unknown
  logger?: {
    debug(message: string, ...args: unknown[]): void
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
  }
  parallel?(name: string, ...args: unknown[]): unknown
}

/** A push of the plugin's own event bus. */
export interface PluginEvents {
  emit(event: string, data: unknown): void
  on(event: string, listener: (data: unknown) => void): () => void
}
