import type { HostResponse } from './host.js'
import { startSse, writeSse } from './http.js'
import type { StreamEventName } from './protocol.js'

interface Client {
  id: string
  res: HostResponse
  deviceId: string
  connectedAt: number
}

/** Fan-out of plugin events to every connected app. */
export class SseHub {
  private readonly clients = new Map<string, Client>()
  private readonly deviceClosers = new Map<string, Set<() => void>>()
  private readonly heartbeat: NodeJS.Timeout
  private sequence = 0

  constructor(private readonly onDispose?: () => void) {
    this.heartbeat = setInterval(() => this.broadcast('heartbeat', { time: Date.now() }), 15_000)
    this.heartbeat.unref?.()
  }

  add(id: string, deviceId: string, res: HostResponse): () => void {
    startSse(res)
    const client: Client = { id, res, deviceId, connectedAt: Date.now() }
    this.clients.set(id, client)
    const remove = (): void => {
      this.clients.delete(id)
    }
    res.on('close', remove)
    return remove
  }

  count(): number {
    return this.clients.size
  }

  hasClients(): boolean {
    return this.clients.size > 0
  }

  broadcast(event: StreamEventName, data: unknown): void {
    if (this.clients.size === 0) return
    this.sequence += 1
    const id = String(this.sequence)
    for (const client of this.clients.values()) {
      try {
        writeSse(client.res, event, data, id)
      } catch {
        this.clients.delete(client.id)
      }
    }
  }

  send(clientId: string, event: StreamEventName, data: unknown): void {
    const client = this.clients.get(clientId)
    if (client === undefined) return
    writeSse(client.res, event, data)
  }

  /**
   * Register a cleanup callback for a device's long-lived stream (for example
   * a per-Session SSE follow). Returns an unregister function; the callback
   * runs when the device is revoked.
   */
  trackDevice(deviceId: string, close: () => void): () => void {
    const closers = this.deviceClosers.get(deviceId) ?? new Set<() => void>()
    closers.add(close)
    this.deviceClosers.set(deviceId, closers)
    return () => {
      closers.delete(close)
      if (closers.size === 0 && this.deviceClosers.get(deviceId) === closers) {
        this.deviceClosers.delete(deviceId)
      }
    }
  }

  /**
   * Drop every stream opened with a device token. Called when that device is
   * revoked, so losing a phone actually stops its live feed instead of waiting
   * for the client to disconnect.
   */
  closeDevice(deviceId: string): number {
    let closed = 0
    for (const client of [...this.clients.values()]) {
      if (client.deviceId !== deviceId) continue
      this.clients.delete(client.id)
      try { client.res.end() } catch { /* already gone */ }
      closed += 1
    }
    const closers = [...(this.deviceClosers.get(deviceId) ?? [])]
    this.deviceClosers.delete(deviceId)
    for (const close of closers) {
      try { close() } catch { /* already gone */ }
      closed += 1
    }
    return closed
  }

  dispose(): void {
    clearInterval(this.heartbeat)
    for (const client of this.clients.values()) {
      try { client.res.end() } catch { /* already gone */ }
    }
    this.clients.clear()
    this.onDispose?.()
  }
}
