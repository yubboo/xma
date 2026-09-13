/**
 * 文件作用：定义 XMA Workspace 的稳定身份、根目录、Agent ownership、跨 Workspace 授权与 Tool Security Guard。
 * 关联模块：xma-agent-loop、xma-session、xma-context、xma-tools、Native Tool Plugin。
 * 当前实现：Workspace Registry、稳定 Binding digest、Owner/Grant 访问决策、Session 级显式授权记录 Contract 与 Tool Guard。
 * 职责边界：TypeScript 只决定“哪个 Agent 被允许访问哪个 Workspace”；真实文件路径 canonicalize、进程 cwd confinement 等 OS 强制隔离必须继续由 Rust Native Runtime 执行。
 */

import { createHash } from 'node:crypto'
import path from 'node:path'

export type WorkspacePermission = 'read' | 'write' | 'execute'

export interface WorkspaceDescriptor {
  /** 稳定 Workspace 身份；不能用 cwd 临时字符串代替。 */
  id: string
  /** Workspace 的拥有者 Agent。默认只有 Owner 拥有完整访问权。 */
  ownerAgentId: string
  name: string
  /** 主根目录；相对 Tool path 默认以这里为语义根。 */
  root: string
  /** 额外允许根；最终真实路径仍由 Rust canonical confinement 强制。 */
  allowedRoots?: readonly string[]
}

export interface WorkspaceBinding {
  workspaceId: string
  ownerAgentId: string
  name: string
  root: string
  allowedRoots: readonly string[]
  /** 对安全相关 Descriptor 字段做稳定摘要，用于 Session resume 检测 Workspace 漂移。 */
  descriptorDigest: string
}

export interface WorkspaceAccessRequest {
  workspaceId: string
  permission: WorkspacePermission
}

export interface WorkspaceAccessGrant {
  grantId: string
  workspaceId: string
  granteeAgentId: string
  permissions: readonly WorkspacePermission[]
  grantedBy: 'user'
  grantedAt: string
  reason: string
}

export type WorkspaceAccessDecision =
  | { allow: true; via: 'owner' }
  | { allow: true; via: 'grant'; grantId: string }
  | { allow: false; reason: string }

function assertStableId(kind: string, value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) throw new Error(`Invalid XMA ${kind} id: ${value}`)
}

function normalizeAbsoluteRoot(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('XMA workspace root cannot be empty.')
  // POSIX 根路径以 `/` 开头；先判 POSIX，避免 win32.isAbsolute('/x') 把跨平台测试路径改成反斜杠。
  if (path.posix.isAbsolute(value)) return path.posix.normalize(value)
  if (path.win32.isAbsolute(value)) return path.win32.normalize(value)
  throw new Error(`XMA workspace roots must be absolute paths: ${raw}`)
}

function normalizedDescriptor(input: WorkspaceDescriptor): WorkspaceDescriptor & { allowedRoots: readonly string[] } {
  assertStableId('workspace', input.id)
  assertStableId('agent', input.ownerAgentId)
  const name = input.name.trim()
  if (!name) throw new Error(`XMA workspace ${input.id} must have a non-empty name.`)

  const root = normalizeAbsoluteRoot(input.root)
  const roots = [root, ...(input.allowedRoots ?? []).map(normalizeAbsoluteRoot)]
  const allowedRoots = Object.freeze([...new Set(roots)])
  return Object.freeze({ id: input.id, ownerAgentId: input.ownerAgentId, name, root, allowedRoots })
}

function descriptorDigest(workspace: WorkspaceDescriptor & { allowedRoots: readonly string[] }): string {
  const stable = JSON.stringify({
    workspaceId: workspace.id,
    ownerAgentId: workspace.ownerAgentId,
    root: workspace.root,
    allowedRoots: workspace.allowedRoots,
  })
  return createHash('sha256').update(stable, 'utf8').digest('hex')
}

function cloneBinding(binding: WorkspaceBinding): WorkspaceBinding {
  return Object.freeze({ ...structuredClone(binding), allowedRoots: Object.freeze([...binding.allowedRoots]) })
}

