/**
 * 文件作用：把 Rust process.spawn Capability 包装为模型可调用的 native.process.run Tool。
 * 关联模块：contract.ts、arguments.ts、xma-native、xma-tools。
 * 当前实现：绝对可执行文件白名单、argv/cwd/timeout/output cap 参数与一次性 Capability lease。
 * 职责边界：不调用 shell/child_process；可执行文件身份、cwd confinement、超时与输出限制最终由 Rust Kernel 强制。
 */

import type { JsonValue } from 'xma-ai'
import type { ToolResult, XmaTool } from 'xma-tools'
import { optionalIntegerArg, stringArg, stringArrayArg } from './arguments.ts'
import type { NativeToolSetOptions } from './contract.ts'

function nativeError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, code: 'TOOL_NATIVE_ERROR', content: `Native capability failed: ${message}` }
}

export function createProcessRunTool(options: NativeToolSetOptions): XmaTool {
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
