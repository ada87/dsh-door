import type { Config } from './config.js'
import type { DeviceView } from './devices.js'
import type { HostRequest, HostResponse, WebRoute } from './host.js'
import { shortError } from './util.js'

export interface RouteContext {
  req: HostRequest
  res: HostResponse
  method: string
  pathname: string
  query: URLSearchParams
  params: Record<string, string>
  body: unknown
  device: DeviceView | undefined
  clientAddress: string
  signal: AbortSignal
  /** Authority from the Host header, lowercased. */
  authority: string
}

export interface PublicRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Pattern segments; `:name` captures one segment. */
  pattern: string
  /** Authentication requirement; `public` routes still pass Host/origin checks. */
  auth: 'device' | 'public'
  /** Optional route-specific JSON budget (for example, bounded WAV base64). */
  maxBodyBytes?: number
  handler(context: RouteContext): Promise<void> | void
}

const streamingResponses = new WeakSet<object>()

/** Mark a response as long-lived (SSE) so the router does not end it. */
export function markStreaming(res: HostResponse): void {
  streamingResponses.add(res)
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * Tiny HTTP surface: named routes, exact body limits, a per-address rate limit,
 * a Host/Origin fence, and bearer authentication. It never adds CORS headers,
 * because native clients do not need them and a browser cross-site caller
 * should fail.
 */
export class HttpRouter {
  private readonly routes: PublicRoute[] = []
  private readonly rate = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly config: Config,
    private readonly options: {
      authenticate(token: string): DeviceView | undefined
      isKnownAuthority(authority: string): boolean
      logger: { warn(message: string): void; debug?(message: string): void }
      isLoopbackBindHost?(host: string): boolean
    },
  ) {}

  add(route: PublicRoute): this {
    this.routes.push(route)
    return this
  }

  /** Register one prefix route on the host webserver that delegates here. */
  hostRoute(): WebRoute {
    return {
      kind: 'prefix',
      path: this.config.basePath,
      handler: (req, res) => this.handle(req, res),
    }
  }

  async handle(req: HostRequest, res: HostResponse): Promise<void> {
    const started = Date.now()
    const url = parseUrl(req)
    try {
      if (!url.pathname.startsWith(this.config.basePath)) {
        throw new HttpError(404, 'not-found', 'not found')
      }
      const clientAddress = normalizeAddress(req.socket?.remoteAddress)
      const authority = header(req, 'host')?.toLowerCase() ?? ''
      const origin = header(req, 'origin')
      if (origin !== undefined && !sameOrigin(origin, authority)) {
        throw new HttpError(403, 'origin-refused', 'cross-origin requests are not accepted')
      }
      const pathname = normalizePath(url.pathname.slice(this.config.basePath.length) || '/')
      const lookup = this.match(req.method ?? 'GET', pathname)
      if (lookup === undefined) {
        throw new HttpError(404, 'not-found', `no route for ${req.method ?? 'GET'} ${pathname}`)
      }
      const { route, params } = lookup
      const isPublic = route.auth === 'public' || isHealthRoute(pathname)
      // A pairing request must be allowed through an authority the server has
      // never seen; after it succeeds the authority is recorded.
      const allowNewAuthority = pathname === '/pair'
      this.enforceRate(clientAddress, pathname)
      let device: DeviceView | undefined
      if (route.auth === 'device') {
        // Authenticate before the Host fence. A valid token is the boundary,
        // so an address/tunnel change does not require re-pairing. Set
        // strictHostCheck when a deployment wants the extra authority fence.
        device = this.authenticate(req)
        if (device === undefined) {
          throw new HttpError(401, 'unauthenticated', 'a valid device token is required')
        }
      }
      const authorityAllowed = this.authorityAllowed(authority)
      const tokenCoversAuthority = device !== undefined && !this.config.strictHostCheck
      if (!isPublic && !allowNewAuthority && !authorityAllowed && !tokenCoversAuthority) {
        throw new HttpError(403, 'host-refused', `Host "${authority}" is not allowed; add it to allowedHosts`)
      }
      if (this.config.requireSecure && !isLoopbackAddress(clientAddress) && !isTls(req)) {
        throw new HttpError(426, 'tls-required', 'this deployment requires HTTPS for device traffic')
      }
      // Read the body only after authentication: an anonymous caller cannot
      // spend the body budget or reach JSON parsing.
      const body = await this.readBody(req, route.maxBodyBytes ?? this.config.maxBodyBytes)
      const controller = new AbortController()
      let closed = false
      const onClose = (): void => {
        closed = true
        controller.abort()
      }
      req.on('close', onClose)
      await route.handler({
        req,
        res,
        method: req.method ?? 'GET',
        pathname,
        query: url.searchParams,
        params,
        body,
        device,
        clientAddress,
        signal: controller.signal,
        authority,
      })
      if (!res.writableEnded && !res.destroyed && !closed && !streamingResponses.has(res)) {
        // A handler that returns without ending leaves a hung client; make the
        // failure visible rather than silently holding the socket. This must
        // not run when the handler threw, or it would send a 200 before the
        // error branch can choose the real status.
        res.end()
      }
    } catch (error) {
      // Drain an unread request body so a rejected authenticated POST does not
      // leave the keep-alive socket in a half-consumed state.
      req.resume?.()
      if (res.headersSent) {
        try { res.end() } catch { /* the client is gone */ }
        this.options.logger.warn(`[dsh-door] ${shortError(error)}`)
        return
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: { code: error.code, message: error.message, ...error.details } })
      } else {
        this.options.logger.warn(`[dsh-door] request failed: ${shortError(error)}`)
        sendJson(res, 500, { error: { code: 'internal', message: shortError(error) } })
      }
    } finally {
      this.options.logger.debug?.(`[dsh-door] ${req.method ?? 'GET'} ${url.pathname} ${Date.now() - started}ms`)
    }
  }

  private match(method: string, pathname: string): { route: PublicRoute; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route.method !== method) continue
      const params = matchPattern(route.pattern, pathname)
      if (params !== undefined) return { route, params }
    }
    return undefined
  }

  private authenticate(req: HostRequest): DeviceView | undefined {
    const authorization = header(req, 'authorization')
    if (authorization === undefined) return undefined
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
    if (match === null) return undefined
    return this.options.authenticate(match[1]!)
  }

  private authorityAllowed(authority: string): boolean {
    if (authority === '') return false
    const hostname = authorityHostname(authority)
    if (isLoopbackHostname(hostname)) return true
    if (this.options.isLoopbackBindHost?.(hostname) === true) return true
    if (this.config.allowedHosts.some(allowed => allowed === authority || allowed === hostname)) return true
    return this.options.isKnownAuthority(authority)
  }

  private enforceRate(clientAddress: string, pathname: string): void {
    if (this.config.rateLimitMax <= 0) return
    const now = Date.now()
    const record = this.rate.get(clientAddress)
    if (record === undefined || now >= record.resetAt) {
      this.rate.set(clientAddress, { count: 1, resetAt: now + this.config.rateLimitWindowMs })
      return
    }
    record.count += 1
    if (record.count > this.config.rateLimitMax) {
      throw new HttpError(429, 'rate-limited', 'too many requests; retry later', {
        retryAfterMs: Math.max(0, record.resetAt - now),
      })
    }
    if (pathname === '/pair') return
  }

  private async readBody(req: HostRequest, maxBodyBytes: number): Promise<unknown> {
    const method = req.method ?? 'GET'
    if (method === 'GET' || method === 'HEAD') return undefined
    const chunks: Buffer[] = []
    let total = 0
    const stream = req as unknown as AsyncIterable<Buffer | string>
    if (typeof (stream as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function') {
      return undefined
    }
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > maxBodyBytes) {
        throw new HttpError(413, 'body-too-large', `request body exceeds ${maxBodyBytes} bytes`)
      }
      chunks.push(buffer)
    }
    if (total === 0) return undefined
    const text = Buffer.concat(chunks).toString('utf8')
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new HttpError(400, 'bad-json', 'request body is not valid JSON')
    }
  }
}

