/**
 * 文件作用：实现 XMA typed Tool Definition、Registry、冻结 ToolPlan、ToolRouter 与完整 Tool 执行流水线。
 * 关联模块：../runtime.ts、../session/contract.ts、schema.ts、policy.ts、../native.ts、未来 Plugin/DSH Compatibility。
 * 当前实现：确定性 ToolPlan、Schema 校验、Policy、单调 Security Guard、Approval、parallel-safe/exclusive 调度、结构化 Result 与 Session Approval Cache。
 * 职责边界：Registry/Router 不替模型选择工具；真实 OS 权限必须由 Rust Native Kernel 再次 enforcement，任何 Tool 普通失败都应结构化回模型而非炸毁 Session。
 */

import type { ModelToolCall, ModelToolSpec } from 'xma-ai'
import { validateToolArguments } from './schema.ts'
import {
  AllowToolSecurityGuard,
  DefaultToolPolicy,
  DenyToolApprovalProvider,
  ToolApprovalSessionCache,
  type ToolApprovalDecision,
  type ToolApprovalProvider,
  type ToolEffect,
  type ToolExecutionMode,
  type ToolPolicy,
  type ToolPolicyRequest,
  type ToolSecurityGuard,
} from './policy.ts'
import type { JsonObject, JsonValue } from 'xma-ai'
type Disposer = () => void | Promise<void>
import type { WorkspaceAccessRequest, WorkspaceBinding } from 'xma-context'

export interface ToolContext {
  runId: string
  signal: AbortSignal
  sessionId?: string
  turnId?: string
  stepId?: string
  /** 当前 Session 的稳定 Workspace Binding；无 Workspace 的 legacy Session 为空。 */
  workspace?: WorkspaceBinding
}

export type ToolResultCode =
  | 'OK'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_INVALID_ARGUMENTS'
  | 'TOOL_POLICY_DENIED'
  | 'TOOL_SECURITY_DENIED'
  | 'TOOL_APPROVAL_DENIED'
  | 'TOOL_EXECUTION_ERROR'
  | 'TOOL_ABORTED'
  | 'TOOL_CALL_LIMIT'
  | 'TOOL_NATIVE_ERROR'

export interface ToolResult {
  ok: boolean
  code: ToolResultCode
  content: string
  data?: JsonValue
}

export interface XmaTool {
  spec: ModelToolSpec
  /** 旧 0.1.0 工具未声明时按 read 兼容；新真实副作用工具必须显式声明。 */
  effect?: ToolEffect
  /** parallel-safe 只适合真正无共享副作用/可重入的工具；默认 exclusive 以 fail-safe 为先。 */
  executionMode?: ToolExecutionMode
  /** allow-session 的稳定缓存粒度；未声明时 fail-safe 为单调用不复用，避免把一次参数授权扩成整个工具授权。 */
  approvalKey?(argumentsValue: JsonObject): string
  /** Approval UI 的关键摘要；禁止依赖 UI 自己从参数猜风险。 */
  approvalSummary?(argumentsValue: JsonObject): readonly string[]
  /** 声明本次 Tool Call 需要访问哪个 Workspace；用于 Workspace Security Guard。 */
  workspaceAccess?(argumentsValue: JsonObject, context: ToolContext): WorkspaceAccessRequest | undefined
  execute(argumentsValue: JsonObject, context: ToolContext): Promise<ToolResult>
  /** 执行后可做脱敏/裁剪；抛错会变成 TOOL_EXECUTION_ERROR。 */
  finalize?(result: ToolResult, argumentsValue: JsonObject, context: ToolContext): ToolResult | Promise<ToolResult>
}

interface FrozenToolEntry {
  readonly name: string
  readonly spec: ModelToolSpec
  readonly effect: ToolEffect
  readonly executionMode: ToolExecutionMode
  readonly runtime: XmaTool
}

export interface ToolPlanSnapshot {
  id: string
  specs: readonly ModelToolSpec[]
}

export interface ToolRouterOptions {
  policy?: ToolPolicy
  guards?: readonly ToolSecurityGuard[]
  approvals?: ToolApprovalProvider
  approvalCache?: ToolApprovalSessionCache
  /** Approval 已形成最终决策后、任何真实 execute 之前调用；Runtime 用它先持久化审计事实。 */
  onApproval?: (call: ModelToolCall, audit: ToolApprovalAudit) => void | Promise<void>
  /** Workspace Guard 已允许且 Approval 已结束后、真实 execute 前调用；Runtime 用于 durable cross-workspace audit。 */
  onWorkspaceAccess?: (call: ModelToolCall, access: WorkspaceAccessRequest) => void | Promise<void>
}

export interface ToolApprovalAudit {
  requested: boolean
  decision: ToolApprovalDecision | 'cached-session'
  cacheKey: string
  reason: string
}

