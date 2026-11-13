import type { HostContext } from './host.js'

/**
 * Read-only catalogs for the phone's new-session and model pickers. Every
 * service is optional: a Host profile without workspaces, agent presets, or
 * an LLM runtime simply reports the catalog as unavailable and the phone
 * hides the corresponding selector.
 */

export interface WorkspaceItem {
  id: string
  path: string
  title: string
}

export interface AgentPresetItem {
  id: string
  name?: string
  description?: string
  broken?: string
}

export interface AgentPresetList {
  defaultId: string | null
  items: AgentPresetItem[]
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelCatalogModel {
  id: string
  name: string
  reasoningEfforts: string[]
  defaultEffort?: string
}

export interface ModelCatalogProvider {
  id: string
  name: string
  models: ModelCatalogModel[]
}

export interface ModelCatalog {
  default: ModelSelection | null
  providers: ModelCatalogProvider[]
}

interface WorkspaceLike {
  id: string
  path: string
  title: string
}

interface WorkspaceRegistryLike {
  list(): WorkspaceLike[]
}

interface AgentPresetLike {
  id: string
  name?: string
  description?: string
  broken?: string
}

interface AgentPresetsLike {
  list(): Promise<AgentPresetLike[]>
  defaultId?: string
}

interface LlmModelInfoLike {
  id: string
  name?: string
}

interface LlmReasoningLike {
  efforts?: { id?: string }[]
  defaultEffort?: string
}

interface LlmLike {
  listProviders(): { id: string; name?: string }[]
  listModels(provider: string): Promise<LlmModelInfoLike[]>
  resolveModelInfo(provider: string, model: string): Promise<{ reasoning?: LlmReasoningLike } | null>
  resolveCallConfig?(selection: ModelSelection): Promise<unknown>
}

interface AgentDefaultModelLike {
  currentSelection?(): ModelSelection | undefined
}

interface ModelCarrier {
  current(): ModelSelection | undefined
  select(selection: ModelSelection): void
}

interface AgentWithModel {
  model?: ModelCarrier
}

export function workspacesAvailable(ctx: HostContext): boolean {
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
  return registry !== undefined && typeof registry.list === 'function'
}

export function agentPresetsAvailable(ctx: HostContext): boolean {
  const presets = ctx.get('agentPresets') as AgentPresetsLike | undefined
  return presets !== undefined && typeof presets.list === 'function'
}

export function modelsAvailable(ctx: HostContext): boolean {
  const llm = ctx.get('llm') as LlmLike | undefined
  return llm !== undefined && typeof llm.listProviders === 'function' && typeof llm.listModels === 'function'
}

export function listWorkspaces(ctx: HostContext): WorkspaceItem[] {
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
  if (registry === undefined || typeof registry.list !== 'function') return []
  return registry.list().map(workspace => ({
    id: String(workspace.id),
    path: String(workspace.path),
    title: typeof workspace.title === 'string' && workspace.title.length > 0 ? workspace.title : workspace.path,
  }))
}

export async function listAgentPresets(ctx: HostContext): Promise<AgentPresetList> {
  const presets = ctx.get('agentPresets') as AgentPresetsLike | undefined
  if (presets === undefined || typeof presets.list !== 'function') {
    return { defaultId: null, items: [] }
  }
  const items = (await presets.list()).map(preset => ({
    id: String(preset.id),
    ...(preset.name === undefined ? {} : { name: preset.name }),
    ...(preset.description === undefined ? {} : { description: preset.description }),
    ...(preset.broken === undefined ? {} : { broken: preset.broken }),
  }))
  return { defaultId: typeof presets.defaultId === 'string' ? presets.defaultId : null, items }
}

const MODEL_CATALOG_TTL_MS = 5 * 60_000
let modelCatalogCache: { at: number; catalog: ModelCatalog } | null = null

interface FileUploadRefLike {
  name?: string
  bytes?: number
  mediaType?: string
  width?: number
  height?: number
}

interface FileUploadsLike {
  uploadStream(request: { sessionId: string; data: AsyncIterable<Uint8Array>; name?: string }): Promise<{ receiptId: string; file: FileUploadRefLike }>
  uploadImageStream(request: { sessionId: string; data: AsyncIterable<Uint8Array>; mediaType: string; name?: string }): Promise<{ receiptId: string; image: FileUploadRefLike }>
}

export interface UploadReceipt {
  receiptId: string
  kind: 'file' | 'image'
  name?: string
  bytes?: number
  mediaType?: string
  width?: number
  height?: number
}

export function uploadsAvailable(ctx: HostContext): boolean {
  const uploads = ctx.get('fileUploads') as FileUploadsLike | undefined
  return uploads !== undefined && typeof uploads.uploadStream === 'function'
}

export async function uploadAttachment(
  ctx: HostContext,
  sessionId: string,
  input: { kind: 'file' | 'image'; name?: string; mediaType?: string; bytes: Buffer },
): Promise<UploadReceipt> {
  const uploads = ctx.get('fileUploads') as FileUploadsLike | undefined
  if (uploads === undefined || typeof uploads.uploadStream !== 'function') {
    throw new Error('this Host profile does not expose the file upload service')
  }
  const data = (async function* (): AsyncIterable<Uint8Array> {
    yield new Uint8Array(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength)
  })()
  if (input.kind === 'image') {
    if (input.mediaType === undefined || input.mediaType.length === 0) {
      throw new Error('image uploads require a mediaType')
    }
    const result = await uploads.uploadImageStream({ sessionId: sessionId as never, data, mediaType: input.mediaType, ...(input.name === undefined ? {} : { name: input.name }) })
    return {
      receiptId: String(result.receiptId),
      kind: 'image',
      ...(result.image.name === undefined ? {} : { name: result.image.name }),
      ...(typeof result.image.bytes === 'number' ? { bytes: result.image.bytes } : {}),
      ...(result.image.mediaType === undefined ? {} : { mediaType: result.image.mediaType }),
      ...(typeof result.image.width === 'number' ? { width: result.image.width } : {}),
      ...(typeof result.image.height === 'number' ? { height: result.image.height } : {}),
    }
  }
  const result = await uploads.uploadStream({ sessionId: sessionId as never, data, ...(input.name === undefined ? {} : { name: input.name }) })
  return {
    receiptId: String(result.receiptId),
    kind: 'file',
    ...(result.file.name === undefined ? {} : { name: result.file.name }),
    ...(typeof result.file.bytes === 'number' ? { bytes: result.file.bytes } : {}),
  }
}

export async function modelCatalog(ctx: HostContext): Promise<ModelCatalog> {
  const now = Date.now()
  if (modelCatalogCache !== null && now - modelCatalogCache.at < MODEL_CATALOG_TTL_MS) {
    return modelCatalogCache.catalog
  }
  const defaultModel = ctx.get('agentDefaultModel') as AgentDefaultModelLike | undefined
  const fallback: ModelCatalog = {
    default: defaultModel?.currentSelection?.() ?? null,
    providers: [],
  }
  const llm = ctx.get('llm') as LlmLike | undefined
  if (llm === undefined || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
    modelCatalogCache = { at: now, catalog: fallback }
    return fallback
  }
  const providers: ModelCatalogProvider[] = []
  for (const provider of llm.listProviders()) {
    const providerId = String(provider.id)
    let models: LlmModelInfoLike[] = []
    try {
      models = await llm.listModels(providerId)
    } catch {
      continue
    }
    const entries: ModelCatalogModel[] = []
    for (const model of models) {
      const modelId = String(model.id)
      let reasoning: LlmReasoningLike | undefined
      try {
        reasoning = (await llm.resolveModelInfo(providerId, modelId))?.reasoning
      } catch {
        reasoning = undefined
      }
      const efforts = (reasoning?.efforts ?? []).map(effort => String(effort.id)).filter(id => id.length > 0)
      entries.push({
        id: modelId,
        name: model.name ?? modelId,
        reasoningEfforts: efforts,
        ...(reasoning?.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort }),
      })
    }
    providers.push({ id: providerId, name: provider.name ?? providerId, models: entries })
  }
  const catalog: ModelCatalog = { default: fallback.default, providers }
  modelCatalogCache = { at: now, catalog }
  return catalog
}

export function invalidateModelCatalog(): void {
  modelCatalogCache = null
}

export function currentSessionModel(agent: AgentWithModel | undefined, fallback: ModelSelection | null): ModelSelection | null {
  const current = agent?.model?.current()
  return current ?? fallback
}

/**
 * Switch the session's model. Mirrors the Host's own validation order: the
 * route must resolve before the durable model/selection event is appended.
 */
export async function selectSessionModel(
  ctx: HostContext,
  agent: AgentWithModel | undefined,
  selection: ModelSelection,
): Promise<void> {
  const llm = ctx.get('llm') as LlmLike | undefined
  if (llm?.resolveCallConfig !== undefined) {
    await llm.resolveCallConfig(selection)
  }
  if (agent?.model === undefined) throw new Error('the session agent does not expose a model selector')
  agent.model.select(selection)
}
