/**
 * 文件作用：定义 XMA Skill 的机器可读元数据与已加载 Skill 文档 Contract。
 * 关联模块：registry.ts、loader.ts、agent/contract.ts、skills/*。
 * 当前实现：SkillDefinition、SkillRequirements、LoadedSkill；Skill 只表达专业工作方法和能力要求。
 * 职责边界：Skill 不是 Plugin/Tool，也不保存 Secret、Session 或模型厂商配置；真正程序能力必须由 Tool/Plugin 提供。
 */

import type { AgentBrainCapability } from 'xma-agent-loop'

export interface SkillRequirements {
  tools?: readonly string[]
  brain?: readonly AgentBrainCapability[]
}

export interface SkillDefinition {
  id: string
  name: string
  description: string
  version: string
  requires?: SkillRequirements
  tags?: readonly string[]
}

export interface LoadedSkill {
  definition: SkillDefinition
  instructions: string
  directory: string
}
