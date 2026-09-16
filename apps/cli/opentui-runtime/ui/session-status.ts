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

function percent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
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
 * 详细 telemetry 仍完整保存在 SessionRuntimeMetrics；这里不再把 model/context/balance
 * 全部重复绘制成一条超长状态栏，只保留与当前操作直接相关的少量辅助信息。
 */
export function sessionStatusItems(metrics: SessionRuntimeMetrics, width: number): readonly string[] {
  const turnTokens = compactInteger(metrics.currentTurn?.usage.totalTokens)
  const sessionTokens = compactInteger(metrics.sessionUsage.totalTokens)
  const permission = metrics.permission?.label ? `权限 ${metrics.permission.label}` : '权限—'
  const billing = billingLabel(metrics)

  if (width < 82) return [permission]

  const sessionCost = metrics.billing.kind === 'api' ? money(metrics.sessionCost) : '—'
  const turnCost = metrics.billing.kind === 'api'
    ? money(metrics.currentTurn?.cost ?? { status: 'unavailable', sources: [] })
    : '—'

  const medium = [
    billing,
    `本轮 ${turnTokens}`,
    ...(sessionCost !== '—' ? [`会话费用 ${sessionCost}`] : []),
    permission,
  ]
  if (width < 132) return medium

  const wide = [
    billing,
    `本轮 ${turnTokens}`,
    `会话 ${sessionTokens}`,
    `会话 ${metrics.turnCount}轮`,
    ...(turnCost !== '—' ? [`本轮费用 ${turnCost}`] : []),
    ...(sessionCost !== '—' ? [`会话费用 ${sessionCost}`] : []),
    permission,
  ]
  if (width < 170) return wide

  return [
    billing,
    `本轮命中 ${percent(metrics.currentTurn?.usage.cacheHitRatio)}`,
    `平均命中 ${percent(metrics.sessionUsage.averageCacheHitRatio)}`,
    `本轮 ${turnTokens}`,
    `会话 ${sessionTokens}`,
    `请求 ${metrics.requestCount}`,
    `会话 ${metrics.turnCount}轮`,
    metrics.compaction.available
      ? `压缩 ${metrics.compaction.active ? '进行中' : percent(metrics.compaction.thresholdRatio)}`
      : '压缩—',
    ...(turnCost !== '—' ? [`本轮费用 ${turnCost}`] : []),
    ...(sessionCost !== '—' ? [`会话费用 ${sessionCost}`] : []),
    permission,
  ]
}
