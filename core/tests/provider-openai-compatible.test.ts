/**
 * 文件作用：验证第一条 OpenAI-compatible Adapter 的统一 Provider Contract 与真实 HTTP/SSE 行为。
 * 关联模块：core/src/provider.ts、model.ts、plugins/providers/openai-compatible.ts。
 * 当前实现：Profile/Secret 边界、Model Catalog、Provider-safe Tool wire name 双向映射、文本/Reasoning/Tool Call/Usage、thinking continuation、取消、错误归一化和 Brain Ready Probe 测试。
 * 职责边界：这里使用本机 mock HTTP server 证明协议实现，不代表任何外部厂商已通过真实账号 E2E 或可被标记为产品 Ready。
 */

import assert from 'node:assert/strict'
import type { ModelEvent } from '../src/model.ts'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import test from 'node:test'
import {
  MemoryCredentialResolver,
  ProviderRegistry,
  ProviderRequestError,
  type ProviderProfile,
} from '../src/provider.ts'
import { OpenAiCompatibleAdapter, OPENAI_COMPATIBLE_ADAPTER_ID } from '../../plugins/providers/openai-compatible.ts'

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock provider server has no TCP address')
  try {
    await run(`http://127.0.0.1:${address.port}/v1`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

function profile(baseUrl: string): ProviderProfile {
  return {
    id: 'fixture-openai',
    providerId: 'fixture',
    adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
    displayName: 'Fixture OpenAI Compatible',
    baseUrl,
    auth: { type: 'bearer', credential: { source: 'memory', key: 'fixture-key' } },
    defaultModel: 'fixture-model',
  }
}

test('ProviderRegistry stores references instead of Secret values and rejects persisted auth headers', async () => {
  const credentials = new MemoryCredentialResolver()
  credentials.set('fixture-key', 'secret-123456789')
  const registry = new ProviderRegistry(credentials)
  registry.registerAdapter(new OpenAiCompatibleAdapter())
  const valid = profile('https://example.invalid/v1')
  registry.saveProfile(valid)

  const serialized = JSON.stringify(registry.getProfile(valid.id))
  assert.equal(serialized.includes('secret-123456789'), false)
  assert.equal(serialized.includes('fixture-key'), true)

  assert.throws(() => registry.saveProfile({
    ...valid,
    id: 'bad-header',
    headers: { Authorization: 'Bearer should-not-live-here' },
  }), /cannot persist secret-bearing header/)
})

test('OpenAI-compatible Adapter normalizes catalog, provider-safe tool wire names, streaming text, tool calls and usage', async () => {
  const requests: Array<{ url: string; authorization: string | undefined; body?: Record<string, unknown> }> = []
  await withServer(async (request, response) => {
    if (request.url === '/v1/models' && request.method === 'GET') {
      requests.push({ url: request.url, authorization: request.headers.authorization })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'fixture-model' }, { id: 'another-model' }] }))
      return
    }
    if (request.url === '/v1/chat/completions' && request.method === 'POST') {
      const body = await readJson(request)
      requests.push({ url: request.url, authorization: request.headers.authorization, body })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      // DeepSeek 官方流式协议在 include_usage=true 时，中间块会显式携带 usage:null。
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":""}}],"usage":null}\n\n')
      response.write('data: {"choices":[{"delta":{"reasoning_content":"先分析"}}],"usage":null}\n\n')
      response.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n')
      const tools = body.tools as Array<{ function?: { name?: string } }>
      const wireToolName = tools[0]?.function?.name
      assert.equal(typeof wireToolName, 'string')
      assert.match(String(wireToolName), /^[A-Za-z0-9_-]{1,64}$/)
      assert.notEqual(wireToolName, 'native.fs.read_text')
      response.write(`data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":${JSON.stringify(wireToolName)},\"arguments\":\"{\\\"path\\\":\"}}]}}]}\n\n`)
      response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"README.md\\"}"}}]}}]}\n\n')
      response.write('data: {"choices":[],"usage":{"prompt_tokens":21,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":5},"completion_tokens_details":{"reasoning_tokens":2}}}\n\n')
      response.end('data: [DONE]\n\n')
      return
    }
    response.writeHead(404)
    response.end('not found')
  }, async baseUrl => {
    const credentials = new MemoryCredentialResolver()
    credentials.set('fixture-key', 'secret-123456789')
    const registry = new ProviderRegistry(credentials)
    registry.registerAdapter(new OpenAiCompatibleAdapter())
    registry.saveProfile({
      ...profile(baseUrl),
      options: {
        reasoning: true,
        thinkingMode: 'enabled',
        reasoningEffort: 'high',
        reasoningContentToolContinuation: true,
      },
    })

    const models = await registry.listModels('fixture-openai', new AbortController().signal)
    assert.deepEqual(models.map(model => model.id), ['another-model', 'fixture-model'])

    const provider = registry.createModel('fixture-openai')
    const events: ModelEvent[] = []
    for await (const event of provider.stream({
      messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }],
      tools: [{ name: 'native.fs.read_text', description: 'inspect', inputSchema: { type: 'object' } }],
      signal: new AbortController().signal,
    })) events.push(event)

    assert.deepEqual(events, [
      { type: 'reasoning', text: '先分析' },
      { type: 'text', text: '你好' },
      { type: 'usage', inputTokens: 21, outputTokens: 7, cachedInputTokens: 5, reasoningTokens: 2 },
      { type: 'provider-continuation', data: { adapterId: OPENAI_COMPATIBLE_ADAPTER_ID, reasoningContent: '先分析' } },
      { type: 'tool-call', callId: 'call-1', name: 'native.fs.read_text', arguments: { path: 'README.md' } },
    ])
    const continuation = events.find(event => event.type === 'provider-continuation')
    assert.equal(continuation?.type, 'provider-continuation')
    const secondEvents: ModelEvent[] = []
    for await (const event of provider.stream({
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '你好',
          toolCalls: [{ callId: 'call-1', name: 'native.fs.read_text', arguments: { path: 'README.md' } }],
          ...(continuation?.type === 'provider-continuation' ? { providerContinuation: continuation.data } : {}),
        },
        { role: 'tool', content: 'ok', toolCallId: 'call-1', toolName: 'native.fs.read_text' },
      ],
      tools: [{ name: 'native.fs.read_text', description: 'inspect', inputSchema: { type: 'object' } }],
      signal: new AbortController().signal,
    })) secondEvents.push(event)
    assert.ok(secondEvents.length > 0)

    assert.equal(requests.every(item => item.authorization === 'Bearer secret-123456789'), true)
    const chats = requests.filter(item => item.url.endsWith('/chat/completions'))
    const chat = chats[0]
    assert.equal(chat?.body?.model, 'fixture-model')
    assert.ok(Array.isArray(chat?.body?.tools))
    assert.deepEqual(chat?.body?.thinking, { type: 'enabled' })
    assert.equal(chat?.body?.reasoning_effort, 'high')
    assert.deepEqual((chat?.body?.messages as Array<Record<string, unknown>>).map(message => message.role), ['system', 'user'])
    const secondChat = chats[1]
    const secondMessages = secondChat?.body?.messages as Array<Record<string, unknown>>
    const assistantMessage = secondMessages.find(message => message.role === 'assistant')
    assert.equal(assistantMessage?.reasoning_content, '先分析')
    const firstWireToolName = (((chat?.body?.tools as Array<{ function?: { name?: string } }>)[0]?.function?.name))
    const assistantToolCall = (assistantMessage?.tool_calls as Array<{ function?: { name?: string } }> | undefined)?.[0]
    const toolMessage = secondMessages.find(message => message.role === 'tool')
    assert.equal(assistantToolCall?.function?.name, firstWireToolName)
    assert.equal(toolMessage?.name, firstWireToolName)
  })
})

