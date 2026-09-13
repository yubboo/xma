/**
 * 文件作用：定义 XMA Agent 平台最稳定的专业身份、Brain、Workspace、Memory、交付与委派 Contract。
 * 关联模块：registry.ts、delegation.ts、skill/*、agents/*、runtime.ts、未来 Host/Marketplace。
 * 当前实现：AgentDefinition、Brain capability、Workspace/Memory/Delivery/Delegation Policy 等基础类型。
 * 职责边界：Agent 只描述专业身份和能力组合，不保存 Session 瞬时状态，也不绑定具体模型厂商或第三方 Host。
 */

export type AgentKind = 'manager' | 'specialist'
export type AgentStatus = 'foundation' | 'ready'

/**
 * Agent 对 Brain 能力的抽象要求。这里描述“需要什么智力能力”，而不是绑定 OpenAI/Claude/DeepSeek 等厂商。
 */
export type AgentBrainCapability =
  | 'text'
  | 'tool-calling'
  | 'reasoning'
  | 'vision'
  | 'file-input'
  | 'image-output'
  | 'web-search'
  | 'long-context'

export interface AgentBrainPolicy {
  required: readonly AgentBrainCapability[]
  preferred?: readonly AgentBrainCapability[]
}

export interface AgentWorkspacePolicy {
  /** owned：默认只使用自己的 Workspace；granted：允许经 durable grant 使用他人 Workspace；none：不需要 Workspace。 */
  access: 'owned' | 'granted' | 'none'
}

export interface AgentMemoryPolicy {
  enabled: boolean
}

export interface AgentDeliveryPolicy {
  /** 专业 Agent 完成任务前是否必须给出验证证据，而不是只声称“已经完成”。 */
  requireVerification: boolean
  /** 可选的交付证据类别，例如 test/diff/source/preview。 */
  evidence?: readonly string[]
}

export interface AgentDelegationPolicy {
  /** Manager Agent 可为 true；普通专家默认 false。 */
  canDelegate: boolean
  /** 不填表示可委派给 Registry 中任意 Agent；填入则限制目标 Agent ID。 */
  allowedAgentIds?: readonly string[]
}

/**
 * Agent = 专业身份 + Skill + Tool + Brain/Workspace/Memory/Delivery Policy。
 * 它不是 Model、Prompt、Workspace、Plugin 或 Session 的别名。
 */
export interface AgentDefinition {
  id: string
  name: string
  description: string
  version: string
  kind: AgentKind
  status: AgentStatus
  skills: readonly string[]
  tools: readonly string[]
  brain: AgentBrainPolicy
  workspace: AgentWorkspacePolicy
  memory: AgentMemoryPolicy
  delivery: AgentDeliveryPolicy
  delegation: AgentDelegationPolicy
}