export interface ToolDispatchOutcome {
  call: ModelToolCall
  result: ToolResult
  approval?: ToolApprovalAudit
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function cloneSpec(spec: ModelToolSpec): ModelToolSpec {
  return deepFreeze(structuredClone(spec))
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function toolPlanId(entries: readonly FrozenToolEntry[]): string {
  const canonical = entries.map(entry => ({
    name: entry.name,
    effect: entry.effect,
    executionMode: entry.executionMode,
    spec: entry.spec,
  }))
  return `tool-plan:v1:${fnv1a32(JSON.stringify(canonical))}`
}

function normalizeTool(tool: XmaTool): FrozenToolEntry {
  const name = tool.spec.name.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(name)) throw new Error(`Invalid XMA tool name: ${tool.spec.name}`)
  if (!tool.spec.description.trim()) throw new Error(`XMA tool ${name} must have a non-empty description.`)
  if (tool.spec.inputSchema === null || Array.isArray(tool.spec.inputSchema)) throw new Error(`XMA tool ${name} inputSchema must be an object.`)
  const effect = tool.effect ?? 'read'
  const executionMode = tool.executionMode ?? 'exclusive'
  const spec = cloneSpec({ ...tool.spec, name })
  // 捕获当前函数引用并绑定原 Tool instance；创建 Plan 后再修改 Registry Tool 对象也不能改变该 Step 的执行面。
  const runtime: XmaTool = Object.freeze({
    spec,
    effect,
    executionMode,
    ...(tool.approvalKey ? { approvalKey: tool.approvalKey.bind(tool) } : {}),
    ...(tool.approvalSummary ? { approvalSummary: tool.approvalSummary.bind(tool) } : {}),
    ...(tool.workspaceAccess ? { workspaceAccess: tool.workspaceAccess.bind(tool) } : {}),
    execute: tool.execute.bind(tool),
    ...(tool.finalize ? { finalize: tool.finalize.bind(tool) } : {}),
  })
  return Object.freeze({ name, spec, effect, executionMode, runtime })
}

function approvalFallbackSummary(call: ModelToolCall): readonly string[] {
  const raw = JSON.stringify(call.arguments)
  return Object.freeze([raw.length <= 240 ? raw : `${raw.slice(0, 237)}...`])
}

function policyRequest(entry: FrozenToolEntry, call: ModelToolCall, context: ToolContext): ToolPolicyRequest {
  const request: ToolPolicyRequest = {
    toolName: entry.name,
    effect: entry.effect,
    arguments: structuredClone(call.arguments),
    runId: context.runId,
    callId: call.callId,
  }
  if (context.sessionId !== undefined) request.sessionId = context.sessionId
  if (context.turnId !== undefined) request.turnId = context.turnId
  if (context.stepId !== undefined) request.stepId = context.stepId
  const workspaceAccess = entry.runtime.workspaceAccess?.(call.arguments, context)
  if (workspaceAccess !== undefined) request.workspaceAccess = structuredClone(workspaceAccess)
  return request
}

function approvalCacheKey(entry: FrozenToolEntry, call: ModelToolCall): string {
  const suffix = entry.runtime.approvalKey?.(call.arguments)?.trim()
  // 没有稳定 scope key 时禁止把 allow-session 扩成“整个工具永久放行”；callId 保证只命中当前调用。
  return suffix ? `${entry.name}:${suffix}` : `${entry.name}:call:${call.callId}`
}

function requestId(call: ModelToolCall): string {
  return `approval:${call.callId}`
}

/** 一个 Step 的模型可见 Schema 与真实 Runtime 的不可变配对。 */
export class ToolPlan {
  readonly id: string
  readonly #entries: ReadonlyMap<string, FrozenToolEntry>
  readonly #specs: readonly ModelToolSpec[]

  constructor(entries: readonly FrozenToolEntry[]) {
    const ordered = [...entries].sort((a, b) => compareNames(a.name, b.name))
    this.#entries = new Map(ordered.map(entry => [entry.name, entry]))
    this.#specs = Object.freeze(ordered.map(entry => cloneSpec(entry.spec)))
    this.id = toolPlanId(ordered)
    Object.freeze(this)
  }

