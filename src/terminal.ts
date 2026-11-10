import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { HttpError } from './http.js'
import type { HostContext, SubprocessService, SubprocessTerminalHandle } from './host.js'
import type { TerminalInfo } from './protocol.js'

/** Keep at most this much rendered output per terminal for reconnects. */
const MAX_BUFFER_CHARS = 200_000
/** Terminals with no attachment are reclaimed after this much inactivity. */
const IDLE_TIMEOUT_MS = 30 * 60_000
const MAX_TERMINALS_PER_SESSION = 4
const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30
const MAX_COLS = 500
const MAX_ROWS = 200

export interface TerminalEvent {
  type: 'output' | 'exit'
  data?: string
  exitCode?: number | null
}

interface TerminalRecord {
  info: TerminalInfo
  handle: SubprocessTerminalHandle
  decoder: StringDecoder
  buffer: string
  truncated: boolean
  listeners: Set<(event: TerminalEvent) => void>
  attached: number
  lastActivity: number
}

/**
 * Minimal PTY-backed console for the phone.
 *
 * It uses the Host's own subprocess provider (`ctx.subprocess.spawnTerminal`),
 * the same primitive dsh's Web terminal builds on, so the shell runs as the dsh
 * OS user in the Session's working directory with the Host's environment
 * scrubbing. Unlike the Web terminal this transport is deliberate and small:
 * one retained shell, a bounded text buffer, and HTTP+SSE instead of the
 * browser's duplex Typert stream. Full-screen TUI rendering is the app's job.
 */
