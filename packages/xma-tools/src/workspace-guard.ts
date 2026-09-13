/**
 * 文件作用：把 Workspace ownership/grant 决策接入 Tool Security Guard。
 * 关联模块：xma-context WorkspaceRegistry、xma-tools policy/router。
 * 当前实现：只对声明 workspaceAccess 的 Tool 做单调 deny/allow。
 * 职责边界：这里只做 TypeScript policy；真实路径 confinement 继续由 Rust Kernel 强制。
 */

import type { WorkspaceAccessGrant, WorkspaceRegistry } from 'xma-context'
import type { ToolPolicyRequest, ToolSecurityGuard } from './policy.ts'

export class WorkspaceToolSecurityGuard implements ToolSecurityGuard {
  readonly id = 'xma.guard.workspace'

  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly agentId: string,
    private readonly grants: () => readonly WorkspaceAccessGrant[],
  ) {}

  check(request: ToolPolicyRequest): { allow: true } | { allow: false; reason: string } {
    if (request.workspaceAccess === undefined) return { allow: true }
    const decision = this.registry.authorize(this.agentId, request.workspaceAccess, this.grants())
    return decision.allow ? { allow: true } : { allow: false, reason: decision.reason }
  }
}
