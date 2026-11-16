import assert from 'node:assert/strict'
import test from 'node:test'
import { parseReadState, tagReadService, type ReadStateMap } from '../src/read-state.js'
import type { HostContext } from '../src/host.js'

function ctxWith(service: unknown): HostContext {
  return {
    get: (name: string) => (name === 'dsh-tag' ? service : undefined),
  } as unknown as HostContext
}

test('tagReadService ignores a missing or partial service', () => {
  assert.equal(tagReadService(ctxWith(undefined)), undefined)
  assert.equal(tagReadService(ctxWith({ reads: () => ({}) })), undefined)
  assert.equal(tagReadService(ctxWith('dsh-tag')), undefined)
  const ctx = {
    get: () => {
      throw new Error('service unavailable')
    },
  } as unknown as HostContext
  assert.equal(tagReadService(ctx), undefined)
})

test('tagReadService forwards reads and merges to dsh-tag', async () => {
  const entries: ReadStateMap = { a: { readAt: 0, unread: true, at: 10 } }
  const service = {
    reads: () => ({ ...entries }),
    mergeReads: (input: unknown) => {
      for (const [id, entry] of Object.entries(input as ReadStateMap)) {
        if ((entries[id]?.at ?? -1) < entry.at) entries[id] = entry
      }
      return { ...entries }
    },
  }
  const tag = tagReadService(ctxWith(service))
  assert.notEqual(tag, undefined)
  assert.deepEqual(tag!.reads(), entries)
  const merged = await tag!.mergeReads(parseReadState({ b: { readAt: 5, unread: false, at: 20 } }))
  assert.deepEqual(merged, {
    a: { readAt: 0, unread: true, at: 10 },
    b: { readAt: 5, unread: false, at: 20 },
  })
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
