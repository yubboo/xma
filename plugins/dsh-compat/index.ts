/**
 * 文件作用：把 DeepSeek Harness / Cordis 风格插件适配到 XMA Plugin Host。
 * 关联模块：xma-plugin、docs/architecture/PLUGIN-SYSTEM.md。
 * 当前实现：对象/函数插件、inject、apply(ctx)、ctx.<service>、effect 和基础事件 API 的兼容入口。
 * 职责边界：这不是对所有 DSH 专属 Service 的“已完成兼容”声明；每个 Service 仍需要 Bridge 与 Conformance Test。
 */

import type { Disposer, XmaPlugin, XmaPluginContext, XmaPluginObject } from 'xma-plugin'

export interface DeepSeekHarnessPluginObject<Config = unknown> {
  inject?: readonly string[]
  apply(context: XmaPluginContext, config?: Config): void | Disposer | Promise<void | Disposer>
}

export type DeepSeekHarnessPluginFunction<Config = unknown> = ((context: XmaPluginContext, config?: Config) => void | Disposer | Promise<void | Disposer>) & {
  inject?: readonly string[]
}

export type DeepSeekHarnessPluginLike<Config = unknown> = DeepSeekHarnessPluginObject<Config> | DeepSeekHarnessPluginFunction<Config>

export function adaptDeepSeekHarnessPlugin<Config>(id: string, plugin: DeepSeekHarnessPluginLike<Config>): XmaPlugin<Config> {
  if (typeof plugin === 'function') {
    const adapted = plugin as XmaPlugin<Config> & { id?: string; inject?: readonly string[] }
    adapted.id = `dsh:${id}`
    return adapted
  }

  // exactOptionalPropertyTypes 开启后，可选字段不能显式赋值 undefined；只有插件真的声明 inject 时才写入。
  const adapted: XmaPluginObject<Config> = {
    id: `dsh:${id}`,
    apply(context: XmaPluginContext, config?: Config) {
      return plugin.apply(context, config)
    },
  }
  if (plugin.inject) adapted.inject = plugin.inject
  return adapted
}
