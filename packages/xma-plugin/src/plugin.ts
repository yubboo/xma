/**
 * 文件作用：实现 XMA 的最小 Plugin Host、Context Service 容器和可逆副作用生命周期。
 * 关联模块：plugins/dsh-compat、tool/router.ts、model.ts。
 * 当前实现：service provide/get、ctx.<service> 代理读取、inject、apply(ctx)、effect/disposer、五种事件分发基础语义。
 * 职责边界：这里只负责插件生命周期，不负责 Agent 推理和 Native 副作用执行。
 */

export type Disposer = () => void | Promise<void>
export type ServiceKey = string

type EventListener = (...args: unknown[]) => unknown

export interface XmaPluginContext {
  /** 允许 DeepSeek Harness / Cordis 风格插件使用 ctx.tools 读取稳定 Service。 */
  [key: string]: unknown
  get<T = unknown>(key: ServiceKey): T | undefined
  require<T = unknown>(key: ServiceKey): T
  provide<T>(key: ServiceKey, service: T): Disposer
  effect(setup: () => void | Disposer | Promise<void | Disposer>, label?: string): Disposer
  on(event: string, listener: EventListener, options?: boolean | { prepend?: boolean }): Disposer
  once(event: string, listener: EventListener, options?: boolean | { prepend?: boolean }): Disposer
  emit(event: string, ...args: unknown[]): void
  parallel(event: string, ...args: unknown[]): Promise<void>
  serial(event: string, ...args: unknown[]): Promise<unknown>
  bail(event: string, ...args: unknown[]): unknown
  waterfall(event: string, ...args: unknown[]): unknown
}

export interface XmaPluginObject<Config = unknown> {
  id?: string
  inject?: readonly ServiceKey[]
  apply(context: XmaPluginContext, config?: Config): void | Disposer | Promise<void | Disposer>
}

export type XmaPluginFunction<Config = unknown> = ((context: XmaPluginContext, config?: Config) => void | Disposer | Promise<void | Disposer>) & {
  id?: string
  inject?: readonly ServiceKey[]
}

export type XmaPlugin<Config = unknown> = XmaPluginObject<Config> | XmaPluginFunction<Config>

class ContextImpl {
  readonly services = new Map<ServiceKey, unknown>()
  readonly events = new Map<string, EventListener[]>()
  readonly disposers = new Set<Disposer>()

  get<T = unknown>(key: ServiceKey): T | undefined {
    return this.services.get(key) as T | undefined
  }

  require<T = unknown>(key: ServiceKey): T {
    const value = this.get<T>(key)
    if (value === undefined) throw new Error(`XMA service not found: ${key}`)
    return value
  }

  provide<T>(key: ServiceKey, service: T): Disposer {
    if (this.services.has(key)) throw new Error(`XMA service already exists: ${key}`)
    this.services.set(key, service)
    const dispose = () => {
      if (this.services.get(key) === service) this.services.delete(key)
      this.disposers.delete(dispose)
    }
    this.disposers.add(dispose)
    return dispose
  }

  effect(setup: () => void | Disposer | Promise<void | Disposer>, _label?: string): Disposer {
    // Cordis 的 effect 要求 execute 立即启动；这里也立即调用 setup，再把可能的异步 disposer 包成统一释放函数。
    let settled: Promise<void | Disposer>
    try {
      settled = Promise.resolve(setup())
    } catch (error) {
      settled = Promise.reject(error)
    }
    let disposed = false
    const dispose: Disposer = async () => {
      if (disposed) return
      disposed = true
      const inner = await settled
      if (typeof inner === 'function') await inner()
      this.disposers.delete(dispose)
    }
    this.disposers.add(dispose)
    return dispose
  }

  on(event: string, listener: EventListener, options?: boolean | { prepend?: boolean }): Disposer {
    const listeners = this.events.get(event) ?? []
    const prepend = typeof options === 'boolean' ? options : options?.prepend === true
    if (prepend) listeners.unshift(listener)
    else listeners.push(listener)
    this.events.set(event, listeners)
    let active = true
    const dispose = () => {
      if (!active) return
      active = false
      const current = this.events.get(event)
      if (!current) return
      const index = current.indexOf(listener)
      if (index >= 0) current.splice(index, 1)
      this.disposers.delete(dispose)
    }
    this.disposers.add(dispose)
    return dispose
  }

