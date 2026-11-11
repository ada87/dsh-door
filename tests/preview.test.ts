import assert from 'node:assert/strict'
import { previewToolCall } from '../src/interactions.js'

const bash = previewToolCall('bash', { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'ls -la' }) })
assert.equal(bash?.kind, 'command')
assert.match(bash?.detail ?? '', /ls -la/)

const edit = previewToolCall('edit', {
  callId: 'c2',
  name: 'edit',
  arguments: JSON.stringify({ file_path: 'src/a.ts', old_string: 'old', new_string: 'new\nline' }),
})
assert.equal(edit?.kind, 'diff')
assert.equal(edit?.added, 2)
assert.equal(edit?.removed, 1)
assert.match(edit?.detail ?? '', /- old/)
assert.match(edit?.detail ?? '', /\+ new/)

const web = previewToolCall('web_fetch', { arguments: JSON.stringify({ url: 'https://example.com' }) })
assert.equal(web?.kind, 'url')
assert.equal(web?.detail, 'https://example.com')

assert.equal(previewToolCall('bash', { arguments: 'not-json' }), undefined)

console.log('approval preview: ok')
