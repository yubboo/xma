/**
 * 文件作用：验证 Terminal 对 API / subscription / unknown canonical metrics 的诚实分层投影。
 * 关联模块：apps/cli/opentui-runtime/ui/session-status.ts、xma-session metrics。
 * 职责边界：不测试 OpenTUI 绘制，只锁定 headline/detail 的字段优先级，以及“真实数据有则显示、无则 —”。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionRuntimeMetrics } from 'xma-session'
import { sessionHeadlineItems, sessionStatusItems, sessionStatusRows, terminalTextColumns } from '../opentui-runtime/ui/session-status.ts'

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

test('API headline shows canonical context/balance while detail keeps real cost without repeating model/context/account', () => {
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

  const headline = sessionHeadlineItems(metrics, 110).join(' | ')
  const detail = sessionStatusItems(metrics, 220).join(' | ')
  assert.match(headline, /上下文 10%/)
  assert.match(headline, /余额 \$9\.75/)
  assert.doesNotMatch(headline, /future-model-42/)

  assert.match(detail, /本次命中40\.00%/)
  assert.match(detail, /平均命中20\.00%/)
  assert.match(detail, /会话 tokens1,000/)
  assert.match(detail, /本次 tokens120/)
  assert.match(detail, /压缩阈值—/)
  assert.match(detail, /会话费用≈\$1\.25/)
  assert.match(detail, /权限 请求批准/)
  assert.doesNotMatch(detail, /future-model-42|上下文|余额/)
})

test('subscription headline shows quota and detail never invents API cost fields', () => {
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
  const headline = sessionHeadlineItems(metrics, 110).join(' | ')
  const detail = sessionStatusItems(metrics, 220).join(' | ')
  assert.match(headline, /额度 12\/100/)
  assert.match(detail, /Ultra Plan/)
  assert.doesNotMatch(detail, /费用|余额/)
})

test('unknown telemetry stays unknown instead of rendering fake zeros', () => {
  const metrics = baseMetrics()
  metrics.context = {}
  delete metrics.currentTurn
  metrics.sessionUsage = { requestCount: 0 }
  const headline = sessionHeadlineItems(metrics, 110).join(' | ')
  const detail = sessionStatusItems(metrics, 110).join(' | ')
  assert.match(headline, /上下文 —/)
  assert.match(detail, /本次 tokens—/)
  assert.doesNotMatch(headline + detail, /80%|0\.0000|12\.93/)
})

test('context headline preserves sub-percent truth and shows used/window capacity', () => {
  const metrics = baseMetrics()
  metrics.context = { usedTokens: 1_791, windowTokens: 1_000_000, ratio: 1_791 / 1_000_000 }
  const text = sessionHeadlineItems(metrics, 110).join(' | ')
  assert.match(text, /上下文 0\.2%/)
  assert.match(text, /1,791\/1\.0m/)
  assert.doesNotMatch(text, /上下文 0%/)
})

test('common-width API headline keeps real balance beside context', () => {
  const metrics = baseMetrics()
  metrics.billing = { kind: 'api', label: 'API' }
  metrics.context = { usedTokens: 1_793, windowTokens: 1_000_000, ratio: 1_793 / 1_000_000 }
  metrics.account = {
    providerId: 'provider-x',
    profileId: 'profile-x',
    billing: { kind: 'api', label: 'API' },
    checkedAt: '2026-09-16T00:00:00.000Z',
    available: true,
    balances: [{ currency: 'CNY', total: '12.02' }],
  }
  const text = sessionHeadlineItems(metrics, 100).join(' · ')
  assert.equal(text, '上下文 0.2% · 1,793/1.0m · 余额 ¥12.02')
})



test('detail keeps the same complete canonical field set at narrow, common, and wide widths', () => {
  const metrics = baseMetrics()
  metrics.billing = { kind: 'api', label: 'API' }
  metrics.currentTurn!.usage = {
    requestCount: 1,
    inputTokens: 198_000,
    outputTokens: 157,
    totalTokens: 198_157,
    cachedInputTokens: 0,
    cacheHitRatio: 0,
    averageCacheHitRatio: 0,
  }
  metrics.sessionUsage = {
    requestCount: 35,
    inputTokens: 63_000_000,
    outputTokens: 112_938,
    totalTokens: 63_112_938,
    cachedInputTokens: 0,
    cacheHitRatio: 0,
    averageCacheHitRatio: 0,
  }
  metrics.turnCount = 35
  metrics.sessionCost = { status: 'complete', amount: 0.0011, currency: 'CNY', precision: 'estimated', sources: ['price-source'] }
  metrics.permission = { id: 'smart', label: '替我审批' }

  const items = sessionStatusItems(metrics)
  assert.deepEqual(items, [
    'API',
    '本次命中0.00%',
    '平均命中0.00%',
    '会话 tokens63,112,938',
    '本次 tokens198,157',
    '压缩阈值—',
    '当前会话35轮',
    '会话费用≈¥0.0011',
    '权限 替我审批',
  ])

  for (const width of [78, 100, 136, 220]) {
    const rows = sessionStatusRows(metrics, width)
    assert.ok(rows.length >= 1)
    assert.equal(rows.join(' · '), items.join(' · '), `width ${width} must not hide or reorder metrics`)
    assert.ok(rows.every(row => terminalTextColumns(row) <= Math.max(1, width - 2)), `width ${width} rows must fit inside status padding`)
  }

  assert.ok(sessionStatusRows(metrics, 78).length >= 2, 'Home-width detail must wrap instead of hiding fields')
  assert.equal(sessionStatusRows(metrics, 220).length, 1, 'wide detail should stay on one line when it fits')
  assert.doesNotMatch(items.join(' · '), /80\.00%|63\.1m|198\.2k/)
})

test('compaction threshold is rendered only from canonical available truth', () => {
  const metrics = baseMetrics()
  metrics.compaction = { available: true, active: false, thresholdRatio: 0.8 }
  assert.match(sessionStatusItems(metrics, 220).join(' | '), /压缩阈值80\.00%/)
})

test('very narrow headline yields space back to Provider truth while detail still exposes every canonical metric', () => {
  const metrics = baseMetrics()
  metrics.billing = { kind: 'api', label: 'API' }
  metrics.context = { usedTokens: 1_791, windowTokens: 1_000_000, ratio: 1_791 / 1_000_000 }
  metrics.account = {
    providerId: 'provider-x',
    profileId: 'profile-x',
    billing: { kind: 'api', label: 'API' },
    checkedAt: '2026-09-16T00:00:00.000Z',
    available: true,
    balances: [{ currency: 'CNY', total: '8.88' }],
  }
  assert.deepEqual(sessionHeadlineItems(metrics, 80), [])
  const rows = sessionStatusRows(metrics, 80)
  const detail = rows.join(' · ')
  assert.ok(rows.length >= 2)
  assert.match(detail, /API/)
  assert.match(detail, /本次命中40\.00%/)
  assert.match(detail, /平均命中20\.00%/)
  assert.match(detail, /会话 tokens1,000/)
  assert.match(detail, /本次 tokens120/)
  assert.match(detail, /压缩阈值—/)
  assert.match(detail, /当前会话3轮/)
  assert.match(detail, /权限 请求批准/)
})
