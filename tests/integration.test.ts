import assert from 'node:assert/strict'
import { createServer, request as createServerRequest, type Server } from 'node:http'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { test, before, after } from 'node:test'
import { apply } from '../src/index.js'
import type { HostContext } from '../src/host.js'

interface FakeDeviceRecord {
  kind: 'grant'
  payload: unknown
}

interface FakeCtx extends HostContext {
  emit(event: string, ...args: unknown[]): void
  waterfall(event: string, ...args: unknown[]): Promise<unknown>
  disposers: Array<() => void>
  browserLive: boolean
  listenerCount(event: string): number
}

interface FakeState {
  ctx: FakeCtx
  server: Server
  base: string
  token?: string
  records: Map<unknown, FakeDeviceRecord>
  terminals: TerminalCapture[]
}

interface TerminalCapture {
  spec: { argv: readonly string[]; cwd: string; cols: number; rows: number }
  writes: string[]
  sizes: Array<[number, number]>
  output: PassThrough
  terminated: boolean
  finish(): void
}

const sessionId = 'session-test'
const record = {
  type: 'event',
  event: {
    type: 'user/message',
    seq: 0,
    time: 1,
    data: {
      id: 'message-1',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'hello from the test' }],
    },
  },
} as const

let state: FakeState

before(async () => {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const records = new Map<unknown, FakeDeviceRecord>()
  const terminals: TerminalCapture[] = []
  let routeHandler: ((req: unknown, res: unknown) => unknown) | undefined
  let origin = ''

  const ctx = {
    browserLive: false,
    disposers: [] as Array<() => void>,
    webServer: {
      register(route: { handler: (req: unknown, res: unknown) => unknown }) {
        routeHandler = route.handler
        return () => { routeHandler = undefined }
      },
      get host() { return '127.0.0.1' },
      get port() { return Number(new URL(origin).port) },
      get protocol() { return 'http:' as const },
      getOrigin() { return origin },
    },
    sessionController: {
      async list() {
        return {
          items: [{
            sessionId,
            updatedAt: 123,
            running: false,
            agentAvailable: true,
            blank: false,
            cwd: 'D:\\work',
            formatStatus: 'current' as const,
          }],
        }
      },
      async create() { return { sessionId: 'session-created' } },
      async rename() { return { title: 'Renamed', seq: 4 } },
      async page() {
        return { records: [record], hasMore: false, cursor: 0 }
      },
      async state() {
        return { cursor: 0, active: true, running: false, queue: [], pendingInput: [] }
      },
      async projections() {
        return {
          kind: 'sequenced' as const,
          asOfSeq: 0,
          values: {
            title: 'Test session',
            todos: [{ content: 'do the thing', status: 'in_progress' }],
            goal: null,
            plan: { active: false, pending: false },
            contextPressure: { projectedTokens: 50_000, contextWindow: 200_000 },
            tokenUsage: { outputTokens: 1234 },
            sessionStats: { turns: 3 },
            modelSelection: { lastUsed: { provider: 'test', model: 'model-a' } },
          },
        }
      },
      async *follow(_input?: unknown, signal?: AbortSignal) {
        yield {
          type: 'snapshot' as const,
          header: { version: 4, id: sessionId, createdAt: 1, isSeeded: false, cwd: 'D:\\work' },
          cursor: 0,
          records: [record],
          hasMore: false,
          projections: { asOfSeq: 0, values: { title: 'Test session' } },
        }
        // Stay open like a real follow until the consumer aborts it.
        await new Promise<void>(resolve => {
          if (signal?.aborted === true) {
            resolve()
            return
          }
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      async prompt() { return { accepted: true as const } },
      cancel() { return { accepted: true as const } },
      async updateQueue() { return { accepted: true as const } },
      async resolveAgent() { return { agent: { id: sessionId } } },
    },
    credentials: {
      async readRecord(key: unknown) { return records.get(key) },
      async modifyRecord(key: unknown, mutate: (current: FakeDeviceRecord | undefined) => Promise<FakeDeviceRecord | undefined>) {
        const next = await mutate(records.get(key))
        if (next !== undefined) records.set(key, next)
        return next
      },
      async deleteRecord(key: unknown) { records.delete(key) },
    },
    userQuestions: {
      answer() { return true },
    },
    typertGateway: {
      hasLiveClient() { return ctx.browserLive },
    },
    subprocess: {
      async terminalEnvironment() {
        return { platform: 'posix' as const, defaultShell: '/bin/sh' }
      },
      async resolveExecutable(command: string) {
        return command
      },
      async spawnTerminal(spec: { argv: readonly string[]; cwd: string; cols: number; rows: number }) {
        const output = new PassThrough()
        const capture: TerminalCapture = {
          spec,
          writes: [],
          sizes: [],
          output,
          terminated: false,
          finish: () => undefined,
        }
        terminals.push(capture)
        return {
          pid: 4242,
          output,
          done: new Promise<{ exitCode: number | null; signal: null }>(resolve => {
            capture.finish = () => resolve({ exitCode: 0, signal: null })
          }),
          async write(data: string) { capture.writes.push(data) },
          async resize(cols: number, rows: number) { capture.sizes.push([cols, rows]) },
          async terminate() {
            capture.terminated = true
            output.end()
            capture.finish()
          },
        }
      },
    },
    on(event: string, listener: (...args: unknown[]) => unknown) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {
        listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener))
      }
    },
    effect(setup: () => (() => void) | void) {
      const dispose = setup()
      if (typeof dispose === 'function') ctx.disposers.push(dispose)
      return () => dispose?.()
    },
    get(name: string) {
      return (ctx as unknown as Record<string, unknown>)[name]
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
    },
    async waterfall(event: string, ...args: unknown[]) {
      const chain = [...(listeners.get(event) ?? [])]
      const terminal = args.pop() as () => Promise<unknown>
      const dispatch = async (index: number): Promise<unknown> => {
        if (index >= chain.length) return terminal()
        const listener = chain[index]!
        return listener(...args, () => dispatch(index + 1))
      }
      return dispatch(0)
    },
    listenerCount(event: string) {
      return listeners.get(event)?.length ?? 0
    },
  }

  await apply(ctx as unknown as HostContext, {
    basePath: '/dsh-mobile',
    allowedHosts: [],
    requireSecure: false,
    // The integration suite exercises the stricter opt-in fence. Production
    // defaults to trusting a valid token across address/tunnel changes.
    strictHostCheck: true,
    pairingTtlMs: 60_000,
    pairingCodeLength: 8,
    pairingMaxAttempts: 8,
    logPairingCode: false,
    approvalWaitTimeoutMs: 5000,
    questionWaitTimeoutMs: 5000,
    allowSessionWideGrants: true,
    enableDebugRoutes: true,
    maxBodyBytes: 1024,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 1000,
    dshVersionRange: '*',
    push: {
      provider: 'none',
      apnsEnvironment: 'production',
      notifyTurnEnd: true,
      notifyApproval: true,
      notifyQuestion: true,
    },
  })

  assert.ok(ctx.listenerCount('approval/request') === 1, 'approval listener registered')
  assert.ok(ctx.listenerCount('user-questions/request') === 1, 'question listener registered')

  const server = createServer((req, res) => {
    assert.ok(routeHandler !== undefined, 'the plugin registered a route')
    void Promise.resolve(routeHandler(req, res)).catch((error: unknown) => {
      res.statusCode = 500
      res.end(String(error))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  origin = `http://127.0.0.1:${address.port}`
  state = { ctx: ctx as unknown as FakeCtx, server, base: `${origin}/dsh-mobile`, records, terminals }
})

after(async () => {
  state.server.closeAllConnections()
  await new Promise<void>((resolve) => state.server.close(() => resolve()))
  for (const dispose of state.ctx.disposers.reverse()) dispose()
})

test('health is public and reports the plugin facts', async () => {
  const response = await fetch(`${state.base}/health`)
  assert.equal(response.status, 200)
  const body = await response.json() as { ok: boolean; features: { sessionEvents: string; debugRoutes: boolean; terminal: boolean }; deviceCount: number }
  assert.equal(body.ok, true)
  assert.equal(body.features.sessionEvents, 'sse')
  assert.equal(body.features.debugRoutes, true)
  assert.equal(body.features.terminal, true)
  assert.equal(body.deviceCount, 0)
})

test('a code pairs once, then the same code is refused', async () => {
  const codeResponse = await fetch(`${state.base}/pair/code`)
  assert.equal(codeResponse.status, 200)
  const code = await codeResponse.json() as { code: string; formatted: string }
  assert.equal(code.formatted.length, 9)

  const pairBody = JSON.stringify({
    code: code.code,
    deviceName: 'Test phone',
    platform: 'android',
    appVersion: '0.1.0',
    devicePublicKey: 'test-device-public-key',
  })
  const paired = await fetch(`${state.base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: pairBody,
  })
  assert.equal(paired.status, 201)
  const pair = await paired.json() as { token: string; deviceId: string }
  assert.match(pair.token, /^dshm_/)
  assert.equal(pair.deviceId.length, 32)
  state.token = pair.token

  const reused = await fetch(`${state.base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: pairBody,
  })
  assert.equal(reused.status, 401)
  const error = await reused.json() as { error: { code: string } }
  assert.equal(error.error.code, 'pair-invalid')

  // The credential record must be plain JSON: dsh's credential seam rejects a
  // payload carrying `undefined` values, which is easy to introduce with
  // optional device fields.
  const record = [...state.records.values()][0]
  assert.ok(record !== undefined)
  const roundTripped = JSON.parse(JSON.stringify(record.payload)) as unknown
  assert.deepEqual(roundTripped, record.payload)
})

test('session endpoints require the device token and project dsh data', async () => {
  assert.equal((await fetch(`${state.base}/sessions`)).status, 401)

  const headers = { authorization: `Bearer ${state.token}` }
  const list = await fetch(`${state.base}/sessions`, { headers })
  assert.equal(list.status, 200)
  const listBody = await list.json() as {
    items: Array<{
      id: string
      title: string
      cwd: string
      vitals?: {
        contextTokens: number | null
        contextWindow: number | null
        contextPercent: number | null
        outputTokens: number | null
        turns: number | null
        todoDone: number | null
        todoTotal: number | null
        goalPhase: string | null
        model: string | null
        planActive: boolean
      }
    }>
  }
  assert.equal(listBody.items[0]?.id, sessionId)
  assert.equal(listBody.items[0]?.title, 'Test session')
  assert.equal(listBody.items[0]?.cwd, 'D:\\work')
  assert.deepEqual(listBody.items[0]?.vitals, {
    contextTokens: 50_000,
    contextWindow: 200_000,
    contextPercent: 25,
    outputTokens: 1234,
    turns: 3,
    todoDone: 0,
    todoTotal: 1,
    goalPhase: null,
    planActive: false,
    model: 'test/model-a',
  })

  const transcript = await fetch(`${state.base}/sessions/${sessionId}/transcript`, { headers })
  const transcriptBody = await transcript.json() as { records: unknown[]; projections: { todos: unknown[] } }
  assert.equal(transcriptBody.records.length, 1)
  assert.equal(transcriptBody.projections.todos.length, 1)

  const sessionState = await fetch(`${state.base}/sessions/${sessionId}/state`, { headers })
  assert.equal(sessionState.status, 200)
  const stateBody = await sessionState.json() as { state: { running: boolean } }
  assert.equal(stateBody.state.running, false)
})

test('terminal routes create a PTY, stream output, take input and close it', async () => {
  const headers = { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' }
  const created = await fetch(`${state.base}/sessions/${sessionId}/terminals`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cols: 90, rows: 24 }),
  })
  assert.equal(created.status, 201)
  const createdBody = await created.json() as {
    info: { id: string; shell: string; cwd: string; pid: number; cols: number; rows: number }
    buffer: string
  }
  assert.equal(createdBody.info.shell, '/bin/sh')
  assert.equal(createdBody.info.cwd, 'D:\\work')
  assert.equal(createdBody.info.cols, 90)
  assert.equal(createdBody.info.pid, 4242)
  assert.equal(createdBody.buffer, '')

  const capture = state.terminals.at(-1)
  assert.ok(capture !== undefined)
  assert.deepEqual(capture.spec.argv, ['/bin/sh'])
  assert.equal(capture.spec.cwd, 'D:\\work')

  const events = await openSse(state, state.token, `/sessions/${sessionId}/terminals/${createdBody.info.id}/events`)
  try {
    await events.waitFor('ready')
    capture.output.write('hello from the pty\n')
    await events.waitFor('hello from the pty')

    const input = await fetch(`${state.base}/sessions/${sessionId}/terminals/${createdBody.info.id}/input`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: 'echo hi\n' }),
    })
    assert.equal(input.status, 200)
    assert.deepEqual(capture.writes, ['echo hi\n'])

    const resized = await fetch(`${state.base}/sessions/${sessionId}/terminals/${createdBody.info.id}/resize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cols: 120, rows: 40 }),
    })
    assert.equal(resized.status, 200)
    assert.deepEqual(capture.sizes, [[120, 40]])

    const list = await fetch(`${state.base}/sessions/${sessionId}/terminals`, { headers })
    assert.equal(list.status, 200)
    assert.equal((await list.json() as { items: unknown[] }).items.length, 1)

    const closed = await fetch(`${state.base}/sessions/${sessionId}/terminals/${createdBody.info.id}`, {
      method: 'DELETE',
      headers,
    })
    assert.equal(closed.status, 204)
    assert.equal(capture.terminated, true)
    const empty = await fetch(`${state.base}/sessions/${sessionId}/terminals`, { headers })
    assert.equal((await empty.json() as { items: unknown[] }).items.length, 0)
  } finally {
    events.close()
  }
})

test('Host and Origin fences reject foreign authorities', async () => {
  const response = await rawRequest(`${state.base}/sessions`, {
    authorization: `Bearer ${state.token}`,
    host: 'evil.example',
  })
  assert.equal(response.status, 403)
  const body = JSON.parse(response.body) as { error: { code: string } }
  assert.equal(body.error.code, 'host-refused')

  const origin = await fetch(`${state.base}/sessions`, {
    headers: { authorization: `Bearer ${state.token}`, origin: 'https://evil.example' },
  })
  assert.equal(origin.status, 403)
})

test('a live browser wins: the approval listener delegates with next()', async () => {
  state.ctx.browserLive = true
  let nextCalled = false
  const outcome = await state.ctx.waterfall('approval/request',
    { agent: { id: sessionId }, toolName: 'write', reason: 'edit a file' },
    () => { nextCalled = true; return Promise.resolve('unavailable') },
  )
  state.ctx.browserLive = false
  assert.equal(nextCalled, true)
  assert.equal(outcome, 'unavailable')
})

test('approval is claimed, pushed to SSE, and resolved by HTTP', async () => {
  const sse = await openSse(state)
  try {
    const decision = state.ctx.waterfall('approval/request',
      {
        agent: { id: sessionId },
        toolName: 'bash',
        callId: 'call-1',
        reason: 'run a command',
        displayReason: { en: 'Run a command' },
      },
      () => Promise.resolve('unavailable'),
    )
    const item = await waitForApproval(state)
    assert.equal(item.toolName, 'bash')
    assert.equal(item.displayReason?.en, 'Run a command')
    await sse.waitFor('Approval')

    const response = await fetch(`${state.base}/approvals/${item.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    })
    assert.equal(response.status, 200)
    assert.equal(await decision, 'allowed-once')
  } finally {
    sse.close()
  }
})

