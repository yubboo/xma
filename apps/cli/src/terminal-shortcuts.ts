/**
 * 文件作用：定义 Terminal 全局快捷键的纯决策合同，避免复制/中止/退出语义散落在 Renderer 事件处理里。
 * 关联模块：opentui-runtime/app.tsx、Terminal 回归测试。
 * 职责边界：这里只决定动作，不直接访问 Clipboard、AbortController 或进程生命周期。
 */

export type CtrlCAction = 'copy-selection' | 'cancel-turn' | 'cancel-modal' | 'arm-exit' | 'exit'

export function resolveCtrlCAction(input: {
  hasSelection: boolean
  busy: boolean
  modal: boolean
  exitArmed: boolean
}): CtrlCAction {
  if (input.hasSelection) return 'copy-selection'
  if (input.busy) return 'cancel-turn'
  if (input.modal) return 'cancel-modal'
  return input.exitArmed ? 'exit' : 'arm-exit'
}
