import type { HostContext } from './host.js'
import { HttpError } from './http.js'

interface SpeechControllerLike {
  catalog(): unknown
  transcribe(request: {
    audioBase64: string
    providerId?: string
    language?: string
  }, signal: AbortSignal): Promise<{
    text: string
    audioSeconds: number
    inferenceSeconds: number
  }>
}

/** Public readiness without exposing provider credentials or local paths. */
export function speechCatalog(ctx: HostContext): { available: boolean; providers?: unknown[]; selection?: unknown; maxAudioBytes?: number; maxDurationSeconds?: number } {
  const controller = getSpeechController(ctx)
  if (controller === undefined) return { available: false, providers: [] }
  const catalog = controller.catalog() as {
    providers?: unknown[]
    selection?: unknown
    maxAudioBytes?: number
    maxDurationSeconds?: number
  }
  return {
    available: true,
    providers: Array.isArray(catalog.providers) ? catalog.providers : [],
    ...(catalog.selection === undefined ? {} : { selection: catalog.selection }),
    ...(catalog.maxAudioBytes === undefined ? {} : { maxAudioBytes: catalog.maxAudioBytes }),
    ...(catalog.maxDurationSeconds === undefined ? {} : { maxDurationSeconds: catalog.maxDurationSeconds }),
  }
}

/** Transcribe only; this never submits a Session prompt or activates an Agent. */
export async function transcribeSpeech(
  ctx: HostContext,
  input: { audioBase64: string; providerId?: string; language?: string },
  signal: AbortSignal,
): Promise<{ text: string; audioSeconds: number; inferenceSeconds: number }> {
  const controller = getSpeechController(ctx)
  if (controller === undefined) throw new HttpError(503, 'speech-unavailable', 'this dsh profile has no speech transcription service')
  if (input.audioBase64.length === 0) throw new HttpError(400, 'empty-audio', 'audioBase64 is required')
  try {
    return await controller.transcribe({
      audioBase64: input.audioBase64,
      ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
      ...(input.language === undefined ? {} : { language: input.language }),
    }, signal)
  } catch (error) {
    if (signal.aborted) throw error
    throw new HttpError(422, 'speech-transcription-failed', error instanceof Error ? error.message : String(error))
  }
}

function getSpeechController(ctx: HostContext): SpeechControllerLike | undefined {
  try {
    const value = ctx.get('speechController') as Partial<SpeechControllerLike> | undefined
    return value !== undefined && typeof value.catalog === 'function' && typeof value.transcribe === 'function'
      ? value as SpeechControllerLike
      : undefined
  } catch {
    return undefined
  }
}
