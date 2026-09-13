/**
 * 文件作用：把 Rust Native Runtime 的受限 FS/Process 能力包装成 XMA Tool Definition，供 Agent ToolPlan 安全暴露给模型。
 * 关联模块：core/src/native.ts、core/src/tool/router.ts、native/runtime、未来 Workspace Provider。
 * 当前实现：native.fs.read_text、native.fs.write_text、native.process.run；每次执行先申请最小 Capability lease，再由 Rust Kernel 二次校验。
 * 职责边界：本文件只描述 XMA Tool 语义和最小授权范围；不能直接使用 Node fs/child_process 绕过 Native Kernel，也不能替 Approval 自动放行副作用。
 */

import { isAbsolute } from 'node:path'
import type { NativeClient } from '../../core/src/native.ts'
import type { ToolResult, XmaTool } from '../../core/src/tool/router.ts'
import { ToolRegistry } from '../../core/src/tool/router.ts'
import type { Disposer, JsonObject, JsonValue } from '../../core/src/types.ts'

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
}

function stringArg(args: JsonObject, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`XMA native tool argument ${key} must be a string.`)
  return value
}

function optionalIntegerArg(args: JsonObject, key: string): number | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`XMA native tool argument ${key} must be an integer.`)
  return value
}

function optionalBooleanArg(args: JsonObject, key: string): boolean | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`XMA native tool argument ${key} must be a boolean.`)
  return value
}

function stringArrayArg(args: JsonObject, key: string): string[] {
  const value = args[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`XMA native tool argument ${key} must be an array of strings.`)
  return value.map(item => String(item))
}

function nativeError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, code: 'TOOL_NATIVE_ERROR', content: `Native capability failed: ${message}` }
}

function readTool(options: NativeToolSetOptions): XmaTool {
  const maxReadBytes = options.maxReadBytes ?? 1024 * 1024
  return {
    spec: {
      name: 'native.fs.read_text',
      description: '读取 XMA Workspace 允许根目录内的 UTF-8 文本文件。Rust Kernel 会再次校验真实路径，拒绝路径穿越和符号链接越界。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1, description: '相对 Workspace 或允许根目录内的绝对文件路径。' },
          maxBytes: { type: 'integer', minimum: 1, maximum: maxReadBytes, description: '最多读取的字节数。' },
        },
      },
    },
    effect: 'read',
    executionMode: 'parallel-safe',
    workspaceAccess() { return { workspaceId: options.workspaceId, permission: 'read' } },
    async execute(args, context) {
      try {
        const lease = await options.client.issueCapability({ kind: 'filesystem.read', roots: options.allowedRoots }, context.signal)
        const result = await options.client.readText({
          token: lease.token,
          path: stringArg(args, 'path'),
          maxBytes: optionalIntegerArg(args, 'maxBytes') ?? maxReadBytes,
        }, context.signal)
        return {
          ok: true,
          code: 'OK',
          content: result.content,
          data: {
            path: result.path,
            bytes: result.bytes,
            truncated: result.truncated,
          },
        }
      } catch (error) {
        return nativeError(error)
      }
    },
  }
}

function writeTool(options: NativeToolSetOptions): XmaTool {
  const maxWriteBytes = options.maxWriteBytes ?? 1024 * 1024
  return {
    spec: {
      name: 'native.fs.write_text',
      description: '在 XMA Workspace 允许根目录内写入 UTF-8 文本文件。写入前需要用户授权，Rust Kernel 会再次校验真实路径和 Capability scope。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', minLength: 1, description: '相对 Workspace 或允许根目录内的目标路径。' },
          content: { type: 'string', description: `UTF-8 文本内容；Rust Kernel 最终按 ${maxWriteBytes} bytes 上限校验。` },
          createParents: { type: 'boolean', description: '是否创建缺失的父目录；父目录最终仍必须位于允许根目录内。' },
        },
      },
    },
    effect: 'write',
    executionMode: 'exclusive',
    workspaceAccess() { return { workspaceId: options.workspaceId, permission: 'write' } },
    approvalKey(args) { return stringArg(args, 'path') },
    approvalSummary(args) {
      const content = stringArg(args, 'content')
      return [`写入：${stringArg(args, 'path')}`, `内容长度：${content.length} 字符`]
    },
    async execute(args, context) {
      try {
        const lease = await options.client.issueCapability({ kind: 'filesystem.write', roots: options.allowedRoots }, context.signal)
        const result = await options.client.writeText({
          token: lease.token,
          path: stringArg(args, 'path'),
          content: stringArg(args, 'content'),
          createParents: optionalBooleanArg(args, 'createParents') ?? false,
          maxBytes: maxWriteBytes,
        }, context.signal)
        return { ok: true, code: 'OK', content: `已写入 ${result.path}（${result.bytes} bytes）`, data: result as unknown as JsonValue }
      } catch (error) {
        return nativeError(error)
      }
    },
  }
}

