/**
 * 文件作用：验证 XMA 正式 Session → Turn → Step Runtime 的关键不变量和 JSONL 恢复能力。
 * 关联模块：core/src/runtime.ts、session.ts、session-store.ts、model.ts、tools.ts。
 * 当前实现：多 Step Tool Loop、请求快照、恢复续聊、取消结算、单写者锁和截断尾修复回归测试。
 * 职责边界：全部 Provider 都是确定性测试夹具；真实厂商 Provider 必须在 Stage B 通过独立 Conformance/E2E 证明。
 */

import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ModelProvider } from '../src/model.ts'
import { AgentRuntime } from '../src/runtime.ts'
import { deriveModelMessages } from '../src/session.ts'
import { JsonlSessionStore, MemorySessionStore } from '../src/session-store.ts'
import { StaticToolApprovalProvider } from '../src/tool-policy.ts'
import { ToolRegistry } from '../src/tools.ts'

function toolsWithObservation(executions: { count: number }): ToolRegistry {
  const tools = new ToolRegistry()
  tools.register({
    spec: {
      name: 'demo.inspect',
      description: 'Return a deterministic observation for Runtime tests.',
      inputSchema: { type: 'object', additionalProperties: false },
    },
    async execute(_arguments, context) {
      executions.count += 1
      assert.ok(context.sessionId)
      assert.ok(context.turnId)
      assert.ok(context.stepId)
      return { ok: true, code: 'OK', content: 'observation-ok', data: { source: 'fixture' } }
    },
  })
  return tools
}

class TwoStepProvider implements ModelProvider {
  readonly identity = { provider: 'fixture', model: 'two-step' }
  calls = 0

  async *stream(request: Parameters<ModelProvider['stream']>[0]) {
    this.calls += 1
    if (this.calls === 1) {
      assert.equal(request.messages.at(-1)?.role, 'user')
      assert.equal(request.messages.at(-1)?.content, '检查一下')
      assert.equal(request.tools.length, 1)
      yield { type: 'tool-call' as const, callId: 'call-1', name: 'demo.inspect', arguments: {} }
      return
    }

    const assistantCall = request.messages.find(message => message.role === 'assistant' && message.toolCalls?.[0]?.callId === 'call-1')
    assert.equal(assistantCall?.toolCalls?.[0]?.name, 'demo.inspect')
    assert.ok(request.messages.some(message => message.role === 'tool' && message.toolCallId === 'call-1' && message.content === 'observation-ok'))
    yield { type: 'text' as const, text: '检查完成' }
    yield { type: 'usage' as const, inputTokens: 12, outputTokens: 3 }
  }
}

