import assert from 'node:assert/strict'
import { PushManager } from '../src/push.js'
import { normalizeConfig } from '../src/config.js'
import type { DeviceStore, PushKind } from '../src/devices.js'

const originalFetch = globalThis.fetch
const calls: Array<{ init?: RequestInit }> = []
let subscribed = true
const devices = {
  pushDevices(kind: PushKind) {
    return subscribed ? [{ deviceId: 'device-a', provider: 'fcm' as const, token: 'token', updatedAt: 1 }] : []
  },
} as unknown as DeviceStore

globalThis.fetch = async (_input, init) => {
  calls.push({ init })
  return new Response('{"accepted":true,"delivered":1}', { status: 202 })
}

try {
  const config = normalizeConfig()
  config.push = {
    ...config.push,
    provider: 'relay',
    relayUrl: 'https://relay.example.com',
    relayHostToken: 'host-token',
  }
  const manager = new PushManager(config, devices, { info() {}, warn() {} }, undefined, 'plugin:http://localhost')

  manager.notify('turn-end', { sessionId: 'session-a', title: 'First', eventId: 'turn-1' })
  manager.notify('turn-end', { sessionId: 'session-a', title: 'Second', eventId: 'turn-2' })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(calls.length, 2, 'two turns in one session both reach the relay')
  const keys = calls.map(call => new Headers(call.init?.headers).get('idempotency-key'))
  assert.deepEqual(keys, ['turn-end:turn-1', 'turn-end:turn-2'])
  const firstBody = JSON.parse(String(calls[0]?.init?.body)) as { deviceIds: string[]; data: Record<string, string> }
  assert.deepEqual(firstBody.deviceIds, ['device-a'])
  assert.equal(firstBody.data.eventId, 'turn-1')
  assert.equal(firstBody.data.hostId, 'plugin:http://localhost')

  subscribed = false
  manager.notify('turn-end', { sessionId: 'session-a', title: 'Muted', eventId: 'turn-3' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 2, 'an unsubscribed device produces no relay request')

  console.log('push subscriptions and per-turn idempotency: ok')
} finally {
  globalThis.fetch = originalFetch
}