function processTool(options: NativeToolSetOptions): XmaTool {
  const maxOutputBytes = options.maxProcessOutputBytes ?? 256 * 1024
  const maxTimeoutMs = options.maxProcessTimeoutMs ?? 60_000
  const defaultCwd = options.defaultCwd ?? options.allowedRoots[0] ?? '.'
  const allowedPrograms = Object.freeze([...(options.allowedPrograms ?? [])])
  return {
    spec: {
      name: 'native.process.run',
      description: '通过 Rust Native Kernel 直接执行白名单程序（不经过 shell），可传参数和 cwd。需要用户授权；Kernel 会校验程序白名单、cwd confinement、超时和输出上限。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['program'],
        properties: {
          program: { type: 'string', enum: [...allowedPrograms], description: '必须从当前 ToolPlan 暴露的绝对可执行文件白名单中选择；Rust 会 canonicalize 后再次核对真实身份。' },
          args: { type: 'array', items: { type: 'string' }, maxItems: 256, description: '直接传给程序的 argv，不经过 shell 拼接。' },
          cwd: { type: 'string', minLength: 1, description: '工作目录，必须位于允许根目录内。' },
          timeoutMs: { type: 'integer', minimum: 1, maximum: maxTimeoutMs, description: '硬超时毫秒数。' },
          maxOutputBytes: { type: 'integer', minimum: 1024, maximum: maxOutputBytes, description: 'stdout/stderr 各自最大捕获字节数。' },
        },
      },
    },
    effect: 'execute',
    executionMode: 'exclusive',
    workspaceAccess() { return { workspaceId: options.workspaceId, permission: 'execute' } },
    approvalSummary(args) {
      const argv = stringArrayArg(args, 'args')
      const cwd = typeof args.cwd === 'string' ? args.cwd : defaultCwd
      return [`程序：${stringArg(args, 'program')}`, `参数：${argv.join(' ') || '(无)'}`, `目录：${cwd}`]
    },
    async execute(args, context) {
      try {
        const program = stringArg(args, 'program')
        const lease = await options.client.issueCapability({
          kind: 'process.spawn',
          roots: options.allowedRoots,
          // 单次 Capability 只申请本次真正执行的一个绝对程序，不能把整个 Host allowlist 下放给 lease。
          programs: [program],
        }, context.signal)
        const result = await options.client.runProcess({
          token: lease.token,
          program,
          args: stringArrayArg(args, 'args'),
          cwd: typeof args.cwd === 'string' ? args.cwd : defaultCwd,
          timeoutMs: optionalIntegerArg(args, 'timeoutMs') ?? maxTimeoutMs,
          maxOutputBytes: optionalIntegerArg(args, 'maxOutputBytes') ?? maxOutputBytes,
        }, context.signal)
        return {
          ok: result.success,
          code: result.success ? 'OK' : 'TOOL_NATIVE_ERROR',
          content: [
            `exitCode=${String(result.exitCode)} timedOut=${String(result.timedOut)}`,
            result.stdout ? `stdout:\n${result.stdout}` : '',
            result.stderr ? `stderr:\n${result.stderr}` : '',
          ].filter(Boolean).join('\n'),
          data: result as unknown as JsonValue,
        }
      } catch (error) {
        return nativeError(error)
      }
    },
  }
}

/** 注册 Native 工具并返回统一 disposer，便于 Plugin Host mount/unmount 不留幽灵注册。 */
export function registerNativeTools(registry: ToolRegistry, options: NativeToolSetOptions): Disposer {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(options.workspaceId)) throw new Error(`Invalid XMA native tools workspace id: ${options.workspaceId}`)
  if (options.allowedRoots.length === 0) throw new Error('XMA native tools require at least one allowed root.')
  for (const program of options.allowedPrograms ?? []) {
    if (!isAbsolute(program)) throw new Error(`XMA native process allowlist requires absolute executable paths: ${program}`)
  }
  const disposers: Disposer[] = [registry.register(readTool(options)), registry.register(writeTool(options))]
  if ((options.allowedPrograms?.length ?? 0) > 0) disposers.push(registry.register(processTool(options)))
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
