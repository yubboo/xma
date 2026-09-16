/**
 * 文件作用：定义 UI/CLI/Desktop/Server 与 XMA Runtime 之间的最小稳定 App Protocol 类型。
 * 关联模块：runtime.ts、session/contract.ts、未来 apps/server RPC 与 Desktop IPC。
 * 当前实现：Session create/resume/list、Turn run/cancel 的命令/结果及 Runtime event envelope 基础类型。
 * 职责边界：这里只定义协议数据，不直接持有 AgentSession 对象，不允许 Renderer 绕过 Runtime 执行文件/进程副作用。
 */

import type { RuntimeLiveEvent, TurnRunResult } from './runtime.ts'
import type { SessionRuntimeMetrics, SessionStat } from 'xma-session'
import type { WorkspaceDescriptor, WorkspacePermission } from './workspace.ts'
import type { PermissionProfileId } from 'xma-tools'

export type AppCommand =
  | { type: 'session/create'; agentId: string; workspaceId?: string }
  | { type: 'session/resume'; sessionId: string }
  | { type: 'session/list' }
  | { type: 'session/metrics'; sessionId: string }
  | { type: 'session/permission/set'; sessionId: string; profile: PermissionProfileId }
  | { type: 'workspace/list' }
  | { type: 'workspace/access/grant'; sessionId: string; workspaceId: string; permissions: readonly WorkspacePermission[]; reason: string }
  | { type: 'workspace/access/revoke'; sessionId: string; grantId: string; reason: string }
  | { type: 'turn/run'; sessionId: string; providerId: string; input: string }
  | { type: 'turn/cancel'; sessionId: string; turnId: string }

export type AppCommandResult =
  | { type: 'session/created'; sessionId: string }
  | { type: 'session/resumed'; sessionId: string }
  | { type: 'session/list'; sessions: readonly SessionStat[] }
  | { type: 'session/metrics'; metrics: SessionRuntimeMetrics }
  | { type: 'session/permission/set'; sessionId: string; profile: PermissionProfileId }
  | { type: 'workspace/list'; workspaces: readonly WorkspaceDescriptor[] }
  | { type: 'workspace/access/granted'; sessionId: string; grantId: string; workspaceId: string; permissions: readonly WorkspacePermission[] }
  | { type: 'workspace/access/revoked'; sessionId: string; grantId: string }
  | { type: 'turn/result'; result: TurnRunResult }
  | { type: 'turn/cancelled'; sessionId: string; turnId: string }

export interface AppEventEnvelope {
  protocolVersion: 1
  event: RuntimeLiveEvent
}
