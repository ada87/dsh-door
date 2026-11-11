import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listWorkspaceFiles, readWorkspaceFile } from '../src/files.js'
import type { HostContext } from '../src/host.js'

async function fixture(): Promise<{ root: string; ctx: HostContext }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-door-files-'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'README.md'), '# hello\n')
  await writeFile(join(root, 'src', 'main.ts'), 'export const answer = 42\n')
  const ctx = {
    sessionController: {
      list: async () => ({ items: [{ sessionId: 's1', cwd: root }] }),
    },
  } as unknown as HostContext
  return { root, ctx }
}

test('workspace files lists directories first and reads UTF-8 text', async () => {
  const { root, ctx } = await fixture()
  try {
    const list = await listWorkspaceFiles(ctx, 's1', '', new AbortController().signal)
    assert.deepEqual(list.entries.map(entry => entry.name), ['src', 'README.md'])
    assert.equal(list.entries[0]?.kind, 'directory')
    const nested = await listWorkspaceFiles(ctx, 's1', 'src', new AbortController().signal)
    assert.equal(nested.entries[0]?.path, 'src/main.ts')
    const file = await readWorkspaceFile(ctx, 's1', 'src/main.ts', new AbortController().signal)
    assert.equal(file.content, 'export const answer = 42\n')
    assert.equal(file.truncated, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace files rejects traversal and binary previews', async () => {
  const { root, ctx } = await fixture()
  try {
    await assert.rejects(
      readWorkspaceFile(ctx, 's1', '../outside.txt', new AbortController().signal),
      (error: { code?: string }) => error.code === 'path-outside-workspace',
    )
    await writeFile(join(root, 'binary.dat'), Buffer.from([0, 1, 2]))
    await assert.rejects(
      readWorkspaceFile(ctx, 's1', 'binary.dat', new AbortController().signal),
      (error: { code?: string }) => error.code === 'binary-file',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
