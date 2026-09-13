/**
 * 文件作用：实现 XMA 正式 Session → Turn → Step Agent Runtime 主驱动。
 * 关联模块：session.ts、session-store.ts、model.ts、tools.ts、未来 Context/Provider Registry/App Protocol。
 * 当前实现：创建/恢复 Session、多 Step Tool Loop、冻结请求快照、durable/live event 分层、取消结算与单 Session 并发保护。
 * 职责边界：Runtime 只编排稳定生命周期；专业 Agent 特例、厂商协议、Approval/Native 安全实现必须走各自扩展层，禁止塞进主循环。
 */

import { randomUUID } from 'node:crypto'
import type { ModelEvent, ModelMessage, ModelProvider, ModelToolCall, ModelToolSpec } from './model.ts'
import { deriveModelMessages, SESSION_FORMAT_VERSION, type SessionEvent, type SessionEventInput, type SessionHeader, type SessionSnapshot } from './session.ts'
import type { SessionHandle, SessionStore } from './session-store.ts'
import { ToolRegistry, type ToolResult } from './tools.ts'
import type { Disposer, JsonValue } from './types.ts'

export type RuntimeLiveEvent =
  | { type: 'session/event'; event: SessionEvent }
  | { type: 'model/text-delta'; sessionId: string; turnId: string; stepId: string; text: string }
  | { type: 'model/reasoning-delta'; sessionId: string; turnId: string; stepId: string; text: string }

export type RuntimeEventListener = (event: RuntimeLiveEvent) => void

export interface CreateSessionOptions {
  agentId: string
  sessionId?: string
  workspaceId?: string
}

export interface RunTurnOptions {
  provider: ModelProvider
  tools: ToolRegistry
  input: string
  signal: AbortSignal
  maxToolCalls?: number
}

export interface TurnRunResult {
  sessionId: string
  turnId: string
  status: 'completed' | 'cancelled' | 'failed'
  text: string
  toolCalls: number
  steps: number
}

function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function freezeMessages(messages: readonly ModelMessage[]): readonly ModelMessage[] {
  return deepFreeze(structuredClone(messages))
}

