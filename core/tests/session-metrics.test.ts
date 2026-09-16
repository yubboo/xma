/**
 * 文件作用：验证 Host-neutral SessionRuntimeMetrics 从 durable Session facts 投影真实 Turn/Usage/Context/Cost。
 * 关联模块：packages/xma-session/src/metrics.ts、xma-ai Provider telemetry、未来 App Protocol session/metrics。
 * 职责边界：只验证纯投影，不访问网络、不依赖 Terminal UI。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ModelIdentity, ProviderAccountSnapshot } from 'xma-ai'
import { projectSessionRuntimeMetrics, type SessionEvent, type SessionEventData, type SessionSnapshot } from 'xma-session'

function fixture(): SessionSnapshot {
  let sequence = 0
  const events: SessionEvent[] = []
  const push = (timestamp: string, data: SessionEventData) => {
    events.push({ sessionId: 'session-metrics', sequence: ++sequence, timestamp, ...data } as SessionEvent)
  }

  const deepSeek: ModelIdentity = { provider: 'deepseek', profile: 'deepseek-main', model: 'deepseek-v4-pro', displayName: 'DeepSeek' }
  const custom: ModelIdentity = { provider: 'custom-openai-compatible', profile: 'custom-main', model: 'astra-top', displayName: 'Astra Gateway' }

  push('2026-09-16T10:00:00.000Z', { type: 'session/created', agentId: 'xiaoyu' })
  push('2026-09-16T10:00:01.000Z', { type: 'turn/start', turnId: 'turn-1' })
  push('2026-09-16T10:00:02.000Z', { type: 'step/start', turnId: 'turn-1', stepId: 'step-1', provider: deepSeek, toolPlanId: 'tools-1', tools: [], messageCount: 2 })
  push('2026-09-16T10:00:03.000Z', { type: 'usage', turnId: 'turn-1', stepId: 'step-1', inputTokens: 1_000, outputTokens: 100, cachedInputTokens: 500, reasoningTokens: 40, firstTokenLatencyMs: 120, totalLatencyMs: 500 })
  push('2026-09-16T10:00:04.000Z', { type: 'step/end', turnId: 'turn-1', stepId: 'step-1', outcome: 'completed' })
  push('2026-09-16T10:00:05.000Z', { type: 'turn/end', turnId: 'turn-1', outcome: 'completed', text: 'done' })

  push('2026-09-16T10:01:00.000Z', { type: 'turn/start', turnId: 'turn-2' })
  push('2026-09-16T10:01:01.000Z', { type: 'step/start', turnId: 'turn-2', stepId: 'step-2', provider: custom, toolPlanId: 'tools-2', tools: [], messageCount: 4 })
  push('2026-09-16T10:01:02.000Z', { type: 'usage', turnId: 'turn-2', stepId: 'step-2', inputTokens: 2_000, outputTokens: 200, cachedInputTokens: 0, firstTokenLatencyMs: 240, totalLatencyMs: 900 })

  return {
    header: {
      formatVersion: 1,
      sessionId: 'session-metrics',
      agentId: 'xiaoyu',
      createdAt: '2026-09-16T10:00:00.000Z',
    },
    events,
  }
}

test('Session metrics keep historical model ownership and distinguish weighted/current/average usage facts', () => {
  const activeIdentity: ModelIdentity = { provider: 'custom-openai-compatible', profile: 'custom-main', model: 'astra-top', displayName: 'Astra Gateway' }
  const account: ProviderAccountSnapshot = {
    providerId: 'custom-openai-compatible',
    profileId: 'custom-main',
    billing: { kind: 'api', label: 'API' },
    checkedAt: '2026-09-16T10:01:03.000Z',
    available: true,
  }

  const metrics = projectSessionRuntimeMetrics(fixture(), {
    activeIdentity,
    billingSource: identity => identity.provider === 'custom-openai-compatible' ? { kind: 'api', label: 'API' } : { kind: 'api', label: 'API' },
    modelDescriptor: identity => ({
      id: identity.model,
      contextWindow: identity.model === 'astra-top' ? 4_000 : 1_000_000,
      source: 'static',
      fetchedAt: '2026-09-16T00:00:00.000Z',
    }),
    estimateCost: identity => identity.provider === 'deepseek'
      ? { amount: 0.1234, currency: 'CNY', precision: 'estimated', source: { id: 'deepseek-test-price', label: 'test' } }
      : undefined,
    account,
    permission: { id: 'ask', label: '请求批准' },
  })

  assert.equal(metrics.identity?.model, 'astra-top')
  assert.equal(metrics.billing.kind, 'api')
  assert.equal(metrics.turnCount, 2)
  assert.equal(metrics.requestCount, 2)
  assert.equal(metrics.sessionUsage.inputTokens, 3_000)
  assert.equal(metrics.sessionUsage.outputTokens, 300)
  assert.equal(metrics.sessionUsage.totalTokens, 3_300)
  assert.equal(metrics.sessionUsage.cachedInputTokens, 500)
  assert.equal(metrics.sessionUsage.cacheHitRatio, 500 / 3_000)
  assert.equal(metrics.sessionUsage.averageCacheHitRatio, 0.25)
  assert.equal(metrics.sessionUsage.averageFirstTokenLatencyMs, 180)
  assert.equal(metrics.sessionUsage.averageRequestLatencyMs, 700)
  assert.equal(metrics.currentTurn?.turnId, 'turn-2')
  assert.equal(metrics.currentTurn?.active, true)
  assert.equal(metrics.currentTurn?.usage.totalTokens, 2_200)
  assert.equal(metrics.currentTurn?.usage.cacheHitRatio, 0)
  assert.equal(metrics.sessionCost.status, 'partial')
  assert.equal(metrics.sessionCost.amount, 0.1234)
  assert.deepEqual(metrics.sessionCost.sources, ['deepseek-test-price'])
  assert.equal(metrics.currentTurn?.cost.status, 'unavailable')
  assert.equal(metrics.context.usedTokens, 2_000)
  assert.equal(metrics.context.windowTokens, 4_000)
  assert.equal(metrics.context.ratio, 0.5)
  assert.equal(metrics.account?.profileId, 'custom-main')
  assert.equal(metrics.permission?.id, 'ask')
  assert.equal(metrics.compaction.available, false)
})

test('Session metrics never invent context or cost when Provider telemetry is absent', () => {
  const metrics = projectSessionRuntimeMetrics(fixture(), {
    activeIdentity: { provider: 'unknown-provider', profile: 'p', model: 'm' },
    billingSource: () => ({ kind: 'unknown' }),
  })

  assert.equal(metrics.billing.kind, 'unknown')
  assert.equal(metrics.context.windowTokens, undefined)
  assert.equal(metrics.context.ratio, undefined)
  assert.equal(metrics.sessionCost.status, 'unavailable')
  assert.equal(metrics.sessionCost.amount, undefined)
  assert.equal(metrics.account, undefined)
})


test('context never combines old-model usage with a newly selected model window', () => {
  const metrics = projectSessionRuntimeMetrics(fixture(), {
    activeIdentity: { provider: 'deepseek', profile: 'deepseek-main', model: 'deepseek-v4-pro', displayName: 'DeepSeek' },
    billingSource: () => ({ kind: 'api', label: 'API' }),
    modelDescriptor: identity => ({
      id: identity.model,
      contextWindow: identity.model === 'deepseek-v4-pro' ? 1_000_000 : 4_000,
      source: 'static',
      fetchedAt: '2026-09-16T00:00:00.000Z',
    }),
  })

  assert.equal(metrics.context.identity?.model, 'deepseek-v4-pro')
  assert.equal(metrics.context.windowTokens, 1_000_000)
  assert.equal(metrics.context.usedTokens, undefined)
  assert.equal(metrics.context.ratio, undefined)
})
