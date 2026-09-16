/**
 * 文件作用：实现 DeepSeek 官方 Provider 的品牌级模型元数据、API 计费估算与余额查询 telemetry。
 * 关联模块：catalog.ts、xma-ai ProviderTelemetryRegistry、xma-session metrics。
 * 当前实现：官方 1M context 元数据、峰谷 API token 价格、`/user/balance` 真实余额查询。
 * 职责边界：只对 providerId=deepseek + 官方 api.deepseek.com 生效；自定义兼容 endpoint 绝不复用本品牌余额/价格语义。
 */

import type {
  CredentialResolver,
  ModelDescriptor,
  ProviderAccountSnapshot,
  ProviderBillingSource,
  ProviderCostEstimate,
  ProviderProfile,
  ProviderTelemetryProvider,
  ProviderUsageSnapshot,
} from 'xma-ai'
import { DEEPSEEK_PROVIDER_ID } from './catalog.ts'

const DEEPSEEK_API_HOST = 'api.deepseek.com'
const DEEPSEEK_CONTEXT_WINDOW = 1_000_000
const DEEPSEEK_MAX_OUTPUT = 384_000
const DEEPSEEK_PRICE_SOURCE = Object.freeze({
  id: 'deepseek-api-pricing-2026-09-16',
  label: 'DeepSeek 官方 API 模型与价格',
  url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  effectiveAt: '2026-09-10T04:00:00Z',
  checkedAt: '2026-09-16T00:00:00Z',
})

interface DeepSeekRates {
  cachedInput: number
  uncachedInput: number
  output: number
}

function isPeak(timestamp: string): boolean {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return false
  const day = date.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

function flashRates(timestamp: string): DeepSeekRates {
  return isPeak(timestamp)
    ? { cachedInput: 0.04, uncachedInput: 2, output: 8 }
    : { cachedInput: 0.02, uncachedInput: 1, output: 4 }
}

function v4ProLegacyRates(timestamp: string): DeepSeekRates {
  return isPeak(timestamp)
    ? { cachedInput: 0.30, uncachedInput: 9, output: 27 }
    : { cachedInput: 0.15, uncachedInput: 4.5, output: 13.5 }
}

function billedModel(model: string, timestamp: string): 'flash' | 'v4-pro' | undefined {
  if (model === 'deepseek-flash' || model === 'deepseek-v4-flash' || model === 'deepseek-v4-flash-vision-exp') return 'flash'
  if (model !== 'deepseek-v4-pro') return undefined

  // DeepSeek 官方当前价格页说明：2026-09-14 12:00（UTC+8）起，
  // deepseek-v4-pro 请求路由到 V4.1 Flash，并按 Flash 价格计费。
  const at = Date.parse(timestamp)
  const flashRoutingAt = Date.parse('2026-09-14T04:00:00Z')
  return Number.isFinite(at) && at >= flashRoutingAt ? 'flash' : 'v4-pro'
}

function modelDescriptor(model: string): ModelDescriptor | undefined {
  if (![
    'deepseek-flash',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp',
  ].includes(model)) return undefined
  return {
    id: model,
    contextWindow: DEEPSEEK_CONTEXT_WINDOW,
    maxOutputTokens: DEEPSEEK_MAX_OUTPUT,
    source: 'static',
    fetchedAt: '2026-09-16T00:00:00Z',
  }
}

function estimateCost(model: string, usage: ProviderUsageSnapshot, timestamp: string): ProviderCostEstimate | undefined {
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined
  const category = billedModel(model, timestamp)
  if (!category) return undefined
  const rates = category === 'flash' ? flashRates(timestamp) : v4ProLegacyRates(timestamp)
  const cached = Math.max(0, Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0))
  const uncached = Math.max(0, usage.inputTokens - cached)
  const amount = (
    cached * rates.cachedInput
    + uncached * rates.uncachedInput
    + usage.outputTokens * rates.output
  ) / 1_000_000
  return {
    amount,
    currency: 'CNY',
    precision: 'estimated',
    source: { ...DEEPSEEK_PRICE_SOURCE },
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`DeepSeek ${label} 响应格式无效。`)
  return value as Record<string, unknown>
}

function decimalString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(`DeepSeek ${label} 不是有效十进制金额。`)
  return value
}

async function accountSnapshot(
  profile: ProviderProfile,
  credentials: CredentialResolver,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<ProviderAccountSnapshot | undefined> {
  if (profile.providerId !== DEEPSEEK_PROVIDER_ID || profile.auth.type !== 'bearer') return undefined
  let base: URL
  try {
    base = new URL(profile.baseUrl)
  } catch {
    return undefined
  }
  // 余额接口只允许官方 Host，避免用户手工改 Profile 后把 API Key 发到第三方 endpoint。
  if (base.protocol !== 'https:' || base.hostname.toLowerCase() !== DEEPSEEK_API_HOST) return undefined
  const secret = await credentials.resolve(profile.auth.credential)
  if (!secret) return undefined

  const response = await fetcher(`https://${DEEPSEEK_API_HOST}/user/balance`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`DeepSeek balance HTTP ${response.status}`)
  const body = asRecord(await response.json(), 'balance')
  if (typeof body.is_available !== 'boolean' || !Array.isArray(body.balance_infos)) throw new Error('DeepSeek balance 缺少 is_available / balance_infos。')
  const balances = body.balance_infos.map((item, index) => {
    const value = asRecord(item, `balance_infos[${index}]`)
    const currency = typeof value.currency === 'string' ? value.currency : ''
    if (!currency) throw new Error(`DeepSeek balance_infos[${index}].currency 无效。`)
    return {
      currency,
      total: decimalString(value.total_balance, 'total_balance'),
      granted: decimalString(value.granted_balance, 'granted_balance'),
      toppedUp: decimalString(value.topped_up_balance, 'topped_up_balance'),
    }
  })
  return {
    providerId: profile.providerId,
    profileId: profile.id,
    billing: { kind: 'api', label: 'API' },
    checkedAt: new Date().toISOString(),
    available: body.is_available,
    balances,
  }
}

export function createDeepSeekTelemetryProvider(options: { fetcher?: typeof fetch } = {}): ProviderTelemetryProvider {
  const fetcher = options.fetcher ?? fetch
  const provider: ProviderTelemetryProvider = {
    providerId: DEEPSEEK_PROVIDER_ID,
    billingSource(profile: ProviderProfile): ProviderBillingSource {
      return profile.auth.type === 'bearer' ? { kind: 'api', label: 'API' } : { kind: 'unknown' }
    },
    modelDescriptor(_profile, model) {
      return modelDescriptor(model)
    },
    estimateCost({ identity, usage, timestamp }) {
      return estimateCost(identity.model, usage, timestamp)
    },
    accountSnapshot(profile, credentials, signal) {
      return accountSnapshot(profile, credentials, signal, fetcher)
    },
  }
  return Object.freeze(provider)
}

export const deepSeekTelemetryProvider: ProviderTelemetryProvider = createDeepSeekTelemetryProvider()
