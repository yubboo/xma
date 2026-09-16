/**
 * 文件作用：验证 Terminal 状态栏对 API / subscription / unknown canonical metrics 的诚实投影。
 * 关联模块：apps/cli/opentui-runtime/ui/session-status.ts、xma-session metrics。
 * 职责边界：不测试 OpenTUI 绘制，只锁定“真实数据有则显示、无则 —、套餐不冒充 API 费用”。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionRuntimeMetrics } from 'xma-session'
import { sessionStatusItems } from '../opentui-runtime/ui/session-status.ts'

function baseMetrics(): SessionRuntimeMetrics {
  return {
    sessionId: 's',
    agentId: 'xiaoyu',
    identity: { provider: 'provider-x', profile: 'profile-x', model: 'model-x', displayName: 'Provider X' },
    billing: { kind: 'unknown' },
    turnCount: 3,
    requestCount: 4,
    currentTurn: {
      turnId: 'turn-3',
      active: false,
      usage: { requestCount: 1, inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40, cacheHitRatio: 0.4, averageCacheHitRatio: 0.4 },
      cost: { status: 'unavailable', sources: [] },
    },
    sessionUsage: { requestCount: 4, inputTokens: 800, outputTokens: 200, totalTokens: 1_000, cachedInputTokens: 200, cacheHitRatio: 0.25, averageCacheHitRatio: 0.2 },
    sessionCost: { status: 'unavailable', sources: [] },
    context: { usedTokens: 100, windowTokens: 1_000, ratio: 0.1 },
    compaction: { available: false },
    permission: { id: 'ask', label: '请求批准' },
  }
}

test('API status shows canonical API cost/balance and current model without brand hardcoding', () => {
  const metrics = baseMetrics()
  metrics.identity = { provider: 'any-api-provider', profile: 'api-p', model: 'future-model-42', displayName: 'Future Provider' }
  metrics.billing = { kind: 'api', label: 'API' }
  metrics.currentTurn!.cost = { status: 'complete', amount: 0.0042, currency: 'USD', precision: 'estimated', sources: ['price-source'] }
  metrics.sessionCost = { status: 'complete', amount: 1.25, currency: 'USD', precision: 'estimated', sources: ['price-source'] }
  metrics.account = {
    providerId: 'any-api-provider',
    profileId: 'api-p',
    billing: { kind: 'api', label: 'API' },
    checkedAt: '2026-09-16T00:00:00.000Z',
    available: true,
    balances: [{ currency: 'USD', total: '9.75' }],
  }
  const text = sessionStatusItems(metrics, 220).join(' | ')
  assert.match(text, /future-model-42/)
  assert.match(text, /本轮命中 40%/)
  assert.match(text, /平均命中 20%/)
  assert.match(text, /本轮费用 ≈\$0\.0042/)
  assert.match(text, /会话费用 ≈\$1\.25/)
  assert.match(text, /余额 \$9\.75/)
  assert.match(text, /上下文 10%/)
  assert.match(text, /压缩—/)
})

test('subscription status shows plan/quota and never calculates API cost fields', () => {
  const metrics = baseMetrics()
  metrics.billing = { kind: 'subscription', label: '订阅', planName: 'Ultra Plan' }
  metrics.account = {
    providerId: 'provider-x',
    profileId: 'profile-x',
    billing: metrics.billing,
    checkedAt: '2026-09-16T00:00:00.000Z',
    available: true,
    quota: { planName: 'Ultra Plan', unit: 'requests', used: 12, limit: 100, remaining: 88 },
  }
  const text = sessionStatusItems(metrics, 220).join(' | ')
  assert.match(text, /Ultra Plan/)
  assert.match(text, /额度 12\/100/)
  assert.doesNotMatch(text, /本轮费用|会话费用|余额/)
})

test('unknown telemetry stays unknown instead of rendering fake zeros', () => {
  const metrics = baseMetrics()
  metrics.context = {}
  delete metrics.currentTurn
  metrics.sessionUsage = { requestCount: 0 }
  const text = sessionStatusItems(metrics, 220).join(' | ')
  assert.match(text, /本轮 —/)
  assert.match(text, /会话 — tokens/)
  assert.match(text, /上下文 —/)
  assert.doesNotMatch(text, /80%|0\.0000|12\.93/)
})
