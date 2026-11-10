import type { Config } from './config.js'
import type { DeviceStore } from './devices.js'
import type { HostContext } from './host.js'
import { HttpError, markStreaming, sendJson, sendNoContent, startSse, writeSse } from './http.js'
import type { HttpRouter, RouteContext } from './http.js'
import type { InteractionBroker } from './interactions.js'
import type { PairingManager } from './pairing.js'
import type { PushManager } from './push.js'
import type {
  ApprovalDecision,
  HealthResponse,
  PairRequest,
  PairResponse,
  ServerFacts,
  SessionListResponse,
  SessionStateResponse,
  SessionTranscriptResponse,
} from './protocol.js'
import { PROTOCOL_VERSION } from './protocol.js'
import type { SessionFacade } from './sessions.js'
import type { SseHub } from './streams.js'
import type { TerminalEvent, TerminalManager } from './terminal.js'
import { newId, shortError } from './util.js'

export interface RouteDependencies {
  config: Config
  ctx: HostContext
  devices: DeviceStore
  pairing: PairingManager
  hub: SseHub
  interactions: InteractionBroker
  push: PushManager
  sessions: SessionFacade
  terminals: TerminalManager
  logger: {
    info(message: string): void
    warn(message: string): void
    debug?(message: string): void
  }
  version: { version: string | null; compatible: boolean }
  pluginVersion: string
}

