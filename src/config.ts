/**
 * Plugin configuration. Every tunable value is a configuration field so a
 * deployment can change it from `cordis.yml` without editing code.
 */
import Schema from '@deepseek-ai/schemastery'

export interface PushConfig {
  /** Push transport. `none` disables outbound notifications entirely. */
  provider: 'none' | 'fcm' | 'apns' | 'relay'
  /** Relay base URL, e.g. https://push.example.com. */
  relayUrl?: string
  /** Host token issued by the relay's /v1/hosts enrollment. */
  relayHostToken?: string
  /** FCM v1 service-account JSON (the whole JSON document as a string). */
  fcmServiceAccountJson?: string
  /** FCM project id; read from the service account when omitted. */
  fcmProjectId?: string
  /** APNs `.p8` private key contents (the whole PEM as a string). */
  apnsKey?: string
  /** APNs key id from the Apple developer portal. */
  apnsKeyId?: string
  /** APNs team id from the Apple developer portal. */
  apnsTeamId?: string
  /** APNs bundle topic, normally the iOS bundle id. */
  apnsTopic?: string
  /** APNs environment. */
  apnsEnvironment: 'sandbox' | 'production'
  /** Whether a turn-end notification is sent. */
  notifyTurnEnd: boolean
  /** Whether approval requests are pushed. */
  notifyApproval: boolean
  /** Whether user questions are pushed. */
  notifyQuestion: boolean
}

export interface Config {
  /** Base path for every route this plugin registers. No trailing slash. */
  basePath: string
  /**
   * Extra authorities admitted by the Host-header check, as `host` or
   * `host:port`. Pairing always records the authority a device paired through;
   * loopback and the listener's own bind address are always admitted.
   */
  allowedHosts: string[]
  /**
   * Refuse plain-HTTP device traffic from non-loopback peers. TLS is normally
   * terminated by a reverse proxy; set this only when the Host itself serves
   * TLS and you want the plugin to enforce it.
   */
  requireSecure: boolean
  /**
   * Bind authenticated requests to a known Host authority. The default is
   * false: a valid device token is the boundary, so changing IP, port, or
   * tunnel keeps the pairing. Set true for an extra pre-routing fence.
   */
  strictHostCheck: boolean
  /** One-time pairing code lifetime in milliseconds. */
  pairingTtlMs: number
  /** Number of characters in a generated pairing code. */
  pairingCodeLength: number
  /** Failed pairing attempts allowed per client address inside the TTL. */
  pairingMaxAttempts: number
  /** Fixed pairing code for local testing. Omit in normal deployments. */
  pairingCode?: string
  /** Print the current pairing code and QR at activation. */
  logPairingCode: boolean
  /** How long an approval request is held for the app before delegation. */
  approvalWaitTimeoutMs: number
  /** How long a user question is held for the app before delegation. */
  questionWaitTimeoutMs: number
  /**
   * Allow an app to answer `always` for one tool in one session. dsh itself
   * only has one-shot grants, so this is a process-local convenience grant and
   * disappears when the Host restarts.
   */
  allowSessionWideGrants: boolean
  /**
   * Expose authenticated debug routes that create synthetic approvals and
   * questions. Disabled by default; use it to exercise the phone UI without a
   * model/tool call, then turn it off.
   */
  enableDebugRoutes: boolean
  /**
   * Re-read the generated admin HTML on every request instead of caching it.
   * Development only: pair it with `pnpm dev:web`.
   */
  devAdminReload: boolean
  /** Maximum JSON request body in bytes. */
  maxBodyBytes: number
  /** Rate-limit window in milliseconds. */
  rateLimitWindowMs: number
  /** Maximum requests per client address inside one rate-limit window. */
  rateLimitMax: number
  /** SemVer range of dsh runtimes this plugin supports. */
  dshVersionRange: string
  /** Push configuration. */
  push: PushConfig
}

