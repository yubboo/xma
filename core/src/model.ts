/**
 * 文件作用：定义 XMA 对外部大模型的统一 Model Provider 请求/流事件 Contract，以及 Runtime 可持久重建的规范化消息结构。
 * 关联模块：runtime.ts、session.ts、provider.ts、tools.ts、plugins/providers/。
 * 当前实现：模型身份、消息、Tool Call、流式文本/Reasoning/Usage 事件和统一请求接口。
 * 职责边界：XMA 不在这里实现“自己的弱模型”；厂商 JSON、认证、Catalog、Probe 与错误映射必须通过 Provider Adapter 注入。
 */

import type { JsonObject } from './types.ts'

export interface ModelIdentity {
  provider: string
  model: string
  displayName?: string
}

export interface ModelToolCall {
  callId: string
  name: string
  arguments: JsonObject
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Assistant 规范化 Tool Call；真实 Provider adapter 负责把它映射回厂商协议。 */
  toolCalls?: readonly ModelToolCall[]
  /** Tool Observation 对应的调用 ID。 */
  toolCallId?: string
  /** Tool Observation 的稳定工具名，便于协议适配与审计。 */
  toolName?: string
}

export interface ModelToolSpec {
  name: string
  description: string
  inputSchema: JsonObject
}

export type ModelEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; callId: string; name: string; arguments: JsonObject }
  | {
      type: 'usage'
      inputTokens?: number
      outputTokens?: number
      cachedInputTokens?: number
      reasoningTokens?: number
    }

export interface ModelRequest {
  /** Runtime 在发起 Step 前冻结当前可见历史，Provider 不得就地修改。 */
  messages: readonly ModelMessage[]
  /** 与实际 Tool Runtime 同源的冻结 ToolPlan 模型可见部分。 */
  tools: readonly ModelToolSpec[]
  signal: AbortSignal
}

export interface ModelProvider {
  readonly identity: ModelIdentity
  stream(request: ModelRequest): AsyncIterable<ModelEvent>
}
