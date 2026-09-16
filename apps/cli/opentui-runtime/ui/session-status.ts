/**
 * 文件作用：把 Host-neutral SessionRuntimeMetrics 格式化为 Terminal 状态栏项目，不依赖 OpenTUI Renderable。
 * 关联模块：session-status-bar.tsx、xma-session metrics、未来 Terminal 快照测试。
 * 职责边界：只做 Terminal 文本投影；Provider 品牌、价格、余额、套餐数据必须已经由 canonical metrics 提供。
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

/**
 * Prompt 主状态行中的首要 Session 指标。
 *
 * 这里刻意只放用户需要持续关注的“会话健康”信息；Provider/Model/Ready
 * 由 PromptDock 的 Provider truth 独立展示，避免模型身份在两行重复。
 */
export function sessionHeadlineItems(metrics: SessionRuntimeMetrics, width: number): readonly string[] {
  if (width < 82) return []

  const context = contextLabel(metrics)
  const quota = subscriptionQuota(metrics)
  const account = metrics.billing.kind === 'api' ? `余额 ${balance(metrics)}` : quota

  // 窄屏只保留 context；常见宽度增加账户真值。
  // Provider group 自己 flexShrink=0，因此 headline 即使空间不足也只能被裁，不能挤掉 Provider truth。
  if (width < 100) return [context]
  return account ? [context, account] : [context]
}

/**
 * Prompt 下方的次要 Session 指标。
 *
 * #11 重新把 #05 已存在的 cache/token/turn 真值带回常见宽度，但不恢复旧版
 * model/context/balance 重复。常见宽度使用紧凑标签保留所有关键值；超宽屏再展开
 * 用户可读的完整标签。compaction 仍只消费 canonical truth，未实现时必须显示 —。
 */
export function sessionStatusItems(metrics: SessionRuntimeMetrics, width: number): readonly string[] {
  const turnTokens = exactInteger(metrics.currentTurn?.usage.totalTokens)
  const sessionTokens = exactInteger(metrics.sessionUsage.totalTokens)
  const permission = metrics.permission?.label ? `权限 ${metrics.permission.label}` : '权限—'
  const billing = billingLabel(metrics)
  const turnHit = percent(metrics.currentTurn?.usage.cacheHitRatio, 2)
  const averageHit = percent(metrics.sessionUsage.averageCacheHitRatio, 2)
  const compactionThreshold = metrics.compaction.available
    ? percent(metrics.compaction.thresholdRatio, 2)
    : '—'
  const sessionCost = metrics.billing.kind === 'api' ? money(metrics.sessionCost) : '—'

  if (width < 82) return [permission]

  // 很窄时继续优先保证“计费 + 本次 token + 费用 + 权限”；不让 detail row 自动换行挤高 Dock。
  if (width < 104) {
    return [
      billing,
      `本次 ${turnTokens}`,
      ...(sessionCost !== '—' ? [`费用 ${sessionCost}`] : []),
      permission,
    ]
  }

  // 常见 Windows Terminal 宽度用短标签保留用户要求的全部真实 telemetry。
  // 这里刻意不显示 requestCount/model/context/balance，避免把 #10 已去重的字段重新堆回来。
  if (width < 124) {
    return [
      billing,
      `本次命中${turnHit}`,
      `平均命中${averageHit}`,
      `会话${sessionTokens}t`,
      `本次${turnTokens}t`,
      `压缩${compactionThreshold}`,
      `${metrics.turnCount}轮`,
      ...(sessionCost !== '—' ? [`费用${sessionCost}`] : []),
      metrics.permission?.label ?? '权限—',
    ]
  }

  // 中宽屏优先把本次/平均命中、精确 token、压缩阈值和轮次用完整标签展开；
  // 费用/权限仍使用短标签，避免在常见 130~150 列窗口被裁掉。
  if (width < 150) {
    return [
      billing,
      `本次命中${turnHit}`,
      `平均命中${averageHit}`,
      `会话 tokens${sessionTokens}`,
      `本次 tokens${turnTokens}`,
      `压缩阈值${compactionThreshold}`,
      `当前会话${metrics.turnCount}轮`,
      ...(sessionCost !== '—' ? [`费用${sessionCost}`] : []),
      metrics.permission?.label ?? '权限—',
    ]
  }

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

