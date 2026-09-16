/**
 * 文件作用：集中定义 Xiaoyu Terminal 的视觉色板与模式元数据，避免 Transcript/Prompt/Overlay 各自维护颜色真值。
 * 关联模块：app.tsx、background-sky.tsx、transcript-viewport.tsx。
 * 职责边界：只保存 Terminal Host 视觉常量；不得承载 Runtime、Provider、Session 或 Tool 业务状态。
 */

import type { TerminalAgentMode, TerminalReasoningEffort } from '../contracts.ts'

export const COLOR = {
  background: '#0b0c0c',
  panel: '#151515',
  panelSelected: '#261911',
  orange: '#ff7e3f',
  text: '#e2e2e2',
  soft: '#a4a4a4',
  faint: '#626262',
  green: '#62ca84',
  blue: '#6faeff',
  yellow: '#e0be48',
  red: '#ee5e5e',
} as const

export const MODE_META: Record<TerminalAgentMode, { label: string; color: string; description: string }> = {
  build: { label: 'Build', color: COLOR.orange, description: '完整工具模式' },
  plan: { label: 'Plan', color: COLOR.green, description: '只读规划 · 无写入/执行工具' },
  compose: { label: 'Compose', color: COLOR.blue, description: '纯模型对话 · legacy' },
}

export function reasoningColor(effort: TerminalReasoningEffort): string {
  if (effort === 'max') return COLOR.red
  if (effort === 'high') return COLOR.yellow
  if (effort === 'low') return COLOR.green
  return COLOR.soft
}
