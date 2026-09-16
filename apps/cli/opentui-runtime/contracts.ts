/**
 * 文件作用：定义 OpenTUI 父级工作台向子 UI 模块暴露的稳定 Host 合同，避免子模块深层穿透 apps/cli/src。
 * 关联模块：app.tsx、ui/*、apps/cli/src/tui.ts、apps/cli/src/tui-menu.ts。
 * 职责边界：只做类型/纯菜单能力转发，不复制 Runtime、Provider、Session 或 Tool 业务逻辑。
 */

export type {
  TerminalActivitySummary,
  TerminalAgentMode,
  TerminalReasoningEffort,
  TerminalRunEvent,
  TerminalTranscriptItem,
} from '../src/tui.ts'

export { filterTuiMenuItems, filterTuiMenuShortcutPrefix, splitTuiMenuShortcutPrefix, type TuiMenuItem } from '../src/tui-menu.ts'

export type { SessionCostMetrics, SessionRuntimeMetrics } from 'xma-session'

export { slashCommandSuggestions } from '../src/tui.ts'