function freezeTools(tools: readonly ModelToolSpec[]): readonly ModelToolSpec[] {
  return deepFreeze(structuredClone(tools))
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

function normalizeUsage(previous: { inputTokens?: number; outputTokens?: number }, event: Extract<ModelEvent, { type: 'usage' }>): void {
  // Provider adapter 在 Stage B 负责把“累计/增量”差异归一化；当前 Contract 以最后一个已提供值作为本 Step 的结算快照。
  if (event.inputTokens !== undefined) previous.inputTokens = event.inputTokens
  if (event.outputTokens !== undefined) previous.outputTokens = event.outputTokens
}

function toolResultEvent(result: ToolResult, context: { turnId: string; stepId: string; call: ModelToolCall }): SessionEventInput {
  const event: SessionEventInput = {
    type: 'tool/result',
    turnId: context.turnId,
    stepId: context.stepId,
    callId: context.call.callId,
    name: context.call.name,
    ok: result.ok,
    code: result.code,
    content: result.content,
  }
  if (result.data !== undefined) {
    ;(event as Extract<SessionEventInput, { type: 'tool/result' }>).data = structuredClone(result.data) as JsonValue
  }
  return event
}

export class AgentSession {
  readonly #listeners: Set<RuntimeEventListener>
  #activeTurn = false
  #closed = false

  constructor(
    readonly header: SessionHeader,
    private readonly handle: SessionHandle,
    listeners: Set<RuntimeEventListener>,
    private readonly onClose: () => void,
  ) {
    this.#listeners = listeners
  }

  get id(): string {
    return this.header.sessionId
  }

  snapshot(): SessionSnapshot {
    return this.handle.snapshot()
  }

  messages(): ModelMessage[] {
    return deriveModelMessages(this.handle.snapshot().events)
  }

  async runTurn(options: RunTurnOptions): Promise<TurnRunResult> {
    this.#assertOpen()
    if (this.#activeTurn) throw new Error(`XMA session already has an active turn: ${this.id}`)
    this.#activeTurn = true

    const turnId = createId('turn')
    let steps = 0
    let toolCalls = 0
    let finalText = ''
    const maxToolCalls = options.maxToolCalls ?? 32

    try {
      await this.#append([
        { type: 'turn/start', turnId },
        { type: 'user/message', turnId, content: options.input },
      ])

      while (true) {
        const stepId = createId('step')
        steps += 1

        if (options.signal.aborted) {
          await this.#append([{ type: 'turn/end', turnId, outcome: 'cancelled', text: finalText }])
          await this.handle.flush()
          return { sessionId: this.id, turnId, status: 'cancelled', text: finalText, toolCalls, steps: steps - 1 }
        }

        const messages = freezeMessages(deriveModelMessages(this.handle.snapshot().events))
        const toolSpecs = freezeTools(options.tools.specs())
        await this.#append([{
          type: 'step/start',
          turnId,
          stepId,
          provider: structuredClone(options.provider.identity),
          tools: structuredClone(toolSpecs),
          messageCount: messages.length,
        }])

        let assistantText = ''
        const pendingToolCalls: ModelToolCall[] = []
        const usage: { inputTokens?: number; outputTokens?: number } = {}

        try {
          for await (const event of options.provider.stream({ messages, tools: toolSpecs, signal: options.signal })) {
            if (options.signal.aborted) throw Object.assign(new Error('XMA model request aborted.'), { name: 'AbortError' })
            if (event.type === 'text') {
              assistantText += event.text
              this.#emit({ type: 'model/text-delta', sessionId: this.id, turnId, stepId, text: event.text })
              continue
            }
            if (event.type === 'reasoning') {
              // 原始 reasoning 默认只作为 live event，不进入 durable history，避免把隐藏推理当成后续模型上下文。
              this.#emit({ type: 'model/reasoning-delta', sessionId: this.id, turnId, stepId, text: event.text })
              continue
            }
            if (event.type === 'tool-call') {
              pendingToolCalls.push({ callId: event.callId, name: event.name, arguments: structuredClone(event.arguments) })
              continue
            }
            normalizeUsage(usage, event)
          }
        } catch (error) {
          if (!isAbortError(error, options.signal)) {
            await this.#append([
              { type: 'step/end', turnId, stepId, outcome: 'failed' },
              { type: 'turn/end', turnId, outcome: 'failed', text: assistantText },
            ])
            await this.handle.flush()
            throw error
          }

          if (assistantText.length > 0 || pendingToolCalls.length > 0) {
            await this.#append([{
              type: 'assistant/message',
              turnId,
              stepId,
              content: assistantText,
              toolCalls: structuredClone(pendingToolCalls),
              interrupted: true,
            }])
          }
          toolCalls += pendingToolCalls.length
          for (const call of pendingToolCalls) {
            await this.#append([toolResultEvent(
              { ok: false, code: 'TOOL_ABORTED', content: 'Tool call aborted before execution.' },
              { turnId, stepId, call },
            )])
          }
          await this.#append([
            { type: 'step/end', turnId, stepId, outcome: 'cancelled' },
            { type: 'turn/end', turnId, outcome: 'cancelled', text: assistantText },
          ])
          await this.handle.flush()
          return { sessionId: this.id, turnId, status: 'cancelled', text: assistantText, toolCalls, steps }
        }

        await this.#append([{
          type: 'assistant/message',
          turnId,
          stepId,
          content: assistantText,
          toolCalls: structuredClone(pendingToolCalls),
          interrupted: false,
        }])
        finalText = assistantText

        if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
          const usageEvent: Extract<SessionEventInput, { type: 'usage' }> = { type: 'usage', turnId, stepId }
          if (usage.inputTokens !== undefined) usageEvent.inputTokens = usage.inputTokens
          if (usage.outputTokens !== undefined) usageEvent.outputTokens = usage.outputTokens
          await this.#append([usageEvent])
        }

        if (pendingToolCalls.length === 0) {
          await this.#append([
            { type: 'step/end', turnId, stepId, outcome: 'completed' },
            { type: 'turn/end', turnId, outcome: 'completed', text: assistantText },
          ])
          await this.handle.flush()
          return { sessionId: this.id, turnId, status: 'completed', text: assistantText, toolCalls, steps }
        }

        let exceededLimit = false
        for (const call of pendingToolCalls) {
          toolCalls += 1
          let result: ToolResult
          if (toolCalls > maxToolCalls) {
            exceededLimit = true
            result = { ok: false, code: 'TOOL_CALL_LIMIT', content: `XMA tool call limit exceeded: ${maxToolCalls}` }
          } else if (options.signal.aborted) {
            result = { ok: false, code: 'TOOL_ABORTED', content: 'Tool call aborted before execution.' }
          } else {
            result = await options.tools.execute(call.name, call.arguments, {
              runId: this.id,
              sessionId: this.id,
              turnId,
              stepId,
              signal: options.signal,
            })
          }
          await this.#append([toolResultEvent(result, { turnId, stepId, call })])
        }

        if (options.signal.aborted) {
          await this.#append([
            { type: 'step/end', turnId, stepId, outcome: 'cancelled' },
            { type: 'turn/end', turnId, outcome: 'cancelled', text: assistantText },
          ])
          await this.handle.flush()
          return { sessionId: this.id, turnId, status: 'cancelled', text: assistantText, toolCalls, steps }
        }

        if (exceededLimit) {
          await this.#append([
            { type: 'step/end', turnId, stepId, outcome: 'failed' },
            { type: 'turn/end', turnId, outcome: 'failed', text: assistantText },
          ])
          await this.handle.flush()
          return { sessionId: this.id, turnId, status: 'failed', text: assistantText, toolCalls, steps }
        }

        await this.#append([{ type: 'step/end', turnId, stepId, outcome: 'tool-calls' }])
      }
    } finally {
      this.#activeTurn = false
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    if (this.#activeTurn) throw new Error(`Cannot close XMA session with active turn: ${this.id}`)
    this.#closed = true
    try {
      await this.handle.close()
    } finally {
      this.onClose()
    }
  }

  async #append(inputs: readonly SessionEventInput[]): Promise<void> {
    const events = await this.handle.append(inputs)
    for (const event of events) this.#emit({ type: 'session/event', event })
  }

  #emit(event: RuntimeLiveEvent): void {
    for (const listener of [...this.#listeners]) listener(event)
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`XMA session is closed: ${this.id}`)
  }
}