test('Brain Ready Probe is only ready after a real request succeeds and returns structured failure otherwise', async () => {
  let toolProbeSeen = false
  let probeContinuationSeen = false
  let deepSeekProbeCompatSeen = false
  await withServer(async (request, response) => {
    if (request.url === '/v1/models' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404)
      response.end('not found')
      return
    }
    const body = await readJson(request)
    assert.equal(body.stream, false)
    response.writeHead(200, { 'content-type': 'application/json' })
    const messages = body.messages as Array<Record<string, unknown>>
    if (messages.some(message => message.role === 'tool')) {
      const assistant = messages.find(message => message.role === 'assistant')
      probeContinuationSeen = assistant?.reasoning_content === 'probe reasoning'
      deepSeekProbeCompatSeen = assistant?.content === '' && body.reasoning_effort === undefined && (body.thinking as Record<string, unknown> | undefined)?.type === 'disabled'
      response.end(JSON.stringify({ id: 'round-trip-response', choices: [{ message: { role: 'assistant', content: 'done' } }] }))
      return
    }
    if (body.tool_choice) {
      toolProbeSeen = true
      assert.deepEqual(body.thinking, { type: 'disabled' })
      assert.equal(body.reasoning_effort, undefined)
      response.end(JSON.stringify({
        id: 'tool-probe-response',
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            reasoning_content: 'probe reasoning',
            tool_calls: [{ id: 'call-probe', type: 'function', function: { name: 'xma_probe', arguments: '{"ok":true}' } }],
          },
        }],
      }))
      return
    }
    response.end(JSON.stringify({ id: 'probe-response', choices: [{ message: { role: 'assistant', content: 'OK' } }] }))
  }, async baseUrl => {
    const credentials = new MemoryCredentialResolver()
    credentials.set('fixture-key', 'secret-123456789')
    const registry = new ProviderRegistry(credentials)
    registry.registerAdapter(new OpenAiCompatibleAdapter())
    registry.saveProfile({
      ...profile(baseUrl),
      options: {
        reasoning: true,
        thinkingMode: 'enabled',
        reasoningEffort: 'high',
        reasoningContentToolContinuation: true,
        toolProbeThinkingMode: 'disabled',
      },
    })
    const result = await registry.probe('fixture-openai', undefined, new AbortController().signal)
    assert.equal(result.ready, true)
    assert.equal(result.model, 'fixture-model')
    assert.ok(result.latencyMs >= 0)
    assert.equal(toolProbeSeen, true)
    assert.equal(probeContinuationSeen, true)
    assert.equal(deepSeekProbeCompatSeen, true)
  })

  const credentials = new MemoryCredentialResolver()
  const registry = new ProviderRegistry(credentials)
  registry.registerAdapter(new OpenAiCompatibleAdapter())
  registry.saveProfile(profile('https://example.invalid/v1'))
  const failed = await registry.probe('fixture-openai', undefined, new AbortController().signal)
  assert.equal(failed.ready, false)
  assert.equal(failed.error?.code, 'auth_invalid')
})

test('OpenAI-compatible streaming cancellation is normalized and does not leak the bearer Secret', async () => {
  await withServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404)
      response.end('not found')
      return
    }
    await readJson(request)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
    // 保持连接打开，让客户端 AbortSignal 真正中断正在等待的下一帧。
  }, async baseUrl => {
    const credentials = new MemoryCredentialResolver()
    credentials.set('fixture-key', 'secret-very-sensitive')
    const adapter = new OpenAiCompatibleAdapter()
    const provider = adapter.createModel(profile(baseUrl), 'fixture-model', credentials)
    const controller = new AbortController()
    const iterator = provider.stream({ messages: [{ role: 'user', content: 'cancel' }], tools: [], signal: controller.signal })[Symbol.asyncIterator]()
    assert.deepEqual((await iterator.next()).value, { type: 'text', text: 'first' })
    controller.abort()
    await assert.rejects(iterator.next(), error => {
      assert.ok(error instanceof ProviderRequestError)
      assert.equal(error.code, 'cancelled')
      assert.equal(error.message.includes('secret-very-sensitive'), false)
      return true
    })
  })
})
