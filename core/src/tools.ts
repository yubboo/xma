/**
 * 文件作用：定义 XMA Tool Registry 和 Tool Observation Contract。
 * 关联模块：agent.ts、permissions（后续扩展）、native Rust Bridge、专业 Agent tools。
 * 当前实现：注册工具、列出模型可见 Schema、按名称执行工具。
 * 职责边界：Registry 不替模型选择工具；危险副作用后续必须接 Approval + Native Capability。
 */

import type { ModelToolSpec } from './model.ts'
import type { JsonObject } from './types.ts'

export interface ToolContext {
  runId: string
  signal: AbortSignal
}

export interface ToolResult {
  ok: boolean
  content: string
  data?: unknown
}

export interface XmaTool {
  spec: ModelToolSpec
  execute(argumentsValue: JsonObject, context: ToolContext): Promise<ToolResult>
}

export class ToolRegistry {
  readonly #tools = new Map<string, XmaTool>()

  register(tool: XmaTool): void {
    if (this.#tools.has(tool.spec.name)) throw new Error(`XMA tool already registered: ${tool.spec.name}`)
    this.#tools.set(tool.spec.name, tool)
  }

  specs(): ModelToolSpec[] {
    return [...this.#tools.values()].map(tool => tool.spec)
  }

  async execute(name: string, argumentsValue: JsonObject, context: ToolContext): Promise<ToolResult> {
    const tool = this.#tools.get(name)
    if (!tool) return { ok: false, content: `Tool not found: ${name}` }
    return tool.execute(argumentsValue, context)
  }
}
