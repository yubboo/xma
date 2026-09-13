/**
 * 文件作用：定义 Xiaoyu Manager 与专业 Agent 之间的任务委派 Contract，并提供最小的授权校验服务。
 * 关联模块：contract.ts、registry.ts、未来 durable Task Store / App Protocol / Multi-Agent Runtime。
 * 当前实现：AgentTask、Task status、用户/Agent 请求来源和 createTask() 委派校验；任务执行与持久化留给后续阶段。
 * 职责边界：本文件不启动子 Agent、不复制 Session、不做模型规划；它只保证“谁能把什么任务分给谁”的稳定边界。
 */

import { randomUUID } from 'node:crypto'
import type { JsonValue } from 'xma-ai'
import { AgentRegistry } from './registry.ts'

export type AgentTaskStatus = 'queued' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled'

export type AgentTaskRequester =
  | { type: 'user' }
  | { type: 'agent'; agentId: string }

export interface AgentTaskInput {
  id?: string
  parentTaskId?: string
  requestedBy: AgentTaskRequester
  assignedTo: string
  objective: string
  workspaceId: string
  inputs?: readonly JsonValue[]
}

export interface AgentTask {
  id: string
  parentTaskId?: string
  requestedBy: AgentTaskRequester
  assignedTo: string
  objective: string
  workspaceId: string
  inputs: readonly JsonValue[]
  status: AgentTaskStatus
  createdAt: string
}

function taskId(): string {
  return `task-${randomUUID()}`
}

/**
 * AgentDelegationService 只创建经过 Registry/Policy 校验的 Task 快照。
 * durable Task 生命周期、并发调度、重试和结果验收会在 Xiaoyu Manager 阶段接到 Session/Event 层。
 */
export class AgentDelegationService {
  constructor(readonly agents: AgentRegistry) {}

  createTask(input: AgentTaskInput): AgentTask {
    const target = this.agents.require(input.assignedTo)
    const objective = input.objective.trim()
    const workspaceId = input.workspaceId.trim()
    if (!objective) throw new Error('XMA agent task objective cannot be empty.')
    if (!workspaceId) throw new Error('XMA agent task workspaceId cannot be empty.')

    if (input.requestedBy.type === 'agent') {
      const requester = this.agents.require(input.requestedBy.agentId)
      if (!requester.delegation.canDelegate) {
        throw new Error(`XMA agent cannot delegate tasks: ${requester.id}`)
      }
      const allowlist = requester.delegation.allowedAgentIds
      if (allowlist && !allowlist.includes(target.id)) {
        throw new Error(`XMA agent ${requester.id} cannot delegate to ${target.id}`)
      }
    }

    const result: AgentTask = {
      id: input.id?.trim() || taskId(),
      ...(input.parentTaskId?.trim() ? { parentTaskId: input.parentTaskId.trim() } : {}),
      requestedBy: structuredClone(input.requestedBy),
      assignedTo: target.id,
      objective,
      workspaceId,
      inputs: structuredClone(input.inputs ?? []),
      status: 'queued',
      createdAt: new Date().toISOString(),
    }
    return Object.freeze(result)
  }
}
