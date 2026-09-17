/**
 * 文件作用：验证 Provider Telemetry Registry 的品牌隔离、API/订阅计费来源，以及 DeepSeek 官方余额解析。
 * 关联模块：xma-ai telemetry、xma-plugin-deepseek telemetry、Session status metrics。
 * 职责边界：使用本地 HTTP mock，禁止自动测试读取真实用户 API Key。
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import {
  MemoryCredentialResolver,
  ProviderTelemetryRegistry,
  type ProviderProfile,
  type ProviderTelemetryProvider,
} from 'xma-ai'
import { createDeepSeekTelemetryProvider } from 'xma-plugin-deepseek'

const apiProfile = (overrides: Partial<ProviderProfile> = {}): ProviderProfile => ({
  id: 'profile-1',
  providerId: 'unregistered-api',
  adapterId: 'openai-compatible',
  displayName: 'API Provider',
  baseUrl: 'https://example.invalid',
  auth: { type: 'bearer', credential: { source: 'memory', key: 'token' } },
  defaultModel: 'model-1',
  ...overrides,
})

test('Provider telemetry is brand-neutral and subscription semantics override bearer/API fallback', async () => {
  const credentials = new MemoryCredentialResolver()
  const telemetry = new ProviderTelemetryRegistry(credentials)

  assert.deepEqual(telemetry.billingSource(apiProfile()), { kind: 'api', label: 'API' })
  assert.deepEqual(telemetry.billingSource(apiProfile({ auth: { type: 'none' } })), { kind: 'unknown' })
  assert.equal(await telemetry.accountSnapshot(apiProfile(), new AbortController().signal), undefined)

  const subscription: ProviderTelemetryProvider = {
    providerId: 'subscription-provider',
    billingSource: () => ({ kind: 'subscription', label: '套餐', planName: 'Pro' }),
    accountSnapshot: async profile => ({
      providerId: profile.providerId,
      profileId: profile.id,
      billing: { kind: 'subscription', label: '套餐', planName: 'Pro' },
      checkedAt: '2026-09-16T00:00:00.000Z',
      available: true,
      quota: { planName: 'Pro', unit: 'requests', used: 12, limit: 100, remaining: 88 },
    }),
  }
  telemetry.register(subscription)
  const profile = apiProfile({ providerId: 'subscription-provider' })
  assert.deepEqual(telemetry.billingSource(profile), { kind: 'subscription', label: '套餐', planName: 'Pro' })
  const account = await telemetry.accountSnapshot(profile, new AbortController().signal)
  assert.equal(account?.quota?.remaining, 88)
})

test('DeepSeek telemetry parses official balance shape through a local HTTP mock without real credentials', async () => {
  let authorization = ''
  const server = createServer((request, response) => {
    authorization = request.headers.authorization ?? ''
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '12.9300', granted_balance: '2.0000', topped_up_balance: '10.9300' },
      ],
    }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const localUrl = `http://127.0.0.1:${address.port}/user/balance`

  try {
    const credentials = new MemoryCredentialResolver()
    credentials.set('deepseek-token', 'test-secret')
    const telemetry = new ProviderTelemetryRegistry(credentials)
    telemetry.register(createDeepSeekTelemetryProvider({
      // Production code still constructs the official endpoint and enforces an
      // official Profile. The injected fetcher only redirects transport in test.
      fetcher: ((_input, init) => fetch(localUrl, init)) as typeof fetch,
    }))
    const profile = apiProfile({
      id: 'deepseek-main',
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      auth: { type: 'bearer', credential: { source: 'memory', key: 'deepseek-token' } },
      defaultModel: 'deepseek-v4-pro',
    })
    const account = await telemetry.accountSnapshot(profile, new AbortController().signal)
    assert.equal(authorization, 'Bearer test-secret')
    assert.equal(account?.billing.kind, 'api')
    assert.equal(account?.balances?.[0]?.currency, 'CNY')
    assert.equal(account?.balances?.[0]?.total, '12.9300')

    const descriptor = telemetry.modelDescriptor(profile, 'deepseek-v4-pro')
    assert.equal(descriptor?.contextWindow, 1_000_000)
    const legacyEstimate = telemetry.estimateCost(
      profile,
      { provider: 'deepseek', profile: profile.id, model: 'deepseek-v4-pro' },
      { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 },
      '2026-09-11T07:00:00.000Z',
    )
    assert.equal(legacyEstimate?.amount, 9)
    const estimate = telemetry.estimateCost(
      profile,
      { provider: 'deepseek', profile: profile.id, model: 'deepseek-v4-pro' },
      { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 },
      '2026-09-16T07:00:00.000Z',
    )
    // 2026-09-14 04:00 UTC 起官方把 deepseek-v4-pro 路由到 V4.1 Flash，并按 Flash 价格计费。
    assert.equal(estimate?.currency, 'CNY')
    assert.equal(estimate?.amount, 2)
    assert.equal(estimate?.precision, 'estimated')
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
