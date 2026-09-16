/**
 * 文件作用：把 durable Session events 投影为 Host-neutral 的运行指标快照。
 * 关联模块：contract.ts、xma-ai Provider telemetry、App Protocol、CLI/Desktop/Web 状态面板。
 * 当前实现：Turn/Request/Token/Cache/Latency/Context/Cost/Account/Permission/Compaction 统一 Projection。
 * 职责边界：只从真实 Session facts 和注入的 Provider telemetry 计算；未知即 unknown，不允许 Renderer 自己补假数字。
 */

import type {
  ModelDescriptor,
  ModelIdentity,
  ProviderAccountSnapshot,
  ProviderBillingSource,
  ProviderCostEstimate,
  ProviderUsageSnapshot,
} from 'xma-ai'
import type { PermissionProfileId } from 'xma-tools'
import type { SessionEvent, SessionSnapshot } from './contract.ts'

export interface SessionUsageMetrics extends ProviderUsageSnapshot {
  totalTokens?: number
  cacheHitRatio?: number
  /** Arithmetic mean of per-request cache hit ratios when the Provider reports both values. */
  averageCacheHitRatio?: number
  requestCount: number
  averageRequestLatencyMs?: number
  averageFirstTokenLatencyMs?: number
}

export interface SessionCostMetrics {
  status: 'complete' | 'partial' | 'unavailable'
  amount?: number
  currency?: string
  precision?: 'provider-reported' | 'estimated'
  sources: readonly string[]
}

export interface SessionTurnMetrics {
  turnId: string
  active: boolean
  usage: SessionUsageMetrics
  cost: SessionCostMetrics
}

export interface SessionContextMetrics {
  usedTokens?: number
  windowTokens?: number
  ratio?: number
  identity?: ModelIdentity
}

export interface SessionCompactionMetrics {
  available: boolean
  active?: boolean
  thresholdRatio?: number
  detail?: string
}

export interface SessionPermissionMetrics {
  id: PermissionProfileId
  label: string
}

export interface SessionRuntimeMetrics {
  sessionId: string
  agentId: string
  identity?: ModelIdentity
  billing: ProviderBillingSource
  turnCount: number
  requestCount: number
  currentTurn?: SessionTurnMetrics
  sessionUsage: SessionUsageMetrics
  sessionCost: SessionCostMetrics
  context: SessionContextMetrics
  compaction: SessionCompactionMetrics
  account?: ProviderAccountSnapshot
  permission?: SessionPermissionMetrics
}

export interface SessionMetricsProjectionOptions {
  activeIdentity?: ModelIdentity
  billingSource?: (identity: ModelIdentity) => ProviderBillingSource | undefined
  modelDescriptor?: (identity: ModelIdentity) => ModelDescriptor | undefined
  estimateCost?: (
    identity: ModelIdentity,
    usage: ProviderUsageSnapshot,
    timestamp: string,
  ) => ProviderCostEstimate | undefined
  account?: ProviderAccountSnapshot
  permission?: SessionPermissionMetrics
  compaction?: SessionCompactionMetrics
}

interface UsageRow {
  event: Extract<SessionEvent, { type: 'usage' }>
  identity: ModelIdentity | undefined
  /** Pricing time is the model request Step start, not the later usage-event append time. */
  pricingTimestamp: string
}

function addValue(current: number | undefined, value: number | undefined): number | undefined {
  if (value === undefined) return current
  return (current ?? 0) + value
}

function usageMetrics(rows: readonly UsageRow[]): SessionUsageMetrics {
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let cachedInputTokens: number | undefined
  let reasoningTokens: number | undefined
  let latencyTotal = 0
  let latencyCount = 0
  let firstTokenTotal = 0
  let firstTokenCount = 0
  let cacheRatioTotal = 0
  let cacheRatioCount = 0
  for (const row of rows) {
    const event = row.event
    inputTokens = addValue(inputTokens, event.inputTokens)
    outputTokens = addValue(outputTokens, event.outputTokens)
    cachedInputTokens = addValue(cachedInputTokens, event.cachedInputTokens)
    reasoningTokens = addValue(reasoningTokens, event.reasoningTokens)
    if (event.totalLatencyMs !== undefined) {
      latencyTotal += event.totalLatencyMs
      latencyCount += 1
    }
    if (event.firstTokenLatencyMs !== undefined) {
      firstTokenTotal += event.firstTokenLatencyMs
      firstTokenCount += 1
    }
    if (event.inputTokens !== undefined && event.inputTokens > 0 && event.cachedInputTokens !== undefined) {
      cacheRatioTotal += Math.max(0, Math.min(1, event.cachedInputTokens / event.inputTokens))
      cacheRatioCount += 1
    }
  }
  const result: SessionUsageMetrics = { requestCount: rows.length }
  if (inputTokens !== undefined) result.inputTokens = inputTokens
  if (outputTokens !== undefined) result.outputTokens = outputTokens
  if (cachedInputTokens !== undefined) result.cachedInputTokens = cachedInputTokens
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens
  if (inputTokens !== undefined && outputTokens !== undefined) result.totalTokens = inputTokens + outputTokens
  if (inputTokens !== undefined && inputTokens > 0 && cachedInputTokens !== undefined) {
    result.cacheHitRatio = Math.max(0, Math.min(1, cachedInputTokens / inputTokens))
  }
  if (cacheRatioCount > 0) result.averageCacheHitRatio = cacheRatioTotal / cacheRatioCount
  if (latencyCount > 0) result.averageRequestLatencyMs = latencyTotal / latencyCount
  if (firstTokenCount > 0) result.averageFirstTokenLatencyMs = firstTokenTotal / firstTokenCount
  return result
}

