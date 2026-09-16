/**
 * 文件作用：定义 XMA Tool Policy、Security Guard 与 Approval Contract，把“模型请求副作用”和“框架最终允许副作用”明确分离。
 * 关联模块：router.ts、../runtime.ts、未来 App Protocol Approval UI、Native Capability Bridge。
 * 当前实现：Read/Write/Execute/Network/Control 权限语义、标准/严格/自动策略、单次/Session Approval 与可组合单调 Security Guard。
 * 职责边界：模型和 Tool 自己都不能把 deny 改成 allow；Rust Native Kernel 对真实 OS 副作用仍需再次独立校验。
 */

import type { JsonObject } from 'xma-ai'
import type { WorkspaceAccessRequest } from 'xma-context'

export type ToolEffect = 'read' | 'write' | 'execute' | 'network' | 'control'
export type ToolExecutionMode = 'parallel-safe' | 'exclusive'
export type ToolPolicyMode = 'standard' | 'paranoid' | 'auto'

export type PermissionProfileId = 'ask' | 'smart' | 'full'

export const PERMISSION_PROFILE_LABELS: Readonly<Record<PermissionProfileId, string>> = Object.freeze({
  ask: '请求批准',
  smart: '帮我批准',
  full: '完全访问',
})

export interface ToolPolicyRequest {
  toolName: string
  effect: ToolEffect
  arguments: JsonObject
  runId: string
  sessionId?: string
  turnId?: string
  stepId?: string
  callId: string
  /** Tool 声明的 Workspace 访问目标；Workspace Guard 在 Approval/execute 前做单调拒绝。 */
  workspaceAccess?: WorkspaceAccessRequest
}

export type ToolPolicyDecision =
  | { action: 'allow'; reason?: string }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; reason: string }

export interface ToolPolicy {
  decide(request: ToolPolicyRequest): ToolPolicyDecision | Promise<ToolPolicyDecision>
}

/**
 * 默认策略：只读与纯控制操作直接允许；写入/执行/网络需要 Approval。
 * auto/paranoid 是未来设置页的策略语义，默认仍是 standard，不能因为没有 UI 就自动放开。
 */
export class DefaultToolPolicy implements ToolPolicy {
  constructor(readonly mode: ToolPolicyMode = 'standard') {}

  decide(request: ToolPolicyRequest): ToolPolicyDecision {
    if (this.mode === 'auto') return { action: 'allow', reason: 'XMA tool policy mode is auto.' }
    if (this.mode === 'paranoid') return { action: 'ask', reason: `Paranoid policy requires approval for ${request.effect} tool.` }
    if (request.effect === 'read' || request.effect === 'control') {
      return { action: 'allow', reason: `Standard policy allows ${request.effect} tool without approval.` }
    }
    return { action: 'ask', reason: `Standard policy requires approval for ${request.effect} tool.` }
  }
}

export interface ToolSecurityGuard {
  readonly id: string
  check(request: ToolPolicyRequest): { allow: true } | { allow: false; reason: string } | Promise<{ allow: true } | { allow: false; reason: string }>
}

/** 默认没有额外 TypeScript Guard；Native 工具仍必须在 Rust Kernel 内做真实 enforcement。 */
export class AllowToolSecurityGuard implements ToolSecurityGuard {
  readonly id = 'xma.guard.allow'
  check(): { allow: true } { return { allow: true } }
}

export type ToolApprovalDecision = 'allow-once' | 'allow-session' | 'deny'

export interface ToolApprovalRequest {
  requestId: string
  toolName: string
  effect: ToolEffect
  callId: string
  runId: string
  sessionId?: string
  turnId?: string
  stepId?: string
  reason: string
  summary: readonly string[]
  arguments: JsonObject
}

export interface ToolApprovalProvider {
  request(request: ToolApprovalRequest, signal: AbortSignal): Promise<ToolApprovalDecision>
}

/** 无 Host Approval Provider 时 fail closed，避免无 UI/无交互时静默执行写入/命令/网络副作用。 */
export class DenyToolApprovalProvider implements ToolApprovalProvider {
  async request(): Promise<ToolApprovalDecision> { return 'deny' }
}

/** 单元测试/自动化宿主可注入脚本化决策；生产 UI 后续通过 App Protocol 实现同一 Contract。 */
export class StaticToolApprovalProvider implements ToolApprovalProvider {
  constructor(private readonly decision: ToolApprovalDecision | ((request: ToolApprovalRequest) => ToolApprovalDecision | Promise<ToolApprovalDecision>)) {}

  async request(request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
    return typeof this.decision === 'function' ? await this.decision(request) : this.decision
  }
}

/**
 * Session 级 Approval Cache 只保存稳定 cache key，不保存 Tool arguments/Secret。
 * `allow-session` 只在当前 AgentSession 生命周期内有效；恢复 Session 后默认重新询问，避免持久权限悄悄跨进程延续。
 */
export class ToolApprovalSessionCache {
  readonly #keys = new Set<string>()

  has(key: string): boolean { return this.#keys.has(key) }
  allow(key: string): void { this.#keys.add(key) }
  clear(): void { this.#keys.clear() }
}
