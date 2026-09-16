/**
 * 文件作用：定义 XMA 内建 Provider 产品目录，把用户看到的真实 Provider 品牌与底层协议 Adapter 分离。
 * 关联模块：xma-ai、apps/cli Brain/Provider 管理。
 * 当前实现：首个真实品牌入口 DeepSeek Official，以及自定义 OpenAI-compatible 入口；DeepSeek 使用官方 endpoint 与动态 /models 发现。
 * 职责边界：目录项只描述已真实实现的品牌接入模板，不保存 Secret、不伪造 Ready；未完成真实接入的 OpenAI/Claude/Gemini 等不得冒充可用项。
 */

import type { JsonObject } from 'xma-ai'
import { OPENAI_COMPATIBLE_ADAPTER_ID } from 'xma-ai'

export const DEEPSEEK_PROVIDER_ID = 'deepseek'
export const CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID = 'custom-openai-compatible'


export const DEEPSEEK_CURRENT_MODELS = Object.freeze([
  'deepseek-flash',
  'deepseek-v4-pro',
] as const)

export const DEEPSEEK_DEPRECATED_MODEL_IDS = Object.freeze(new Set<string>([
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
]))

export interface ProviderCatalogEntry {
  id: string
  displayName: string
  description: string
  adapterId: string
  /** 品牌官方 endpoint；自定义 Provider 不提供固定值。 */
  baseUrl?: string
  /** 只用于首次创建 Profile 的 bootstrap；真实可用模型以 /models 或目标 Provider catalog 为准。 */
  defaultModel?: string
  credentialRequired: boolean
  options?: JsonObject
}

const BUILTIN_PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = Object.freeze([
  Object.freeze({
    id: DEEPSEEK_PROVIDER_ID,
    displayName: 'DeepSeek',
    description: 'DeepSeek 官方 API · 动态读取真实模型列表',
    adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
    baseUrl: 'https://api.deepseek.com',
    defaultModel: DEEPSEEK_CURRENT_MODELS[0],
    credentialRequired: true,
    options: Object.freeze({
      includeUsage: true,
      modelCatalogDiscovery: true,
      nativeToolCalling: true,
      parallelToolCalls: true,
      reasoning: true,
      thinkingMode: 'enabled',
      reasoningContentToolContinuation: true,
      toolProbeThinkingMode: 'disabled',
      promptCaching: true,
    }),
  }),
  Object.freeze({
    id: CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID,
    displayName: '自定义 OpenAI-compatible',
    description: '自定义兼容 endpoint · Base URL / Model 由用户提供',
    adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
    credentialRequired: false,
    options: Object.freeze({
      includeUsage: true,
      modelCatalogDiscovery: false,
      nativeToolCalling: true,
    }),
  }),
])

export function listBuiltinProviderCatalog(): readonly ProviderCatalogEntry[] {
  return BUILTIN_PROVIDER_CATALOG.map(entry => structuredClone(entry))
}

export function providerCatalogDisplayName(providerId: string): string {
  return BUILTIN_PROVIDER_CATALOG.find(item => item.id === providerId)?.displayName ?? providerId
}

export function builtinProviderCatalogEntry(providerId: string): ProviderCatalogEntry | undefined {
  const entry = BUILTIN_PROVIDER_CATALOG.find(item => item.id === providerId)
  return entry ? structuredClone(entry) : undefined
}
