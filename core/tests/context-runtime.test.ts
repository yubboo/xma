/**
 * 文件作用：验证 Context Assembly 真正进入 durable Session，并可按 Step 精确重建模型可见上下文。
 * 关联模块：core/src/context.ts、runtime.ts、session.ts。
 * 当前实现：稳定排序、上下文变化、Context Snapshot 去重/更新和 Step 请求历史重建测试。
 * 职责边界：测试 Source 只返回确定性文本；Workspace/Skill/Knowledge 的真实 Context Provider 在后续阶段实现。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { ContextRegistry } from '../src/context.ts'
import type { ModelProvider } from '../src/model.ts'
import { AgentRuntime } from '../src/runtime.ts'
import { requestContextForStep, requestMessagesForStep } from '../src/session.ts'
import { MemorySessionStore } from '../src/session-store.ts'
import { ToolRegistry } from '../src/tools.ts'

test('ContextRegistry orders sources deterministically and Runtime persists only effective changes', async () => {
  const context = new ContextRegistry({ maxCharacters: 4096 })
  let phase = 0
  context.register({ id: 'workspace.rules', order: 20, render: () => phase === 0 ? 'Workspace A' : 'Workspace B' })
  context.register({ id: 'agent.identity', order: 10, render: () => 'You are Xiaoyu Code.' })

  const tools = new ToolRegistry()
  tools.register({
    spec: { name: 'demo.observe', description: 'Advance context phase.', inputSchema: { type: 'object' } },
    async execute() {
      phase = 1
      return { ok: true, code: 'OK', content: 'phase advanced' }
    },
  })

  let calls = 0
  const provider: ModelProvider = {
    identity: { provider: 'fixture', model: 'context-aware' },
    async *stream(request) {
      calls += 1
      assert.equal(request.messages[0]?.role, 'system')
      if (calls === 1) {
        assert.equal(request.messages[0]?.content, 'You are Xiaoyu Code.\n\nWorkspace A')
        yield { type: 'tool-call' as const, callId: 'context-call', name: 'demo.observe', arguments: {} }
        return
      }
      assert.equal(request.messages[0]?.content, 'You are Xiaoyu Code.\n\nWorkspace B')
      assert.ok(request.messages.some(message => message.role === 'tool' && message.content === 'phase advanced'))
      yield { type: 'text' as const, text: 'context updated' }
    },
  }

  const runtime = new AgentRuntime(new MemorySessionStore(), { context })
  const session = await runtime.createSession({ agentId: 'xiaoyu.code', sessionId: 'session-context' })
  const result = await session.runTurn({ provider, tools, input: '继续', signal: new AbortController().signal })
  assert.equal(result.status, 'completed')
  assert.equal(calls, 2)

  const snapshot = session.snapshot()
  const contexts = snapshot.events.filter(event => event.type === 'context/snapshot')
  assert.equal(contexts.length, 2)
  assert.equal(contexts[0]?.type, 'context/snapshot')
  assert.equal(contexts[1]?.type, 'context/snapshot')
  if (contexts[0]?.type === 'context/snapshot' && contexts[1]?.type === 'context/snapshot') {
    assert.equal(contexts[0].content, 'You are Xiaoyu Code.\n\nWorkspace A')
    assert.equal(contexts[1].content, 'You are Xiaoyu Code.\n\nWorkspace B')
    assert.deepEqual(contexts[0].sources.map(source => source.sourceId), ['agent.identity', 'workspace.rules'])
  }

  const steps = snapshot.events.filter(event => event.type === 'step/start')
  assert.equal(steps.length, 2)
  const first = steps[0]
  const second = steps[1]
  assert.equal(first?.type, 'step/start')
  assert.equal(second?.type, 'step/start')
  if (first?.type === 'step/start' && second?.type === 'step/start') {
    assert.equal(requestContextForStep(snapshot.events, first.stepId)?.content, 'You are Xiaoyu Code.\n\nWorkspace A')
    assert.equal(requestContextForStep(snapshot.events, second.stepId)?.content, 'You are Xiaoyu Code.\n\nWorkspace B')
    assert.equal(requestMessagesForStep(snapshot.events, first.stepId)?.[0]?.content, 'You are Xiaoyu Code.\n\nWorkspace A')
    assert.equal(requestMessagesForStep(snapshot.events, second.stepId)?.[0]?.content, 'You are Xiaoyu Code.\n\nWorkspace B')
  }

  await session.close()
})

test('ContextRegistry fails loud when model-visible context exceeds the configured hard limit', async () => {
  const context = new ContextRegistry({ maxCharacters: 4 })
  context.register({ id: 'too.large', render: () => '12345' })
  const runtime = new AgentRuntime(new MemorySessionStore(), { context })
  const session = await runtime.createSession({ agentId: 'xiaoyu.code', sessionId: 'session-context-limit' })
  const provider: ModelProvider = {
    identity: { provider: 'fixture', model: 'never-called' },
    async *stream() { throw new Error('provider must not be called') },
  }
  await assert.rejects(
    session.runTurn({ provider, tools: new ToolRegistry(), input: '超限', signal: new AbortController().signal }),
    /exceeds maxCharacters/,
  )
  assert.equal(session.snapshot().events.at(-1)?.type, 'turn/end')
  await session.close()
})
