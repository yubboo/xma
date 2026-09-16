/**
 * 文件作用：定义 XMA Session / Turn / Step 的 durable event Contract，并提供从事实日志重建模型请求历史的纯函数。
 * 关联模块：../context.ts、store.ts、../runtime.ts、../model.ts、未来 App Protocol/Session Projection。
 * 当前实现：Session Header、durable event、Context Snapshot、Model Message/Provider continuation 投影、Step 请求重建与 Session 基础统计。
 * 职责边界：本文件只描述可持久事实与投影，不执行模型请求、不做文件 IO，也不保存 Provider Secret。
 */

import type { ModelIdentity, ModelMessage, ModelToolCall, ModelToolSpec } from 'xma-ai'
import type { JsonObject, JsonValue } from 'xma-ai'
import type { ToolResultCode } from 'xma-tools'
import type { WorkspaceAccessGrant, WorkspaceBinding, WorkspacePermission } from 'xma-context'

export const SESSION_FORMAT_VERSION = 1 as const

export interface SessionHeader {
  formatVersion: typeof SESSION_FORMAT_VERSION
  sessionId: string
  agentId: string
  createdAt: string
  workspaceId?: string
  /** Stage D 新 Session 会把安全相关 Workspace identity 直接冻结进 Header；workspaceId 仅保留兼容索引。 */
  workspace?: WorkspaceBinding
}

export interface SessionEventMeta {
  sessionId: string
  sequence: number
  timestamp: string
}

export interface ContextSnapshotSourceRef {
  sourceId: string
  digest: string
  workspaceId?: string
}

export type SessionEventData =
  | { type: 'session/created'; agentId: string; workspaceId?: string; workspace?: WorkspaceBinding }
  | {
      type: 'workspace/access-granted'
      grantId: string
      workspaceId: string
      granteeAgentId: string
      permissions: readonly WorkspacePermission[]
      grantedBy: 'user'
      reason: string
    }
  | {
      type: 'workspace/access-revoked'
      grantId: string
      workspaceId: string
      reason: string
    }
  | {
      type: 'workspace/access-used'
      turnId: string
      stepId: string
      callId: string
      toolName: string
      workspaceId: string
      permission: WorkspacePermission
      grantId: string
    }
  | { type: 'turn/start'; turnId: string }
  | { type: 'user/message'; turnId: string; content: string }
  | { type: 'plan/snapshot'; turnId: string; content: string }
  | { type: 'plan/decision'; turnId: string; planTurnId: string; decision: 'yes' | 'no' }
  | {
      type: 'context/snapshot'
      turnId: string
      stepId: string
      digest: string
      content: string
      sources: readonly ContextSnapshotSourceRef[]
    }
  | {
      type: 'step/start'
      turnId: string
      stepId: string
      provider: ModelIdentity
      toolPlanId: string
      tools: readonly ModelToolSpec[]
      messageCount: number
      contextDigest?: string
    }
  | {
      type: 'assistant/message'
      turnId: string
      stepId: string
      content: string
      toolCalls: readonly ModelToolCall[]
      /** Provider 协议续传状态；例如某些 thinking+tools API 要求下一请求回传的隐藏状态。 */
      providerContinuation?: JsonObject
      interrupted: boolean
    }
  | {
      type: 'tool/approval'
      turnId: string
      stepId: string
      callId: string
      name: string
      requested: boolean
      decision: 'allow-once' | 'allow-session' | 'deny' | 'cached-session'
      cacheKey: string
      reason: string
    }
  | {
      type: 'tool/result'
      turnId: string
      stepId: string
      callId: string
      name: string
      ok: boolean
      code: ToolResultCode
      content: string
      data?: JsonValue
    }
  | {
      type: 'usage'
      turnId: string
      stepId: string
      inputTokens?: number
      outputTokens?: number
      cachedInputTokens?: number
      reasoningTokens?: number
      firstTokenLatencyMs?: number
      totalLatencyMs?: number
    }
  | {
      type: 'step/end'
      turnId: string
      stepId: string
      outcome: 'completed' | 'tool-calls' | 'cancelled' | 'failed'
    }
  | {
      type: 'turn/end'
      turnId: string
      outcome: 'completed' | 'cancelled' | 'failed'
      text: string
    }

export type SessionEvent = SessionEventMeta & SessionEventData
export type SessionEventInput = SessionEventData

export interface SessionSnapshot {
  header: SessionHeader
  events: readonly SessionEvent[]
}

export interface SessionStat {
  sessionId: string
  agentId: string
  workspaceId?: string
  createdAt: string
  updatedAt: string
  eventCount: number
}

