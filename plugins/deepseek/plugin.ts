/**
 * 文件作用：注册 XMA 官方 Provider Registry、Credentials Service 与第一条 OpenAI-compatible Adapter。
 * 关联模块：xma-ai、xma-plugin。
 * 当前实现：环境变量 + 进程内凭据解析、Provider Registry 服务和 OpenAI-compatible Adapter 生命周期。
 * 职责边界：这里只注册能力，不内置任何用户 API Key、不预置“已 Ready”状态；具体 Profile 必须由用户配置并通过真实 Probe。
 */

import {
  CompositeCredentialResolver,
  EnvironmentCredentialResolver,
  MemoryCredentialResolver,
  ProviderRegistry,
} from 'xma-ai'
import type { XmaPlugin } from 'xma-plugin'
import { OpenAiCompatibleAdapter } from 'xma-ai'

export const MODEL_PROVIDER_REGISTRY = 'xma.modelProviders'
export const MEMORY_CREDENTIALS = 'xma.memoryCredentials'

export const builtinProviderRegistryPlugin: XmaPlugin = {
  id: 'xma.providers.registry',
  apply(context) {
    const memoryCredentials = new MemoryCredentialResolver()
    const credentials = new CompositeCredentialResolver([
      memoryCredentials,
      new EnvironmentCredentialResolver(),
    ])
    const registry = new ProviderRegistry(credentials)
    const disposeAdapter = registry.registerAdapter(new OpenAiCompatibleAdapter())
    context.provide(MEMORY_CREDENTIALS, memoryCredentials)
    context.provide(MODEL_PROVIDER_REGISTRY, registry)
    return disposeAdapter
  },
}
