/**
 * 文件作用：实现 XMA AgentDefinition Registry、不可变快照与基础一致性验证。
 * 关联模块：contract.ts、delegation.ts、skill/registry.ts、agents/*。
 * 当前实现：注册/读取/列举 Agent、按 kind 过滤、检测重复 Skill/Tool/Brain capability 与非法委派目标。
 * 职责边界：Registry 不执行 Agent、不选择模型、不读取 Workspace，也不把专业业务写进 Core。
 */

import type { Disposer } from '../types.ts'
import type { AgentBrainCapability, AgentDefinition, AgentKind } from './contract.ts'

const AGENT_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function assertUnique(values: readonly string[], label: string, agentId: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (!value.trim()) throw new Error(`XMA agent ${agentId} has empty ${label}.`)
    if (seen.has(value)) throw new Error(`XMA agent ${agentId} has duplicate ${label}: ${value}`)
    seen.add(value)
  }
}

function assertCapabilities(values: readonly AgentBrainCapability[], label: string, agentId: string): void {
  assertUnique(values, label, agentId)
}

function cloneDefinition(definition: AgentDefinition): AgentDefinition {
  return structuredClone(definition)
}

function validateDefinition(definition: AgentDefinition): void {
  if (!AGENT_ID_PATTERN.test(definition.id)) throw new Error(`Invalid XMA agent id: ${definition.id}`)
  if (!definition.name.trim()) throw new Error(`XMA agent ${definition.id} is missing name.`)
  if (!definition.description.trim()) throw new Error(`XMA agent ${definition.id} is missing description.`)
  if (!VERSION_PATTERN.test(definition.version)) throw new Error(`XMA agent ${definition.id} has invalid version: ${definition.version}`)
  assertUnique(definition.skills, 'skill binding', definition.id)
  assertUnique(definition.tools, 'tool requirement', definition.id)
  assertCapabilities(definition.brain.required, 'required Brain capability', definition.id)
  assertCapabilities(definition.brain.preferred ?? [], 'preferred Brain capability', definition.id)
  const required = new Set(definition.brain.required)
  for (const preferred of definition.brain.preferred ?? []) {
    if (required.has(preferred)) throw new Error(`XMA agent ${definition.id} repeats Brain capability in required/preferred: ${preferred}`)
  }
  assertUnique(definition.delivery.evidence ?? [], 'delivery evidence', definition.id)
  assertUnique(definition.delegation.allowedAgentIds ?? [], 'delegation target', definition.id)
  if (!definition.delegation.canDelegate && (definition.delegation.allowedAgentIds?.length ?? 0) > 0) {
    throw new Error(`XMA agent ${definition.id} cannot declare delegation targets when canDelegate=false.`)
  }
}

export class AgentRegistry {
  readonly #definitions = new Map<string, AgentDefinition>()

  register(definition: AgentDefinition): Disposer {
    validateDefinition(definition)
    if (this.#definitions.has(definition.id)) throw new Error(`XMA agent already registered: ${definition.id}`)
    const snapshot = cloneDefinition(definition)
    this.#definitions.set(definition.id, snapshot)
    return () => {
      if (this.#definitions.get(definition.id) === snapshot) this.#definitions.delete(definition.id)
    }
  }

  get(id: string): AgentDefinition | undefined {
    const definition = this.#definitions.get(id)
    return definition ? cloneDefinition(definition) : undefined
  }

  require(id: string): AgentDefinition {
    const definition = this.get(id)
    if (!definition) throw new Error(`XMA agent not registered: ${id}`)
    return definition
  }

  list(kind?: AgentKind): readonly AgentDefinition[] {
    return [...this.#definitions.values()]
      .filter(definition => kind === undefined || definition.kind === kind)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(cloneDefinition)
  }

  validateDelegationTargets(): void {
    for (const definition of this.#definitions.values()) {
      for (const target of definition.delegation.allowedAgentIds ?? []) {
        if (!this.#definitions.has(target)) {
          throw new Error(`XMA agent ${definition.id} delegates to unregistered agent: ${target}`)
        }
      }
    }
  }
}
