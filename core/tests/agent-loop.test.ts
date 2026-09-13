/**
 * 文件作用：保留旧 runAgent 兼容 API 的最小回归测试，确保迁移到正式 Runtime 期间旧调用方不会立即失效。
 * 关联模块：core/src/agent.ts、model.ts、tool/router.ts。
 * 当前实现：两轮假 Provider 测试，验证 Tool Observation 仍回灌给同一 Provider。
 * 职责边界：正式 Session/Turn/Step 行为由 runtime-session.test.ts 验证；Fake Provider 不代表 XMA 有内置模型。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { runAgent } from '../src/agent.ts'
import type { ModelProvider } from '../src/model.ts'
import { ToolRegistry } from '../src/tool/router.ts'

class FakeProvider implements ModelProvider {
  readonly identity = { provider: 'test', model: 'fake' }
  calls = 0
  async *stream(request: Parameters<ModelProvider['stream']>[0]) {
    this.calls += 1
    if (this.calls === 1) {
      yield { type: 'tool-call' as const, callId: 'call-1', name: 'demo.inspect', arguments: {} }
      return
    }
    assert.ok(request.messages.some(message => message.role === 'tool' && message.content === 'observation-ok'))
    yield { type: 'text' as const, text: '完成' }
  }
}

test('legacy runAgent keeps model -> tool -> observation -> same model behavior', async () => {
  const tools = new ToolRegistry()
  tools.register({
    spec: { name: 'demo.inspect', description: 'test', inputSchema: { type: 'object' } },
    async execute() { return { ok: true, code: 'OK', content: 'observation-ok' } },
  })
  const provider = new FakeProvider()
  const result = await runAgent({ runId: 'run-1', provider, tools, messages: [{ role: 'user', content: 'do it' }], signal: new AbortController().signal })
  assert.equal(provider.calls, 2)
  assert.equal(result.toolCalls, 1)
  assert.equal(result.text, '完成')
})
