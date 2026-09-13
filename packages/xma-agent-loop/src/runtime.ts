/**
 * 文件作用：实现 XMA 正式 Session → Turn → Step Agent Runtime 主驱动。
 * 关联模块：context.ts、session/contract.ts、session/store.ts、model.ts、tool/router.ts、provider.ts、未来 App Protocol。
 * 当前实现：创建/恢复 Session、durable Context Assembly、多 Step Tool Loop、Provider continuation round-trip、冻结请求快照、取消结算与请求延迟记录。
 * 职责边界：Runtime 只编排稳定生命周期；专业 Agent 特例、厂商协议、Approval/Native 安全实现必须走各自扩展层，禁止塞进主循环。
 */

import { randomUUID } from 'node:crypto'
import { ContextRegistry, type WorkspaceAccessGrant, type WorkspaceAccessRequest, type WorkspacePermission, type WorkspaceRegistry } from 'xma-context'
import type { ModelEvent, ModelMessage, ModelProvider, ModelToolCall, ModelToolSpec } from 'xma-ai'
import { activeWorkspaceGrants, deriveModelMessages, SESSION_FORMAT_VERSION, type SessionEvent, type SessionEventInput, type SessionHeader, type SessionSnapshot } from 'xma-session'
import type { SessionHandle, SessionStore } from 'xma-session'
import { ToolApprovalSessionCache, ToolRegistry, type ToolApprovalProvider, type ToolPolicy, type ToolResult, type ToolSecurityGuard } from 'xma-tools'
import type { JsonObject, JsonValue } from 'xma-ai'
type Disposer = () => void | Promise<void>
import { WorkspaceToolSecurityGuard } from 'xma-tools'

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
  /** Tool Policy 默认 standard；真实副作用在没有 Approval Provider 时 fail closed。 */
  policy?: ToolPolicy
  /** Host/UI/CLI 提供用户确认；未提供时 write/execute/network 默认拒绝。 */
  approvals?: ToolApprovalProvider
  /** 额外单调 Security Guard；任一 deny 都不可被后续层恢复。 */
  guards?: readonly ToolSecurityGuard[]
}

export interface TurnRunResult {
  sessionId: string
  turnId: string
  status: 'completed' | 'cancelled' | 'failed'
  text: string
  toolCalls: number
  steps: number
}

export interface AgentRuntimeOptions {
  context?: ContextRegistry
  /** Stage D Workspace Registry；带 workspaceId 的新 Session 必须通过这里解析稳定 Binding。 */
  workspaces?: WorkspaceRegistry
  /** Product Host 可开启强制 Workspace；默认 false 保留 0.1.x workspace-less 测试/兼容入口。 */
  requireWorkspace?: boolean
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

interface UsageAccumulator {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
}

function normalizeUsage(previous: UsageAccumulator, event: Extract<ModelEvent, { type: 'usage' }>): void {
  // Provider adapter 负责把厂商累计/增量语义归一化；Core 只保留该 Step 最后一个已提供的结算值。
  if (event.inputTokens !== undefined) previous.inputTokens = event.inputTokens
  if (event.outputTokens !== undefined) previous.outputTokens = event.outputTokens
  if (event.cachedInputTokens !== undefined) previous.cachedInputTokens = event.cachedInputTokens
  if (event.reasoningTokens !== undefined) previous.reasoningTokens = event.reasoningTokens
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

function latestContextEvent(snapshot: SessionSnapshot): Extract<SessionEvent, { type: 'context/snapshot' }> | undefined {
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index]
    if (event?.type === 'context/snapshot') return event
  }
  return undefined
}

export class AgentSession {
  readonly #listeners: Set<RuntimeEventListener>
  #activeTurn = false
  #closed = false
  readonly #approvalCache = new ToolApprovalSessionCache()

