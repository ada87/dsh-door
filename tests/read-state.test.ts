import assert from 'node:assert/strict'
import test from 'node:test'
import { parseReadState, ReadStateStore } from '../src/read-state.js'
import type { CredentialProviderService } from '../src/host.js'

function fakeCredentials(): CredentialProviderService & { records: Map<string, { kind: string; payload?: unknown }> } {
  const records = new Map<string, { kind: string; payload?: unknown }>()
  return {
    records,
    async readRecord(key: unknown) {
      return records.get(String(key))
    },
    async modifyRecord(key: unknown, mutate: (current: { kind: string; payload?: unknown } | undefined) => Promise<{ kind: string; payload?: unknown } | undefined>) {
      const next = await mutate(records.get(String(key)))
      if (next !== undefined) records.set(String(key), next)
      return next
    },
    async deleteRecord(key: unknown) {
      records.delete(String(key))
    },
  }
}

test('read state merges the newest entry and ignores stale devices', async () => {
  const credentials = fakeCredentials()
  const store = new ReadStateStore(credentials)
  await store.load()

  const merged = await store.merge({
    a: { readAt: 100, unread: false, at: 100 },
    b: { readAt: 0, unread: true, at: 200 },
  })
  assert.equal(merged.a?.readAt, 100)
  assert.equal(merged.b?.unread, true)

  const later = await store.merge({
    a: { readAt: 50, unread: false, at: 50 },
    b: { readAt: 300, unread: false, at: 300 },
  })
  assert.equal(later.a?.readAt, 100, 'an older device must not roll back a read marker')
  assert.deepEqual(later.b, { readAt: 300, unread: false, at: 300 }, 'the newer read clears the unread flag')
})

test('read state survives a Host restart through the credential store', async () => {
  const credentials = fakeCredentials()
  const first = new ReadStateStore(credentials)
  await first.load()
  await first.merge({ a: { readAt: 0, unread: true, at: 10 } })

  const second = new ReadStateStore(credentials)
  await second.load()
  assert.deepEqual(second.snapshot(), { a: { readAt: 0, unread: true, at: 10 } })
})

test('read state clamps a client clock that runs far ahead', async () => {
  const store = new ReadStateStore(undefined)
  await store.load()
  const merged = await store.merge({ a: { readAt: 0, unread: true, at: Date.now() + 10 * 60_000 } })
  assert.ok((merged.a?.at ?? 0) < Date.now() + 2 * 60_000)
})

test('parseReadState drops malformed entries', () => {
  assert.equal(parseReadState('nope'), undefined)
  assert.equal(parseReadState([]), undefined)
  const parsed = parseReadState({
    good: { readAt: 5, unread: true, at: 6 },
    missingAt: { readAt: 5, unread: true },
    negative: { readAt: -1, unread: false, at: 6 },
    junk: 'x',
  })
  assert.deepEqual(parsed, { good: { readAt: 5, unread: true, at: 6 } })
})
