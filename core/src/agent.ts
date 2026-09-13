/**
 * 文件作用：保留 XMA 早期无持久化 runAgent() 兼容入口，供迁移期旧调用方继续使用。
 * 关联模块：runtime.ts、model.ts、tools.ts；新代码应优先使用 AgentRuntime / AgentSession。
 * 当前实现：多轮 Tool Call、结构化 Tool Call 历史、Observation 回灌和文本结果收集。
 * 职责边界：本文件不再承担正式 Session 生命周期；不得在这里加入关键词路由或专业 Agent 固定流程。
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

/**
 * @deprecated 正式产品 Runtime 使用 AgentRuntime / AgentSession；这里只保留 0.1.x 迁移兼容。
 */
export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const messages = [...input.messages]
  let text = ''
  let toolCalls = 0
  const maxToolSteps = input.maxToolSteps ?? 32

  while (true) {
    let calledTool = false
    // 兼容入口也必须遵守冻结 ToolPlan；同一模型 Step 看见的 Schema 与执行 Runtime 不得来自两次 Registry 读取。
    const plan = input.tools.createPlan()
    const router = plan.createRouter()
    for await (const event of input.provider.stream({ messages, tools: plan.modelVisibleSpecs(), signal: input.signal })) {
      if (event.type === 'text') text += event.text
      if (event.type !== 'tool-call') continue

      if (toolCalls >= maxToolSteps) throw new Error(`XMA max tool steps exceeded: ${maxToolSteps}`)
      calledTool = true
      toolCalls += 1
      const dispatched = await router.dispatch(
        { callId: event.callId, name: event.name, arguments: event.arguments },
        { runId: input.runId, signal: input.signal },
      )
      const observation = dispatched.result
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: [{ callId: event.callId, name: event.name, arguments: structuredClone(event.arguments) }],
      })
      messages.push({ role: 'tool', content: observation.content, toolCallId: event.callId, toolName: event.name })
    }

    if (!calledTool) return { text, messages, toolCalls }
    text = ''
  }
}