export const Config: Schema<Config> = Schema.object({
  basePath: Schema.string().default('/dsh-door'),
  allowedHosts: Schema.array(Schema.string()).default([]),
  requireSecure: Schema.boolean().default(false),
  strictHostCheck: Schema.boolean().default(false),
  pairingTtlMs: Schema.number().default(5 * 60 * 1000),
  pairingCodeLength: Schema.number().default(8),
  pairingMaxAttempts: Schema.number().default(8),
  pairingCode: Schema.string(),
  logPairingCode: Schema.boolean().default(true),
  approvalWaitTimeoutMs: Schema.number().default(2 * 60 * 1000),
  questionWaitTimeoutMs: Schema.number().default(2 * 60 * 1000),
  allowSessionWideGrants: Schema.boolean().default(true),
  enableDebugRoutes: Schema.boolean().default(false),
  devAdminReload: Schema.boolean().default(false),
  maxBodyBytes: Schema.number().default(64 * 1024),
  rateLimitWindowMs: Schema.number().default(60 * 1000),
  rateLimitMax: Schema.number().default(240),
  dshVersionRange: Schema.string().default('>=0.2.1-rc.4 <0.3.0'),
  push: Schema.object({
    provider: Schema.union(['none', 'fcm', 'apns', 'relay'] as const).default('none'),
    relayUrl: Schema.string(),
    relayHostToken: Schema.string(),
    fcmServiceAccountJson: Schema.string(),
    fcmProjectId: Schema.string(),
    apnsKey: Schema.string(),
    apnsKeyId: Schema.string(),
    apnsTeamId: Schema.string(),
    apnsTopic: Schema.string(),
    apnsEnvironment: Schema.union(['sandbox', 'production'] as const).default('production'),
    notifyTurnEnd: Schema.boolean().default(true),
    notifyApproval: Schema.boolean().default(true),
    notifyQuestion: Schema.boolean().default(true),
  }).default({}),
})

/** Structural type check for the configuration Cordis passes to apply(). */
export function normalizeConfig(input: Partial<Config> | undefined): Config {
  const raw = (input ?? {}) as Partial<Config>
  const push = { ...(raw.push ?? {}) } as Partial<PushConfig>
  const config: Config = {
    basePath: normalizeBasePath(raw.basePath ?? '/dsh-door'),
    allowedHosts: (raw.allowedHosts ?? []).map(value => value.trim().toLowerCase()).filter(Boolean),
    requireSecure: raw.requireSecure ?? false,
    strictHostCheck: raw.strictHostCheck ?? false,
    pairingTtlMs: raw.pairingTtlMs ?? 5 * 60 * 1000,
    pairingCodeLength: raw.pairingCodeLength ?? 8,
    pairingMaxAttempts: raw.pairingMaxAttempts ?? 8,
    logPairingCode: raw.logPairingCode ?? true,
    approvalWaitTimeoutMs: raw.approvalWaitTimeoutMs ?? 2 * 60 * 1000,
    questionWaitTimeoutMs: raw.questionWaitTimeoutMs ?? 2 * 60 * 1000,
    allowSessionWideGrants: raw.allowSessionWideGrants ?? true,
    enableDebugRoutes: raw.enableDebugRoutes ?? false,
    devAdminReload: raw.devAdminReload ?? false,
    maxBodyBytes: raw.maxBodyBytes ?? 64 * 1024,
    rateLimitWindowMs: raw.rateLimitWindowMs ?? 60 * 1000,
    rateLimitMax: raw.rateLimitMax ?? 240,
    dshVersionRange: raw.dshVersionRange ?? '>=0.2.1-rc.4 <0.3.0',
    push: {
      provider: push.provider ?? 'none',
      fcmServiceAccountJson: push.fcmServiceAccountJson,
      fcmProjectId: push.fcmProjectId,
      apnsKey: push.apnsKey,
      apnsKeyId: push.apnsKeyId,
      apnsTeamId: push.apnsTeamId,
      apnsTopic: push.apnsTopic,
      apnsEnvironment: push.apnsEnvironment ?? 'production',
      notifyTurnEnd: push.notifyTurnEnd ?? true,
      notifyApproval: push.notifyApproval ?? true,
      notifyQuestion: push.notifyQuestion ?? true,
    },
  }
  if (raw.pairingCode !== undefined) config.pairingCode = raw.pairingCode
  if (!Number.isFinite(config.pairingTtlMs) || config.pairingTtlMs < 1000) {
    throw new Error('dsh-door: pairing.ttlMs must be at least 1000 ms')
  }
  if (!Number.isInteger(config.pairingCodeLength) || config.pairingCodeLength < 4 || config.pairingCodeLength > 32) {
    throw new Error('dsh-door: pairing.codeLength must be an integer from 4 to 32')
  }
  if (!Number.isFinite(config.maxBodyBytes) || config.maxBodyBytes < 1024) {
    throw new Error('dsh-door: maxBodyBytes must be at least 1024')
  }
  return config
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) throw new Error('dsh-door: basePath must start with "/"')
  const withoutTrailing = trimmed.replace(/\/+$/, '')
  if (withoutTrailing.length === 0) throw new Error('dsh-door: basePath may not be "/"')
  return withoutTrailing
}

export const defaultPushConfig: PushConfig = {
  provider: 'none',
  apnsEnvironment: 'production',
  notifyTurnEnd: true,
  notifyApproval: true,
  notifyQuestion: true,
}

