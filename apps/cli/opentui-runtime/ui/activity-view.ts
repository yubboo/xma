/**
 * 文件作用：把真实 Turn Activity 的时间/状态转换为 Host 可展示的公开文案，不读取或暴露模型隐藏思维链。
 * 关联模块：opentui-runtime/ui/transcript-viewport.tsx、tui.ts。
 * 职责边界：这里只格式化 elapsed/outcome；真实活动条目继续来自 Runtime/Tool 事件，禁止生成假进度或假工具记录。
 */

export type TerminalActivityOutcome = 'running' | 'completed' | 'cancelled' | 'failed'

export interface TerminalActivityPresentationInput {
  startedAtMs: number
  elapsedMs: number
  outcome: TerminalActivityOutcome
}

export interface TerminalActivityPresentation {
  elapsedMs: number
  timeLabel: string
  stateLabel?: string
}

export function formatTerminalActivityElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  if (hours > 0) return `${hours}小时${minutes}分${remaining}秒`
  if (minutes > 0) return `${minutes}分${remaining}秒`
  return `${remaining}秒`
}

export function terminalActivityPresentation(
  input: TerminalActivityPresentationInput,
  nowMs: number,
): TerminalActivityPresentation {
  const elapsedMs = input.outcome === 'running'
    ? Math.max(input.elapsedMs, Math.max(0, nowMs - input.startedAtMs))
    : Math.max(0, input.elapsedMs)
  const elapsed = formatTerminalActivityElapsed(elapsedMs)
  if (input.outcome === 'running') {
    return { elapsedMs, timeLabel: `已处理 ${elapsed}`, stateLabel: '正在思考' }
  }
  const suffix = input.outcome === 'cancelled'
    ? ' · 已中止'
    : input.outcome === 'failed'
      ? ' · 失败'
      : ''
  return { elapsedMs, timeLabel: `用时 ${elapsed}${suffix}` }
}