export class TerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>()
  private readonly reaper: NodeJS.Timeout

  constructor(
    private readonly ctx: HostContext,
    private readonly logger: { warn(message: string): void },
  ) {
    this.reaper = setInterval(() => this.reclaimIdle(), 60_000)
    this.reaper.unref?.()
  }

  /** Whether this Host exposes the subprocess provider the feature needs. */
  available(): boolean {
    return this.subprocess() !== undefined
  }

  list(sessionId: string): TerminalInfo[] {
    return [...this.terminals.values()]
      .filter(record => record.info.sessionId === sessionId)
      .map(record => record.info)
  }

  async create(
    sessionId: string,
    cwd: string,
    options: { cols?: number; rows?: number },
  ): Promise<{ info: TerminalInfo; buffer: string; truncated: boolean }> {
    const subprocess = this.subprocess()
    if (subprocess === undefined) {
      throw new HttpError(501, 'terminal-unavailable', 'this dsh profile has no subprocess provider')
    }
    if (this.list(sessionId).length >= MAX_TERMINALS_PER_SESSION) {
      throw new HttpError(409, 'terminal-limit-reached', `at most ${MAX_TERMINALS_PER_SESSION} terminals per session`)
    }
    const cols = clamp(options.cols ?? DEFAULT_COLS, 20, MAX_COLS)
    const rows = clamp(options.rows ?? DEFAULT_ROWS, 10, MAX_ROWS)

    const signal = new AbortController().signal
    const environment = await subprocess.terminalEnvironment(signal)
    const shellCandidate = environment.defaultShell ?? (environment.platform === 'windows' ? 'cmd.exe' : '/bin/bash')
    const shell = await subprocess.resolveExecutable(shellCandidate, undefined, signal)
    const handle = await subprocess.spawnTerminal({
      argv: [shell],
      cwd,
      env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      rows,
      cols,
      terminalType: 'xterm-256color',
      shellActivity: true,
      graceMs: 1_000,
    })

    const now = Date.now()
    const record: TerminalRecord = {
      info: {
        id: `term-${randomUUID()}`,
        sessionId,
        cwd,
        shell,
        cols,
        rows,
        pid: handle.pid,
        createdAt: now,
        exited: false,
        exitCode: null,
        truncated: false,
      },
      handle,
      decoder: new StringDecoder('utf8'),
      buffer: '',
      truncated: false,
      listeners: new Set(),
      attached: 0,
      lastActivity: now,
    }
    this.terminals.set(record.info.id, record)
    this.attachOutput(record)
    return { info: record.info, buffer: record.buffer, truncated: record.truncated }
  }

  snapshot(sessionId: string, id: string): { info: TerminalInfo; buffer: string; truncated: boolean } {
    const record = this.require(sessionId, id)
    return { info: record.info, buffer: record.buffer, truncated: record.truncated }
  }

  subscribe(sessionId: string, id: string, listener: (event: TerminalEvent) => void): () => void {
    const record = this.require(sessionId, id)
    record.listeners.add(listener)
    record.attached += 1
    record.lastActivity = Date.now()
    return () => {
      record.listeners.delete(listener)
      record.attached = Math.max(0, record.attached - 1)
    }
  }

  async write(sessionId: string, id: string, data: string): Promise<void> {
    const record = this.require(sessionId, id)
    if (record.info.exited) {
      throw new HttpError(409, 'terminal-exited', 'this terminal has already exited')
    }
    record.lastActivity = Date.now()
    await record.handle.write(data)
  }

  async resize(sessionId: string, id: string, cols: number, rows: number): Promise<TerminalInfo> {
    const record = this.require(sessionId, id)
    const nextCols = clamp(cols, 20, MAX_COLS)
    const nextRows = clamp(rows, 10, MAX_ROWS)
    await record.handle.resize(nextCols, nextRows)
    record.info = { ...record.info, cols: nextCols, rows: nextRows }
    return record.info
  }

  async close(sessionId: string, id: string): Promise<boolean> {
    const record = this.terminals.get(id)
    if (record === undefined || record.info.sessionId !== sessionId) return false
    this.terminals.delete(id)
    record.listeners.clear()
    try {
      await record.handle.terminate()
    } catch (error) {
      this.logger.warn(`[dsh-door] terminal cleanup failed: ${shortMessage(error)}`)
    }
    return true
  }

  async closeSession(sessionId: string): Promise<void> {
    const ids = this.list(sessionId).map(info => info.id)
    await Promise.all(ids.map(id => this.close(sessionId, id)))
  }

  dispose(): void {
    clearInterval(this.reaper)
    for (const record of this.terminals.values()) {
      record.listeners.clear()
      void record.handle.terminate().catch(() => undefined)
    }
    this.terminals.clear()
  }

  private attachOutput(record: TerminalRecord): void {
    record.handle.output.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : record.decoder.write(chunk)
      if (text.length === 0) return
      record.lastActivity = Date.now()
      record.buffer += text
      if (record.buffer.length > MAX_BUFFER_CHARS) {
        record.buffer = record.buffer.slice(record.buffer.length - MAX_BUFFER_CHARS)
        record.truncated = true
        record.info = { ...record.info, truncated: true }
      }
      this.emit(record, { type: 'output', data: text })
    })
    record.handle.output.on('error', (error: Error) => {
      this.logger.warn(`[dsh-door] terminal output failed: ${error.message}`)
    })
    void record.handle.done.then(
      (outcome) => this.finish(record, outcome.exitCode),
      (error: unknown) => {
        this.logger.warn(`[dsh-door] terminal process failed: ${shortMessage(error)}`)
        this.finish(record, null)
      },
    )
  }

  private finish(record: TerminalRecord, exitCode: number | null): void {
    if (record.info.exited) return
    const tail = record.decoder.end()
    if (tail.length > 0) {
      record.buffer += tail
      this.emit(record, { type: 'output', data: tail })
    }
    record.info = { ...record.info, exited: true, exitCode }
    record.lastActivity = Date.now()
    this.emit(record, { type: 'exit', exitCode })
  }

  private emit(record: TerminalRecord, event: TerminalEvent): void {
    for (const listener of [...record.listeners]) {
      try {
        listener(event)
      } catch {
        record.listeners.delete(listener)
        record.attached = Math.max(0, record.attached - 1)
      }
    }
  }

  private require(sessionId: string, id: string): TerminalRecord {
    const record = this.terminals.get(id)
    if (record === undefined || record.info.sessionId !== sessionId) {
      throw new HttpError(404, 'terminal-not-found', 'no such terminal in this session')
    }
    return record
  }

  private reclaimIdle(): void {
    const now = Date.now()
    for (const record of [...this.terminals.values()]) {
      if (record.attached > 0) continue
      if (now - record.lastActivity < IDLE_TIMEOUT_MS) continue
      void this.close(record.info.sessionId, record.info.id)
    }
  }

  private subprocess(): SubprocessService | undefined {
    if (this.ctx.subprocess !== undefined) return this.ctx.subprocess
    try {
      return this.ctx.get('subprocess') as SubprocessService | undefined
    } catch {
      return undefined
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function shortMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
