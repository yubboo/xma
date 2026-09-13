/**
 * 文件作用：定义 XMA 专业 Agent 的稳定身份 Contract 与 Registry。
 * 关联模块：runtime.ts、agents/*、未来 Agent Profile/Plugin preset。
 * 当前实现：AgentDefinition 注册、读取和列举，避免 Host 用散落字符串判断专业 Agent。
 * 职责边界：Registry 只管理身份与静态元数据，不包含模型选择、业务决策树或 Workspace 副作用。
 */

export interface AgentDefinition {
  id: string
  name: string
  description: string
  status?: 'skeleton' | 'priority-development' | 'ready'
}

export class AgentRegistry {
  readonly #definitions = new Map<string, AgentDefinition>()

  register(definition: AgentDefinition): void {
    if (this.#definitions.has(definition.id)) throw new Error(`XMA agent already registered: ${definition.id}`)
    this.#definitions.set(definition.id, Object.freeze({ ...definition }))
  }

  get(id: string): AgentDefinition | undefined {
    const definition = this.#definitions.get(id)
    return definition ? { ...definition } : undefined
  }

  list(): AgentDefinition[] {
    return [...this.#definitions.values()].map(definition => ({ ...definition }))
  }
}