export class AgentRuntime {
  readonly #listeners = new Set<RuntimeEventListener>()
  readonly #sessions = new Map<string, AgentSession>()

  constructor(readonly store: SessionStore) {}

  subscribe(listener: RuntimeEventListener): Disposer {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const sessionId = options.sessionId ?? createId('session')
    if (this.#sessions.has(sessionId)) throw new Error(`XMA session already attached: ${sessionId}`)
    const header: SessionHeader = {
      formatVersion: SESSION_FORMAT_VERSION,
      sessionId,
      agentId: options.agentId,
      createdAt: new Date().toISOString(),
    }
    if (options.workspaceId !== undefined) header.workspaceId = options.workspaceId
    const handle = await this.store.create(header)
    const session = this.#attach(handle)
    const created: SessionEventInput = { type: 'session/created', agentId: options.agentId }
    if (options.workspaceId !== undefined) created.workspaceId = options.workspaceId
    const events = await handle.append([created])
    for (const event of events) for (const listener of [...this.#listeners]) listener({ type: 'session/event', event })
    await handle.flush()
    return session
  }

  async resumeSession(sessionId: string): Promise<AgentSession> {
    if (this.#sessions.has(sessionId)) throw new Error(`XMA session already attached: ${sessionId}`)
    const handle = await this.store.open(sessionId, 'write')
    return this.#attach(handle)
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.#sessions.values()]
    for (const session of sessions) await session.close()
  }

  #attach(handle: SessionHandle): AgentSession {
    const sessionId = handle.header.sessionId
    const session = new AgentSession(handle.header, handle, this.#listeners, () => {
      if (this.#sessions.get(sessionId) === session) this.#sessions.delete(sessionId)
    })
    this.#sessions.set(sessionId, session)
    return session
  }
}
