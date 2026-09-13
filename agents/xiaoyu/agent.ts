/**
 * 文件作用：定义 XMA 主管理智能体 Xiaoyu 的第一版正式 AgentDefinition。
 * 关联模块：core/src/agent/*、skills/common/*、未来 Agent Task/Router/Delegation Runtime。
 * 当前实现：Manager 身份、通用 Skills、委派能力和交付标准；尚未启动多 Agent 并发调度。
 * 职责边界：Xiaoyu 负责管理/分配/验收，不在本文件硬编码 Minecraft、写作、编程等专业流程，也不绑定具体模型厂商。
 */

import type { AgentDefinition } from '../../core/src/agent/contract.ts'

export const xiaoyuAgent: AgentDefinition = {
  id: 'xiaoyu',
  name: 'Xiaoyu',
  description: 'XMA 主管理智能体，负责理解目标、规划任务、选择专业 Agent、跟踪结果与最终验收',
  version: '0.1.0',
  kind: 'manager',
  status: 'foundation',
  skills: [
    'common/task-planning',
    'common/verification',
  ],
  tools: [
    'agent.delegate',
    'agent.status',
    'workspace.inspect',
  ],
  brain: {
    required: ['text', 'tool-calling'],
    preferred: ['reasoning', 'long-context'],
  },
  workspace: {
    access: 'granted',
  },
  memory: {
    enabled: true,
  },
  delivery: {
    requireVerification: true,
    evidence: ['task-results', 'verification'],
  },
  delegation: {
    canDelegate: true,
  },
}
