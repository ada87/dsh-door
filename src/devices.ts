import type { CredentialProviderService, HostContext } from './host.js'
import { fingerprint, safeEqual, sha256 } from './util.js'

/** Credential record key owned by this plugin. */
const DEVICE_RECORD_KEY = 'dsh-door/devices' as unknown

export type PushKind = 'approval' | 'question' | 'turn-end'

export interface PushSubscriptions {
  approval: boolean
  question: boolean
  turnEnd: boolean
}

export const DEFAULT_PUSH_SUBSCRIPTIONS: PushSubscriptions = {
  approval: true,
  question: true,
  turnEnd: true,
}

export interface DevicePushRegistration {
  provider: 'fcm' | 'apns'
  token: string
  updatedAt: number
}

export interface DevicePushTarget extends DevicePushRegistration {
  deviceId: string
}

interface StoredDevice {
  deviceId: string
  tokenHash: string
  deviceName: string
  platform?: string
  appVersion?: string
  pairedAt: number
  lastSeenAt: number
  authorities: string[]
  subscriptions?: PushSubscriptions
  push?: DevicePushRegistration
}

interface DeviceFile {
  version: 1
  devices: StoredDevice[]
}

/** Public device view used by the app; never includes the token hash. */
export interface DeviceView {
  deviceId: string
  deviceName: string
  platform?: string
  appVersion?: string
  pairedAt: number
  lastSeenAt: number
  authorities: string[]
  subscriptions: PushSubscriptions
  push?: DevicePushRegistration
}

/**
 * Durable device registry. Records live in the dsh credential store as one
 * owner-scoped grant record, so device tokens never enter configuration files
 * and survive a Host restart.
 */
