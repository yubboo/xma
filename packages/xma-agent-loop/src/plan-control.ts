/**
 * 文件作用：定义 Plan 模式的 Host-neutral“计划已就绪”控制 Tool，让真实模型只在计划足够完整时请求 Host 进行 Yes/No 执行确认。
 * 关联模块：work-mode.ts、CLI Backend、未来 Desktop/Web Plan 交接 UI。
 * 职责边界：该 Tool 只声明计划已经可交接，不执行任何副作用，也不替用户批准进入 Build。
 */

import type { JsonObject } from 'xma-ai'
import type { ToolRegistry } from 'xma-tools'

export interface PlanReadyProposal {
  plan: string
  summary?: string
}

/**
 * 注册 Plan 控制 Tool。模型必须显式调用它，Host 才能询问用户是否进入 Build；
 * 普通 Plan 问答、模式解释、尚未完成的规划不会触发执行确认。
 */
export function registerPlanReadyTool(
  registry: ToolRegistry,
  onReady: (proposal: PlanReadyProposal) => void,
): () => void | Promise<void> {
  return registry.register({
    spec: {
      name: 'xma.plan.ready',
      description: [
        'Mark the current Plan as complete enough to hand off for user execution approval.',
        'Call this only in Plan mode after you have produced a concrete executable plan and genuinely want the Host to ask the user Yes/No before entering Build.',
        'Do not call it for ordinary questions, mode explanations, partial analysis, or an unfinished plan.',
        'This tool never executes the plan and never grants permission by itself.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['plan'],
        properties: {
          plan: { type: 'string', description: 'The complete executable plan that should be retained durably if the user says No and executed if the user later says Yes.' },
          summary: { type: 'string', description: 'Optional one-line summary for Host UI.' },
        },
      },
    },
    effect: 'control',
    executionMode: 'exclusive',
    async execute(argumentsValue: JsonObject) {
      const plan = typeof argumentsValue.plan === 'string' ? argumentsValue.plan.trim() : ''
      if (!plan) {
        return { ok: false, code: 'TOOL_INVALID_ARGUMENTS', content: 'xma.plan.ready requires a non-empty plan string.' }
      }
      const summary = typeof argumentsValue.summary === 'string' ? argumentsValue.summary.trim() : ''
      onReady({ plan, ...(summary ? { summary } : {}) })
      return {
        ok: true,
        code: 'OK',
        content: 'Plan marked ready for Host Yes/No execution confirmation. No execution or permission change has occurred.',
      }
    },
  })
}
