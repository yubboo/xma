/**
 * 文件作用：验证 Native Tool Adapter 只通过 Capability Bridge 访问文件/进程，并受 ToolRouter Approval 约束。
 * 关联模块：plugins/tools/native.ts、core/src/native.ts、core/src/tool/router.ts、native/runtime。
 * 当前实现：最小 Capability scope、读工具直通、写工具 Approval、进程白名单注册条件与参数转发测试。
 * 职责边界：Fake NativeClient 只验证 TypeScript 桥接；路径真实 canonical confinement 和进程 enforcement 由 Rust Kernel 负责。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  NativeCapabilityGrant,
  NativeCapabilityLease,
  NativeClient,
  NativeProcessRunRequest,
  NativeProcessRunResult,
  NativeReadTextRequest,
  NativeReadTextResult,
  NativeRuntimeStatus,
  NativeWriteTextRequest,
  NativeWriteTextResult,
} from '../src/native.ts'
import { StaticToolApprovalProvider } from '../src/tool/policy.ts'
import { ToolRegistry } from '../src/tool/router.ts'
import { registerNativeTools } from '../../plugins/tools/native.ts'

class FakeNativeClient implements NativeClient {
  grants: NativeCapabilityGrant[] = []
  reads: NativeReadTextRequest[] = []
  writes: NativeWriteTextRequest[] = []
  processes: NativeProcessRunRequest[] = []

  async status(): Promise<NativeRuntimeStatus> {
    return { name: 'fake', version: '0.1.0', protocol: 'xma.native.v1', ready: true, policyConfigured: true, capabilities: [] }
  }

  async issueCapability(grant: NativeCapabilityGrant): Promise<NativeCapabilityLease> {
    this.grants.push(structuredClone(grant))
    return { token: `lease-${this.grants.length}`, kind: grant.kind }
  }

  async readText(request: NativeReadTextRequest): Promise<NativeReadTextResult> {
    this.reads.push(structuredClone(request))
    return { path: 'C:/workspace/read.txt', content: 'hello', bytes: 5, truncated: false }
  }

  async writeText(request: NativeWriteTextRequest): Promise<NativeWriteTextResult> {
    this.writes.push(structuredClone(request))
    return { path: 'C:/workspace/write.txt', bytes: request.content.length }
  }

  async runProcess(request: NativeProcessRunRequest): Promise<NativeProcessRunResult> {
    this.processes.push(structuredClone(request))
    return {
      program: request.program,
      cwd: request.cwd,
      exitCode: 0,
      success: true,
      timedOut: false,
      stdout: 'ok',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    }
  }

  async close(): Promise<void> {}
}

const toolContext = {
  runId: 'native-tool-test',
  sessionId: 'session-native',
  turnId: 'turn-1',
  stepId: 'step-1',
  signal: new AbortController().signal,
  workspace: {
    workspaceId: 'workspace-main',
    ownerAgentId: 'xiaoyu.code',
    name: 'Main Workspace',
    root: 'C:/workspace',
    allowedRoots: ['C:/workspace'],
    descriptorDigest: '0'.repeat(64),
  },
}

test('native read requests only filesystem.read scope and never uses Approval in standard policy', async () => {
  const client = new FakeNativeClient()
  const registry = new ToolRegistry()
  registerNativeTools(registry, { client, workspaceId: 'workspace-main', allowedRoots: ['C:/workspace'] })

  const outcome = await registry.createPlan().createRouter().dispatch({
    callId: 'read-1',
    name: 'native.fs.read_text',
    arguments: { path: 'read.txt', maxBytes: 128 },
  }, toolContext)

  assert.equal(outcome.result.code, 'OK')
  assert.equal(outcome.approval, undefined)
  assert.deepEqual(client.grants, [{ kind: 'filesystem.read', roots: ['C:/workspace'] }])
  assert.equal(client.reads[0]?.token, 'lease-1')
  assert.equal(client.reads[0]?.path, 'read.txt')
})

test('native write fails closed before Capability issuance, then runs only after explicit Approval', async () => {
  const deniedClient = new FakeNativeClient()
  const deniedRegistry = new ToolRegistry()
  registerNativeTools(deniedRegistry, { client: deniedClient, workspaceId: 'workspace-main', allowedRoots: ['C:/workspace'] })
  const denied = await deniedRegistry.createPlan().createRouter().dispatch({
    callId: 'write-denied',
    name: 'native.fs.write_text',
    arguments: { path: 'write.txt', content: 'hello' },
  }, toolContext)
  assert.equal(denied.result.code, 'TOOL_APPROVAL_DENIED')
  assert.equal(deniedClient.grants.length, 0)
  assert.equal(deniedClient.writes.length, 0)

  const client = new FakeNativeClient()
  const registry = new ToolRegistry()
  registerNativeTools(registry, { client, workspaceId: 'workspace-main', allowedRoots: ['C:/workspace'], maxWriteBytes: 1024 })
  const allowed = await registry.createPlan().createRouter({
    approvals: new StaticToolApprovalProvider('allow-once'),
  }).dispatch({
    callId: 'write-allowed',
    name: 'native.fs.write_text',
    arguments: { path: 'write.txt', content: 'hello', createParents: true },
  }, toolContext)

  assert.equal(allowed.result.code, 'OK')
  assert.equal(allowed.approval?.decision, 'allow-once')
  assert.deepEqual(client.grants[0], { kind: 'filesystem.write', roots: ['C:/workspace'] })
  assert.equal(client.writes[0]?.token, 'lease-1')
  assert.equal(client.writes[0]?.createParents, true)
})

test('native process tool requires absolute executable identity and leases only the selected program', async () => {
  const hiddenClient = new FakeNativeClient()
  const hiddenRegistry = new ToolRegistry()
  registerNativeTools(hiddenRegistry, { client: hiddenClient, workspaceId: 'workspace-main', allowedRoots: ['C:/workspace'] })
  assert.equal(hiddenRegistry.createPlan().modelVisibleSpecs().some(spec => spec.name === 'native.process.run'), false)

  const invalidRegistry = new ToolRegistry()
  assert.throws(() => registerNativeTools(invalidRegistry, {
    client: new FakeNativeClient(),
    workspaceId: 'workspace-main',
    allowedRoots: ['C:/workspace'],
    allowedPrograms: ['git.exe'],
  }), /absolute executable paths/)

  const client = new FakeNativeClient()
  const registry = new ToolRegistry()
  const allowedProgram = process.execPath
  registerNativeTools(registry, {
    client,
    workspaceId: 'workspace-main',
    allowedRoots: ['C:/workspace'],
    allowedPrograms: [allowedProgram],
    defaultCwd: 'C:/workspace',
  })
  const outcome = await registry.createPlan().createRouter({
    approvals: new StaticToolApprovalProvider('allow-once'),
  }).dispatch({
    callId: 'process-1',
    name: 'native.process.run',
    arguments: { program: allowedProgram, args: ['--version'] },
  }, toolContext)

  assert.equal(outcome.result.code, 'OK')
  assert.deepEqual(client.grants[0], {
    kind: 'process.spawn',
    roots: ['C:/workspace'],
    programs: [allowedProgram],
  })
  assert.deepEqual(client.processes[0]?.args, ['--version'])
  assert.equal(client.processes[0]?.program, allowedProgram)
  assert.equal(client.processes[0]?.cwd, 'C:/workspace')
})

test('native process ToolPlan exposes only configured executable identities and rejects unadvertised programs before capability issuance', async () => {
  const client = new FakeNativeClient()
  const registry = new ToolRegistry()
  registerNativeTools(registry, {
    client,
    workspaceId: 'workspace-main',
    allowedRoots: ['C:/workspace'],
    allowedPrograms: [process.execPath],
    defaultCwd: 'C:/workspace',
  })
  const spec = registry.createPlan().modelVisibleSpecs().find(item => item.name === 'native.process.run')
  assert.ok(spec)
  assert.deepEqual((spec.inputSchema.properties as Record<string, { enum?: string[] }>).program?.enum, [process.execPath])

  const foreignProgram = process.platform === 'win32' ? 'C:/Windows/System32/notepad.exe' : '/bin/sh'
  const denied = await registry.createPlan().createRouter({
    approvals: new StaticToolApprovalProvider('allow-once'),
  }).dispatch({
    callId: 'process-unadvertised',
    name: 'native.process.run',
    arguments: { program: foreignProgram, args: [] },
  }, toolContext)

  assert.equal(denied.result.code, 'TOOL_INVALID_ARGUMENTS')
  assert.equal(client.grants.length, 0)
  assert.equal(client.processes.length, 0)
})