test('Runtime persists a reconstructable multi-step tool turn', async () => {
  const runtime = new AgentRuntime(new MemorySessionStore())
  const liveTypes: string[] = []
  runtime.subscribe(event => liveTypes.push(event.type))
  const session = await runtime.createSession({ agentId: 'xiaoyu.code', sessionId: 'session-runtime-basic' })
  const executions = { count: 0 }
  const provider = new TwoStepProvider()

  const result = await session.runTurn({
    provider,
    tools: toolsWithObservation(executions),
    input: '检查一下',
    signal: new AbortController().signal,
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.steps, 2)
  assert.equal(result.toolCalls, 1)
  assert.equal(result.text, '检查完成')
  assert.equal(provider.calls, 2)
  assert.equal(executions.count, 1)

  const snapshot = session.snapshot()
  const types = snapshot.events.map(event => event.type)
  assert.deepEqual(types, [
    'session/created',
    'turn/start',
    'user/message',
    'step/start',
    'assistant/message',
    'usage',
    'tool/result',
    'step/end',
    'step/start',
    'assistant/message',
    'usage',
    'step/end',
    'turn/end',
  ])
  const firstStep = snapshot.events.find(event => event.type === 'step/start')
  assert.equal(firstStep?.type, 'step/start')
  if (firstStep?.type === 'step/start') {
    assert.equal(firstStep.provider.model, 'two-step')
    assert.match(firstStep.toolPlanId, /^tool-plan:v1:[0-9a-f]{8}$/)
    assert.equal(firstStep.tools[0]?.name, 'demo.inspect')
    assert.equal(firstStep.messageCount, 1)
    assert.equal(firstStep.contextDigest, '')
  }
  assert.ok(liveTypes.includes('session/event'))
  assert.ok(liveTypes.includes('model/text-delta'))

  const rebuilt = deriveModelMessages(snapshot.events)
  assert.deepEqual(rebuilt.map(message => message.role), ['user', 'assistant', 'tool', 'assistant'])
  assert.equal(rebuilt[1]?.toolCalls?.[0]?.callId, 'call-1')
  await session.close()
})


test('Runtime persists approval decisions before side-effect tool results', async () => {
  const runtime = new AgentRuntime(new MemorySessionStore())
  const session = await runtime.createSession({ agentId: 'xiaoyu.code', sessionId: 'session-runtime-approval' })
  const tools = new ToolRegistry()
  tools.register({
    spec: {
      name: 'fixture.write',
      description: 'Write fixture state.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: { path: { type: 'string', minLength: 1 } },
      },
    },
    effect: 'write',
    approvalKey(args) { return String(args.path) },
    async execute() {
      assert.ok(session.snapshot().events.some(event => event.type === 'tool/approval' && event.callId === 'approval-call'))
      return { ok: true, code: 'OK', content: 'write-ok' }
    },
  })
  let calls = 0
  const provider: ModelProvider = {
    identity: { provider: 'fixture', model: 'approval-runtime' },
    async *stream(request) {
      calls += 1
      if (calls === 1) {
        yield { type: 'tool-call' as const, callId: 'approval-call', name: 'fixture.write', arguments: { path: 'a.txt' } }
        return
      }
      assert.ok(request.messages.some(message => message.role === 'tool' && message.toolCallId === 'approval-call' && message.content === 'write-ok'))
      yield { type: 'text' as const, text: 'done' }
    },
  }

  const result = await session.runTurn({
    provider,
    tools,
    approvals: new StaticToolApprovalProvider('allow-once'),
    input: '写入',
    signal: new AbortController().signal,
  })
  assert.equal(result.status, 'completed')
  const events = session.snapshot().events
  const approval = events.find(event => event.type === 'tool/approval')
  assert.equal(approval?.type, 'tool/approval')
  if (approval?.type === 'tool/approval') {
    assert.equal(approval.requested, true)
    assert.equal(approval.decision, 'allow-once')
    assert.equal(approval.cacheKey, 'fixture.write:a.txt')
  }
  const approvalIndex = events.findIndex(event => event.type === 'tool/approval')
  const resultIndex = events.findIndex(event => event.type === 'tool/result' && event.callId === 'approval-call')
  assert.ok(approvalIndex >= 0 && resultIndex > approvalIndex)
  await session.close()
})