function normalizePermissions(permissions: readonly WorkspacePermission[]): readonly WorkspacePermission[] {
  const order: readonly WorkspacePermission[] = ['read', 'write', 'execute']
  const values = new Set(permissions)
  if (values.size === 0) throw new Error('XMA workspace access grant requires at least one permission.')
  for (const permission of values) {
    if (!order.includes(permission)) throw new Error(`Invalid XMA workspace permission: ${String(permission)}`)
  }
  return Object.freeze(order.filter(permission => values.has(permission)))
}

/** Workspace Registry 保存稳定定义；修改 root/owner 应创建显式迁移，而不是静默原地漂移。 */
export class WorkspaceRegistry {
  readonly #items = new Map<string, WorkspaceDescriptor & { allowedRoots: readonly string[] }>()

  register(workspace: WorkspaceDescriptor): void {
    const normalized = normalizedDescriptor(workspace)
    if (this.#items.has(normalized.id)) throw new Error(`XMA workspace already exists: ${normalized.id}`)
    this.#items.set(normalized.id, normalized)
  }

  get(id: string): WorkspaceDescriptor | undefined {
    const workspace = this.#items.get(id)
    return workspace ? structuredClone(workspace) : undefined
  }

  list(): WorkspaceDescriptor[] {
    return [...this.#items.values()]
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(workspace => structuredClone(workspace))
  }

  binding(workspaceId: string): WorkspaceBinding {
    const workspace = this.#items.get(workspaceId)
    if (!workspace) throw new Error(`XMA workspace not found: ${workspaceId}`)
    return cloneBinding({
      workspaceId: workspace.id,
      ownerAgentId: workspace.ownerAgentId,
      name: workspace.name,
      root: workspace.root,
      allowedRoots: workspace.allowedRoots,
      descriptorDigest: descriptorDigest(workspace),
    })
  }

  /** 新 Session 默认只能绑定自己的 Workspace；跨 Agent 访问通过 Session durable grant，而不是伪装成 Owner Session。 */
  bindOwned(workspaceId: string, agentId: string): WorkspaceBinding {
    const binding = this.binding(workspaceId)
    if (binding.ownerAgentId !== agentId) {
      throw new Error(`XMA agent ${agentId} cannot bind workspace ${workspaceId} owned by ${binding.ownerAgentId}.`)
    }
    return binding
  }

  /** Resume 时检查 Workspace 安全身份是否漂移；root/owner 变化必须走未来显式 rebind/migration。 */
  verifyBinding(binding: WorkspaceBinding): WorkspaceBinding {
    const current = this.binding(binding.workspaceId)
    if (current.descriptorDigest !== binding.descriptorDigest) {
      throw new Error(`XMA workspace binding changed since session creation: ${binding.workspaceId}`)
    }
    return current
  }

  normalizeGrant(grant: WorkspaceAccessGrant): WorkspaceAccessGrant {
    assertStableId('workspace grant', grant.grantId)
    assertStableId('workspace', grant.workspaceId)
    assertStableId('agent', grant.granteeAgentId)
    if (!this.#items.has(grant.workspaceId)) throw new Error(`XMA workspace not found: ${grant.workspaceId}`)
    const reason = grant.reason.trim()
    if (!reason) throw new Error('XMA workspace access grant requires an explicit reason.')
    return Object.freeze({ ...grant, permissions: normalizePermissions(grant.permissions), reason })
  }

  authorize(agentId: string, request: WorkspaceAccessRequest, grants: readonly WorkspaceAccessGrant[]): WorkspaceAccessDecision {
    const workspace = this.#items.get(request.workspaceId)
    if (!workspace) return { allow: false, reason: `Workspace not found: ${request.workspaceId}` }
    if (workspace.ownerAgentId === agentId) return { allow: true, via: 'owner' }

    for (let index = grants.length - 1; index >= 0; index -= 1) {
      const grant = grants[index]!
      if (grant.workspaceId !== request.workspaceId || grant.granteeAgentId !== agentId) continue
      if (grant.permissions.includes(request.permission)) return { allow: true, via: 'grant', grantId: grant.grantId }
    }
    return {
      allow: false,
      reason: `Agent ${agentId} has no explicit ${request.permission} grant for workspace ${request.workspaceId}.`,
    }
  }
}