  once(event: string, listener: EventListener, options?: boolean | { prepend?: boolean }): Disposer {
    let dispose: Disposer = () => undefined
    const wrapped: EventListener = (...args) => {
      dispose()
      return listener(...args)
    }
    dispose = this.on(event, wrapped, options)
    return dispose
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.events.get(event) ?? [])]) listener(...args)
  }

  async parallel(event: string, ...args: unknown[]): Promise<void> {
    await Promise.all([...(this.events.get(event) ?? [])].map(listener => Promise.resolve(listener(...args))))
  }

  async serial(event: string, ...args: unknown[]): Promise<unknown> {
    for (const listener of [...(this.events.get(event) ?? [])]) {
      const value = await listener(...args)
      if (value !== null && value !== undefined && value !== false) return value
    }
    return undefined
  }

  bail(event: string, ...args: unknown[]): unknown {
    for (const listener of [...(this.events.get(event) ?? [])]) {
      const value = listener(...args)
      if (value !== null && value !== undefined && value !== false) return value
    }
    return undefined
  }

  waterfall(event: string, ...args: unknown[]): unknown {
    const listeners = [...(this.events.get(event) ?? [])]
    // Cordis waterfall 的最后一个参数是最内层 next；每一层 listener 可以调用 next() 包裹下游，也可以直接短路。
    const fallback = typeof args.at(-1) === 'function' ? args.pop() as () => unknown : () => undefined
    const invoke = (index: number): unknown => {
      if (index >= listeners.length) return fallback()
      const listener = listeners[index]!
      return listener(...args, () => invoke(index + 1))
    }
    return invoke(0)
  }

  async disposeAll(): Promise<void> {
    const list = [...this.disposers].reverse()
    this.disposers.clear()
    for (const dispose of list) await dispose()
  }
}

function createScopedContext(parent: XmaPluginContext): { context: XmaPluginContext; dispose: Disposer } {
  const owned: Disposer[] = []
  const scopeTarget = {
    get<T = unknown>(key: ServiceKey): T | undefined { return parent.get<T>(key) },
    require<T = unknown>(key: ServiceKey): T { return parent.require<T>(key) },
    provide<T>(key: ServiceKey, service: T): Disposer {
      const dispose = parent.provide(key, service)
      owned.push(dispose)
      return dispose
    },
    effect(setup: () => void | Disposer | Promise<void | Disposer>, label?: string): Disposer {
      const dispose = parent.effect(setup, label)
      owned.push(dispose)
      return dispose
    },
    on(event: string, listener: EventListener, options?: boolean | { prepend?: boolean }): Disposer {
      const dispose = parent.on(event, listener, options)
      owned.push(dispose)
      return dispose
    },
    once(event: string, listener: EventListener, options?: boolean | { prepend?: boolean }): Disposer {
      const dispose = parent.once(event, listener, options)
      owned.push(dispose)
      return dispose
    },
    emit(event: string, ...args: unknown[]): void { parent.emit(event, ...args) },
    parallel(event: string, ...args: unknown[]): Promise<void> { return parent.parallel(event, ...args) },
    serial(event: string, ...args: unknown[]): Promise<unknown> { return parent.serial(event, ...args) },
    bail(event: string, ...args: unknown[]): unknown { return parent.bail(event, ...args) },
    waterfall(event: string, ...args: unknown[]): unknown { return parent.waterfall(event, ...args) },
  }
  const context = new Proxy(scopeTarget, {
    get: (target, property, receiver) => {
      if (typeof property === 'string' && !(property in target)) return parent.get(property)
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? (value as Function).bind(target) : value
    },
  }) as unknown as XmaPluginContext
  const dispose: Disposer = async () => {
    for (const ownedDispose of [...owned].reverse()) await ownedDispose()
    owned.length = 0
  }
  return { context, dispose }
}

export class XmaPluginHost {
  readonly context: XmaPluginContext
  readonly #contextImpl: ContextImpl
  readonly #mounted = new Map<string, Disposer>()
  #counter = 0

  constructor() {
    this.#contextImpl = new ContextImpl()
    // Cordis Context 本身就是 Proxy；XMA 用同样的访问体验让 ctx.tools 自动解析稳定 Service key。
    this.context = new Proxy(this.#contextImpl, {
      get: (target, property, receiver) => {
        if (typeof property === 'string' && !(property in target) && target.services.has(property)) return target.services.get(property)
        const value = Reflect.get(target, property, receiver) as unknown
        return typeof value === 'function' ? (value as Function).bind(target) : value
      },
    }) as unknown as XmaPluginContext
  }

  async mount<Config>(plugin: XmaPlugin<Config>, config?: Config): Promise<string> {
    const object: XmaPluginObject<Config> = typeof plugin === 'function'
      ? {
          ...(plugin.id ? { id: plugin.id } : {}),
          ...(plugin.inject ? { inject: plugin.inject } : {}),
          apply: plugin,
        }
      : plugin
    const id = object.id ?? `plugin-${++this.#counter}`
    if (this.#mounted.has(id)) throw new Error(`XMA plugin already mounted: ${id}`)

    // 0.1.0 先做确定性依赖检查；后续 Compatibility Layer 会升级成 Cordis 风格“等待 Service 就绪后再启动”。
    for (const key of object.inject ?? []) this.context.require(key)

    const scope = createScopedContext(this.context)
    let result: void | Disposer
    try {
      result = await object.apply(scope.context, config)
    } catch (error) {
      await scope.dispose()
      throw error
    }
    const pluginDispose: Disposer = typeof result === 'function' ? result : () => undefined
    const dispose: Disposer = async () => {
      await pluginDispose()
      await scope.dispose()
    }
    this.#mounted.set(id, dispose)
    return id
  }

  async unmount(id: string): Promise<void> {
    const dispose = this.#mounted.get(id)
    if (!dispose) return
    this.#mounted.delete(id)
    await dispose()
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.#mounted.keys()].reverse()) await this.unmount(id)
    await this.#contextImpl.disposeAll()
  }
}