export class DeviceStore {
  private readonly devices = new Map<string, StoredDevice>()
  private readonly byTokenHash = new Map<string, StoredDevice>()
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly ctx: HostContext,
    private readonly credentials: CredentialProviderService | undefined,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return
    if (this.credentials === undefined) {
      throw new Error(
        'dsh-door: this deployment composes no credential store. ' +
        'Load @deepseek-ai/dsh-credentials-local so paired devices can be stored durably.',
      )
    }
    const record = await this.credentials.readRecord(DEVICE_RECORD_KEY)
    const payload = record?.payload
    if (isDeviceFile(payload)) {
      for (const device of payload.devices) this.remember(device)
    }
    this.loaded = true
  }

  list(): DeviceView[] {
    return [...this.devices.values()]
      .sort((a, b) => b.pairedAt - a.pairedAt)
      .map(toView)
  }

  count(): number {
    return this.devices.size
  }

  findById(deviceId: string): DeviceView | undefined {
    const device = this.devices.get(deviceId)
    return device === undefined ? undefined : toView(device)
  }

  /** Resolve a bearer token to its device and update last-seen time. */
  authenticate(token: string): DeviceView | undefined {
    const hash = sha256(token)
    const device = this.byTokenHash.get(hash)
    if (device === undefined) return undefined
    if (!safeEqual(device.tokenHash, hash)) return undefined
    const now = Date.now()
    const stale = now - device.lastSeenAt > 5 * 60 * 1000
    device.lastSeenAt = now
    // last-seen is a hint, not a per-request audit record; persist at most
    // once per five minutes per device to avoid rewriting the credential file
    // on every poll.
    if (stale) this.schedulePersist()
    return toView(device)
  }

  async pair(input: {
    token: string
    deviceName: string
    devicePublicKey?: string
    platform?: string
    appVersion?: string
    authority: string
  }): Promise<DeviceView> {
    const deviceId = input.devicePublicKey === undefined
      ? fingerprint(input.token)
      : fingerprint(input.devicePublicKey)
    const existing = this.devices.get(deviceId)
    const now = Date.now()
    if (existing !== undefined) {
      existing.tokenHash = sha256(input.token)
      existing.deviceName = input.deviceName
      if (input.platform === undefined) delete existing.platform
      else existing.platform = input.platform
      if (input.appVersion === undefined) delete existing.appVersion
      else existing.appVersion = input.appVersion
      existing.lastSeenAt = now
      existing.authorities = unique([...existing.authorities, input.authority])
      this.byTokenHash.set(existing.tokenHash, existing)
      await this.persist()
      return toView(existing)
    }
    const device: StoredDevice = {
      deviceId,
      tokenHash: sha256(input.token),
      deviceName: input.deviceName,
      ...(input.platform === undefined ? {} : { platform: input.platform }),
      ...(input.appVersion === undefined ? {} : { appVersion: input.appVersion }),
      pairedAt: now,
      lastSeenAt: now,
      authorities: [input.authority],
    }
    this.remember(device)
    await this.persist()
    return toView(device)
  }

  async addAuthority(deviceId: string, authority: string): Promise<void> {
    const device = this.devices.get(deviceId)
    if (device === undefined) return
    if (!device.authorities.includes(authority)) {
      device.authorities = [...device.authorities, authority]
      await this.persist()
    }
  }

  async revoke(deviceId: string): Promise<boolean> {
    const device = this.devices.get(deviceId)
    if (device === undefined) return false
    this.devices.delete(deviceId)
    this.byTokenHash.delete(device.tokenHash)
    await this.persist()
    return true
  }

  async setPush(deviceId: string, push: DevicePushRegistration): Promise<boolean> {
    const device = this.devices.get(deviceId)
    if (device === undefined) return false
    device.push = push
    await this.persist()
    return true
  }

  async setSubscriptions(deviceId: string, subscriptions: PushSubscriptions): Promise<boolean> {
    const device = this.devices.get(deviceId)
    if (device === undefined) return false
    device.subscriptions = { ...subscriptions }
    await this.persist()
    return true
  }

  async clearPush(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId)
    if (device === undefined) return
    delete device.push
    await this.persist()
  }

  /** Registered devices that opted into this notification kind. */
  pushDevices(kind: PushKind): DevicePushTarget[] {
    return [...this.devices.values()]
      .filter(device => device.push !== undefined && subscriptionsOf(device)[subscriptionKey(kind)])
      .map(device => ({ ...device.push!, deviceId: device.deviceId }))
  }

  /** Devices that carry an outbound push registration for one provider. */
  pushTargets(provider: 'fcm' | 'apns', kind: PushKind): DevicePushRegistration[] {
    return this.pushDevices(kind).filter(push => push.provider === provider)
  }

  private remember(device: StoredDevice): void {
    this.devices.set(device.deviceId, device)
    this.byTokenHash.set(device.tokenHash, device)
  }

  private schedulePersist(): void {
    // lastSeenAt is best effort; a failed write must not fail an otherwise
    // authenticated request.
    void this.persist().catch(() => undefined)
  }

  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        if (this.credentials === undefined) return
        const file: DeviceFile = { version: 1, devices: [...this.devices.values()] }
        await this.credentials.modifyRecord(DEVICE_RECORD_KEY, async () => ({
          kind: 'grant',
          payload: file,
        }))
      })
    return this.writeQueue
  }
}

function isDeviceFile(value: unknown): value is DeviceFile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DeviceFile>
  return candidate.version === 1 && Array.isArray(candidate.devices)
}

function subscriptionsOf(device: StoredDevice): PushSubscriptions {
  return { ...DEFAULT_PUSH_SUBSCRIPTIONS, ...device.subscriptions }
}

function subscriptionKey(kind: PushKind): keyof PushSubscriptions {
  return kind === 'turn-end' ? 'turnEnd' : kind
}

function toView(device: StoredDevice): DeviceView {
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    platform: device.platform,
    appVersion: device.appVersion,
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
    authorities: [...device.authorities],
    subscriptions: subscriptionsOf(device),
    push: device.push,
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
