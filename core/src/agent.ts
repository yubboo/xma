/**
 * 文件作用：实现 XMA 最小 Agent Loop，证明“真实厂商模型 → Tool → Observation → 同一模型”是唯一推理主链。
 * 关联模块：model.ts、tools.ts、workspace.ts、各专业 Agent。
 * 当前实现：多轮 Tool Call、Observation 回灌、文本结果收集。
 * 职责边界：不得添加关键词路由或固定 Minecraft/Writer 流程替代模型判断。
 */

import type { ModelMessage, ModelProvider } from './model.ts'
import { ToolRegistry } from './tools.ts'

export interface AgentRunInput {
  runId: string
  provider: ModelProvider
  tools: ToolRegistry
  messages: ModelMessage[]
  signal: AbortSignal
  maxToolSteps?: number
}

export interface AgentRunResult {
  text: string
  messages: ModelMessage[]
  toolCalls: number
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const messages = [...input.messages]
  let text = ''
  let toolCalls = 0
  const maxToolSteps = input.maxToolSteps ?? 32

  while (true) {
    let calledTool = false
    for await (const event of input.provider.stream({ messages, tools: input.tools.specs(), signal: input.signal })) {
      if (event.type === 'text') text += event.text
      if (event.type !== 'tool-call') continue

      if (toolCalls >= maxToolSteps) throw new Error(`XMA max tool steps exceeded: ${maxToolSteps}`)
      calledTool = true
      toolCalls += 1
      const observation = await input.tools.execute(event.name, event.arguments, { runId: input.runId, signal: input.signal })
      messages.push({ role: 'assistant', content: `[tool-call] ${event.name}`, toolCallId: event.callId })
      messages.push({ role: 'tool', content: observation.content, toolCallId: event.callId })
    }

    if (!calledTool) return { text, messages, toolCalls }
    text = ''
  }
}
