/**
 * 文件作用：定义 XMA 正式 Model Provider 平台 Contract：Profile、Credential、Capability、Model Catalog、Registry、Probe 与错误分类。
 * 关联模块：model.ts、runtime.ts、plugins/providers/*、未来 Settings/App Protocol。
 * 当前实现：无 Secret 的 Provider Profile、环境/内存凭据解析、Adapter Registry、Model 创建、Catalog 与 Brain Ready Probe。
 * 职责边界：Core 不包含任何厂商 HTTP JSON；OpenAI/Claude/Gemini 等协议必须放在 Provider Adapter，Secret 值不得进入 Profile/Session/普通日志。
 */

import type { ModelProvider } from './model.ts'
import type { Disposer, JsonObject } from './types.ts'

export type ProviderTransportFamily = 'openai-compatible' | 'anthropic' | 'gemini' | 'custom'

export interface ProviderCapabilities {
  streamingText: boolean
  nativeToolCalling: boolean
  parallelToolCalls: boolean
  reasoning: boolean
  visionInput: boolean
  fileInput: boolean
  imageOutput: boolean
  webSearch: boolean
  promptCaching: boolean
  remoteCompaction: boolean
  usageReporting: boolean
  modelCatalogDiscovery: boolean
}

export interface CredentialReference {
  /** `env` 指向系统环境变量；`memory` 只用于当前进程/测试，不进入持久配置。 */
  source: 'env' | 'memory'
  key: string
}

export type ProviderAuth =
  | { type: 'none' }
  | { type: 'bearer'; credential: CredentialReference }

export interface ProviderProfile {
  id: string
  adapterId: string
  displayName: string
  baseUrl: string
  auth: ProviderAuth
  defaultModel: string
  /** 仅允许非 Secret 的自定义请求头；Authorization/X-Api-Key 等由 Credentials Service 注入。 */
  headers?: Readonly<Record<string, string>>
  /** Adapter 自己解释的非 Secret 高级配置；严禁把 API Key 塞进这里。 */
  options?: JsonObject
}

export interface ModelDescriptor {
  id: string
  displayName?: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities?: Partial<ProviderCapabilities>
  source: 'remote' | 'static'
  fetchedAt: string
}

export type ProviderErrorCode =
  | 'auth_invalid'
  | 'permission_denied'
  | 'model_not_found'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'context_too_large'
  | 'unsupported_capability'
  | 'server_error'
  | 'malformed_response'
  | 'cancelled'
  | 'unknown'

export class ProviderRequestError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderRequestError'
  }
}

export interface BrainReadyProbeResult {
  profileId: string
  adapterId: string
  model: string
  ready: boolean
  checkedAt: string
  latencyMs: number
  error?: {
    code: ProviderErrorCode
    message: string
    retryable: boolean
    status?: number
  }
}

export interface CredentialResolver {
  resolve(reference: CredentialReference): Promise<string | undefined>
}

/** 系统环境变量凭据源；只解析 env reference，不枚举环境变量。 */
export class EnvironmentCredentialResolver implements CredentialResolver {
  async resolve(reference: CredentialReference): Promise<string | undefined> {
    if (reference.source !== 'env') return undefined
    return process.env[reference.key]
  }
}

/** 进程内凭据源，主要用于测试和未来受控 Keychain bridge；值不会被 ProviderProfile 序列化。 */
export class MemoryCredentialResolver implements CredentialResolver {
  readonly #values = new Map<string, string>()

  set(key: string, value: string): void {
    this.#values.set(key, value)
  }

  delete(key: string): void {
    this.#values.delete(key)
  }

  async resolve(reference: CredentialReference): Promise<string | undefined> {
    if (reference.source !== 'memory') return undefined
    return this.#values.get(reference.key)
  }
}

/** 按顺序尝试多个凭据源；只返回第一个解析到的值。 */
export class CompositeCredentialResolver implements CredentialResolver {
  constructor(readonly resolvers: readonly CredentialResolver[]) {}

  async resolve(reference: CredentialReference): Promise<string | undefined> {
    for (const resolver of this.resolvers) {
      const value = await resolver.resolve(reference)
      if (value !== undefined) return value
    }
    return undefined
  }
}

export interface ProviderAdapter {
  readonly id: string
  readonly family: ProviderTransportFamily
  capabilities(profile: ProviderProfile): ProviderCapabilities
  createModel(profile: ProviderProfile, model: string, credentials: CredentialResolver): ModelProvider
  listModels(profile: ProviderProfile, credentials: CredentialResolver, signal: AbortSignal): Promise<readonly ModelDescriptor[]>
  probe(profile: ProviderProfile, model: string, credentials: CredentialResolver, signal: AbortSignal): Promise<BrainReadyProbeResult>
}