test('always creates a session-wide tool grant and skips the app', async () => {
  const sse = await openSse(state)
  try {
    const first = state.ctx.waterfall('approval/request',
      { agent: { id: sessionId }, toolName: 'grep', callId: 'call-2', reason: 'search files' },
      () => Promise.resolve('unavailable'),
    )
    const item = await waitForApproval(state)
    const response = await fetch(`${state.base}/approvals/${item.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'always' }),
    })
    assert.equal(response.status, 200)
    assert.equal(await first, 'allowed-once')

    let nextCalled = false
    const second = await state.ctx.waterfall('approval/request',
      { agent: { id: sessionId }, toolName: 'grep', callId: 'call-3', reason: 'search again' },
      () => { nextCalled = true; return Promise.resolve('unavailable') },
    )
    assert.equal(second, 'allowed-once')
    assert.equal(nextCalled, false)
  } finally {
    sse.close()
  }
})

test('an unanswered approval times out and delegates with next()', async () => {
  const sse = await openSse(state)
  try {
    let nextCalled = false
    const outcome = await state.ctx.waterfall('approval/request',
      { agent: { id: sessionId }, toolName: 'write', callId: 'call-timeout', reason: 'edit a file' },
      () => { nextCalled = true; return Promise.resolve('unavailable') },
    )
    assert.equal(outcome, 'unavailable')
    assert.equal(nextCalled, true)
    const pending = await fetch(`${state.base}/approvals`, { headers: { authorization: `Bearer ${state.token}` } })
    const body = await pending.json() as { items: unknown[] }
    assert.equal(body.items.length, 0)
  } finally {
    sse.close()
  }
})

test('a user question is claimed and answered over HTTP', async () => {
  const sse = await openSse(state)
  try {
    const answer = state.ctx.waterfall('user-questions/request',
      {
        agent: { id: sessionId },
        wait: { callId: 'question-call-1' },
        questions: [{
          id: 'q1',
          question: 'Which file?',
          options: [{ label: 'a.ts' }, { label: 'b.ts' }],
        }],
      },
      () => Promise.reject(new Error('no provider')),
    )
    const item = await waitForQuestion(state)
    assert.equal(item.questions[0]?.question, 'Which file?')
    await sse.waitFor('Question')

    const response = await fetch(`${state.base}/questions/${item.id}/answer`, {
      method: 'POST',
      headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [{ id: 'q1', selected: ['a.ts'] }] }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await answer, { answers: [{ id: 'q1', selected: ['a.ts'] }] })
  } finally {
    sse.close()
  }
})

test('admin page can set and clear a persisted fixed pairing code', async () => {
  const data = await fetch(`${state.base}/admin/data`)
  assert.equal(data.status, 200)
  const before = await data.json() as { formatted: string; fixed: boolean }
  assert.equal(before.fixed, false)

  const fixed = await fetch(`${state.base}/admin/pair-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'fixed', code: 'FIXED-CODE' }),
  })
  assert.equal(fixed.status, 200)
  const fixedBody = await fixed.json() as { formatted: string; fixed: boolean }
  assert.equal(fixedBody.formatted, 'FIXED-CODE')
  assert.equal(fixedBody.fixed, true)

  const health = await fetch(`${state.base}/health`)
  assert.equal((await health.json() as { pairingFixed: boolean }).pairingFixed, true)

  const pairBody = JSON.stringify({ code: 'FIXED-CODE', deviceName: 'fixed code phone' })
  const first = await fetch(`${state.base}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: pairBody })
  const second = await fetch(`${state.base}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: pairBody })
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)

  const auto = await fetch(`${state.base}/admin/pair-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'auto' }),
  })
  const autoBody = await auto.json() as { fixed: boolean }
  assert.equal(autoBody.fixed, false)
})

test('debug routes create and resolve synthetic approvals and questions', async () => {
  const headers = { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' }
  const sse = await openSse(state)
  try {
    const approvalResponse = await fetch(`${state.base}/debug/approval`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toolName: 'bash', reason: 'debug launch' }),
    })
    assert.equal(approvalResponse.status, 201)
    const approval = await approvalResponse.json() as { id: string; toolName: string }
    assert.equal(approval.toolName, 'bash')
    await sse.waitFor('debug launch')
    const allowed = await fetch(`${state.base}/approvals/${approval.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'allow' }),
    })
    assert.equal(allowed.status, 200)

    const questionResponse = await fetch(`${state.base}/debug/question`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    assert.equal(questionResponse.status, 201)
    const question = await questionResponse.json() as { id: string; questions: Array<{ id: string }> }
    const answered = await fetch(`${state.base}/questions/${question.id}/answer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ answers: [{ id: question.questions[0]!.id, selected: ['继续'] }] }),
    })
    assert.equal(answered.status, 200)
  } finally {
    sse.close()
  }
})

test('revoking a device closes its open event streams', async () => {
  const admin = await fetch(`${state.base}/admin/pair-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'fixed', code: 'REVOKE-TEST' }),
  })
  assert.equal(admin.status, 200)
  const paired = await fetch(`${state.base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'REVOKE-TEST', deviceName: 'revoke test' }),
  })
  assert.equal(paired.status, 201)
  const device = await paired.json() as { token: string; deviceId: string }

  const events = await openSse(state, device.token)
  const session = await openSse(state, device.token, `/sessions/${sessionId}/events`)
  await events.waitFor('hello')
  await session.waitFor('ready')
  try {
    const removed = await fetch(`${state.base}/devices/${device.deviceId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${device.token}` },
    })
    assert.equal(removed.status, 204)
    await Promise.race([
      Promise.all([events.waitForClose(), session.waitForClose()]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('streams stayed open after revoke')), 3000)),
    ])
  } finally {
    events.close()
    session.close()
    await fetch(`${state.base}/admin/pair-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'auto' }),
    })
  }
})