function hasUsageTokens(event: Extract<SessionEvent, { type: 'usage' }>): boolean {
  return event.inputTokens !== undefined || event.outputTokens !== undefined || event.cachedInputTokens !== undefined || event.reasoningTokens !== undefined
}

function costMetrics(rows: readonly UsageRow[], estimator: SessionMetricsProjectionOptions['estimateCost']): SessionCostMetrics {
  if (!estimator) return { status: 'unavailable', sources: [] }
  let amount = 0
  let currency: string | undefined
  let precision: 'provider-reported' | 'estimated' | undefined
  let known = 0
  let missing = 0
  const sources = new Set<string>()

  for (const row of rows) {
    if (!hasUsageTokens(row.event)) continue
    if (!row.identity) {
      missing += 1
      continue
    }
    const estimate = estimator(row.identity, {
      ...(row.event.inputTokens !== undefined ? { inputTokens: row.event.inputTokens } : {}),
      ...(row.event.outputTokens !== undefined ? { outputTokens: row.event.outputTokens } : {}),
      ...(row.event.cachedInputTokens !== undefined ? { cachedInputTokens: row.event.cachedInputTokens } : {}),
      ...(row.event.reasoningTokens !== undefined ? { reasoningTokens: row.event.reasoningTokens } : {}),
    }, row.pricingTimestamp)
    if (!estimate) {
      missing += 1
      continue
    }
    if (currency !== undefined && currency !== estimate.currency) {
      return { status: 'unavailable', sources: [...sources, estimate.source.id] }
    }
    currency = estimate.currency
    precision = precision === 'estimated' || estimate.precision === 'estimated' ? 'estimated' : 'provider-reported'
    amount += estimate.amount
    sources.add(estimate.source.id)
    known += 1
  }

  if (known === 0) return { status: 'unavailable', sources: [...sources] }
  const result: SessionCostMetrics = {
    status: missing > 0 ? 'partial' : 'complete',
    amount,
    sources: [...sources],
  }
  if (currency !== undefined) result.currency = currency
  if (precision !== undefined) result.precision = precision
  return result
}

function sameProfile(account: ProviderAccountSnapshot | undefined, identity: ModelIdentity | undefined): boolean {
  if (!account || !identity) return false
  if (account.providerId !== identity.provider) return false
  return identity.profile === undefined || account.profileId === identity.profile
}

export function projectSessionRuntimeMetrics(
  snapshot: SessionSnapshot,
  options: SessionMetricsProjectionOptions = {},
): SessionRuntimeMetrics {
  const stepIdentity = new Map<string, ModelIdentity>()
  const stepStartedAt = new Map<string, string>()
  const turnStarts: Array<Extract<SessionEvent, { type: 'turn/start' }>> = []
  const turnEnds = new Map<string, Extract<SessionEvent, { type: 'turn/end' }>>()
  const usageRows: UsageRow[] = []

  for (const event of snapshot.events) {
    if (event.type === 'turn/start') turnStarts.push(event)
    else if (event.type === 'turn/end') turnEnds.set(event.turnId, event)
    else if (event.type === 'step/start') {
      stepIdentity.set(event.stepId, structuredClone(event.provider))
      stepStartedAt.set(event.stepId, event.timestamp)
    } else if (event.type === 'usage') {
      usageRows.push({
        event,
        identity: stepIdentity.get(event.stepId),
        pricingTimestamp: stepStartedAt.get(event.stepId) ?? event.timestamp,
      })
    }
  }

  const latestTurn = turnStarts.at(-1)
  const currentRows = latestTurn ? usageRows.filter(row => row.event.turnId === latestTurn.turnId) : []
  const latestUsage = [...usageRows].reverse().find(row => row.event.inputTokens !== undefined && row.identity !== undefined)
  const latestStepIdentity = [...stepIdentity.values()].at(-1)
  const identity = structuredClone(options.activeIdentity ?? latestStepIdentity)
  const billing = identity ? options.billingSource?.(identity) ?? { kind: 'unknown' as const } : { kind: 'unknown' as const }

  const context: SessionContextMetrics = {}
  if (latestUsage?.identity && latestUsage.event.inputTokens !== undefined) {
    context.usedTokens = latestUsage.event.inputTokens
    context.identity = structuredClone(latestUsage.identity)
    const descriptor = options.modelDescriptor?.(latestUsage.identity)
    if (descriptor?.contextWindow !== undefined && descriptor.contextWindow > 0) {
      context.windowTokens = descriptor.contextWindow
      context.ratio = latestUsage.event.inputTokens / descriptor.contextWindow
    }
  }

  const sessionUsage = usageMetrics(usageRows)
  const result: SessionRuntimeMetrics = {
    sessionId: snapshot.header.sessionId,
    agentId: snapshot.header.agentId,
    ...(identity ? { identity } : {}),
    billing: structuredClone(billing),
    turnCount: turnStarts.length,
    requestCount: sessionUsage.requestCount,
    sessionUsage,
    sessionCost: costMetrics(usageRows, options.estimateCost),
    context,
    compaction: structuredClone(options.compaction ?? {
      available: false,
      detail: '当前 Session 尚未启用 durable context compaction。',
    }),
    ...(options.permission ? { permission: structuredClone(options.permission) } : {}),
  }

  if (latestTurn) {
    result.currentTurn = {
      turnId: latestTurn.turnId,
      active: !turnEnds.has(latestTurn.turnId),
      usage: usageMetrics(currentRows),
      cost: costMetrics(currentRows, options.estimateCost),
    }
  }
  if (options.account && sameProfile(options.account, identity)) result.account = structuredClone(options.account)
  return result
}
