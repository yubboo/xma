/**
 * 文件作用：定义 Provider 品牌级的 usage / billing / account telemetry Contract 与 Registry。
 * 关联模块：provider.ts、xma-session metrics、Provider 品牌插件、未来 App Protocol。
 * 当前实现：API/订阅/未知计费来源、模型元数据、费用估算、账户余额/套餐快照与品牌隔离 Registry。
 * 职责边界：Transport Adapter 不拥有品牌价格；未知数据必须保持 unknown/unavailable，禁止 UI 伪造精确费用或余额。
 */

import type { ModelIdentity } from '../model/model.ts'
import type { CredentialResolver, ModelDescriptor, ProviderProfile } from './provider.ts'

export type ProviderBillingKind = 'api' | 'subscription' | 'unknown'

export type ProviderBillingSource =
  | { kind: 'api'; label?: string }
  | { kind: 'subscription'; label?: string; planName?: string }
  | { kind: 'unknown'; label?: string }

export interface ProviderUsageSnapshot {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
}

export interface ProviderPriceSource {
  id: string
  label: string
  url?: string
  effectiveAt?: string
  checkedAt?: string
}

export interface ProviderCostEstimate {
  amount: number
  currency: string
  precision: 'provider-reported' | 'estimated'
  source: ProviderPriceSource
}

export interface ProviderBalance {
  currency: string
  /** Decimal string keeps the Provider-reported financial value exact for display/audit. */
  total: string
  granted?: string
  toppedUp?: string
}

export interface ProviderSubscriptionQuota {
  planName?: string
  unit: 'tokens' | 'requests' | 'credits' | 'unknown'
  used?: number
  limit?: number
  remaining?: number
  resetAt?: string
}

export interface ProviderAccountSnapshot {
  providerId: string
  profileId: string
  billing: ProviderBillingSource
  checkedAt: string
  available: boolean
  balances?: readonly ProviderBalance[]
  quota?: ProviderSubscriptionQuota
  detail?: string
}

export interface ProviderTelemetryProvider {
  readonly providerId: string
  billingSource(profile: ProviderProfile): ProviderBillingSource
  modelDescriptor?(profile: ProviderProfile, model: string): ModelDescriptor | undefined
  estimateCost?(input: {
    profile: ProviderProfile
    identity: ModelIdentity
    usage: ProviderUsageSnapshot
    timestamp: string
  }): ProviderCostEstimate | undefined
  accountSnapshot?(
    profile: ProviderProfile,
    credentials: CredentialResolver,
    signal: AbortSignal,
  ): Promise<ProviderAccountSnapshot | undefined>
}

export class ProviderTelemetryRegistry {
  readonly #providers = new Map<string, ProviderTelemetryProvider>()

  constructor(readonly credentials: CredentialResolver) {}

  register(provider: ProviderTelemetryProvider): () => void {
    if (!provider.providerId.trim()) throw new Error('XMA Provider telemetry providerId cannot be empty.')
    if (this.#providers.has(provider.providerId)) throw new Error(`XMA Provider telemetry already registered: ${provider.providerId}`)
    this.#providers.set(provider.providerId, provider)
    return () => {
      if (this.#providers.get(provider.providerId) === provider) this.#providers.delete(provider.providerId)
    }
  }

  billingSource(profile: ProviderProfile): ProviderBillingSource {
    const provider = this.#providers.get(profile.providerId)
    if (provider) return structuredClone(provider.billingSource(profile))
    // Bearer/API-key style auth is an API billing signal, but does not imply known price or balance support.
    if (profile.auth.type === 'bearer') return { kind: 'api', label: 'API' }
    return { kind: 'unknown' }
  }

  modelDescriptor(profile: ProviderProfile, model = profile.defaultModel): ModelDescriptor | undefined {
    const descriptor = this.#providers.get(profile.providerId)?.modelDescriptor?.(profile, model)
    return descriptor ? structuredClone(descriptor) : undefined
  }

  estimateCost(
    profile: ProviderProfile,
    identity: ModelIdentity,
    usage: ProviderUsageSnapshot,
    timestamp: string,
  ): ProviderCostEstimate | undefined {
    const estimate = this.#providers.get(profile.providerId)?.estimateCost?.({ profile, identity, usage, timestamp })
    return estimate ? structuredClone(estimate) : undefined
  }

  async accountSnapshot(profile: ProviderProfile, signal: AbortSignal): Promise<ProviderAccountSnapshot | undefined> {
    const provider = this.#providers.get(profile.providerId)
    if (!provider?.accountSnapshot) return undefined
    return structuredClone(await provider.accountSnapshot(profile, this.credentials, signal))
  }
}
