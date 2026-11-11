import assert from 'node:assert/strict'
import test from 'node:test'
import { speechCatalog, transcribeSpeech } from '../src/speech.js'
import type { HostContext } from '../src/host.js'

test('speech catalog is explicit when the Host has no speech service', () => {
  const ctx = { get: () => undefined } as unknown as HostContext
  assert.deepEqual(speechCatalog(ctx), { available: false, providers: [] })
})

test('speech transcription delegates WAV bytes to the selected Host provider', async () => {
  let received = ''
  const controller = {
    catalog: () => ({
      providers: [{ id: 'local', name: 'SenseVoice', location: 'host-local', languages: ['auto'], preparation: { phase: 'ready' } }],
      selection: { providerId: 'local', language: 'auto' },
      maxAudioBytes: 4 * 1024 * 1024,
      maxDurationSeconds: 120,
    }),
    transcribe: async (request: { audioBase64: string }) => {
      received = request.audioBase64
      return { text: '你好', audioSeconds: 1, inferenceSeconds: 0.2 }
    },
  }
  const ctx = { get: (name: string) => name === 'speechController' ? controller : undefined } as unknown as HostContext
  const catalog = speechCatalog(ctx)
  assert.equal(catalog.available, true)
  assert.equal(catalog.providers?.length, 1)
  const result = await transcribeSpeech(ctx, { audioBase64: 'UklGRg==' }, new AbortController().signal)
  assert.equal(result.text, '你好')
  assert.equal(received, 'UklGRg==')
})
