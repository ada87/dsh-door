import { createPrivateKey, createSign, sign as cryptoSign } from 'node:crypto'
import { connect } from 'node:http2'
import type { Config, PushConfig } from './config.js'
import type { CredentialProviderService } from './host.js'
import type { DeviceStore } from './devices.js'
import { shortError } from './util.js'

export interface PushPayload {
  title: string
  body: string
  data: Record<string, string>
}

/**
 * Direct APNs/FCM sender. There is no relay: credentials come from the
 * deployment's own service account or APNs key, so the plugin author never
 * sees user sessions.
 */
export class PushManager {
  private fcmToken: { value: string; expiresAt: number } | undefined
  private apnsToken: { value: string; createdAt: number } | undefined
  private remote: Partial<PushConfig> = {}

  constructor(
    private readonly config: Config,
    private readonly devices: DeviceStore,
    private readonly logger: { info(message: string): void; warn(message: string): void },
    private readonly credentials?: CredentialProviderService,
  ) {}

  /**
   * Prefer a `dsh-mobile/push` credential record over configuration. Push
   * service-account JSON and APNs keys are secrets, so a deployment that
   * keeps them in the credential store never writes them into cordis.yml.
   */
  async load(): Promise<void> {
    if (this.credentials === undefined) return
    try {
      const record = await this.credentials.readRecord('dsh-mobile/push' as unknown)
      const payload = record?.payload
      if (typeof payload === 'object' && payload !== null) this.remote = payload as Partial<PushConfig>
    } catch (error) {
      this.logger.warn(`[dsh-door] could not read push credentials: ${shortError(error)}`)
    }
  }

  private get push(): PushConfig {
    return { ...this.config.push, ...this.remote }
  }

  isConfigured(): boolean {
    const push = this.push
    if (push.provider === 'fcm') return typeof push.fcmServiceAccountJson === 'string' && push.fcmServiceAccountJson.length > 0
    if (push.provider === 'apns') {
      return typeof push.apnsKey === 'string' && typeof push.apnsKeyId === 'string' && typeof push.apnsTeamId === 'string' && typeof push.apnsTopic === 'string'
    }
    return false
  }

  notify(kind: 'approval' | 'question' | 'turn-end', payload: unknown): void {
    if (!this.isConfigured()) return
    const push = this.push
    if (kind === 'approval' && !push.notifyApproval) return
    if (kind === 'question' && !push.notifyQuestion) return
    if (kind === 'turn-end' && !push.notifyTurnEnd) return
    const message = render(kind, payload)
    void this.send(message).catch((error: unknown) => {
      this.logger.warn(`[dsh-door] push failed: ${shortError(error)}`)
    })
  }

  private async send(message: PushPayload): Promise<void> {
    if (this.push.provider === 'fcm') {
      const targets = this.devices.pushTargets('fcm')
      await Promise.all(targets.map(target => this.sendFcm(target.token, message)))
      return
    }
    if (this.push.provider === 'apns') {
      const targets = this.devices.pushTargets('apns')
      await Promise.all(targets.map(target => this.sendApns(target.token, message)))
    }
  }

  private async sendFcm(token: string, message: PushPayload): Promise<void> {
    const serviceAccount = parseServiceAccount(this.push.fcmServiceAccountJson)
    const accessToken = await this.fcmAccessToken(serviceAccount)
    const projectId = this.push.fcmProjectId ?? serviceAccount.project_id
    if (projectId === undefined) throw new Error('FCM project id is missing')
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: message.data,
          android: { priority: 'high' },
        },
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`FCM ${response.status}: ${text.slice(0, 300)}`)
    }
  }

  private async fcmAccessToken(account: ServiceAccount): Promise<string> {
    if (this.fcmToken !== undefined && Date.now() < this.fcmToken.expiresAt) return this.fcmToken.value
    const now = Math.floor(Date.now() / 1000)
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = base64url(JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }))
    const signer = createSign('RSA-SHA256')
    signer.update(`${header}.${claims}`)
    signer.end()
    const assertion = `${header}.${claims}.${signer.sign(account.private_key).toString('base64url')}`
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`FCM token ${response.status}: ${text.slice(0, 300)}`)
    }
    const value = await response.json() as { access_token?: string; expires_in?: number }
    if (typeof value.access_token !== 'string') throw new Error('FCM token response has no access_token')
    this.fcmToken = { value: value.access_token, expiresAt: Date.now() + Math.max(60, (value.expires_in ?? 3600) - 60) * 1000 }
    return value.access_token
  }

  private async sendApns(token: string, message: PushPayload): Promise<void> {
    const push = this.push
    const jwt = this.apnsJwt()
    const host = push.apnsEnvironment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'
    const client = connect(host)
    try {
      await new Promise<void>((resolve, reject) => {
        const request = client.request({
          ':method': 'POST',
          ':path': `/3/device/${encodeURIComponent(token)}`,
          authorization: `bearer ${jwt}`,
          'apns-topic': push.apnsTopic!,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'content-type': 'application/json',
        })
        let status = 0
        let body = ''
        request.on('response', (headers) => {
          status = Number(headers[':status'] ?? 0)
        })
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => { body += chunk })
        request.on('end', () => {
          if (status >= 200 && status < 300) resolve()
          else reject(new Error(`APNs ${status}: ${body.slice(0, 300)}`))
        })
        request.on('error', reject)
        request.end(JSON.stringify({
          aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
          ...message.data,
        }))
      })
    } finally {
      client.close()
    }
  }

  private apnsJwt(): string {
    if (this.apnsToken !== undefined && Date.now() - this.apnsToken.createdAt < 50 * 60 * 1000) return this.apnsToken.value
    const push = this.push
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: push.apnsKeyId }))
    const claims = base64url(JSON.stringify({ iss: push.apnsTeamId, iat: Math.floor(Date.now() / 1000) }))
    const key = createPrivateKey(push.apnsKey!)
    const signature = cryptoSign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' })
    const value = `${header}.${claims}.${signature.toString('base64url')}`
    this.apnsToken = { value, createdAt: Date.now() }
    return value
  }
}

interface ServiceAccount {
  project_id?: string
  client_email: string
  private_key: string
}

function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (raw === undefined) throw new Error('FCM service account JSON is missing')
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('FCM service account JSON must carry client_email and private_key')
  }
  return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function render(kind: 'approval' | 'question' | 'turn-end', payload: unknown): PushPayload {
  if (kind === 'approval') {
    const item = payload as { id?: string; toolName?: string; reason?: string; displayReason?: { en?: string } }
    const reason = item.displayReason?.en ?? item.reason ?? ''
    return {
      title: 'dsh needs approval',
      body: reason.length > 0 ? `${item.toolName ?? 'tool'}: ${reason}` : `Tool call: ${item.toolName ?? 'unknown'}`,
      data: { kind, approvalId: item.id ?? '', toolName: item.toolName ?? '' },
    }
  }
  if (kind === 'question') {
    const item = payload as { id?: string; sessionId?: string; questions?: Array<{ question?: string }> }
    return {
      title: 'dsh asks a question',
      body: truncate(item.questions?.[0]?.question ?? 'Open the app to answer', 160),
      data: { kind, questionId: item.id ?? '', sessionId: item.sessionId ?? '' },
    }
  }
  const item = payload as { sessionId?: string; title?: string }
  return {
    title: 'dsh finished',
    body: item.title ?? 'The agent finished its turn',
    data: { kind, sessionId: item.sessionId ?? '' },
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

