/**
 * 文件作用：预留 XMA 官方 Provider Plugin 的注册入口。
 * 关联模块：core/src/model.ts、core/src/plugin.ts。
 * 当前实现：只定义服务键和 Provider Registry 骨架，不伪造任何“已连接模型”。
 * 职责边界：OpenAI/Claude/Gemini/DeepSeek/MiMo 必须后续通过真实 API/订阅适配与 Probe 才能标记 Ready。
 */

import type { ModelProvider } from '../../core/src/model.ts'
import type { XmaPlugin } from '../../core/src/plugin.ts'

export const MODEL_PROVIDER_REGISTRY = 'xma.modelProviders'

export class ModelProviderRegistry {
  readonly #providers = new Map<string, ModelProvider>()

  register(id: string, provider: ModelProvider): void {
    this.#providers.set(id, provider)
  }

  get(id: string): ModelProvider | undefined {
    return this.#providers.get(id)
  }
}

export const builtinProviderRegistryPlugin: XmaPlugin = {
  id: 'xma.providers.registry',
  apply(context) {
    return context.provide(MODEL_PROVIDER_REGISTRY, new ModelProviderRegistry())
  },
}
