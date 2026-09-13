/**
 * 文件作用：验证 Stage D Workspace identity、Session 强绑定、跨 Agent durable grant 与 Context/Tool 边界。
 * 关联模块：workspace.ts、runtime.ts、session/contract.ts、context.ts、tool/router.ts。
 * 当前实现：Owner Session 绑定、Resume 漂移拒绝、跨 Workspace Tool 默认拒绝/显式授权/撤销、Context Source read grant。
 * 职责边界：这里验证 TypeScript Workspace Policy；真实路径 canonical confinement 仍由 native/runtime Rust 测试负责。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { ContextRegistry } from '../src/context.ts'
import type { ModelProvider } from '../src/model.ts'
import { AgentRuntime } from '../src/runtime.ts'
import { MemorySessionStore } from '../src/session/store.ts'
import { SESSION_FORMAT_VERSION } from '../src/session/contract.ts'
import { StaticToolApprovalProvider } from '../src/tool/policy.ts'
import { ToolRegistry } from '../src/tool/router.ts'
import { WorkspaceRegistry } from '../src/workspace.ts'

function workspaceRegistry(codeRoot = '/workspace/code'): WorkspaceRegistry {
  const workspaces = new WorkspaceRegistry()
  workspaces.register({
    id: 'workspace-code',
    ownerAgentId: 'xiaoyu.code',
    name: 'Code Workspace',
    root: codeRoot,
    allowedRoots: ['/workspace/shared'],
  })
  workspaces.register({
    id: 'workspace-writer',
    ownerAgentId: 'xiaoyu.writer',
    name: 'Writer Workspace',
    root: '/workspace/writer',
  })
  return workspaces
}

class ToolThenTextProvider implements ModelProvider {
  readonly identity = { provider: 'fixture', model: 'workspace-tool' }
  #calls = 0

  constructor(private readonly callId: string) {}

  async *stream() {
    this.#calls += 1
    if (this.#calls === 1) {
      yield { type: 'tool-call' as const, callId: this.callId, name: 'fixture.foreign-write', arguments: {} }
      return
    }
    yield { type: 'text' as const, text: 'done' }
  }
}

const textProvider: ModelProvider = {
  identity: { provider: 'fixture', model: 'workspace-context' },
  async *stream() { yield { type: 'text' as const, text: 'context-ok' } },
}

test('Workspace Session binds owner identity and rejects descriptor drift on resume', async () => {
  const store = new MemorySessionStore()
  const workspaces = workspaceRegistry()
  const runtime = new AgentRuntime(store, { workspaces, requireWorkspace: true })

  await assert.rejects(
    runtime.createSession({ agentId: 'xiaoyu.code', workspaceId: 'workspace-writer', sessionId: 'workspace-foreign-owner' }),
    /cannot bind workspace workspace-writer owned by xiaoyu\.writer/,
  )
  await assert.rejects(
    runtime.createSession({ agentId: 'xiaoyu.code', sessionId: 'workspace-missing' }),
    /requires a Workspace/,
  )

  const session = await runtime.createSession({
    agentId: 'xiaoyu.code',
    workspaceId: 'workspace-code',
    sessionId: 'workspace-bound',
  })
  assert.equal(session.header.workspace?.workspaceId, 'workspace-code')
  assert.equal(session.header.workspace?.ownerAgentId, 'xiaoyu.code')
  assert.deepEqual(session.header.workspace?.allowedRoots, ['/workspace/code', '/workspace/shared'])
  assert.match(session.header.workspace?.descriptorDigest ?? '', /^[0-9a-f]{64}$/)
  await session.close()

  const drifted = workspaceRegistry('/workspace/code-moved')
  const driftRuntime = new AgentRuntime(store, { workspaces: drifted, requireWorkspace: true })
  await assert.rejects(driftRuntime.resumeSession('workspace-bound'), /binding changed since session creation/)

  const resumeRuntime = new AgentRuntime(store, { workspaces, requireWorkspace: true })
  const resumed = await resumeRuntime.resumeSession('workspace-bound')
  assert.equal(resumed.header.workspace?.root, '/workspace/code')
  await resumed.close()

  const forged = await store.create({
    formatVersion: SESSION_FORMAT_VERSION,
    sessionId: 'workspace-forged-owner',
    agentId: 'xiaoyu.code',
    createdAt: new Date().toISOString(),
    workspaceId: 'workspace-writer',
    workspace: workspaces.binding('workspace-writer'),
  })
  await forged.close()
  await assert.rejects(
    resumeRuntime.resumeSession('workspace-forged-owner'),
    /cannot resume as owner of Workspace workspace-writer; owner is xiaoyu\.writer/,
  )
})

test('cross-Agent Workspace Tool access is denied by default, durably granted, audited before execute, and revocable', async () => {
  const runtime = new AgentRuntime(new MemorySessionStore(), { workspaces: workspaceRegistry(), requireWorkspace: true })
  const session = await runtime.createSession({
    agentId: 'xiaoyu.code',
    workspaceId: 'workspace-code',
    sessionId: 'workspace-tool-access',
  })
  let executions = 0
  const tools = new ToolRegistry()
  tools.register({
    spec: {
      name: 'fixture.foreign-write',
      description: 'Write a fixture in another Agent Workspace.',
      inputSchema: { type: 'object', additionalProperties: false },
    },
    effect: 'write',
    workspaceAccess() { return { workspaceId: 'workspace-writer', permission: 'write' } },
    approvalKey() { return 'workspace-writer:fixture' },
    async execute(_args, context) {
      executions += 1
      assert.equal(context.workspace?.workspaceId, 'workspace-code')
      const events = session.snapshot().events
      const audit = events.find(event => event.type === 'workspace/access-used' && event.callId === 'foreign-allowed')
      assert.equal(audit?.type, 'workspace/access-used')
      return { ok: true, code: 'OK', content: 'foreign-write-ok' }
    },
  })

  await session.runTurn({
    provider: new ToolThenTextProvider('foreign-denied'),
    tools,
    approvals: new StaticToolApprovalProvider('allow-once'),
    input: 'try foreign workspace',
    signal: new AbortController().signal,
  })
  assert.equal(executions, 0)
  const denied = session.snapshot().events.find(event => event.type === 'tool/result' && event.callId === 'foreign-denied')
  assert.equal(denied?.type, 'tool/result')
  if (denied?.type === 'tool/result') assert.equal(denied.code, 'TOOL_SECURITY_DENIED')

  const grant = await session.grantWorkspaceAccess({
    workspaceId: 'workspace-writer',
    permissions: ['write'],
    reason: 'User explicitly approved a one-session Writer workspace edit.',
  })
  assert.equal(grant.grantedBy, 'user')
  assert.deepEqual(grant.permissions, ['write'])

  await session.runTurn({
    provider: new ToolThenTextProvider('foreign-allowed'),
    tools,
    approvals: new StaticToolApprovalProvider('allow-once'),
    input: 'approved foreign workspace',
    signal: new AbortController().signal,
  })
  assert.equal(executions, 1)

  const events = session.snapshot().events
  const grantIndex = events.findIndex(event => event.type === 'workspace/access-granted' && event.grantId === grant.grantId)
  const usedIndex = events.findIndex(event => event.type === 'workspace/access-used' && event.callId === 'foreign-allowed')
  const resultIndex = events.findIndex(event => event.type === 'tool/result' && event.callId === 'foreign-allowed')
  assert.ok(grantIndex >= 0 && usedIndex > grantIndex && resultIndex > usedIndex)

  await session.revokeWorkspaceAccess(grant.grantId, 'User revoked the cross-workspace permission.')
  await session.runTurn({
    provider: new ToolThenTextProvider('foreign-revoked'),
    tools,
    approvals: new StaticToolApprovalProvider('allow-once'),
    input: 'revoked foreign workspace',
    signal: new AbortController().signal,
  })
  assert.equal(executions, 1)
  const revoked = session.snapshot().events.find(event => event.type === 'tool/result' && event.callId === 'foreign-revoked')
  assert.equal(revoked?.type, 'tool/result')
  if (revoked?.type === 'tool/result') assert.equal(revoked.code, 'TOOL_SECURITY_DENIED')
  await session.close()
})

test('workspace-scoped ToolRouter calls fail closed without a bound Workspace or cross-workspace Runtime guard/audit', async () => {
  let executions = 0
  const tools = new ToolRegistry()
  tools.register({
    spec: {
      name: 'fixture.workspace-read',
      description: 'Read a fixture from a Workspace.',
      inputSchema: { type: 'object', additionalProperties: false },
    },
    effect: 'read',
    workspaceAccess() { return { workspaceId: 'workspace-writer', permission: 'read' } },
    async execute() {
      executions += 1
      return { ok: true, code: 'OK', content: 'should-not-run' }
    },
  })
  const router = tools.createPlan().createRouter()
  const signal = new AbortController().signal
  const unbound = await router.dispatch(
    { callId: 'workspace-unbound', name: 'fixture.workspace-read', arguments: {} },
    { runId: 'workspace-router', signal },
  )
  assert.equal(unbound.result.code, 'TOOL_SECURITY_DENIED')

  const crossWithoutGuard = await router.dispatch(
    { callId: 'workspace-cross-no-guard', name: 'fixture.workspace-read', arguments: {} },
    {
      runId: 'workspace-router',
      signal,
      workspace: workspaceRegistry().binding('workspace-code'),
    },
  )
  assert.equal(crossWithoutGuard.result.code, 'TOOL_SECURITY_DENIED')
  assert.equal(executions, 0)
})

test('Workspace-scoped Context Source requires read authorization and records its workspace source in durable snapshot', async () => {
  const context = new ContextRegistry()
  context.register({
    id: 'writer.instructions',
    workspaceAccess: { workspaceId: 'workspace-writer' },
    render() { return 'Writer workspace instructions.' },
  })
  const runtime = new AgentRuntime(new MemorySessionStore(), {
    context,
    workspaces: workspaceRegistry(),
    requireWorkspace: true,
  })
  const session = await runtime.createSession({
    agentId: 'xiaoyu.code',
    workspaceId: 'workspace-code',
    sessionId: 'workspace-context-access',
  })

  await assert.rejects(
    session.runTurn({ provider: textProvider, tools: new ToolRegistry(), input: 'read writer context', signal: new AbortController().signal }),
    /cannot read workspace workspace-writer/,
  )

  await session.grantWorkspaceAccess({
    workspaceId: 'workspace-writer',
    permissions: ['read'],
    reason: 'User explicitly allowed read-only Writer context reference.',
  })
  const result = await session.runTurn({
    provider: textProvider,
    tools: new ToolRegistry(),
    input: 'read approved writer context',
    signal: new AbortController().signal,
  })
  assert.equal(result.status, 'completed')
  const snapshot = session.snapshot().events.findLast(event => event.type === 'context/snapshot')
  assert.equal(snapshot?.type, 'context/snapshot')
  if (snapshot?.type === 'context/snapshot') {
    assert.equal(snapshot.sources[0]?.sourceId, 'writer.instructions')
    assert.equal(snapshot.sources[0]?.workspaceId, 'workspace-writer')
    assert.equal(snapshot.content, 'Writer workspace instructions.')
  }
  await session.close()
})