const FORBIDDEN_PROFILE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
])

function validateProfile(profile: ProviderProfile): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profile.id)) throw new Error(`Invalid XMA provider profile id: ${profile.id}`)
  if (!profile.adapterId) throw new Error(`XMA provider profile ${profile.id} is missing adapterId.`)
  if (!profile.defaultModel.trim()) throw new Error(`XMA provider profile ${profile.id} is missing defaultModel.`)
  let url: URL
  try {
    url = new URL(profile.baseUrl)
  } catch {
    throw new Error(`XMA provider profile ${profile.id} has invalid baseUrl.`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`XMA provider profile ${profile.id} baseUrl must use http or https.`)
  }
  for (const name of Object.keys(profile.headers ?? {})) {
    if (FORBIDDEN_PROFILE_HEADERS.has(name.toLowerCase())) {
      throw new Error(`XMA provider profile ${profile.id} cannot persist secret-bearing header: ${name}`)
    }
  }
  if (profile.auth.type === 'bearer' && !profile.auth.credential.key.trim()) {
    throw new Error(`XMA provider profile ${profile.id} has an empty credential reference.`)
  }
}

/** ProviderRegistry 只保存非 Secret Profile 与 Adapter；创建请求时才通过 CredentialResolver 取 Secret。 */
export class ProviderRegistry {
  readonly #adapters = new Map<string, ProviderAdapter>()
  readonly #profiles = new Map<string, ProviderProfile>()

  constructor(readonly credentials: CredentialResolver) {}

  registerAdapter(adapter: ProviderAdapter): Disposer {
    if (this.#adapters.has(adapter.id)) throw new Error(`XMA provider adapter already registered: ${adapter.id}`)
    this.#adapters.set(adapter.id, adapter)
    return () => {
      if (this.#adapters.get(adapter.id) === adapter) this.#adapters.delete(adapter.id)
    }
  }

  saveProfile(profile: ProviderProfile): void {
    validateProfile(profile)
    if (!this.#adapters.has(profile.adapterId)) throw new Error(`XMA provider adapter not registered: ${profile.adapterId}`)
    this.#profiles.set(profile.id, structuredClone(profile))
  }

  removeProfile(profileId: string): void {
    this.#profiles.delete(profileId)
  }

  getProfile(profileId: string): ProviderProfile | undefined {
    const profile = this.#profiles.get(profileId)
    return profile ? structuredClone(profile) : undefined
  }

  listProfiles(): readonly ProviderProfile[] {
    return [...this.#profiles.values()].map(profile => structuredClone(profile)).sort((a, b) => a.id.localeCompare(b.id))
  }

  capabilities(profileId: string): ProviderCapabilities {
    const { adapter, profile } = this.#resolve(profileId)
    return structuredClone(adapter.capabilities(profile))
  }

  createModel(profileId: string, model?: string): ModelProvider {
    const { adapter, profile } = this.#resolve(profileId)
    return adapter.createModel(profile, model ?? profile.defaultModel, this.credentials)
  }

  async listModels(profileId: string, signal: AbortSignal): Promise<readonly ModelDescriptor[]> {
    const { adapter, profile } = this.#resolve(profileId)
    return adapter.listModels(profile, this.credentials, signal)
  }

  async probe(profileId: string, model: string | undefined, signal: AbortSignal): Promise<BrainReadyProbeResult> {
    const { adapter, profile } = this.#resolve(profileId)
    return adapter.probe(profile, model ?? profile.defaultModel, this.credentials, signal)
  }

  #resolve(profileId: string): { adapter: ProviderAdapter; profile: ProviderProfile } {
    const profile = this.#profiles.get(profileId)
    if (!profile) throw new Error(`XMA provider profile not found: ${profileId}`)
    const adapter = this.#adapters.get(profile.adapterId)
    if (!adapter) throw new Error(`XMA provider adapter not registered: ${profile.adapterId}`)
    return { adapter, profile: structuredClone(profile) }
  }
}

export function providerErrorSummary(error: unknown): NonNullable<BrainReadyProbeResult['error']> {
  if (error instanceof ProviderRequestError) {
    const summary: NonNullable<BrainReadyProbeResult['error']> = {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    }
    if (error.status !== undefined) summary.status = error.status
    return summary
  }
  return { code: 'unknown', message: error instanceof Error ? error.message : String(error), retryable: false }
}
