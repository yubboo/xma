/**
 * 文件作用：提供 Xiaoyu Terminal 列表菜单的统一检索、列宽计算与可见行投影。
 * 关联模块：tui.ts 的命令面板、Provider/Model 选择与 Terminal Settings Overlay。
 * 当前实现：统一固定列栅格、CJK 单元格宽度、即时搜索、选择窗口和快捷键列，避免各页面手调空格导致布局漂移。
 * 职责边界：本文件只处理纯菜单数据与布局，不输出 ANSI、不持有 Pi TUI 实例，也不执行业务命令。
 */

export interface TuiMenuItem {
  value: string
  label: string
  description?: string
  keywords?: readonly string[]
  shortcut?: string
}

export interface TuiMenuRow {
  item: TuiMenuItem
  selected: boolean
  label: string
  description: string
  shortcut: string
}

export interface TuiMenuProjection {
  rows: readonly TuiMenuRow[]
  filtered: readonly TuiMenuItem[]
  selectedIndex: number
  labelWidth: number
  descriptionWidth: number
  shortcutWidth: number
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

export function tuiMenuCellWidth(value: string): number {
  let width = 0
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint === 0) continue
    if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) continue
    width += isWideCodePoint(codePoint) ? 2 : 1
  }
  return width
}

export function truncateTuiMenuText(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (tuiMenuCellWidth(value) <= maxWidth) return value
  if (maxWidth === 1) return '…'

  let width = 0
  let result = ''
  for (const char of value) {
    const charWidth = isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1
    if (width + charWidth + 1 > maxWidth) break
    result += char
    width += charWidth
  }
  return `${result}…`
}

function padTuiMenuText(value: string, width: number): string {
  const clipped = truncateTuiMenuText(value, width)
  return `${clipped}${' '.repeat(Math.max(0, width - tuiMenuCellWidth(clipped)))}`
}


function normalizedHaystack(item: TuiMenuItem): string {
  return [item.label, item.value, item.description ?? '', ...(item.keywords ?? [])]
    .join(' ')
    .toLocaleLowerCase()
}

export function filterTuiMenuItems(items: readonly TuiMenuItem[], query: string): readonly TuiMenuItem[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return items
  return items.filter(item => {
    const haystack = normalizedHaystack(item)
    return tokens.every(token => haystack.includes(token))
  })
}

function clampSelectedIndex(index: number, count: number): number {
  if (count <= 0) return -1
  return Math.min(Math.max(index, 0), count - 1)
}

export function moveTuiMenuSelection(index: number, count: number, direction: -1 | 1): number {
  if (count <= 0) return -1
  const current = clampSelectedIndex(index, count)
  return (current + direction + count) % count
}

function menuColumnWidths(width: number, items: readonly TuiMenuItem[]): { labelWidth: number; descriptionWidth: number; shortcutWidth: number } {
  const safeWidth = Math.max(28, width)
  const maxLabel = Math.max(8, ...items.map(item => tuiMenuCellWidth(item.label)))
  const maxShortcut = Math.max(0, ...items.map(item => tuiMenuCellWidth(item.shortcut ?? '')))
  const shortcutWidth = Math.min(14, maxShortcut)
  const shortcutCost = shortcutWidth > 0 ? shortcutWidth + 2 : 0
  const available = Math.max(20, safeWidth - 4 - shortcutCost)
  const labelWidth = Math.min(maxLabel, Math.max(10, Math.min(24, Math.floor(available * 0.38))))
  const descriptionWidth = Math.max(8, available - labelWidth - 2)
  return { labelWidth, descriptionWidth, shortcutWidth }
}

/**
 * 中文说明：所有 Overlay 列表统一通过这里生成“快捷命令列 / 菜单列 / 说明列”。
 * 选中项始终保持在可见窗口中；窗口宽度变化时只截断描述，不允许菜单名称互相挤位。
 */
export function projectTuiMenu(
  items: readonly TuiMenuItem[],
  query: string,
  selectedIndex: number,
  width: number,
  maxVisible: number,
): TuiMenuProjection {
  const filtered = filterTuiMenuItems(items, query)
  const clamped = clampSelectedIndex(selectedIndex, filtered.length)
  const visibleCount = Math.max(1, maxVisible)
  const first = clamped < 0
    ? 0
    : Math.max(0, Math.min(clamped - visibleCount + 1, filtered.length - visibleCount))
  const visible = filtered.slice(first, first + visibleCount)
  const { labelWidth, descriptionWidth, shortcutWidth } = menuColumnWidths(width, filtered.length > 0 ? filtered : items)

  const rows = visible.map((item, offset): TuiMenuRow => {
    const absoluteIndex = first + offset
    return {
      item,
      selected: absoluteIndex === clamped,
      label: padTuiMenuText(item.label, labelWidth),
      description: padTuiMenuText(item.description ?? '', descriptionWidth),
      shortcut: shortcutWidth > 0 ? padTuiMenuText(item.shortcut ?? '', shortcutWidth) : '',
    }
  })

  return {
    rows,
    filtered,
    selectedIndex: clamped,
    labelWidth,
    descriptionWidth,
    shortcutWidth,
  }
}
