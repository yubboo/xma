import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentWorkModeController, createPlanStateContextSource } from 'xma-agent-loop'
import { ContextRegistry } from 'xma-context'

test('work mode context tells the real model when it is in Plan or Build', async () => {
  const modes = new AgentWorkModeController('plan')
  const context = new ContextRegistry()
  context.register(modes.createContextSource())
  const base = { header: { sessionId: 's', agentId: 'xiaoyu.code' }, snapshot: { header: { sessionId: 's', agentId: 'xiaoyu.code' }, events: [] }, turnId: 't', stepId: 'st', signal: new AbortController().signal }
  const plan = await context.assemble(base)
  assert.match(plan.content, /currently in Plan mode/i)
  assert.match(plan.content, /read-only/i)
  modes.set('build')
  const build = await context.assemble(base)
  assert.match(build.content, /currently in Build mode/i)
  assert.match(build.content, /actual reasoning model is the Provider\/Model selected by the user/i)
})

test('retained Plan context survives No without granting execution', async () => {
  const context = new ContextRegistry()
  context.register(createPlanStateContextSource())
  const events = [
    { type: 'plan/snapshot', sessionId: 's', sequence: 1, timestamp: '2026-09-16T00:00:00.000Z', turnId: 'plan-1', content: 'Step A then Step B.' },
    { type: 'plan/decision', sessionId: 's', sequence: 2, timestamp: '2026-09-16T00:00:01.000Z', turnId: 'plan-1', planTurnId: 'plan-1', decision: 'no' },
  ]
  const result = await context.assemble({ header: { sessionId: 's', agentId: 'xiaoyu.code' }, snapshot: { header: { sessionId: 's', agentId: 'xiaoyu.code' }, events }, turnId: 't2', stepId: 's2', signal: new AbortController().signal })
  assert.match(result.content, /declined execution for now/i)
  assert.match(result.content, /Step A then Step B/)
})

test('Plan ready is an explicit control Tool signal, not a heuristic on every Plan reply', async () => {
  const { registerPlanReadyTool } = await import('xma-agent-loop')
  const { ToolRegistry } = await import('xma-tools')
  const registry = new ToolRegistry()
  let proposal: { plan: string; summary?: string } | undefined
  registerPlanReadyTool(registry, value => { proposal = value })
  const plan = registry.createPlan()
  assert.ok(plan.modelVisibleSpecs().some(spec => spec.name === 'xma.plan.ready'))
  const outcome = await plan.createRouter().dispatch(
    { callId: 'ready-1', name: 'xma.plan.ready', arguments: { plan: '1. Inspect\n2. Implement\n3. Verify', summary: 'Implement safely' } },
    { runId: 'r', sessionId: 's', turnId: 't', stepId: 'st', signal: new AbortController().signal },
  )
  assert.equal(outcome.result.code, 'OK')
  assert.deepEqual(proposal, { plan: '1. Inspect\n2. Implement\n3. Verify', summary: 'Implement safely' })
})

test('ordinary Plan replies are not retained until the model explicitly marks a Plan ready', async () => {
  const { AgentRuntime } = await import('xma-agent-loop')
  const { MemorySessionStore } = await import('xma-session')
  const { ToolRegistry } = await import('xma-tools')
  const runtime = new AgentRuntime(new MemorySessionStore())
  const session = await runtime.createSession({ agentId: 'xiaoyu.code', sessionId: 'plan-retain-explicit' })
  const provider = {
    identity: { provider: 'fixture', model: 'planner' },
    async *stream() { yield { type: 'text' as const, text: 'I am in Plan mode. What would you like me to plan?' } },
  }
  const result = await session.runTurn({ provider, tools: new ToolRegistry(), input: '当前是什么模式？', signal: new AbortController().signal, workMode: 'plan' })
  assert.equal(result.status, 'completed')
  assert.equal(session.latestPlan(), undefined)
  await session.retainPlan(result.turnId, '1. Inspect\n2. Implement\n3. Verify')
  assert.equal(session.latestPlan()?.content, '1. Inspect\n2. Implement\n3. Verify')
  await session.decideLatestPlan('no')
  assert.equal(session.latestPlan()?.decision, 'no')
  await session.close()
})