  snapshot(): ToolPlanSnapshot {
    return Object.freeze({ id: this.id, specs: this.#specs })
  }

  modelVisibleSpecs(): readonly ModelToolSpec[] {
    return this.#specs
  }

  entry(name: string): FrozenToolEntry | undefined {
    return this.#entries.get(name)
  }

  createRouter(options: ToolRouterOptions = {}): ToolRouter {
    return new ToolRouter(this, options)
  }
}

/**
 * Router 固定消费一个 ToolPlan；模型在当前 Step 看到什么，就只能执行该 Plan 中同一个 Runtime。
 */
export class ToolRouter {
  readonly #policy: ToolPolicy
  readonly #guards: readonly ToolSecurityGuard[]
  readonly #approvals: ToolApprovalProvider
  readonly #approvalCache: ToolApprovalSessionCache
  readonly #onApproval: ToolRouterOptions['onApproval']
  readonly #onWorkspaceAccess: ToolRouterOptions['onWorkspaceAccess']

  constructor(readonly plan: ToolPlan, options: ToolRouterOptions = {}) {
    this.#policy = options.policy ?? new DefaultToolPolicy()
    this.#guards = Object.freeze([...(options.guards ?? [new AllowToolSecurityGuard()])])
    this.#approvals = options.approvals ?? new DenyToolApprovalProvider()
    this.#approvalCache = options.approvalCache ?? new ToolApprovalSessionCache()
    this.#onApproval = options.onApproval
    this.#onWorkspaceAccess = options.onWorkspaceAccess
  }

  supportsParallel(name: string): boolean {
    return this.plan.entry(name)?.executionMode === 'parallel-safe'
  }

  async dispatch(call: ModelToolCall, context: ToolContext): Promise<ToolDispatchOutcome> {
    const entry = this.plan.entry(call.name)
    if (!entry) {
      return { call, result: { ok: false, code: 'TOOL_NOT_FOUND', content: `Tool not found in frozen ToolPlan: ${call.name}` } }
    }
    if (context.signal.aborted) {
      return { call, result: { ok: false, code: 'TOOL_ABORTED', content: 'Tool call aborted before validation.' } }
    }

    const validation = validateToolArguments(call.arguments, entry.spec.inputSchema)
    if (!validation.ok) {
      return {
        call,
        result: {
          ok: false,
          code: 'TOOL_INVALID_ARGUMENTS',
          content: `Tool arguments failed schema validation: ${validation.errors.join(' ')}`,
          data: { errors: [...validation.errors] },
        },
      }
    }

    const request = policyRequest(entry, call, context)
    if (request.workspaceAccess !== undefined) {
      if (context.workspace === undefined) {
        return {
          call,
          result: {
            ok: false,
            code: 'TOOL_SECURITY_DENIED',
            content: 'Workspace-scoped tool requires a bound Session Workspace.',
          },
        }
      }
      const crossWorkspace = request.workspaceAccess.workspaceId !== context.workspace.workspaceId
      if (crossWorkspace && !this.#guards.some(guard => guard.id === 'xma.guard.workspace')) {
        return {
          call,
          result: {
            ok: false,
            code: 'TOOL_SECURITY_DENIED',
            content: 'Cross-workspace tool access requires the XMA Workspace Security Guard.',
          },
        }
      }
      if (crossWorkspace && this.#onWorkspaceAccess === undefined) {
        return {
          call,
          result: {
            ok: false,
            code: 'TOOL_SECURITY_DENIED',
            content: 'Cross-workspace tool access requires durable Workspace access auditing.',
          },
        }
      }
    }

    const decision = await this.#policy.decide(request)
    if (decision.action === 'deny') {
      return { call, result: { ok: false, code: 'TOOL_POLICY_DENIED', content: `Tool policy denied the call: ${decision.reason}` } }
    }

    for (const guard of this.#guards) {
      const guarded = await guard.check(request)
      if (!guarded.allow) {
        return { call, result: { ok: false, code: 'TOOL_SECURITY_DENIED', content: `Security guard ${guard.id} denied the call: ${guarded.reason}` } }
      }
    }

    let approval: ToolApprovalAudit | undefined
    if (decision.action === 'ask') {
      const cacheKey = approvalCacheKey(entry, call)
      if (this.#approvalCache.has(cacheKey)) {
        approval = { requested: false, decision: 'cached-session', cacheKey, reason: decision.reason }
        await this.#onApproval?.(call, approval)
      } else {
        const summary = entry.runtime.approvalSummary?.(call.arguments) ?? approvalFallbackSummary(call)
        const approvalRequest = {
          requestId: requestId(call),
          toolName: entry.name,
          effect: entry.effect,
          callId: call.callId,
          runId: context.runId,
          reason: decision.reason,
          summary: Object.freeze([...summary]),
          arguments: structuredClone(call.arguments),
        }
        if (context.sessionId !== undefined) Object.assign(approvalRequest, { sessionId: context.sessionId })
        if (context.turnId !== undefined) Object.assign(approvalRequest, { turnId: context.turnId })
        if (context.stepId !== undefined) Object.assign(approvalRequest, { stepId: context.stepId })

        let userDecision: ToolApprovalDecision
        try {
          userDecision = await this.#approvals.request(approvalRequest, context.signal)
        } catch (error) {
          if (isAbortError(error, context.signal)) {
            return { call, result: { ok: false, code: 'TOOL_ABORTED', content: 'Tool approval request aborted.' } }
          }
          const message = error instanceof Error ? error.message : String(error)
          return { call, result: { ok: false, code: 'TOOL_APPROVAL_DENIED', content: `Tool approval failed closed: ${message}` } }
        }
        approval = { requested: true, decision: userDecision, cacheKey, reason: decision.reason }
        // 先让 Runtime/Host 持久化最终 Approval 决策，再允许任何真实副作用发生。
        await this.#onApproval?.(call, approval)
        if (userDecision === 'deny') {
          return { call, result: { ok: false, code: 'TOOL_APPROVAL_DENIED', content: 'User denied this tool call.' }, approval }
        }
        if (userDecision === 'allow-session') this.#approvalCache.allow(cacheKey)
      }
    }

    if (context.signal.aborted) {
      return { call, result: { ok: false, code: 'TOOL_ABORTED', content: 'Tool call aborted before execution.' }, ...(approval ? { approval } : {}) }
    }

    if (request.workspaceAccess !== undefined) {
      try {
        await this.#onWorkspaceAccess?.(call, request.workspaceAccess)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { call, result: { ok: false, code: 'TOOL_SECURITY_DENIED', content: `Workspace access audit failed closed: ${message}` }, ...(approval ? { approval } : {}) }
      }
    }

    try {
      let result = await entry.runtime.execute(structuredClone(call.arguments), context)
      if (entry.runtime.finalize) result = await entry.runtime.finalize(result, call.arguments, context)
      return { call, result, ...(approval ? { approval } : {}) }
    } catch (error) {
      if (isAbortError(error, context.signal)) {
        return { call, result: { ok: false, code: 'TOOL_ABORTED', content: 'Tool call aborted.' }, ...(approval ? { approval } : {}) }
      }
      const message = error instanceof Error ? error.message : String(error)
      return { call, result: { ok: false, code: 'TOOL_EXECUTION_ERROR', content: `Tool execution failed: ${message}` }, ...(approval ? { approval } : {}) }
    }
  }

  /**
   * parallel-safe 调用可并发；exclusive 调用会先等待前一批并发调用结束，再单独执行，保持提交顺序。
   * 返回值始终按原始 call 顺序排列，方便 Runtime durable log 与模型 Tool Call 配对。
   */
  async dispatchMany(calls: readonly ModelToolCall[], context: ToolContext): Promise<readonly ToolDispatchOutcome[]> {
    const results = new Array<ToolDispatchOutcome | undefined>(calls.length)
    let parallelBatch: Array<{ index: number; call: ModelToolCall }> = []

    const flushParallel = async (): Promise<void> => {
      const batch = parallelBatch
      parallelBatch = []
      const resolved = await Promise.all(batch.map(item => this.dispatch(item.call, context)))
      resolved.forEach((outcome, index) => { results[batch[index]!.index] = outcome })
    }

    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index]!
      if (this.supportsParallel(call.name)) {
        parallelBatch.push({ index, call })
        continue
      }
      await flushParallel()
      results[index] = await this.dispatch(call, context)
    }
    await flushParallel()
    return Object.freeze(results.map((result, index): ToolDispatchOutcome => result ?? {
      call: calls[index]!,
      result: { ok: false, code: 'TOOL_EXECUTION_ERROR', content: 'XMA internal dispatch result missing.' },
    }))
  }
}

export class ToolRegistry {
  readonly #tools = new Map<string, XmaTool>()