  constructor(
    readonly header: SessionHeader,
    private readonly handle: SessionHandle,
    private readonly context: ContextRegistry,
    private readonly workspaces: WorkspaceRegistry | undefined,
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

  workspaceGrants(): WorkspaceAccessGrant[] {
    return activeWorkspaceGrants(this.handle.snapshot().events, this.header.agentId)
  }

  authorizeWorkspaceAccess(request: WorkspaceAccessRequest) {
    if (!this.workspaces) return { allow: false, reason: 'XMA Workspace Registry is not configured.' } as const
    return this.workspaces.authorize(this.header.agentId, request, this.workspaceGrants())
  }

  /** 用户显式授权当前 Agent Session 访问另一个 Workspace；授权事实先 durable append，再允许后续 Tool/Context 使用。 */
  async grantWorkspaceAccess(input: { workspaceId: string; permissions: readonly WorkspacePermission[]; reason: string }): Promise<WorkspaceAccessGrant> {
    this.#assertOpen()
    if (!this.workspaces) throw new Error('XMA Workspace Registry is not configured.')
    const grant = this.workspaces.normalizeGrant({
      grantId: createId('workspace-grant'),
      workspaceId: input.workspaceId,
      granteeAgentId: this.header.agentId,
      permissions: input.permissions,
      grantedBy: 'user',
      grantedAt: new Date().toISOString(),
      reason: input.reason,
    })
    await this.#append([{
      type: 'workspace/access-granted',
      grantId: grant.grantId,
      workspaceId: grant.workspaceId,
      granteeAgentId: grant.granteeAgentId,
      permissions: [...grant.permissions],
      grantedBy: grant.grantedBy,
      reason: grant.reason,
    }])
    await this.handle.flush()
    return structuredClone(grant)
  }

  async revokeWorkspaceAccess(grantId: string, reason: string): Promise<void> {
    this.#assertOpen()
    const grant = this.workspaceGrants().find(item => item.grantId === grantId)
    if (!grant) throw new Error(`XMA workspace grant not found or already revoked: ${grantId}`)
    const normalizedReason = reason.trim()
    if (!normalizedReason) throw new Error('XMA workspace grant revocation requires an explicit reason.')
    await this.#append([{ type: 'workspace/access-revoked', grantId, workspaceId: grant.workspaceId, reason: normalizedReason }])
    await this.handle.flush()
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

        let contextDigest = ''
        try {
          const beforeAssembly = this.handle.snapshot()
          const assembly = await this.context.assemble({
            header: structuredClone(this.header),
            snapshot: beforeAssembly,
            turnId,
            stepId,
            signal: options.signal,
            ...(this.header.workspace ? { workspace: structuredClone(this.header.workspace) } : {}),
            authorizeWorkspaceAccess: request => this.authorizeWorkspaceAccess(request),
          })
          contextDigest = assembly.content.length > 0 ? assembly.digest : ''
          const previousContext = latestContextEvent(beforeAssembly)
          const previousDigest = previousContext?.digest ?? ''
          if (contextDigest !== previousDigest) {
            await this.#append([{
              type: 'context/snapshot',
              turnId,
              stepId,
              digest: contextDigest,
              content: assembly.content,
              sources: assembly.sections.map(section => ({
                sourceId: section.sourceId,
                digest: section.digest,
                ...(section.workspaceId !== undefined ? { workspaceId: section.workspaceId } : {}),
              })),
            }])
          }
        } catch (error) {
          if (isAbortError(error, options.signal)) {
            await this.#append([{ type: 'turn/end', turnId, outcome: 'cancelled', text: finalText }])
            await this.handle.flush()
            return { sessionId: this.id, turnId, status: 'cancelled', text: finalText, toolCalls, steps: steps - 1 }
          }
          await this.#append([{ type: 'turn/end', turnId, outcome: 'failed', text: finalText }])
          await this.handle.flush()
          throw error
        }

        const messages = freezeMessages(deriveModelMessages(this.handle.snapshot().events))
        // 当前 Step 只创建一次 ToolPlan：模型看到的 Schema 和稍后执行的 Runtime 必须来自同一个冻结计划。
        const toolPlan = options.tools.createPlan()
        const toolSpecs = freezeTools(toolPlan.modelVisibleSpecs())
        // Approval 可能来自并发工具；用 promise chain 保证 durable audit 串行，并且在 execute 前真正 append 完成。
        let approvalAppend: Promise<void> = Promise.resolve()
        const workspaceGuard = this.workspaces
          ? new WorkspaceToolSecurityGuard(this.workspaces, this.header.agentId, () => this.workspaceGrants())
          : undefined
        const guards = [...(workspaceGuard ? [workspaceGuard] : []), ...(options.guards ?? [])]
        const toolRouter = toolPlan.createRouter({
          ...(options.policy ? { policy: options.policy } : {}),
          ...(options.approvals ? { approvals: options.approvals } : {}),
          ...(guards.length > 0 ? { guards } : {}),
          approvalCache: this.#approvalCache,
          onApproval: (call, approval) => {
            const append = approvalAppend.then(() => this.#append([{
              type: 'tool/approval',
              turnId,
              stepId,
              callId: call.callId,
              name: call.name,
              requested: approval.requested,
              decision: approval.decision,
              cacheKey: approval.cacheKey,
              reason: approval.reason,
            }]))
            approvalAppend = append
            return append
          },
          onWorkspaceAccess: async (call, access) => {
            if (!this.workspaces) throw new Error('XMA Workspace Registry is not configured.')
            const decision = this.authorizeWorkspaceAccess(access)
            if (!decision.allow) throw new Error(decision.reason)
            // Owner 访问不制造额外噪音；只有跨 Agent grant 真正被 Tool 使用时才 durable 记录。
            if (decision.via === 'grant') {
              await this.#append([{
                type: 'workspace/access-used',
                turnId,
                stepId,
                callId: call.callId,
                toolName: call.name,
                workspaceId: access.workspaceId,
                permission: access.permission,
                grantId: decision.grantId,
              }])
            }
          },
        })
        await this.#append([{
          type: 'step/start',
          turnId,
          stepId,
          provider: structuredClone(options.provider.identity),
          toolPlanId: toolPlan.id,
          tools: structuredClone(toolSpecs),
          messageCount: messages.length,
          contextDigest,
        }])

        let assistantText = ''
        let providerContinuation: JsonObject | undefined
        const pendingToolCalls: ModelToolCall[] = []
        const usage: UsageAccumulator = {}
        const requestStartedAt = performance.now()
        let firstResponseAt: number | undefined

        try {
          for await (const event of options.provider.stream({ messages, tools: toolSpecs, signal: options.signal })) {
            if (options.signal.aborted) throw Object.assign(new Error('XMA model request aborted.'), { name: 'AbortError' })
            if (event.type === 'text') {
              firstResponseAt ??= performance.now()
              assistantText += event.text
              this.#emit({ type: 'model/text-delta', sessionId: this.id, turnId, stepId, text: event.text })
              continue
            }
            if (event.type === 'reasoning') {
              firstResponseAt ??= performance.now()
              // 原始 reasoning 不作为普通 assistant 文本；协议必须续传的部分只能由 Adapter 另行发 provider-continuation。
              this.#emit({ type: 'model/reasoning-delta', sessionId: this.id, turnId, stepId, text: event.text })
              continue
            }
            if (event.type === 'provider-continuation') {
              providerContinuation = structuredClone(event.data)
              continue
            }
            if (event.type === 'tool-call') {
              firstResponseAt ??= performance.now()
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
              ...(providerContinuation ? { providerContinuation: structuredClone(providerContinuation) } : {}),
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

        const requestFinishedAt = performance.now()
        await this.#append([{
          type: 'assistant/message',
          turnId,
          stepId,
          content: assistantText,
          toolCalls: structuredClone(pendingToolCalls),
          ...(providerContinuation ? { providerContinuation: structuredClone(providerContinuation) } : {}),
          interrupted: false,
        }])
        finalText = assistantText

        const usageEvent: Extract<SessionEventInput, { type: 'usage' }> = {
          type: 'usage',
          turnId,
          stepId,
          totalLatencyMs: Math.max(0, requestFinishedAt - requestStartedAt),
        }
        if (firstResponseAt !== undefined) usageEvent.firstTokenLatencyMs = Math.max(0, firstResponseAt - requestStartedAt)
        if (usage.inputTokens !== undefined) usageEvent.inputTokens = usage.inputTokens
        if (usage.outputTokens !== undefined) usageEvent.outputTokens = usage.outputTokens
        if (usage.cachedInputTokens !== undefined) usageEvent.cachedInputTokens = usage.cachedInputTokens
        if (usage.reasoningTokens !== undefined) usageEvent.reasoningTokens = usage.reasoningTokens
        await this.#append([usageEvent])

        if (pendingToolCalls.length === 0) {
          await this.#append([
            { type: 'step/end', turnId, stepId, outcome: 'completed' },
            { type: 'turn/end', turnId, outcome: 'completed', text: assistantText },
          ])
          await this.handle.flush()
          return { sessionId: this.id, turnId, status: 'completed', text: assistantText, toolCalls, steps }
        }

        let exceededLimit = false
        const dispatchable: ModelToolCall[] = []
        const limited = new Map<string, ToolResult>()
        for (const call of pendingToolCalls) {
          toolCalls += 1
          if (toolCalls > maxToolCalls) {
            exceededLimit = true
            limited.set(call.callId, { ok: false, code: 'TOOL_CALL_LIMIT', content: `XMA tool call limit exceeded: ${maxToolCalls}` })
          } else if (options.signal.aborted) {
            limited.set(call.callId, { ok: false, code: 'TOOL_ABORTED', content: 'Tool call aborted before execution.' })
          } else {
            dispatchable.push(call)
          }
        }

        const dispatches = await toolRouter.dispatchMany(dispatchable, {
          runId: this.id,
          sessionId: this.id,
          turnId,
          stepId,
          signal: options.signal,
          ...(this.header.workspace ? { workspace: structuredClone(this.header.workspace) } : {}),
        })
        const byCallId = new Map(dispatches.map(outcome => [outcome.call.callId, outcome]))

        for (const call of pendingToolCalls) {
          const dispatched = byCallId.get(call.callId)
          const result = limited.get(call.callId) ?? dispatched?.result ?? {
            ok: false,
            code: 'TOOL_EXECUTION_ERROR' as const,
            content: 'XMA internal tool dispatch result missing.',
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
  readonly context: ContextRegistry
  readonly workspaces: WorkspaceRegistry | undefined
  readonly requireWorkspace: boolean

  constructor(readonly store: SessionStore, options: AgentRuntimeOptions = {}) {
    this.context = options.context ?? new ContextRegistry()
    this.workspaces = options.workspaces
    this.requireWorkspace = options.requireWorkspace ?? false
    if (this.requireWorkspace && this.workspaces === undefined) {
      throw new Error('XMA requireWorkspace needs a WorkspaceRegistry.')
    }
  }

  subscribe(listener: RuntimeEventListener): Disposer {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const sessionId = options.sessionId ?? createId('session')
    if (this.#sessions.has(sessionId)) throw new Error(`XMA session already attached: ${sessionId}`)
    if (this.requireWorkspace && options.workspaceId === undefined) {
      throw new Error(`XMA session requires a Workspace: ${sessionId}`)
    }
    const workspace = options.workspaceId !== undefined
      ? this.workspaces?.bindOwned(options.workspaceId, options.agentId)
      : undefined
    if (options.workspaceId !== undefined && workspace === undefined) {
      throw new Error('XMA workspaceId requires AgentRuntimeOptions.workspaces.')
    }
    const header: SessionHeader = {
      formatVersion: SESSION_FORMAT_VERSION,
      sessionId,
      agentId: options.agentId,
      createdAt: new Date().toISOString(),
    }
    if (workspace !== undefined) {
      header.workspaceId = workspace.workspaceId
      header.workspace = structuredClone(workspace)
    }
    const handle = await this.store.create(header)
    const session = this.#attach(handle)
    const created: SessionEventInput = { type: 'session/created', agentId: options.agentId }
    if (workspace !== undefined) {
      created.workspaceId = workspace.workspaceId
      created.workspace = structuredClone(workspace)
    }
    const events = await handle.append([created])
    for (const event of events) for (const listener of [...this.#listeners]) listener({ type: 'session/event', event })
    await handle.flush()
    return session
  }

  async resumeSession(sessionId: string): Promise<AgentSession> {
    if (this.#sessions.has(sessionId)) throw new Error(`XMA session already attached: ${sessionId}`)
    const handle = await this.store.open(sessionId, 'write')
    try {
      if (handle.header.workspace !== undefined) {
        if (!this.workspaces) throw new Error(`XMA session ${sessionId} has a Workspace binding but Runtime has no WorkspaceRegistry.`)
        if (handle.header.workspaceId !== handle.header.workspace.workspaceId) {
          throw new Error(`XMA session ${sessionId} Workspace header identity is inconsistent.`)
        }
        const current = this.workspaces.verifyBinding(handle.header.workspace)
        if (current.ownerAgentId !== handle.header.agentId) {
          throw new Error(`XMA session ${sessionId} cannot resume as owner of Workspace ${current.workspaceId}; owner is ${current.ownerAgentId}.`)
        }
      } else if (this.requireWorkspace) {
        throw new Error(`XMA session ${sessionId} is legacy/unbound but this Runtime requires Workspace binding.`)
      }
      return this.#attach(handle)
    } catch (error) {
      await handle.close()
      throw error
    }
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.#sessions.values()]
    for (const session of sessions) await session.close()
  }

  #attach(handle: SessionHandle): AgentSession {
    const sessionId = handle.header.sessionId
    const session = new AgentSession(handle.header, handle, this.context, this.workspaces, this.#listeners, () => {
      if (this.#sessions.get(sessionId) === session) this.#sessions.delete(sessionId)
    })
    this.#sessions.set(sessionId, session)
    return session
  }
}