export function registerRoutes(router: HttpRouter, deps: RouteDependencies): void {
  const { config } = deps

  router.add({
    method: 'GET',
    pattern: '/health',
    auth: 'public',
    handler: (rc) => {
      const facts = serverFacts(deps)
      const response: HealthResponse = {
        ok: true,
        ...facts,
        pairingOpen: deps.pairing.status().pairingOpen,
        pairingFixed: deps.pairing.status().fixed,
        deviceCount: deps.devices.count(),
        features: features(deps),
        time: Date.now(),
      }
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/admin',
    auth: 'public',
    handler: async (rc) => {
      if (!adminAuthorized(deps, rc)) {
        sendHtml(rc.res, 401, adminDeniedPage(config.basePath))
        return
      }
      const data = await adminData(deps)
      sendHtml(rc.res, 200, adminPage(data, config.basePath))
    },
  })

  router.add({
    method: 'GET',
    pattern: '/admin/data',
    auth: 'public',
    handler: async (rc) => {
      if (!adminAuthorized(deps, rc)) throw new HttpError(401, 'admin-unauthorized', 'open this page from an authenticated dsh browser')
      sendJson(rc.res, 200, await adminData(deps))
    },
  })

  router.add({
    method: 'POST',
    pattern: '/admin/pair-code',
    auth: 'public',
    handler: async (rc) => {
      if (!adminAuthorized(deps, rc)) throw new HttpError(401, 'admin-unauthorized', 'open this page from an authenticated dsh browser')
      const body = (rc.body ?? {}) as { action?: unknown; code?: unknown }
      try {
        if (body.action === 'fixed') {
          if (typeof body.code !== 'string') throw new HttpError(400, 'bad-code', 'code is required')
          await deps.pairing.setFixedCode(body.code)
        } else if (body.action === 'auto' || body.action === 'rotate') {
          if (body.action === 'auto') await deps.pairing.setFixedCode(null)
          else deps.pairing.rotate()
        } else {
          throw new HttpError(400, 'bad-action', 'action must be rotate, fixed, or auto')
        }
      } catch (error) {
        if (error instanceof HttpError) throw error
        throw new HttpError(400, 'bad-code', error instanceof Error ? error.message : String(error))
      }
      sendJson(rc.res, 200, await adminData(deps))
    },
  })

  router.add({
    method: 'GET',
    pattern: '/pair',
    auth: 'public',
    handler: (rc) => {
      const status = deps.pairing.status()
      sendJson(rc.res, 200, {
        server: serverFacts(deps),
        features: features(deps),
        pairing: { open: status.pairingOpen },
      })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/pair/code',
    auth: 'public',
    handler: async (rc) => {
      assertLoopback(rc)
      const current = deps.pairing.current()
      const origin = serverFacts(deps).origin ?? ''
      const payload = JSON.stringify({
        v: 1,
        url: `${origin}${config.basePath}`,
        code: current.code,
      })
      const qr = await renderQr(payload)
      sendJson(rc.res, 200, {
        code: current.code,
        formatted: current.formatted,
        expiresAt: current.expiresAt,
        payload,
        qr,
      })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/pair/code',
    auth: 'public',
    handler: (rc) => {
      assertLoopback(rc)
      const rotated = deps.pairing.rotate()
      sendJson(rc.res, 200, rotated)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/pair',
    auth: 'public',
    handler: async (rc) => {
      const body = rc.body as Partial<PairRequest> | undefined
      if (body === undefined || typeof body.code !== 'string') {
        throw new HttpError(400, 'bad-pair-request', 'pairing requires a code')
      }
      const verification = deps.pairing.verify(body.code, rc.clientAddress)
      if (!verification.ok) {
        const message = verification.reason === 'rate-limited'
          ? 'too many pairing attempts from this address'
          : verification.reason === 'expired'
            ? 'the pairing code has expired; read the new code from the dsh terminal'
            : 'the pairing code is invalid'
        throw new HttpError(verification.reason === 'rate-limited' ? 429 : 401, `pair-${verification.reason}`, message)
      }
      const authority = rc.authority
      if (authority.length === 0) throw new HttpError(400, 'missing-host', 'the Host header is required')
      const token = randomPairingToken()
      const device = await deps.devices.pair({
        token,
        deviceName: sanitizeName(body.deviceName),
        devicePublicKey: typeof body.devicePublicKey === 'string' ? body.devicePublicKey : undefined,
        platform: body.platform,
        appVersion: body.appVersion,
        authority,
      })
      const response: PairResponse = {
        deviceId: device.deviceId,
        token,
        deviceName: device.deviceName,
        pairedAt: device.pairedAt,
        server: serverFacts(deps),
        features: features(deps),
      }
      deps.logger.info(`[dsh-door] paired device "${device.deviceName}" (${device.deviceId.slice(0, 12)}…) from ${rc.clientAddress}`)
      sendJson(rc.res, 201, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/devices',
    auth: 'device',
    handler: (rc) => {
      sendJson(rc.res, 200, {
        current: rc.device?.deviceId,
        items: deps.devices.list(),
      })
    },
  })

  router.add({
    method: 'DELETE',
    pattern: '/devices/:id',
    auth: 'device',
    handler: async (rc) => {
      const removed = await deps.devices.revoke(rc.params.id!)
      if (!removed) throw new HttpError(404, 'device-not-found', 'no such device')
      deps.hub.closeDevice(rc.params.id!)
      sendNoContent(rc.res)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/push/register',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { provider?: unknown; token?: unknown } | undefined
      const provider = body?.provider
      const token = body?.token
      if (provider !== 'fcm' && provider !== 'apns') {
        throw new HttpError(400, 'bad-push-provider', 'provider must be "fcm" or "apns"')
      }
      if (typeof token !== 'string' || token.length < 8 || token.length > 4096) {
        throw new HttpError(400, 'bad-push-token', 'token must be a non-empty push token')
      }
      const updated = await deps.devices.setPush(rc.device!.deviceId, { provider, token, updatedAt: Date.now() })
      if (!updated) throw new HttpError(404, 'device-not-found', 'no such device')
      sendJson(rc.res, 200, { accepted: true, provider })
    },
  })

  router.add({
    method: 'DELETE',
    pattern: '/push',
    auth: 'device',
    handler: async (rc) => {
      await deps.devices.clearPush(rc.device!.deviceId)
      sendNoContent(rc.res)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions',
    auth: 'device',
    handler: async (rc) => {
      const items = await deps.sessions.list(rc.signal)
      const response: SessionListResponse = { items }
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions',
    auth: 'device',
    handler: async (rc) => {
      const body = (rc.body ?? {}) as { cwd?: unknown; workspaceId?: unknown; agentPreset?: unknown }
      const created = await deps.sessions.create({
        ...(typeof body.cwd === 'string' && body.cwd.length > 0 ? { cwd: body.cwd } : {}),
        ...(typeof body.workspaceId === 'string' && body.workspaceId.length > 0 ? { workspaceId: body.workspaceId } : {}),
        ...(typeof body.agentPreset === 'string' && body.agentPreset.length > 0 ? { agentPreset: body.agentPreset } : {}),
      })
      sendJson(rc.res, 201, created)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/transcript',
    auth: 'device',
    handler: async (rc) => {
      const beforeSeq = numberParam(rc.query.get('beforeSeq'))
      const maxMessages = numberParam(rc.query.get('maxMessages'))
      const response: SessionTranscriptResponse = await deps.sessions.transcript(rc.params.id!, {
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        ...(maxMessages === undefined ? {} : { maxMessages }),
      }, rc.signal)
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/state',
    auth: 'device',
    handler: async (rc) => {
      const response: SessionStateResponse = await deps.sessions.state(rc.params.id!, rc.signal)
      sendJson(rc.res, 200, response)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/prompt',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { text?: unknown; requestId?: unknown; mode?: unknown; clientTimeZone?: unknown } | undefined
      if (body === undefined || typeof body.text !== 'string' || body.text.trim().length === 0) {
        throw new HttpError(400, 'empty-prompt', 'text must contain non-whitespace content')
      }
      const mode = body.mode === 'steer' ? 'steer' : 'queue'
      const requestId = typeof body.requestId === 'string' && body.requestId.length > 0 ? body.requestId : newId()
      const accepted = await deps.sessions.prompt(rc.params.id!, {
        requestId,
        text: body.text,
        mode,
        ...(typeof body.clientTimeZone === 'string' ? { clientTimeZone: body.clientTimeZone } : {}),
      }, rc.signal)
      sendJson(rc.res, 202, accepted)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/rename',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { title?: unknown } | undefined
      if (body === undefined || typeof body.title !== 'string' || body.title.trim().length === 0) {
        throw new HttpError(400, 'empty-title', 'title must be non-empty')
      }
      const renamed = await deps.sessions.rename(rc.params.id!, body.title)
      sendJson(rc.res, 200, renamed)
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/cancel',
    auth: 'device',
    handler: (rc) => {
      const accepted = deps.sessions.cancel(rc.params.id!)
      sendJson(rc.res, 202, accepted)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/open',
    auth: 'device',
    handler: (rc) => {
      const facts = serverFacts(deps)
      // Prefer the authority this request actually reached. `getOrigin()` is
      // the Host's bind address, which is often a LAN/Tailscale IP that the
      // phone cannot open in its browser.
      const base = `${facts.protocolName}://${rc.authority}`
      sendJson(rc.res, 200, {
        url: `${base}/`,
        sessionId: rc.params.id!,
        requiresBrowserLogin: true,
        note: 'Open this in a browser that already has a dsh web session; the mobile token is not a browser token.',
      })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/questions/:callId/answer',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { answers?: unknown } | undefined
      const answers = normalizeAnswers(body?.answers)
      const accepted = await deps.interactions.answerContinued(rc.params.id!, rc.params.callId!, { answers })
      if (!accepted) throw new HttpError(409, 'question-not-open', 'the question is not open in this session')
      sendJson(rc.res, 200, { accepted: true })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/events',
    auth: 'device',
    handler: async (rc) => {
      markStreaming(rc.res)
      startSse(rc.res)
      writeSse(rc.res, 'ready', { sessionId: rc.params.id!, time: Date.now() })
      const heartbeat = setInterval(() => writeSse(rc.res, 'heartbeat', { time: Date.now() }), 15_000)
      heartbeat.unref?.()
      // A client disconnect and a device revoke both end this follow stream.
      const abort = new AbortController()
      const onClientAbort = (): void => abort.abort()
      rc.signal.addEventListener('abort', onClientAbort)
      const untrack = deps.hub.trackDevice(rc.device!.deviceId, () => abort.abort())
      try {
        for await (const frame of deps.sessions.follow(rc.params.id!, abort.signal)) {
          if (abort.signal.aborted) break
          writeSse(rc.res, 'frame', frame)
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          writeSse(rc.res, 'error', { code: 'stream-failed', message: shortError(error) })
        }
      } finally {
        untrack()
        rc.signal.removeEventListener('abort', onClientAbort)
        clearInterval(heartbeat)
        if (!rc.res.writableEnded) rc.res.end()
      }
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/terminals',
    auth: 'device',
    handler: (rc) => {
      sendJson(rc.res, 200, { items: deps.terminals.list(rc.params.id!) })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/terminals',
    auth: 'device',
    handler: async (rc) => {
      const sessionId = rc.params.id!
      const body = rc.body as { cols?: unknown; rows?: unknown } | undefined
      const state = await deps.sessions.state(sessionId, rc.signal)
      const cwd = state.session.cwd
      if (typeof cwd !== 'string' || cwd.length === 0) {
        throw new HttpError(409, 'session-cwd-unknown', 'the session has no working directory yet')
      }
      const created = await deps.terminals.create(sessionId, cwd, {
        ...(typeof body?.cols === 'number' ? { cols: body.cols } : {}),
        ...(typeof body?.rows === 'number' ? { rows: body.rows } : {}),
      })
      sendJson(rc.res, 201, created)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/sessions/:id/terminals/:terminalId/events',
    auth: 'device',
    handler: async (rc) => {
      const sessionId = rc.params.id!
      const terminalId = rc.params.terminalId!
      // Resolve before headers so a missing terminal is a JSON 404.
      const snapshot = deps.terminals.snapshot(sessionId, terminalId)
      markStreaming(rc.res)
      startSse(rc.res)
      const heartbeat = setInterval(() => writeSse(rc.res, 'heartbeat', { time: Date.now() }), 15_000)
      heartbeat.unref?.()
      let ready = false
      const pending: TerminalEvent[] = []
      let release: () => void = () => undefined
      const stopped = new Promise<void>(resolve => { release = resolve })
      const shutdown = (): void => {
        if (!rc.res.writableEnded) rc.res.end()
        release()
      }
      // Subscribe before the snapshot is sent, then flush anything that raced
      // in while the reconnect replay was being written.
      const unsubscribe = deps.terminals.subscribe(sessionId, terminalId, event => {
        if (!ready) {
          pending.push(event)
          return
        }
        writeSse(rc.res, event.type, event)
      })
      rc.signal.addEventListener('abort', shutdown)
      const untrack = deps.hub.trackDevice(rc.device!.deviceId, shutdown)
      writeSse(rc.res, 'ready', { ...snapshot, time: Date.now() })
      ready = true
      for (const event of pending.splice(0)) writeSse(rc.res, event.type, event)
      try {
        await stopped
      } finally {
        untrack()
        rc.signal.removeEventListener('abort', shutdown)
        unsubscribe()
        clearInterval(heartbeat)
        if (!rc.res.writableEnded) rc.res.end()
      }
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/terminals/:terminalId/input',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { data?: unknown } | undefined
      const data = body?.data
      if (typeof data !== 'string' || data.length === 0) {
        throw new HttpError(400, 'bad-input', 'data must be a non-empty string')
      }
      if (data.length > 65_536) throw new HttpError(413, 'input-too-large', 'terminal input is limited to 64 KiB')
      await deps.terminals.write(rc.params.id!, rc.params.terminalId!, data)
      sendJson(rc.res, 200, { accepted: true })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/sessions/:id/terminals/:terminalId/resize',
    auth: 'device',
    handler: async (rc) => {
      const body = rc.body as { cols?: unknown; rows?: unknown } | undefined
      if (typeof body?.cols !== 'number' || typeof body?.rows !== 'number') {
        throw new HttpError(400, 'bad-size', 'cols and rows must be numbers')
      }
      const info = await deps.terminals.resize(rc.params.id!, rc.params.terminalId!, body.cols, body.rows)
      sendJson(rc.res, 200, info)
    },
  })

  router.add({
    method: 'DELETE',
    pattern: '/sessions/:id/terminals/:terminalId',
    auth: 'device',
    handler: async (rc) => {
      const closed = await deps.terminals.close(rc.params.id!, rc.params.terminalId!)
      if (!closed) throw new HttpError(404, 'terminal-not-found', 'no such terminal in this session')
      sendNoContent(rc.res)
    },
  })

  router.add({
    method: 'GET',
    pattern: '/events',
    auth: 'device',
    handler: (rc) => {
      markStreaming(rc.res)
      const clientId = newId()
      deps.hub.add(clientId, rc.device!.deviceId, rc.res)
      writeSse(rc.res, 'hello', {
        server: serverFacts(deps),
        features: features(deps),
        pendingApprovals: deps.interactions.listApprovals(),
        pendingQuestions: deps.interactions.listQuestions(),
        time: Date.now(),
      })
      rc.req.on('close', () => {
        // `SseHub` removes the response on close; nothing else is owned here.
      })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/approvals',
    auth: 'device',
    handler: (rc) => {
      sendJson(rc.res, 200, { items: deps.interactions.listApprovals() })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/approvals/:id',
    auth: 'device',
    handler: (rc) => {
      const body = rc.body as { decision?: unknown } | undefined
      const decision = body?.decision
      if (decision !== 'allow' && decision !== 'deny' && decision !== 'always') {
        throw new HttpError(400, 'bad-decision', 'decision must be allow, deny, or always')
      }
      const item = deps.interactions.decideApproval(rc.params.id!, decision as ApprovalDecision)
      if (item === undefined) throw new HttpError(404, 'approval-not-found', 'the approval is no longer pending')
      sendJson(rc.res, 200, { accepted: true, decision })
    },
  })

  router.add({
    method: 'GET',
    pattern: '/questions',
    auth: 'device',
    handler: (rc) => {
      sendJson(rc.res, 200, { items: deps.interactions.listQuestions() })
    },
  })

  router.add({
    method: 'POST',
    pattern: '/questions/:id/answer',
    auth: 'device',
    handler: (rc) => {
      const body = rc.body as { answers?: unknown } | undefined
      const answers = normalizeAnswers(body?.answers)
      const answered = deps.interactions.answerQuestion(rc.params.id!, { answers })
      if (answered === undefined) throw new HttpError(404, 'question-not-found', 'the question is no longer pending')
      sendJson(rc.res, 200, { accepted: true })
    },
  })

  if (config.enableDebugRoutes) {
    router.add({
      method: 'POST',
      pattern: '/debug/approval',
      auth: 'device',
      handler: (rc) => {
        const body = (rc.body ?? {}) as {
          sessionId?: unknown
          toolName?: unknown
          reason?: unknown
          displayReason?: unknown
        }
        const item = deps.interactions.createDebugApproval({
          ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
          ...(typeof body.toolName === 'string' ? { toolName: body.toolName } : {}),
          ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
          ...(typeof body.displayReason === 'object' && body.displayReason !== null
            ? { displayReason: body.displayReason as { en: string; [locale: string]: string } }
            : {}),
        })
        sendJson(rc.res, 201, item)
      },
    })
    router.add({
      method: 'POST',
      pattern: '/debug/question',
      auth: 'device',
      handler: (rc) => {
        const body = (rc.body ?? {}) as { sessionId?: unknown; questions?: unknown }
        const item = deps.interactions.createDebugQuestion({
          ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
          ...(Array.isArray(body.questions) ? { questions: body.questions as never } : {}),
        })
        sendJson(rc.res, 201, item)
      },
    })
    deps.logger.warn('[dsh-door] debug interaction routes are enabled')
  }

  deps.logger.info(
    `[dsh-door] routes mounted at ${config.basePath} (protocol ${PROTOCOL_VERSION}, push ${config.push.provider})`,
  )
}

function serverFacts(deps: RouteDependencies): ServerFacts {
  const web = deps.ctx.webServer
  let origin: string | null = null
  try {
    origin = typeof web.getOrigin === 'function' ? web.getOrigin() : null
  } catch {
    origin = null
  }
  return {
    name: 'dsh-door',
    version: deps.pluginVersion,
    protocol: PROTOCOL_VERSION,
    dshVersion: deps.version.version,
    dshCompatible: deps.version.compatible,
    origin,
    protocolName: web.protocol === 'https:' ? 'https' : 'http',
    host: web.host ?? null,
    port: web.port ?? null,
  }
}

function features(deps: RouteDependencies): HealthResponse['features'] {
  return {
    approvals: true,
    questions: true,
    push: deps.push.isConfigured(),
    debugRoutes: deps.config.enableDebugRoutes,
    terminal: deps.terminals.available(),
    sessionEvents: 'sse',
    protocol: PROTOCOL_VERSION,
  }
}

function assertLoopback(rc: RouteContext): void {
  const address = rc.clientAddress.replace(/^::ffff:/, '')
  if (address !== '127.0.0.1' && address !== '::1' && !address.startsWith('127.')) {
    throw new HttpError(403, 'loopback-only', 'this route is available only from the Host itself')
  }
}

function numberParam(value: string | null): number | undefined {
  if (value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return 'Mobile device'
  return value.trim().slice(0, 80)
}

function randomPairingToken(): string {
  // 32 random bytes rendered base64url, prefixed for recognisability.
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return `dshd_${Buffer.from(bytes).toString('base64url')}`
}

function normalizeAnswers(value: unknown): Array<{ id: string; selected: string[]; custom?: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'bad-answers', 'answers must be a non-empty array')
  }
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new HttpError(400, 'bad-answers', 'each answer must be an object')
    const candidate = item as { id?: unknown; selected?: unknown; custom?: unknown }
    if (typeof candidate.id !== 'string' || !Array.isArray(candidate.selected) || !candidate.selected.every(label => typeof label === 'string')) {
      throw new HttpError(400, 'bad-answers', 'each answer needs an id and a selected string array')
    }
    return {
      id: candidate.id,
      selected: candidate.selected,
      ...(typeof candidate.custom === 'string' ? { custom: candidate.custom } : {}),
    }
  })
}

function adminAuthorized(deps: RouteDependencies, rc: RouteContext): boolean {
  const connection = deps.ctx.get('connection') as
    | { admit(request: { headers: Record<string, string | string[] | undefined> }): { peer?: unknown; rejection?: number } }
    | undefined
  if (connection !== undefined && typeof connection.admit === 'function') {
    try {
      const admission = connection.admit({ headers: rc.req.headers })
      if (admission.peer !== undefined) return true
    } catch {
      // Fall through to the loopback check.
    }
  }
  return rc.clientAddress === '127.0.0.1' || rc.clientAddress === '::1' || rc.clientAddress.startsWith('127.')
}

async function adminData(deps: RouteDependencies): Promise<Record<string, unknown>> {
  const view = deps.pairing.current()
  const origin = serverFacts(deps).origin ?? ''
  const payload = JSON.stringify({ v: 1, url: `${origin}${deps.config.basePath}`, code: view.code })
  const qr = await renderQr(payload)
  return {
    code: view.code,
    formatted: view.formatted,
    fixed: view.fixed,
    expiresAt: view.fixed ? null : view.expiresAt,
    origin,
    basePath: deps.config.basePath,
    qr,
    time: Date.now(),
    devices: deps.devices.list().map(device => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: device.platform,
      pairedAt: device.pairedAt,
      lastSeenAt: device.lastSeenAt,
    })),
  }
}

function sendHtml(res: RouteContext['res'], status: number, html: string): void {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:")
  res.writeHead(status, { 'Content-Length': String(Buffer.byteLength(html)) })
  res.end(html)
}

function adminDeniedPage(basePath: string): string {
  return `<!doctype html><meta charset="utf-8"><title>dsh-door pairing</title>
<body style="background:#0b0e14;color:#e8edf7;font:16px system-ui;padding:48px;line-height:1.6">
<h1>需要 dsh 浏览器登录</h1>
<p>这个页面只对已经登录 dsh Web UI 的浏览器开放。</p>
<p>请先在同一个浏览器里打开 <a style="color:#6ea8fe" href="/">dsh Web UI</a> 完成登录，然后回到
<a style="color:#6ea8fe" href="${escapeHtml(basePath)}/admin">${escapeHtml(basePath)}/admin</a>。</p>
<p style="color:#9aa7bd">也可以直接在服务器终端查看配对码：<code>journalctl -u dsh -f | grep dsh-door</code></p>
</body>`
}

function adminPage(_data: unknown, basePath: string): string {
  const base = escapeHtml(basePath)
  const baseJson = JSON.stringify(basePath).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-door 配对</title>
<style>
:root{color-scheme:dark}
body{background:#0b0e14;color:#e8edf7;font:15px/1.5 system-ui,-apple-system,sans-serif;margin:0;padding:32px}
main{max-width:720px;margin:auto;display:grid;gap:18px}
.card{background:#121826;border:1px solid #243049;border-radius:14px;padding:20px}
h1{font-size:24px;margin:0 0 6px} h2{font-size:16px;margin:0 0 12px}
.muted{color:#9aa7bd;font-size:13px}
.code{font:700 40px ui-monospace,monospace;letter-spacing:8px;text-align:center;color:#6ea8fe;padding:18px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
button{background:#3d7bfd;color:#fff;border:0;border-radius:9px;padding:10px 16px;font-weight:600;cursor:pointer}
button.secondary{background:#0f1420;color:#e8edf7;border:1px solid #243049}
button.danger{background:#3a1720;color:#f87171;border:1px solid #f87171}
input{background:#0f1420;border:1px solid #243049;color:#e8edf7;border-radius:9px;padding:10px;font:15px ui-monospace,monospace;min-width:220px}
pre{background:#0a0d13;border:1px solid #1a2234;border-radius:9px;padding:12px;overflow:auto;color:#9aa7bd;font-size:10px;line-height:1}
.warn{color:#fbbf24}.ok{color:#4ade80}.bad{color:#f87171}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 0;border-bottom:1px solid #1a2234;color:#9aa7bd}
</style></head><body><main>
<div><h1>dsh-door 配对</h1><div class="muted">已通过 dsh 浏览器登录校验 · <span id="mode"></span></div></div>
<div class="card">
  <h2>当前配对码</h2>
  <div class="code" id="code">…</div>
  <div class="muted" id="expiry"></div>
  <div class="row" style="margin-top:14px">
    <button onclick="act('rotate')">生成新的一次性码</button>
    <button class="secondary" onclick="act('auto')">恢复一次性码</button>
  </div>
</div>
<div class="card">
  <h2>固定配对码</h2>
  <div class="muted">固定码会一直有效，直到你在下面恢复一次性码；只建议在可信网络使用。</div>
  <div class="row" style="margin-top:12px">
    <input id="fixedInput" placeholder="例如 ABCD-EFGH" autocomplete="off">
    <button class="danger" onclick="setFixed()">设为固定码</button>
  </div>
</div>
<div class="card"><h2>扫码/输入</h2><pre id="qr">二维码加载中…</pre>
  <div class="muted">App 目前使用数字码；二维码内容为 <code>{"v":1,"url":…,"code":…}</code>。</div>
</div>
<div class="card"><h2>已配对设备</h2><table><thead><tr><th>设备</th><th>配对时间</th><th>最近连接</th></tr></thead><tbody id="devices"></tbody></table></div>
<div class="muted">配对码默认 5 分钟有效。固定码会写入 dsh 凭据存储，重启后仍然有效。</div>
</main>
<script>
const BASE=${baseJson};
let timer;
async function refresh(){
  const r=await fetch(BASE+'/admin/data',{credentials:'include',cache:'no-store'});
  if(!r.ok){document.getElementById('code').textContent='登录已失效，请刷新 dsh Web UI';return}
  const d=await r.json();
  document.getElementById('code').textContent=d.formatted;
  document.getElementById('mode').innerHTML=d.fixed?'<span class="warn">固定码</span>':'<span class="ok">一次性码</span>';
  document.getElementById('expiry').textContent=d.fixed?'固定码长期有效，直到你手动恢复一次性码':('过期时间：'+new Date(d.expiresAt).toLocaleString());
  document.getElementById('qr').textContent=d.qr||'（二维码生成失败，使用上面的数字码）';
  document.getElementById('devices').innerHTML=(d.devices||[]).map(x=>'<tr><td>'+esc(x.deviceName)+'<br><span class="muted">'+esc(x.platform||'')+' '+esc(x.deviceId.slice(0,12))+'…</span></td><td>'+new Date(x.pairedAt).toLocaleString()+'</td><td>'+new Date(x.lastSeenAt).toLocaleString()+'</td></tr>').join('')||'<tr><td colspan="3" class="muted">还没有设备</td></tr>';
  clearTimeout(timer); timer=setTimeout(refresh,5000);
}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function act(action){
  const r=await fetch(BASE+'/admin/pair-code',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({action})});
  if(!r.ok){alert((await r.json()).error?.message||'操作失败');return}
  await refresh();
}
async function setFixed(){
  const code=document.getElementById('fixedInput').value.trim();
  if(!code){alert('请输入固定码');return}
  if(!confirm('固定码会一直有效，确定设置？'))return;
  const r=await fetch(BASE+'/admin/pair-code',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({action:'fixed',code})});
  if(!r.ok){alert((await r.json()).error?.message||'操作失败');return}
  document.getElementById('fixedInput').value='';
  await refresh();
}
refresh();
</script></body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character))
}

async function renderQr(text: string): Promise<string | null> {
  try {
    const mod = await import('qrcode-terminal')
    const qrcode = (mod as { default?: unknown }).default ?? mod
    return await new Promise<string>((resolve) => {
      ;(qrcode as { generate(input: string, options: unknown, done: (output: string) => void): void })
        .generate(text, { small: true }, resolve)
    })
  } catch {
    return null
  }
}
