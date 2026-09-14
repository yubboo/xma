/**
 * 文件作用：提供 Xiaoyu OpenTUI 工作台的纯响应式布局计算，保证正文、Prompt 与快捷栏共享同一居中宽度。
 * 关联模块：apps/cli/opentui-runtime/app.tsx、apps/cli/tests/opentui-runtime.test.ts。
 * 当前实现：按终端列数计算对称左右留白，并限制超宽终端正文最大宽度，避免内容贴边或过早换行。
 * 职责边界：本文件只包含无 OpenTUI 运行时依赖的纯布局函数，不渲染组件、不处理焦点、键盘或业务状态。
 */

export function openTuiContentWidth(columns: number): number {
  const safeColumns = Math.max(28, columns)
  const margin = safeColumns >= 120 ? 12 : safeColumns >= 84 ? 10 : 4
  const available = Math.max(28, safeColumns - 4)
  return Math.min(108, available, Math.max(44, safeColumns - margin))
}

export function openTuiSidePadding(columns: number): number {
  const safeColumns = Math.max(28, columns)
  return Math.max(0, Math.floor((safeColumns - openTuiContentWidth(safeColumns)) / 2))
}
