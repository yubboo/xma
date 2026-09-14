/**
 * 文件作用：提供 Xiaoyu OpenTUI 工作台的纯响应式布局计算，保持迁移前 Terminal TUI 的内容宽度与对称留白。
 * 关联模块：apps/cli/opentui-runtime/app.tsx、apps/cli/tests/opentui-runtime.test.ts、apps/cli/src/tui.ts。
 * 当前实现：沿用既有 Xiaoyu Terminal 的 20-cell 总侧边留白规则；窄终端使用 8-cell 总留白，超宽正文最多 132 cell。
 * 职责边界：本文件只包含无 OpenTUI 运行时依赖的纯布局函数，不渲染组件、不处理焦点、键盘或业务状态。
 */

export function openTuiContentWidth(columns: number): number {
  const safeColumns = Math.max(40, columns)
  const sidePadding = safeColumns >= 72 ? 20 : 8
  return Math.max(40, Math.min(132, safeColumns - sidePadding))
}

export function openTuiSidePadding(columns: number): number {
  const safeColumns = Math.max(40, columns)
  return Math.max(0, Math.floor((safeColumns - openTuiContentWidth(safeColumns)) / 2))
}
