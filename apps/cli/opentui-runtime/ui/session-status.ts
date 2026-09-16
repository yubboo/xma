/**
 * 文件作用：把 Host-neutral SessionRuntimeMetrics 格式化为 Terminal 状态栏项目与可见行，不依赖 OpenTUI Renderable。
 * 关联模块：session-status-bar.tsx、xma-session metrics、Terminal formatter tests。
 * 职责边界：只做 Terminal 文本投影与行打包；Provider 品牌、价格、余额、套餐数据必须已经由 canonical metrics 提供。
 */

import type { SessionCostMetrics, SessionRuntimeMetrics } from '../contracts.ts'

function compactInteger(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b`
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (absolute >= 10_000) return `${(value / 1_000).toFixed(1)}k`
  return Math.round(value).toLocaleString('en-US')
}

function percent(value: number | undefined, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

function exactInteger(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('en-US')
}

function contextPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value === 0) return '0%'
  const percentage = value * 100
  if (percentage > 0 && percentage < 0.1) return '<0.1%'
  if (percentage < 10) return `${percentage.toFixed(1)}%`
  return `${Math.round(percentage)}%`
}

function contextLabel(metrics: SessionRuntimeMetrics): string {
  const used = metrics.context.usedTokens
  const window = metrics.context.windowTokens
  const ratio = metrics.context.ratio
  if (window === undefined) return '上下文 —'
  const capacity = `${compactInteger(used)}/${compactInteger(window)}`
  if (ratio === undefined) return `上下文 — · ${capacity}`
  return `上下文 ${contextPercent(ratio)} · ${capacity}`
}

function currencyPrefix(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return `${currency} `
}

function money(cost: SessionCostMetrics): string {
  if (cost.amount === undefined || !cost.currency || cost.status === 'unavailable') return '—'
  const estimate = cost.precision === 'estimated' ? '≈' : ''
  const partial = cost.status === 'partial' ? '部分' : ''
  const amount = cost.amount < 0.01 ? cost.amount.toFixed(4) : cost.amount.toFixed(2)
  return `${partial}${estimate}${currencyPrefix(cost.currency)}${amount}`
}

function balance(metrics: SessionRuntimeMetrics): string {
  const balances = metrics.account?.balances
  if (!balances || balances.length === 0) return '—'
  const item = balances.find(value => value.currency === 'CNY') ?? balances.find(value => value.currency === 'USD') ?? balances[0]
  if (!item) return '—'
  return `${currencyPrefix(item.currency)}${item.total}`
}

function billingLabel(metrics: SessionRuntimeMetrics): string {
  if (metrics.billing.kind === 'subscription') return metrics.billing.planName || metrics.billing.label || '套餐'
  if (metrics.billing.kind === 'api') return metrics.billing.label || 'API'
  return metrics.billing.label || '计费—'
}

function subscriptionQuota(metrics: SessionRuntimeMetrics): string | undefined {
  if (metrics.billing.kind !== 'subscription') return undefined
  const quota = metrics.account?.quota
  if (!quota) return undefined
  if (quota.used !== undefined && quota.limit !== undefined) return `额度 ${compactInteger(quota.used)}/${compactInteger(quota.limit)}`
  if (quota.remaining !== undefined) return `剩余额度 ${compactInteger(quota.remaining)}`
  return undefined
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  )
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3040 && codePoint <= 0xa4cf) ||
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

/**
 * 估算字符串在等宽 Terminal 中占用的列数。状态栏主要包含 ASCII 与 CJK，
 * 这里覆盖 combining mark / CJK / 常见 emoji，避免用 JS string.length 低估中文宽度。
 */
export function terminalTextColumns(value: string): number {
  let width = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) continue
    if (isZeroWidthCodePoint(codePoint)) continue
    width += isWideCodePoint(codePoint) ? 2 : 1
  }
  return width
}

/**
 * Prompt 主状态行中的首要 Session 指标。
 *
 * headline 仍然可以为最右侧 Model truth 让位；完整 telemetry 由下方 detail block
 * 负责全量直显，因此窄屏时这里允许只保留 context 或完全让出空间。
 */
export function sessionHeadlineItems(metrics: SessionRuntimeMetrics, width: number): readonly string[] {
  if (width < 82) return []

  const context = contextLabel(metrics)
  const quota = subscriptionQuota(metrics)
  const account = metrics.billing.kind === 'api' ? `余额 ${balance(metrics)}` : quota

  if (width < 100) return [context]
  return account ? [context, account] : [context]
}

/**
 * 空会话只展示最小状态：左侧 billing label、右侧 permission。
 * 这两个字段也供 SessionStatusBar 的左右对齐布局复用，避免组件自行拼业务文案。
 */
export function sessionIdleStatusItems(metrics: SessionRuntimeMetrics): readonly [string, string] {
  const billing = billingLabel(metrics)
  const permission = metrics.permission?.label ? `权限 ${metrics.permission.label}` : '权限—'
  return [billing, permission]
}

/**
 * Prompt 下方 canonical Session detail 项目。
 *
 * #14：0 轮时只保留 billing + permission，避免用一排 “—” 占位制造视觉噪声；
 * 第 1 轮开始恢复 #12 的完整 telemetry，且 width 仍然只影响换行，不影响字段集合。
 */
export function sessionStatusItems(metrics: SessionRuntimeMetrics, _width?: number): readonly string[] {
  const [billing, permission] = sessionIdleStatusItems(metrics)
  if (metrics.turnCount <= 0) return [billing, permission]

  const turnTokens = exactInteger(metrics.currentTurn?.usage.totalTokens)
  const sessionTokens = exactInteger(metrics.sessionUsage.totalTokens)
  const turnHit = percent(metrics.currentTurn?.usage.cacheHitRatio, 2)
  const averageHit = percent(metrics.sessionUsage.averageCacheHitRatio, 2)
  const compactionThreshold = metrics.compaction.available
    ? percent(metrics.compaction.thresholdRatio, 2)
    : '—'
  const sessionCost = metrics.billing.kind === 'api' ? money(metrics.sessionCost) : '—'

  return [
    billing,
    `本次命中${turnHit}`,
    `平均命中${averageHit}`,
    `会话 tokens${sessionTokens}`,
    `本次 tokens${turnTokens}`,
    `压缩阈值${compactionThreshold}`,
    `当前会话${metrics.turnCount}轮`,
    ...(sessionCost !== '—' ? [`会话费用${sessionCost}`] : []),
    permission,
  ]
}

/**
 * 把完整 detail items 按真实 Terminal 列宽贪心打包为多行。字段集合恒定；
 * 这里仅决定换行，不允许通过窄屏分支隐藏 telemetry。
 */
export function sessionStatusRows(metrics: SessionRuntimeMetrics, width: number): readonly string[] {
  const separator = ' · '
  const separatorWidth = terminalTextColumns(separator)
  const available = Math.max(1, Math.floor(width) - 2) // SessionStatusBar 左右各保留 1 列 padding。
  const rows: string[] = []
  let currentItems: string[] = []
  let currentWidth = 0

  for (const item of sessionStatusItems(metrics)) {
    const itemWidth = terminalTextColumns(item)
    const nextWidth = currentItems.length === 0
      ? itemWidth
      : currentWidth + separatorWidth + itemWidth

    if (currentItems.length > 0 && nextWidth > available) {
      rows.push(currentItems.join(separator))
      currentItems = [item]
      currentWidth = itemWidth
      continue
    }

    currentItems.push(item)
    currentWidth = nextWidth
  }

  if (currentItems.length > 0) rows.push(currentItems.join(separator))
  return rows
}
