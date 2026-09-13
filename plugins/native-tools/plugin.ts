/**
 * 文件作用：装配并注册 Native FS/Process ToolSet，作为 native-tools 插件的单一入口。
 * 关联模块：contract.ts、filesystem.ts、process.ts、xma-tools。
 * 当前实现：按 Workspace/写权限/进程白名单决定暴露的 Tool，并返回统一 disposer。
 * 职责边界：这里只负责 Tool 注册生命周期；Approval、Workspace Guard 和 Rust Capability enforcement 由平台对应层负责。
 */

import { isAbsolute } from 'node:path'
import { ToolRegistry } from 'xma-tools'
import type { NativeToolSetOptions } from './contract.ts'
import { createReadTextTool, createWriteTextTool } from './filesystem.ts'
import { createProcessRunTool } from './process.ts'

type Disposer = () => void | Promise<void>

/** 注册 Native 工具并返回统一 disposer，便于 Plugin Host mount/unmount 不留幽灵注册。 */
export function registerNativeTools(registry: ToolRegistry, options: NativeToolSetOptions): Disposer {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(options.workspaceId)) throw new Error(`Invalid XMA native tools workspace id: ${options.workspaceId}`)
  if (options.allowedRoots.length === 0) throw new Error('XMA native tools require at least one allowed root.')
  for (const program of options.allowedPrograms ?? []) {
    if (!isAbsolute(program)) throw new Error(`XMA native process allowlist requires absolute executable paths: ${program}`)
  }

  const disposers: Disposer[] = [registry.register(createReadTextTool(options))]
  if (options.allowWrite !== false) disposers.push(registry.register(createWriteTextTool(options)))
  if (options.allowWrite !== false && (options.allowedPrograms?.length ?? 0) > 0) {
    disposers.push(registry.register(createProcessRunTool(options)))
  }
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
