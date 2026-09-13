/**
 * 文件作用：定义 XMA Tool Registry、结构化 Tool Result 和 Runtime 调用上下文。
 * 关联模块：runtime.ts、session.ts、未来 permission/approval、native Rust Bridge、专业 Agent tools。
 * 当前实现：注册工具、冻结前列出模型可见 Schema、按名称执行工具，并把普通执行异常/取消转换为结构化结果。
 * 职责边界：Registry 不替模型选择工具；Schema 校验、Approval、Native Capability 等完整安全流水线在后续阶段继续接入。
 */

import type { ModelToolSpec } from './model.ts'
import type { JsonObject, JsonValue } from './types.ts'

export interface ToolContext {
  runId: string
  signal: AbortSignal
  sessionId?: string
  turnId?: string
  stepId?: string
}

export type ToolResultCode =
  | 'OK'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_EXECUTION_ERROR'
  | 'TOOL_ABORTED'
  | 'TOOL_CALL_LIMIT'

export interface ToolResult {
  ok: boolean
  code: ToolResultCode
  content: string
  data?: JsonValue
}

export interface XmaTool {
  spec: ModelToolSpec
  execute(argumentsValue: JsonObject, context: ToolContext): Promise<ToolResult>
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

export class ToolRegistry {
  readonly #tools = new Map<string, XmaTool>()

  register(tool: XmaTool): void {
    if (this.#tools.has(tool.spec.name)) throw new Error(`XMA tool already registered: ${tool.spec.name}`)
    this.#tools.set(tool.spec.name, tool)
  }

  specs(): ModelToolSpec[] {
    // 返回克隆，避免调用方修改 Registry 内部定义；Runtime 会在每个 Step 再冻结一次。
    return [...this.#tools.values()].map(tool => structuredClone(tool.spec))
  }

  async execute(name: string, argumentsValue: JsonObject, context: ToolContext): Promise<ToolResult> {
    const tool = this.#tools.get(name)
    if (!tool) return { ok: false, code: 'TOOL_NOT_FOUND', content: `Tool not found: ${name}` }
    if (context.signal.aborted) return { ok: false, code: 'TOOL_ABORTED', content: 'Tool call aborted before execution.' }

    try {
      return await tool.execute(argumentsValue, context)
    } catch (error) {
      if (isAbortError(error, context.signal)) {
        return { ok: false, code: 'TOOL_ABORTED', content: 'Tool call aborted.' }
      }
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, code: 'TOOL_EXECUTION_ERROR', content: `Tool execution failed: ${message}` }
    }
  }
}