test('body limits and unknown routes fail explicitly', async () => {
  const tooLarge = await fetch(`${state.base}/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ cwd: 'x'.repeat(5000) }),
  })
  assert.equal(tooLarge.status, 413)
  const body = await tooLarge.json() as { error: { code: string } }
  assert.equal(body.error.code, 'body-too-large')

  const missing = await fetch(`${state.base}/nope`, { headers: { authorization: `Bearer ${state.token}` } })
  assert.equal(missing.status, 404)
})

interface SseHandle {
  close(): void
  waitFor(fragment: string): Promise<void>
  waitForClose(): Promise<void>
}

async function rawRequest(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const request = createServerRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'GET',
      headers,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('error', reject)
    request.end()
  })
}

async function openSse(current: FakeState, token = current.token, path = '/events'): Promise<SseHandle> {
  const controller = new AbortController()
  const response = await fetch(`${current.base}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const events: string[] = []
  let resolveClosed: () => void = () => undefined
  const closed = new Promise<void>(resolve => { resolveClosed = resolve })
  void (async () => {
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) return
        events.push(decoder.decode(chunk.value, { stream: true }))
      }
    } catch {
      // Aborted at the end of a test.
    } finally {
      resolveClosed()
    }
  })()
  return {
    close: () => controller.abort(),
    waitForClose: () => closed,
    async waitFor(fragment: string) {
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        if (events.join('').includes(fragment)) return
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.fail(`SSE never carried ${fragment}`)
    },
  }
}

async function waitForApproval(current: FakeState): Promise<{ id: string; toolName: string; displayReason?: { en: string } }> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const response = await fetch(`${current.base}/approvals`, { headers: { authorization: `Bearer ${current.token}` } })
    const body = await response.json() as { items: Array<{ id: string; toolName: string; displayReason?: { en: string } }> }
    if (body.items.length > 0) return body.items[0]!
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('approval never became pending')
}

async function waitForQuestion(current: FakeState): Promise<{ id: string; questions: Array<{ question: string }> }> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const response = await fetch(`${current.base}/questions`, { headers: { authorization: `Bearer ${current.token}` } })
    const body = await response.json() as { items: Array<{ id: string; questions: Array<{ question: string }> }> }
    if (body.items.length > 0) return body.items[0]!
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('question never became pending')
}
