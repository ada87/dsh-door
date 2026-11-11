import { open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { HostContext } from './host.js'
import { HttpError } from './http.js'

const MAX_ENTRIES = 300
const MAX_FILE_BYTES = 256 * 1024

export interface WorkspaceFileEntry {
  name: string
  path: string
  kind: 'directory' | 'file'
  size?: number
  modifiedAt?: number
}

export interface WorkspaceFileList {
  root: string
  path: string
  entries: WorkspaceFileEntry[]
  truncated: boolean
}

export interface WorkspaceFileContent {
  path: string
  size: number
  truncated: boolean
  content: string
}

/** List one directory without activating the Session or following symlinks. */
export async function listWorkspaceFiles(
  ctx: HostContext,
  sessionId: string,
  requestedPath: string,
  signal: AbortSignal,
): Promise<WorkspaceFileList> {
  const { root, rootReal } = await workspaceRoot(ctx, sessionId, signal)
  const directory = await confinedRealPath(rootReal, requestedPath)
  const info = await stat(directory)
  if (!info.isDirectory()) throw new HttpError(400, 'not-a-directory', 'the requested path is not a directory')
  const dirents = await readdir(directory, { withFileTypes: true })
  const visible = dirents.filter(entry => entry.isDirectory() || entry.isFile())
  visible.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  const entries = await Promise.all(visible.slice(0, MAX_ENTRIES).map(async (entry): Promise<WorkspaceFileEntry> => {
    const absolute = resolve(directory, entry.name)
    const entryInfo = await stat(absolute)
    const path = displayPath(rootReal, absolute)
    return entry.isDirectory()
      ? { name: entry.name, path, kind: 'directory' }
      : { name: entry.name, path, kind: 'file', size: entryInfo.size, modifiedAt: entryInfo.mtimeMs }
  }))
  return { root, path: displayPath(rootReal, directory), entries, truncated: visible.length > MAX_ENTRIES }
}

/** Read at most 256 KiB of a UTF-8 text file inside the Session cwd. */
export async function readWorkspaceFile(
  ctx: HostContext,
  sessionId: string,
  requestedPath: string,
  signal: AbortSignal,
): Promise<WorkspaceFileContent> {
  const { rootReal } = await workspaceRoot(ctx, sessionId, signal)
  const filename = await confinedRealPath(rootReal, requestedPath)
  const info = await stat(filename)
  if (!info.isFile()) throw new HttpError(400, 'not-a-file', 'the requested path is not a regular file')
  const handle = await open(filename, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(info.size, MAX_FILE_BYTES + 1))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const bytes = buffer.subarray(0, bytesRead)
    const truncated = bytesRead > MAX_FILE_BYTES || info.size > MAX_FILE_BYTES
    const contentBytes = truncated ? bytes.subarray(0, MAX_FILE_BYTES) : bytes
    // A NUL is a conservative binary guard: source/text files do not contain
    // it, and sending arbitrary binary as JSON would make the phone unusable.
    if (contentBytes.includes(0)) throw new HttpError(415, 'binary-file', 'binary files cannot be previewed as text')
    return {
      path: displayPath(rootReal, filename),
      size: info.size,
      truncated,
      content: contentBytes.toString('utf8'),
    }
  } finally {
    await handle.close()
  }
}

async function workspaceRoot(ctx: HostContext, sessionId: string, signal: AbortSignal): Promise<{ root: string; rootReal: string }> {
  const list = await ctx.sessionController.list({}, signal)
  const session = list.items.find(item => item.sessionId === sessionId)
  if (session === undefined) throw new HttpError(404, 'session-not-found', 'the Session does not exist')
  if (session.cwd === undefined || session.cwd.trim().length === 0) {
    throw new HttpError(409, 'workspace-unavailable', 'this Session has no working directory')
  }
  try {
    return { root: session.cwd, rootReal: await realpath(session.cwd) }
  } catch {
    throw new HttpError(404, 'workspace-not-found', 'the Session working directory does not exist')
  }
}

async function confinedRealPath(rootReal: string, requestedPath: string): Promise<string> {
  if (requestedPath.includes('\0')) throw new HttpError(400, 'invalid-path', 'the path contains a NUL byte')
  const candidate = resolve(rootReal, requestedPath)
  if (!inside(rootReal, candidate)) throw new HttpError(403, 'path-outside-workspace', 'the path is outside the Session working directory')
  try {
    const actual = await realpath(candidate)
    if (!inside(rootReal, actual)) throw new HttpError(403, 'path-outside-workspace', 'the path resolves outside the Session working directory')
    return actual
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(404, 'file-not-found', 'the requested file or directory does not exist')
  }
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function displayPath(root: string, candidate: string): string {
  return relative(root, candidate).split(sep).join('/')
}
