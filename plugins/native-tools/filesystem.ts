/**
 * 文件作用：把 Rust filesystem Capability 包装为模型可调用的 XMA 文件 Tool。
 * 关联模块：contract.ts、arguments.ts、xma-native、xma-tools。
 * 当前实现：native.fs.read_text / native.fs.write_text，并为每次调用申请最小一次性 Capability lease。
 * 职责边界：不直接调用 Node fs；路径 confinement 与真实路径校验最终由 Rust Kernel 强制。
 */

import type { JsonValue } from 'xma-ai'
import type { ToolResult, XmaTool } from 'xma-tools'
import { optionalBooleanArg, optionalIntegerArg, stringArg } from './arguments.ts'
import type { NativeToolSetOptions } from './contract.ts'

function nativeError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, code: 'TOOL_NATIVE_ERROR', content: `Native capability failed: ${message}` }
}

export function createReadTextTool(options: NativeToolSetOptions): XmaTool {
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
          data: { path: result.path, bytes: result.bytes, truncated: result.truncated },
        }
      } catch (error) {
        return nativeError(error)
      }
    },
  }
}

export function createWriteTextTool(options: NativeToolSetOptions): XmaTool {
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