test('JSONL Session closes, resumes in a new Runtime, and keeps prior model-visible history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xma-session-resume-'))
  try {
    const store = new JsonlSessionStore(root)
    const runtime1 = new AgentRuntime(store)
    const session1 = await runtime1.createSession({ agentId: 'xiaoyu.code', sessionId: 'session-resume' })
    const firstProvider: ModelProvider = {
      identity: { provider: 'fixture', model: 'first' },
      async *stream() { yield { type: 'text' as const, text: '第一次完成' } },
    }
    await session1.runTurn({ provider: firstProvider, tools: new ToolRegistry(), input: '第一次', signal: new AbortController().signal })
    await session1.close()

    const runtime2 = new AgentRuntime(new JsonlSessionStore(root))
    const session2 = await runtime2.resumeSession('session-resume')
    const secondProvider: ModelProvider = {
      identity: { provider: 'fixture', model: 'second' },
      async *stream(request) {
        assert.deepEqual(request.messages.map(message => [message.role, message.content]), [
          ['user', '第一次'],
          ['assistant', '第一次完成'],
          ['user', '第二次'],
        ])
        yield { type: 'text' as const, text: '第二次完成' }
      },
    }
    const second = await session2.runTurn({ provider: secondProvider, tools: new ToolRegistry(), input: '第二次', signal: new AbortController().signal })
    assert.equal(second.text, '第二次完成')
    await session2.close()

    const readHandle = await store.open('session-resume', 'read')
    const snapshot = readHandle.snapshot()
    assert.equal(snapshot.events.filter(event => event.type === 'turn/end').length, 2)
    assert.equal(deriveModelMessages(snapshot.events).at(-1)?.content, '第二次完成')
    await readHandle.close()

    const list = await store.list()
    assert.equal(list[0]?.sessionId, 'session-resume')
    assert.ok((list[0]?.eventCount ?? 0) > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Cancellation settles already-emitted tool calls with durable aborted results', async () => {
  const runtime = new AgentRuntime(new MemorySessionStore())
  const session = await runtime.createSession({ agentId: 'xiaoyu.code', sessionId: 'session-cancel' })
  const controller = new AbortController()
  let toolExecutions = 0
  const tools = new ToolRegistry()
  tools.register({
    spec: { name: 'demo.write', description: 'must not execute', inputSchema: { type: 'object' } },
    async execute() {
      toolExecutions += 1
      return { ok: true, code: 'OK', content: 'unexpected' }
    },
  })
  const provider: ModelProvider = {
    identity: { provider: 'fixture', model: 'cancel' },
    async *stream() {
      yield { type: 'tool-call' as const, callId: 'cancel-call', name: 'demo.write', arguments: {} }
      controller.abort()
      yield { type: 'reasoning' as const, text: 'never persisted' }
    },
  }

  const result = await session.runTurn({ provider, tools, input: '取消测试', signal: controller.signal })
  assert.equal(result.status, 'cancelled')
  assert.equal(result.toolCalls, 1)
  assert.equal(toolExecutions, 0)

  const events = session.snapshot().events
  const assistant = events.find(event => event.type === 'assistant/message')
  assert.equal(assistant?.type, 'assistant/message')
  if (assistant?.type === 'assistant/message') {
    assert.equal(assistant.interrupted, true)
    assert.equal(assistant.toolCalls[0]?.callId, 'cancel-call')
  }
  const toolResult = events.find(event => event.type === 'tool/result')
  assert.equal(toolResult?.type, 'tool/result')
  if (toolResult?.type === 'tool/result') assert.equal(toolResult.code, 'TOOL_ABORTED')
  assert.equal(events.at(-1)?.type, 'turn/end')
  await session.close()
})

test('JSONL Store enforces one writer and can repair a truncated final line before resume', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xma-session-lock-'))
  try {
    const store = new JsonlSessionStore(root)
    const runtime = new AgentRuntime(store)
    const session = await runtime.createSession({ agentId: 'xiaoyu.code', sessionId: 'session-lock' })
    await assert.rejects(store.open('session-lock', 'write'), /already has a writer/)
    await session.close()

    const filePath = path.join(root, 'session-lock.jsonl')
    await appendFile(filePath, '{"kind":"event","event":', 'utf8')
    const resumed = await new AgentRuntime(new JsonlSessionStore(root)).resumeSession('session-lock')
    const provider: ModelProvider = {
      identity: { provider: 'fixture', model: 'after-repair' },
      async *stream() { yield { type: 'text' as const, text: '恢复完成' } },
    }
    await resumed.runTurn({ provider, tools: new ToolRegistry(), input: '继续', signal: new AbortController().signal })
    await resumed.close()

    const raw = await readFile(filePath, 'utf8')
    assert.equal(raw.includes('{"kind":"event","event":{"kind"'), false)
    const reader = await store.open('session-lock', 'read')
    assert.equal(deriveModelMessages(reader.snapshot().events).at(-1)?.content, '恢复完成')
    await reader.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
