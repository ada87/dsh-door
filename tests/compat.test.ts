import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HostContext } from '../src/host.js'
import { createSessionFacade } from '../src/sessions.js'

const sessionId = 'session-compat'

function context(): HostContext {
  const controller = {
    async list() {
      return {
        items: [{
          sessionId,
          updatedAt: 1,
          running: false,
          agentAvailable: true,
          blank: false,
          cwd: '/home/ubuntu',
        }],
      }
    },
    async projections() {
      return { kind: 'sequenced', asOfSeq: 42, values: { title: 'compat' } }
    },
    async page(request: { throughSeq?: number; beforeSeq?: number; maxMessages?: number; turnWindow?: { minMessages: number; maxMessages?: number } }) {
      // 0.2.1 requires the explicit cut, forbids minMessages > maxMessages,
      // and returns no cursor.
      assert.equal(typeof request.throughSeq, 'number')
      assert.ok((request.turnWindow?.minMessages ?? 0) <= (request.maxMessages ?? 0))
      return { records: [], hasMore: false }
    },
    // No state() at all, mirroring 0.2.1.
  }
  return {
    webServer: { register: () => () => undefined },
    sessionController: controller as never,
    on: () => () => undefined,
    effect: () => () => undefined,
    get: () => undefined,
  } as unknown as HostContext
}

test('0.2.1 compatibility: transcript supplies throughSeq and fills cursor', async () => {
  const facade = createSessionFacade(context())
  const page = await facade.transcript(sessionId, { maxMessages: 10 }, new AbortController().signal)
  assert.equal(page.cursor, 42)
  assert.equal(page.title, 'compat')
})

test('0.2.1 compatibility: state is synthesized without controller.state()', async () => {
  const facade = createSessionFacade(context())
  const value = await facade.state(sessionId, new AbortController().signal)
  assert.equal(value.state.cursor, 42)
  assert.equal(value.state.running, false)
  assert.equal(value.state.active, true)
  assert.equal(value.state.queue, null)
  assert.deepEqual(value.state.pendingInput, [])
})
