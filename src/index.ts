import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Config, normalizeConfig, type Config as PluginConfig } from './config.js'
import { DeviceStore } from './devices.js'
import { HttpRouter } from './http.js'
import type { HostContext } from './host.js'
import { InteractionBroker } from './interactions.js'
import { PairingManager } from './pairing.js'
import { PushManager } from './push.js'
import { registerRoutes } from './routes.js'
import { createSessionFacade, readProjections } from './sessions.js'
import { SseHub } from './streams.js'
import { TerminalManager } from './terminal.js'
import { checkDshVersion } from './version.js'
import { formatPairingCode, newId, shortError } from './util.js'

export { Config }
export type { Config as PluginConfig }
export const name = 'dsh-door'

/**
 * The plugin reads the Host's own service instances. Credentials is required
 * so a paired device survives restarts; session-controller is the only data
 * source for sessions and events; webServer owns the route registration.
 */
export const inject = ['webServer', 'sessionController', 'credentials']

const PLUGIN_VERSION = readPluginVersion()

/**
 * Mount the mobile BFF. Every unauthenticated request is answered by the
 * plugin's own Host/Origin fence; only the public health route and the
 * code-protected pairing route are reachable without a device token.
 */
export async function apply(ctx: HostContext, rawConfig?: Partial<PluginConfig>): Promise<void> {
  const config = normalizeConfig(rawConfig)
  const logger = createLogger(ctx)
  const version = await checkDshVersion(config.dshVersionRange, logger)

  const webServer = ctx.webServer ?? (ctx.get('webServer') as HostContext['webServer'])
  const sessionController = ctx.sessionController ?? (ctx.get('sessionController') as HostContext['sessionController'])
  const credentials = ctx.credentials ?? (ctx.get('credentials') as HostContext['credentials'])
  if (webServer === undefined) throw new Error('dsh-door: the webServer service is required')
  if (sessionController === undefined) throw new Error('dsh-door: the sessionController service is required')

  // Never spread a Cordis Context: its services and lifecycle methods live on
  // the prototype. The injected services are already properties on `ctx`.
  const host: HostContext = ctx

  const devices = new DeviceStore(host, credentials)
  await devices.load()

  const hub = new SseHub()
  const hostOrigin = (host.webServer.getOrigin?.() ?? '').replace(/\/+$/, '')
  const push = new PushManager(config, devices, logger, credentials, hostOrigin.length > 0 ? `plugin:${hostOrigin}` : '')
  await push.load()
  const pairingRecordKey = 'dsh-door/pairing' as unknown
  const pairing = new PairingManager(config, logger, undefined, async (fixedCode) => {
    if (credentials === undefined) return
    await credentials.modifyRecord(pairingRecordKey, async () => ({
      kind: 'grant',
      payload: { fixedCode },
    }))
  })
  if (credentials !== undefined) {
    try {
      const record = await credentials.readRecord(pairingRecordKey)
      const payload = record?.payload
      if (typeof payload === 'object' && payload !== null) {
        const fixed = (payload as { fixedCode?: unknown }).fixedCode
        if (typeof fixed === 'string') await pairing.setFixedCode(fixed, false)
      }
    } catch (error) {
      logger.warn(`[dsh-door] could not load the fixed pairing code: ${shortError(error)}`)
    }
  }
  const interactions = new InteractionBroker(host, config, hub, push, logger)
  interactions.register()
  const sessions = createSessionFacade(host)
  const terminals = new TerminalManager(host, logger)

  const router = new HttpRouter(config, {
    authenticate: token => devices.authenticate(token),
    isKnownAuthority: authority => devices.list().some(device => device.authorities.includes(authority)),
    isLoopbackBindHost: hostname => hostname === webServer.host,
    logger,
  })
  registerRoutes(router, {
    config,
    ctx: host,
    devices,
    pairing,
    hub,
    interactions,
    push,
    sessions,
    terminals,
    logger,
    version,
    pluginVersion: PLUGIN_VERSION,
  })

  ctx.effect(() => {
    const dispose = webServer.register(router.hostRoute())
    logger.info(`[dsh-door] listening at ${(host.webServer.getOrigin?.() ?? '') + config.basePath}`)
    return () => dispose()
  }, 'dsh-door: mobile routes')

  // The browser half reads this to link to the configured admin route instead
  // of assuming the default base path.
  ctx.effect(() => {
    const off = ctx.on('webserver/index-inject', (table) => {
      const rows = table as Array<{ kind: 'global'; name: string; value: unknown }>
      rows.push({ kind: 'global', name: '__DSH_DOOR__', value: { basePath: config.basePath } })
    }, { global: true })
    return () => off()
  }, 'dsh-door: index injection')

  registerSessionNotifications(host, hub, push, sessions, logger, terminals)

  ctx.effect(() => () => {
    hub.dispose()
    interactions.dispose()
    terminals.dispose()
  }, 'dsh-door: streams and interactions')

  const current = pairing.current()
  const expiryText = current.fixed || current.expiresAt === Number.MAX_SAFE_INTEGER
    ? 'never (fixed code)'
    : new Date(current.expiresAt).toISOString()
  logger.info(
    `[dsh-door] pairing code ${formatPairingCode(current.code)} — open the app, enter the server URL, then this code. ` +
    `Code expires ${expiryText}.`,
  )
  if (config.logPairingCode && config.pairingCode === undefined) {
    void printPairingQr(current.code, host, config).catch(() => undefined)
  }
  logger.info(
    `[dsh-door] ${devices.count()} paired device(s); push provider "${config.push.provider}". ` +
    'Plain HTTP on a public address leaks the device token: use TLS or a private network.',
  )
}

