/**
 * Wire protocol shared with the React Native app. The plugin owns this shape;
 * the app mirrors it in `src/api/protocol.ts`. Keep both files in sync.
 */

/** Protocol version; bump on a breaking wire change. */
export const PROTOCOL_VERSION = 1

/** The prefix every app route is served under. */
export interface ServerFacts {
  /** Plugin name. */
  name: string
  /** Plugin version. */
  version: string
  /** Wire protocol version the plugin speaks. */
  protocol: number
  /** Running dsh version, when it could be discovered. */
  dshVersion: string | null
  /** Whether the running dsh version satisfies the plugin's supported range. */
  dshCompatible: boolean
  /** Webserver origin (`http://host:port`), when available. */
  origin: string | null
  /** Webserver protocol. */
  protocolName: 'http' | 'https'
  /** Webserver bind host. */
  host: string | null
  /** Webserver listening port. */
  port: number | null
}

export interface HealthResponse extends ServerFacts {
  ok: true
  /** Whether an unpaired device may pair right now. */
  pairingOpen: boolean
  /** Whether the current code is a pinned, reusable code. */
  pairingFixed: boolean
  /** Number of paired devices. */
  deviceCount: number
  /** Feature flags for capability negotiation. */
  features: {
    approvals: boolean
    questions: boolean
    push: boolean
    debugRoutes: boolean
    /** Whether the Host has a subprocess provider for the phone terminal. */
    terminal: boolean
    files: boolean
    sessionEvents: 'sse'
    protocol: number
  }
  /** Current time on the Host. */
  time: number
}

export interface PairRequest {
  /** One-time pairing code. */
  code: string
  /** Human-readable device name shown in the device list. */
  deviceName?: string
  /** Stable public-key fingerprint chosen by the device (TOFU identity). */
  devicePublicKey?: string
  /** Platform label for diagnostics. */
  platform?: 'android' | 'ios' | 'unknown'
  /** App version string. */
  appVersion?: string
}

export interface PairResponse {
  deviceId: string
  /** Bearer token. Not bound to host:port, so changing deployment address keeps the pairing. */
  token: string
  deviceName: string
  pairedAt: number
  server: ServerFacts
  features: HealthResponse['features']
}

export interface DeviceInfo {
  deviceId: string
  deviceName: string
  platform?: string
  appVersion?: string
  pairedAt: number
  lastSeenAt: number
  /** Authorities this device paired through. */
  authorities: string[]
  push?: {
    provider: 'fcm' | 'apns'
    token: string
    updatedAt: number
  }
}

export interface SessionListItem {
  id: string
  title: string | null
  updatedAt: number
  running: boolean
  agentAvailable: boolean
  blank: boolean
  cwd?: string
  parentSessionId?: string
  origin?: 'subagent'
  formatStatus?: 'current' | 'migration-required'
  /**
   * Compact numbers lifted from the Session projections. Optional: older
   * plugins omit it, and a Session without projections has nothing to report.
   */
  vitals?: SessionVitals
}

/**
 * The handful of projection numbers a phone list can show without opening the
 * Session. Every field is nullable so a partial projection is still useful.
 */
export interface SessionVitals {
  contextTokens: number | null
  contextWindow: number | null
  contextPercent: number | null
  outputTokens: number | null
  turns: number | null
  todoDone: number | null
  todoTotal: number | null
  goalPhase: GoalView['goal']['phase'] | null
  planActive: boolean
  model: string | null
}

export interface SessionListResponse {
  items: SessionListItem[]
}

/** One retained shell owned by this plugin for a Session. */
export interface TerminalInfo {
  id: string
  sessionId: string
  cwd: string
  shell: string
  cols: number
  rows: number
  pid: number
  createdAt: number
  exited: boolean
  exitCode: number | null
  /** True when older output was dropped from the replay buffer. */
  truncated: boolean
}

export interface TerminalListResponse {
  items: TerminalInfo[]
}

export interface SessionTranscriptResponse {
  sessionId: string
  title: string | null
  cwd?: string
  records: unknown[]
  hasMore: boolean
  cursor: number
  projections: ProjectionValues
}

export interface ProjectionValues {
  title?: string | null
  todos?: TodoItem[] | null
  goal?: GoalView | null
  plan?: PlanView | null
  userQuestions?: UserQuestionView | null
  [key: string]: unknown
}

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface GoalView {
  goal: {
    id: string
    revision: number
    objective: string
    phase: 'active' | 'paused' | 'blocked' | 'complete'
    blockedReason?: { code: string; message: string }
    maxGoalRounds: number
  }
  roundsStarted: number
  createdAt: number
  updatedAt: number
}

export interface PlanView {
  active: boolean
  pending: boolean
}

export interface UserQuestionView {
  active: Array<{
    callId: string
    questions: QuestionItem[]
    state: 'open' | 'continued'
  }>
  settled: Array<{ callId: string; answers: QuestionAnswerItem[] }>
}

export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
  intent?: unknown
}

export interface QuestionAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

export interface SessionStateResponse {
  state: {
    cursor: number
    active: boolean
    running: boolean
    queue: unknown[] | null
    pendingInput: string[]
  }
  projections: ProjectionValues
  session: SessionListItem
}

export interface CreateSessionRequest {
  cwd?: string
  workspaceId?: string
  agentPreset?: string
}

export interface PromptRequest {
  /** Client-minted request identity for idempotent retries. */
  requestId?: string
  text: string
  mode?: 'queue' | 'steer'
  clientTimeZone?: string
}

export interface RenameRequest {
  title: string
}

/**
 * A small, presentation-only summary of the tool call behind an approval.
 * The app renders it as a command block / diff / URL; clients that do not
 * understand the kind still get a readable `title` and `detail`.
 */
export interface ApprovalPreview {
  kind: 'command' | 'diff' | 'url' | 'path' | 'text'
  title: string
  detail?: string
  /** For diffs: number of added/removed lines, when cheap to count. */
  added?: number
  removed?: number
}

export interface ApprovalItem {
  id: string
  sessionId: string
  toolName: string
  callId?: string
  reason?: string
  displayReason?: { en: string; [locale: string]: string }
  createdAt: number
  expiresAt: number
  /** True when this is a process-local session-wide grant already in effect. */
  auto?: boolean
  /** Optional summary of the call arguments; older plugins omit it. */
  preview?: ApprovalPreview
}

export type ApprovalDecision = 'allow' | 'deny' | 'always'

export interface ApprovalResponse {
  accepted: true
  decision: ApprovalDecision
}

export interface QuestionItemEnvelope {
  id: string
  sessionId: string
  callId?: string
  questions: QuestionItem[]
  createdAt: number
  expiresAt: number
}

export interface QuestionAnswerRequest {
  answers: QuestionAnswerItem[]
}

export interface QuestionAnswerResponse {
  accepted: true
}

export type StreamEventName =
  | 'hello'
  | 'heartbeat'
  | 'session'
  | 'approval'
  | 'approval-resolved'
  | 'question'
  | 'question-resolved'
  | 'turn-end'

export interface StreamEvent {
  type: StreamEventName
  data: unknown
}

export interface ErrorResponse {
  error: {
    code: string
    message: string
    [key: string]: unknown
  }
}
