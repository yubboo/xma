/**
 * 文件作用：实现 XMA Skill Registry、Agent↔Skill 绑定验证，并把专业 Skill 组装成可重建的模型 Context Source。
 * 关联模块：contract.ts、loader.ts、agent/contract.ts、agent/registry.ts、context.ts、runtime.ts。
 * 当前实现：Skill 注册/读取/列举、Agent loadout 校验、稳定顺序渲染、agent/skills Context Source。
 * 职责边界：Registry 不执行 Tool、不决定任务策略；Skill 文本只通过 Context Assembly 进入模型，并由 Session durable snapshot 保存实际可见内容。
 */

import type { AgentDefinition } from '../agent/contract.ts'
import { AgentRegistry } from '../agent/registry.ts'
import type { ContextSource } from '../context.ts'
import type { Disposer } from '../types.ts'
import type { LoadedSkill, SkillDefinition } from './contract.ts'

function cloneSkill(skill: LoadedSkill): LoadedSkill {
  return structuredClone(skill)
}

function validateBinding(agent: AgentDefinition, skill: LoadedSkill): void {
  const tools = new Set(agent.tools)
  for (const required of skill.definition.requires?.tools ?? []) {
    if (!tools.has(required)) {
      throw new Error(`XMA agent ${agent.id} binds Skill ${skill.definition.id} but does not declare required tool: ${required}`)
    }
  }

  const brain = new Set([...(agent.brain.required ?? []), ...(agent.brain.preferred ?? [])])
  for (const required of skill.definition.requires?.brain ?? []) {
    if (!brain.has(required)) {
      throw new Error(`XMA agent ${agent.id} binds Skill ${skill.definition.id} but does not declare required Brain capability: ${required}`)
    }
  }
}

function renderAgentSkillContext(agent: AgentDefinition, skills: readonly LoadedSkill[]): string {
  const sections = [
    '# XMA Agent',
    `Name: ${agent.name}`,
    `Identity: ${agent.id}`,
    `Role: ${agent.description}`,
    `Kind: ${agent.kind}`,
    '',
    '# Delivery Policy',
    agent.delivery.requireVerification
      ? '完成任务前必须提供可核验的完成证据，不得只声称“已经完成”。'
      : '按任务需要提供清晰交付结果。',
  ]
  if ((agent.delivery.evidence?.length ?? 0) > 0) sections.push(`Preferred evidence: ${agent.delivery.evidence!.join(', ')}`)

  for (const skill of skills) {
    sections.push('', `# Skill: ${skill.definition.name}`, `Skill ID: ${skill.definition.id}`, skill.instructions)
  }
  return sections.join('\n')
}

export class SkillRegistry {
  readonly #skills = new Map<string, LoadedSkill>()

  register(skill: LoadedSkill): Disposer {
    if (this.#skills.has(skill.definition.id)) throw new Error(`XMA Skill already registered: ${skill.definition.id}`)
    const snapshot = cloneSkill(skill)
    this.#skills.set(skill.definition.id, snapshot)
    return () => {
      if (this.#skills.get(skill.definition.id) === snapshot) this.#skills.delete(skill.definition.id)
    }
  }

  get(id: string): LoadedSkill | undefined {
    const skill = this.#skills.get(id)
    return skill ? cloneSkill(skill) : undefined
  }

  definition(id: string): SkillDefinition | undefined {
    return this.get(id)?.definition
  }

  list(): readonly LoadedSkill[] {
    return [...this.#skills.values()].sort((a, b) => a.definition.id.localeCompare(b.definition.id)).map(cloneSkill)
  }

  resolveForAgent(agent: AgentDefinition): readonly LoadedSkill[] {
    const result: LoadedSkill[] = []
    for (const id of agent.skills) {
      const skill = this.#skills.get(id)
      if (!skill) throw new Error(`XMA agent ${agent.id} requires unregistered Skill: ${id}`)
      validateBinding(agent, skill)
      result.push(cloneSkill(skill))
    }
    return result
  }

  renderForAgent(agent: AgentDefinition): string {
    return renderAgentSkillContext(agent, this.resolveForAgent(agent))
  }
}

/**
 * 把 Agent 身份 + 绑定 Skills 作为正式 Context Source 注入模型。
 * Runtime 随后会把实际渲染文本写成 durable context/snapshot，因此“模型看见的 Skill”可恢复、可审计。
 */
export function createAgentSkillContextSource(agents: AgentRegistry, skills: SkillRegistry): ContextSource {
  return {
    id: 'agent/skills',
    order: -500,
    render(request) {
      const agent = agents.require(request.header.agentId)
      return skills.renderForAgent(agent)
    },
  }
}
