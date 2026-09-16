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
 * 根据 Terminal 宽度选择真实指标。窄屏只裁展示字段，不改变 canonical metrics。
 */
export function sessionStatusItems(metrics: SessionRuntimeMetrics, width: number): readonly string[] {
  const model = metrics.identity?.model ?? '模型—'
  const turnTokens = compactInteger(metrics.currentTurn?.usage.totalTokens)
  const sessionTokens = compactInteger(metrics.sessionUsage.totalTokens)
  const context = percent(metrics.context.ratio)
  const permission = metrics.permission?.label ?? '权限—'
  const quota = subscriptionQuota(metrics)

  const essential = [
    model,
    billingLabel(metrics),
    `本轮 ${turnTokens}`,
    `会话 ${sessionTokens}`,
    `上下文 ${context}`,
    permission,
  ]
  if (width < 92) return essential

  const medium = [
    model,
    billingLabel(metrics),
    `本轮 ${turnTokens}`,
    `会话 ${sessionTokens}`,
    `会话 ${metrics.turnCount}轮`,
    `上下文 ${context}`,
    metrics.compaction.available
      ? `压缩 ${metrics.compaction.active ? '进行中' : percent(metrics.compaction.thresholdRatio)}`
      : '压缩—',
    ...(quota ? [quota] : []),
    permission,
  ]
  if (width < 132) return medium

  const apiCosts = metrics.billing.kind === 'api'
    ? [`本轮费用 ${money(metrics.currentTurn?.cost ?? { status: 'unavailable', sources: [] })}`, `会话费用 ${money(metrics.sessionCost)}`, `余额 ${balance(metrics)}`]
    : []

  return [
    model,
    billingLabel(metrics),
    `本轮命中 ${percent(metrics.currentTurn?.usage.cacheHitRatio)}`,
    `平均命中 ${percent(metrics.sessionUsage.averageCacheHitRatio)}`,
    `会话 ${sessionTokens} tokens`,
    `本轮 ${turnTokens}`,
    `请求 ${metrics.requestCount}`,
    `会话 ${metrics.turnCount}轮`,
    `上下文 ${context}`,
    metrics.compaction.available
      ? `压缩 ${metrics.compaction.active ? '进行中' : percent(metrics.compaction.thresholdRatio)}`
      : '压缩—',
    ...apiCosts,
    ...(quota ? [quota] : []),
    permission,
  ]
}