export function sendJson(res: HostResponse, status: number, value: unknown): void {
  if (res.writableEnded) return
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.writeHead(status, { 'Content-Length': String(Buffer.byteLength(body)) })
  res.end(body)
}

export function sendNoContent(res: HostResponse, status = 204): void {
  if (res.writableEnded) return
  res.writeHead(status)
  res.end()
}

export function startSse(res: HostResponse, extraHeaders: Record<string, string> = {}): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value)
  res.writeHead(200)
  res.flushHeaders?.()
}

export function writeSse(res: HostResponse, event: string, data: unknown, id?: string): void {
  if (res.writableEnded || res.destroyed === true) return
  let frame = ''
  if (id !== undefined) frame += `id: ${id}\n`
  frame += `event: ${event}\n`
  frame += `data: ${JSON.stringify(data)}\n\n`
  res.write(frame)
}

export function header(req: HostRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

export function bearerDevice(): void {
  // Marker for documentation; authentication lives on HttpRouter.
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, '')
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost' || normalized.startsWith('127.')
}

export function normalizeAddress(address: string | undefined): string {
  return (address ?? 'unknown').replace(/^::ffff:/, '')
}

export function parseUrl(req: HostRequest): URL {
  const raw = req.url ?? '/'
  try {
    return new URL(raw, 'http://placeholder')
  } catch {
    throw new HttpError(400, 'bad-url', 'malformed request URL')
  }
}

function normalizePath(path: string): string {
  if (path.length === 0) return '/'
  const withLeading = path.startsWith('/') ? path : `/${path}`
  return withLeading.length > 1 ? withLeading.replace(/\/+$/, '') : withLeading
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | undefined {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return undefined
  const params: Record<string, string> = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]!
    const actual = pathParts[index]!
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual)
    } else if (expected !== actual) {
      return undefined
    }
  }
  return params
}

function isHealthRoute(pathname: string): boolean {
  return pathname === '/health'
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname.startsWith('127.')
}

function authorityHostname(authority: string): string {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    return end === -1 ? authority : authority.slice(0, end + 1)
  }
  const colon = authority.lastIndexOf(':')
  return colon === -1 ? authority : authority.slice(0, colon)
}

function sameOrigin(origin: string, authority: string): boolean {
  try {
    const parsed = new URL(origin)
    return parsed.host.toLowerCase() === authority
  } catch {
    return false
  }
}

function isTls(req: HostRequest): boolean {
  // Only the socket's own TLS state counts. A forwarded header is caller
  // controlled and must not be able to satisfy requireSecure.
  const socket = req.socket as { encrypted?: boolean } | undefined
  return socket?.encrypted === true
}
