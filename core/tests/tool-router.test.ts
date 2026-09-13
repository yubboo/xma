/**
 * 文件作用：验证 XMA Frozen ToolPlan、Schema/Policy/Guard/Approval 与 parallel-safe/exclusive 调度不变量。
 * 关联模块：core/src/tools.ts、tool-policy.ts、tool-schema.ts、runtime.ts。
 * 当前实现：冻结 Runtime 配对、参数拒绝、fail-closed Approval、Session 允许缓存、单调 Guard 与并发/独占执行顺序测试。
 * 职责边界：测试只验证 TypeScript Tool Platform；真实文件/进程安全边界由 native/runtime Rust 测试承担。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { StaticToolApprovalProvider } from '../src/tool-policy.ts'
import { ToolApprovalSessionCache, ToolRegistry } from '../src/tools.ts'
import type { ToolContext } from '../src/tools.ts'

function context(): ToolContext {
  return {
    runId: 'tool-router-test',
    sessionId: 'session-tool-router',
    turnId: 'turn-1',
    stepId: 'step-1',
    signal: new AbortController().signal,
  }
}

test('Frozen ToolPlan keeps the exact runtime paired with the schemas advertised for that step', async () => {
  const registry = new ToolRegistry()
  const originalTool = {
    spec: {
      name: 'fixture.version',
      description: 'Return the runtime generation.',
      inputSchema: { type: 'object', additionalProperties: false },
    },
    async execute() { return { ok: true as const, code: 'OK' as const, content: 'runtime-v1' } },
  }
  const dispose = registry.register(originalTool)
  const planV1 = registry.createPlan()
  // Plan 必须捕获 Runtime 函数引用，不能被模型请求之后的对象突变改变。
  originalTool.execute = async () => ({ ok: true as const, code: 'OK' as const, content: 'mutated-after-freeze' })
  await dispose()
  registry.register({
    spec: {
      name: 'fixture.version',
      description: 'Return the runtime generation.',
      inputSchema: { type: 'object', additionalProperties: false },
    },
    async execute() { return { ok: true, code: 'OK', content: 'runtime-v2' } },
  })

  const oldOutcome = await planV1.createRouter().dispatch(
    { callId: 'call-old', name: 'fixture.version', arguments: {} },
    context(),
  )
  const newOutcome = await registry.createPlan().createRouter().dispatch(
    { callId: 'call-new', name: 'fixture.version', arguments: {} },
    context(),
  )

  assert.equal(oldOutcome.result.content, 'runtime-v1')
  assert.equal(newOutcome.result.content, 'runtime-v2')
  assert.equal(planV1.modelVisibleSpecs()[0]?.name, 'fixture.version')
  assert.match(planV1.id, /^tool-plan:v1:[0-9a-f]{8}$/)
})

test('ToolRouter returns schema errors to the model without executing the tool', async () => {
  let executions = 0
  const registry = new ToolRegistry()
  registry.register({
    spec: {
      name: 'fixture.validate',
      description: 'Validate a required integer.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['count'],
        properties: { count: { type: 'integer', minimum: 1 } },
      },
    },
    async execute() {
      executions += 1
      return { ok: true, code: 'OK', content: 'should-not-run' }
    },
  })

  const outcome = await registry.createPlan().createRouter().dispatch(
    { callId: 'call-invalid', name: 'fixture.validate', arguments: { count: 0 } },
    context(),
  )
  assert.equal(outcome.result.code, 'TOOL_INVALID_ARGUMENTS')
  assert.equal(executions, 0)
})

test('side-effect tools fail closed without an Approval Provider', async () => {
  let executions = 0
  const registry = new ToolRegistry()
  registry.register({
    spec: { name: 'fixture.write', description: 'Write fixture.', inputSchema: { type: 'object' } },
    effect: 'write',
    async execute() {
      executions += 1
      return { ok: true, code: 'OK', content: 'written' }
    },
  })

  const outcome = await registry.createPlan().createRouter().dispatch(
    { callId: 'call-write', name: 'fixture.write', arguments: {} },
    context(),
  )
  assert.equal(outcome.result.code, 'TOOL_APPROVAL_DENIED')
  assert.equal(outcome.approval?.decision, 'deny')
  assert.equal(executions, 0)
})

test('allow-session approval is reused only for the stable session cache key', async () => {
  let approvals = 0
  let executions = 0
  const registry = new ToolRegistry()
  registry.register({
    spec: {
      name: 'fixture.write',
      description: 'Write a path.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: { path: { type: 'string', minLength: 1 } },
      },
    },
    effect: 'write',
    approvalKey(args) { return String(args.path) },
    approvalSummary(args) { return [`写入 ${String(args.path)}`] },
    async execute() {
      executions += 1
      return { ok: true, code: 'OK', content: 'written' }
    },
  })
  const cache = new ToolApprovalSessionCache()
  const router = registry.createPlan().createRouter({
    approvalCache: cache,
    approvals: new StaticToolApprovalProvider(request => {
      approvals += 1
      assert.deepEqual(request.summary, [`写入 ${String(request.arguments.path)}`])
      return 'allow-session'
    }),
  })

  const first = await router.dispatch(
    { callId: 'call-1', name: 'fixture.write', arguments: { path: 'a.txt' } },
    context(),
  )
  const second = await router.dispatch(
    { callId: 'call-2', name: 'fixture.write', arguments: { path: 'a.txt' } },
    context(),
  )
  const third = await router.dispatch(
    { callId: 'call-3', name: 'fixture.write', arguments: { path: 'b.txt' } },
    context(),
  )

  assert.equal(first.approval?.decision, 'allow-session')
  assert.equal(second.approval?.decision, 'cached-session')
  assert.equal(second.approval?.requested, false)
  assert.equal(third.approval?.decision, 'allow-session')
  assert.equal(approvals, 2)
  assert.equal(executions, 3)
})

test('allow-session does not broaden to every argument when a tool omits an approvalKey', async () => {
  let approvals = 0
  const registry = new ToolRegistry()
  registry.register({
    spec: { name: 'fixture.unsafe_scope', description: 'Side effect without a reusable approval scope.', inputSchema: { type: 'object' } },
    effect: 'write',
    async execute() { return { ok: true, code: 'OK', content: 'ok' } },
  })
  const router = registry.createPlan().createRouter({
    approvalCache: new ToolApprovalSessionCache(),
    approvals: new StaticToolApprovalProvider(() => { approvals += 1; return 'allow-session' }),
  })

  const first = await router.dispatch({ callId: 'scope-1', name: 'fixture.unsafe_scope', arguments: { value: 1 } }, context())
  const second = await router.dispatch({ callId: 'scope-2', name: 'fixture.unsafe_scope', arguments: { value: 2 } }, context())
  assert.equal(first.approval?.decision, 'allow-session')
  assert.equal(second.approval?.decision, 'allow-session')
  assert.equal(approvals, 2)
})

test('Security Guard denial is monotonic and prevents Approval/execute', async () => {
  let approvals = 0
  let executions = 0
  const registry = new ToolRegistry()
  registry.register({
    spec: { name: 'fixture.exec', description: 'Execute fixture.', inputSchema: { type: 'object' } },
    effect: 'execute',
    async execute() {
      executions += 1
      return { ok: true, code: 'OK', content: 'executed' }
    },
  })
  const router = registry.createPlan().createRouter({
    guards: [{ id: 'fixture.guard', check: () => ({ allow: false, reason: 'blocked by test guard' }) }],
    approvals: new StaticToolApprovalProvider(() => {
      approvals += 1
      return 'allow-once'
    }),
  })

  const outcome = await router.dispatch(
    { callId: 'call-denied', name: 'fixture.exec', arguments: {} },
    context(),
  )
  assert.equal(outcome.result.code, 'TOOL_SECURITY_DENIED')
  assert.equal(approvals, 0)
  assert.equal(executions, 0)
})

test('parallel-safe tools overlap while exclusive tools form an execution barrier', async () => {
  const trace: string[] = []
  const registry = new ToolRegistry()
  for (const name of ['fixture.parallel_a', 'fixture.parallel_b', 'fixture.parallel_c']) {
    registry.register({
      spec: { name, description: `Parallel tool ${name}.`, inputSchema: { type: 'object' } },
      executionMode: 'parallel-safe',
      async execute() {
        trace.push(`start:${name}`)
        await new Promise(resolve => setTimeout(resolve, 20))
        trace.push(`end:${name}`)
        return { ok: true, code: 'OK', content: name }
      },
    })
  }
  registry.register({
    spec: { name: 'fixture.exclusive', description: 'Exclusive barrier.', inputSchema: { type: 'object' } },
    async execute() {
      trace.push('start:fixture.exclusive')
      trace.push('end:fixture.exclusive')
      return { ok: true, code: 'OK', content: 'exclusive' }
    },
  })

  const calls = [
    { callId: 'a', name: 'fixture.parallel_a', arguments: {} },
    { callId: 'b', name: 'fixture.parallel_b', arguments: {} },
    { callId: 'x', name: 'fixture.exclusive', arguments: {} },
    { callId: 'c', name: 'fixture.parallel_c', arguments: {} },
  ]
  const outcomes = await registry.createPlan().createRouter().dispatchMany(calls, context())

  assert.deepEqual(outcomes.map(item => item.call.callId), ['a', 'b', 'x', 'c'])
  const exclusiveStart = trace.indexOf('start:fixture.exclusive')
  assert.ok(trace.indexOf('start:fixture.parallel_a') < trace.indexOf('end:fixture.parallel_a'))
  assert.ok(trace.indexOf('start:fixture.parallel_b') < trace.indexOf('end:fixture.parallel_b'))
  assert.ok(trace.indexOf('end:fixture.parallel_a') < exclusiveStart)
  assert.ok(trace.indexOf('end:fixture.parallel_b') < exclusiveStart)
  assert.ok(trace.indexOf('end:fixture.exclusive') < trace.indexOf('start:fixture.parallel_c'))
})
