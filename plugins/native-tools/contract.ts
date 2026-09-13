/**
 * 文件作用：定义 Native Tool Plugin 的稳定装配参数。
 * 关联模块：filesystem.ts、process.ts、plugin.ts、xma-native。
 * 当前实现：Workspace、允许根、进程白名单与资源上限配置。
 * 职责边界：这里只声明 Tool Plugin 配置，不执行任何 OS 副作用；真实执行必须经过 xma-native → Rust Kernel。
 */

import type { NativeClient } from 'xma-native'

export interface NativeToolSetOptions {
  client: NativeClient
  /** 这些 Native Tool 属于哪个稳定 Workspace；Runtime Workspace Guard 会在 Capability issuance 前核对。 */
  workspaceId: string
  allowedRoots: readonly string[]
  /** process.run 的精确绝对可执行文件白名单；为空时不注册进程工具。Rust 会 canonicalize 后再次核对身份。 */
  allowedPrograms?: readonly string[]
  defaultCwd?: string
  maxReadBytes?: number
  maxWriteBytes?: number
  maxProcessOutputBytes?: number
  maxProcessTimeoutMs?: number
  /** Plan 等受限模式可关闭写工具；默认 true。 */
  allowWrite?: boolean
}
