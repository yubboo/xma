/**
 * 文件作用：定义 XMA 对外部大模型的统一 Provider Contract。
 * 关联模块：agent.ts、plugins/providers/、plugin.ts。
 * 当前实现：模型身份、消息、Tool Call 和流式事件的最小接口。
 * 职责边界：XMA 不在这里实现“自己的弱模型”；具体厂商适配必须通过 Provider/Plugin 注入。
 */

import type { JsonObject } from './types.ts'

export interface ModelIdentity {
  provider: string
  model: string
  displayName?: string
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
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
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }

export interface ModelRequest {
  messages: ModelMessage[]
  tools: ModelToolSpec[]
  signal: AbortSignal
}

export interface ModelProvider {
  readonly identity: ModelIdentity
  stream(request: ModelRequest): AsyncIterable<ModelEvent>
}