function latestContext(events: readonly SessionEvent[]): Extract<SessionEvent, { type: 'context/snapshot' }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'context/snapshot') return event
  }
  return undefined
}

/**
 * 从 durable event 还原下一次模型请求的历史。
 * Context Snapshot 作为当前有效 system message 放在首位；user/assistant/tool 按 durable 顺序进入历史。
 */
export function deriveModelMessages(events: readonly SessionEvent[]): ModelMessage[] {
  const messages: ModelMessage[] = []
  const context = latestContext(events)
  if (context && context.content.length > 0) messages.push({ role: 'system', content: context.content })

  for (const event of events) {
    if (event.type === 'user/message') {
      messages.push({ role: 'user', content: event.content })
      continue
    }
    if (event.type === 'assistant/message') {
      const message: ModelMessage = { role: 'assistant', content: event.content }
      if (event.toolCalls.length > 0) message.toolCalls = event.toolCalls.map(call => structuredClone(call))
      if (event.providerContinuation) message.providerContinuation = structuredClone(event.providerContinuation)
      messages.push(message)
      continue
    }
    if (event.type === 'tool/result') {
      messages.push({ role: 'tool', content: event.content, toolCallId: event.callId, toolName: event.name })
    }
  }
  return messages
}


export function latestPlanSnapshot(events: readonly SessionEvent[]): Extract<SessionEvent, { type: 'plan/snapshot' }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'plan/snapshot') return event
  }
  return undefined
}

export function latestPlanDecision(events: readonly SessionEvent[], planTurnId?: string): Extract<SessionEvent, { type: 'plan/decision' }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'plan/decision') continue
    if (planTurnId === undefined || event.planTurnId === planTurnId) return event
  }
  return undefined
}

/** 用 Step Start 之前的 durable 事实重建该 Step 当时发给 Provider 的消息历史。 */
export function requestMessagesForStep(events: readonly SessionEvent[], stepId: string): readonly ModelMessage[] | undefined {
  const step = events.find(event => event.type === 'step/start' && event.stepId === stepId)
  if (step?.type !== 'step/start') return undefined
  return deriveModelMessages(events.filter(event => event.sequence < step.sequence))
}

/** 返回某个 Step 当时模型看到的 Tool Schema 快照，用于审计与重建。 */
export function requestToolsForStep(events: readonly SessionEvent[], stepId: string): readonly ModelToolSpec[] | undefined {
  const event = events.find(item => item.type === 'step/start' && item.stepId === stepId)
  return event?.type === 'step/start' ? event.tools : undefined
}

/** 返回某个 Step 绑定的 Context Snapshot；digest 不匹配时视为历史损坏。 */
export function requestContextForStep(events: readonly SessionEvent[], stepId: string): Extract<SessionEvent, { type: 'context/snapshot' }> | undefined {
  const step = events.find(event => event.type === 'step/start' && event.stepId === stepId)
  if (step?.type !== 'step/start') return undefined
  for (let index = events.findIndex(event => event.sequence === step.sequence) - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'context/snapshot') continue
    const expectedDigest = step.contextDigest ?? ''
    if (event.digest !== expectedDigest) throw new Error(`XMA context digest mismatch for step ${stepId}`)
    return event
  }
  if ((step.contextDigest ?? '') !== '') throw new Error(`XMA context snapshot missing for step ${stepId}`)
  return undefined
}

/** 从 durable grant/revoke 事件投影当前仍有效的跨 Workspace 授权。 */
export function activeWorkspaceGrants(events: readonly SessionEvent[], agentId?: string): WorkspaceAccessGrant[] {
  const grants = new Map<string, WorkspaceAccessGrant>()
  for (const event of events) {
    if (event.type === 'workspace/access-granted') {
      grants.set(event.grantId, {
        grantId: event.grantId,
        workspaceId: event.workspaceId,
        granteeAgentId: event.granteeAgentId,
        permissions: [...event.permissions],
        grantedBy: event.grantedBy,
        grantedAt: event.timestamp,
        reason: event.reason,
      })
      continue
    }
    if (event.type === 'workspace/access-revoked') grants.delete(event.grantId)
  }
  return [...grants.values()]
    .filter(grant => agentId === undefined || grant.granteeAgentId === agentId)
    .map(grant => structuredClone(grant))
}

/** 最小 JSON 可序列化检查，Store 在写盘前用于尽早拒绝循环引用/函数等非法 durable payload。 */
export function assertDurableJson(value: unknown): void {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('XMA durable value is not JSON serializable.')
  JSON.parse(encoded) as JsonObject | JsonValue
}