  register(tool: XmaTool): Disposer {
    const normalized = normalizeTool(tool)
    if (this.#tools.has(normalized.name)) throw new Error(`XMA tool already registered: ${normalized.name}`)
    this.#tools.set(normalized.name, tool)
    return () => {
      if (this.#tools.get(normalized.name) === tool) this.#tools.delete(normalized.name)
    }
  }

  createPlan(): ToolPlan {
    return new ToolPlan([...this.#tools.values()].map(normalizeTool))
  }

  /** @deprecated 新 Runtime 应使用 createPlan()，这里只保留旧 Provider/测试兼容。 */
  specs(): ModelToolSpec[] {
    return this.createPlan().modelVisibleSpecs().map(spec => structuredClone(spec))
  }

  /** @deprecated 新 Runtime 使用 ToolPlan/ToolRouter；本入口仍走同一校验/Policy pipeline，不再直接绕过安全层。 */
  async execute(name: string, argumentsValue: JsonObject, context: ToolContext): Promise<ToolResult> {
    const router = this.createPlan().createRouter()
    const outcome = await router.dispatch({ callId: `legacy:${name}`, name, arguments: argumentsValue }, context)
    return outcome.result
  }
}

export { ToolApprovalSessionCache }
export type { ToolApprovalProvider, ToolEffect, ToolExecutionMode, ToolPolicy, ToolSecurityGuard }
