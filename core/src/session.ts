/**
 * 文件作用：定义 XMA Session / Turn / Step 的 durable event Contract，并提供从事实日志重建模型历史的纯函数。
 * 关联模块：session-store.ts、runtime.ts、model.ts、未来 App Protocol/Session Projection。
 * 当前实现：Session Header、durable event 联合类型、Model Message 投影、Session 基础统计。
 * 职责边界：本文件只描述可持久事实与投影，不执行模型请求、不做文件 IO，也不保存 Provider Secret。
 */

import type { ModelIdentity, ModelMessage, ModelToolCall, ModelToolSpec } from './model.ts'
import type { JsonObject, JsonValue } from './types.ts'
import type { ToolResultCode } from './tools.ts'

export const SESSION_FORMAT_VERSION = 1 as const

export interface SessionHeader {
  formatVersion: typeof SESSION_FORMAT_VERSION
  sessionId: string
  agentId: string
  createdAt: string
  workspaceId?: string
}

export interface SessionEventMeta {
  sessionId: string
  sequence: number
  timestamp: string
}

export type SessionEventData =
  | { type: 'session/created'; agentId: string; workspaceId?: string }
  | { type: 'turn/start'; turnId: string }
  | { type: 'user/message'; turnId: string; content: string }
  | {
      type: 'step/start'
      turnId: string
      stepId: string
      provider: ModelIdentity
      tools: readonly ModelToolSpec[]
      messageCount: number
    }
  | {
      type: 'assistant/message'
      turnId: string
      stepId: string
      content: string
      toolCalls: readonly ModelToolCall[]
      interrupted: boolean
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

/**
 * 从 durable event 还原下一次模型请求的历史。
 * 只有明确标记为模型可见的 user/assistant/tool 三类事实进入请求；Turn/Step/Usage 等控制事件不会泄露给模型。
 */
export function deriveModelMessages(events: readonly SessionEvent[]): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      messages.push({ role: 'user', content: event.content })
      continue
    }
    if (event.type === 'assistant/message') {
      const message: ModelMessage = { role: 'assistant', content: event.content }
      if (event.toolCalls.length > 0) message.toolCalls = event.toolCalls.map(call => structuredClone(call))
      messages.push(message)
      continue
    }
    if (event.type === 'tool/result') {
      messages.push({ role: 'tool', content: event.content, toolCallId: event.callId, toolName: event.name })
    }
  }
  return messages
}

/** 返回某个 Step 当时模型看到的 Tool Schema 快照，用于审计与重建。 */
export function requestToolsForStep(events: readonly SessionEvent[], stepId: string): readonly ModelToolSpec[] | undefined {
  const event = events.find(item => item.type === 'step/start' && item.stepId === stepId)
  return event?.type === 'step/start' ? event.tools : undefined
}

/** 最小 JSON 可序列化检查，Store 在写盘前用于尽早拒绝循环引用/函数等非法 durable payload。 */
export function assertDurableJson(value: unknown): void {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('XMA durable value is not JSON serializable.')
  JSON.parse(encoded) as JsonObject | JsonValue
}