function registerSessionNotifications(
  ctx: HostContext,
  hub: SseHub,
  push: PushManager,
  sessions: ReturnType<typeof createSessionFacade>,
  logger: { warn(message: string): void },
  terminals: TerminalManager,
): void {
  const running = new Map<string, boolean>()

  ctx.on('api-session/added', (summary) => {
    const item = summary as { sessionId?: string; updatedAt?: number; running?: boolean; agentAvailable?: boolean; blank?: boolean; cwd?: string }
    if (typeof item.sessionId !== 'string') return
    hub.broadcast('session', { action: 'added', sessionId: item.sessionId })
  }, { global: true })

  ctx.on('api-session/removed', (sessionId) => {
    if (typeof sessionId !== 'string') return
    hub.broadcast('session', { action: 'removed', sessionId })
    void terminals.closeSession(sessionId)
  }, { global: true })

  ctx.on('api-session/activity', (sessionId, updatedAt) => {
    if (typeof sessionId !== 'string') return
    hub.broadcast('session', { action: 'activity', sessionId, updatedAt })
  }, { global: true })

  ctx.on('api-session/status', (sessionId, isRunning) => {
    if (typeof sessionId !== 'string') return
    const wasRunning = running.get(sessionId) === true
    running.set(sessionId, isRunning === true)
    hub.broadcast('session', { action: 'status', sessionId, running: isRunning === true })
    if (wasRunning && isRunning !== true) {
      const eventId = newId()
      hub.broadcast('turn-end', { sessionId, time: Date.now(), eventId })
      // A connected app receives the SSE event and decides whether to show an
      // in-app toast. Only an app with no live connection needs a system push.
      if (hub.hasClients()) return
      void sessions.titleOf(sessionId, new AbortController().signal)
        .then(title => {
          // The title lookup is asynchronous; recheck so reconnecting while it
          // is in flight does not produce a duplicate system notification.
          if (!hub.hasClients()) push.notify('turn-end', { sessionId, title: title ?? undefined, eventId })
        })
        .catch((error: unknown) => logger.warn(`[dsh-door] turn-end notification failed: ${shortError(error)}`))
    }
  }, { global: true })

  ctx.on('api-session/error', (sessionId, message) => {
    if (typeof sessionId !== 'string') return
    hub.broadcast('session', { action: 'error', sessionId, message: typeof message === 'string' ? message : 'agent error' })
  }, { global: true })
}

function createLogger(_ctx: HostContext): {
  info(message: string): void
  warn(message: string): void
  debug(message: string): void
} {
  // Pairing codes and compatibility failures are operator-facing facts, not
  // debug logging: write them to the terminal unconditionally. A deployment
  // that wants quieter logs can set logPairingCode: false.
  return {
    info: message => console.log(message),
    warn: message => console.warn(message),
    debug: () => undefined,
  }
}

function readPluginVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

async function printPairingQr(code: string, ctx: HostContext, config: PluginConfig): Promise<void> {
  const origin = ctx.webServer.getOrigin?.() ?? ''
  const payload = JSON.stringify({ v: 1, url: `${origin}${config.basePath}`, code })
  const mod = await import('qrcode-terminal')
  const qrcode = (mod as { default?: unknown }).default ?? mod
  await new Promise<void>((resolve) => {
    ;(qrcode as { generate(input: string, options: unknown, done: () => void): void })
      .generate(payload, { small: true }, () => resolve())
  })
}

export { readProjections }
