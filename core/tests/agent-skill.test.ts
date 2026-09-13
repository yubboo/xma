/**
 * 文件作用：验证 XMA Agent/Skill Platform Foundation 的注册、Skill 加载、Context 注入和委派边界。
 * 关联模块：core/src/agent/*、core/src/skill/*、agents/xiaoyu、agents/code、skills/*。
 * 当前实现：覆盖内置 Agent/Skill 绑定、Skill Tool/Brain 要求、durable-ready Context Source 与 Manager delegation。
 * 职责边界：这里不测试真实模型/Process 执行；对应 E2E 在 Provider/Native/Code Agent 后续测试中完成。
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { xiaoyuAgent } from '../../agents/xiaoyu/agent.ts'
import { codeAgent } from '../../agents/code/agent.ts'
import { AgentDelegationService } from '../src/agent/delegation.ts'
import type { AgentDefinition } from '../src/agent/contract.ts'
import { AgentRegistry } from '../src/agent/registry.ts'
import { ContextRegistry } from '../src/context.ts'
import { SESSION_FORMAT_VERSION } from '../src/session/contract.ts'
import { SkillLoader } from '../src/skill/loader.ts'
import { createAgentSkillContextSource, SkillRegistry } from '../src/skill/registry.ts'

async function foundation(): Promise<{ agents: AgentRegistry; skills: SkillRegistry }> {
  const agents = new AgentRegistry()
  agents.register(xiaoyuAgent)
  agents.register(codeAgent)
  agents.validateDelegationTargets()

  const loader = new SkillLoader(path.join(process.cwd(), 'skills'))
  const skills = new SkillRegistry()
  for (const id of [
    'common/task-planning',
    'common/verification',
    'code/bug-fixing',
    'code/testing',
  ]) {
    skills.register(await loader.load(id))
  }
  return { agents, skills }
}

test('Agent/Skill foundation loads canonical Skills and resolves Xiaoyu Code loadout in Agent order', async () => {
  const { agents, skills } = await foundation()
  assert.deepEqual(agents.list().map(agent => agent.id), ['xiaoyu', 'xiaoyu.code'])
  assert.deepEqual(
    skills.resolveForAgent(agents.require('xiaoyu.code')).map(skill => skill.definition.id),
    ['common/task-planning', 'common/verification', 'code/bug-fixing', 'code/testing'],
  )

  const copy = agents.require('xiaoyu.code')
  ;(copy.skills as string[]).push('fake/skill')
  assert.equal(agents.require('xiaoyu.code').skills.includes('fake/skill'), false)
})

test('Agent Skill Context Source makes identity and professional Skills model-visible through normal Context Assembly', async () => {
  const { agents, skills } = await foundation()
  const context = new ContextRegistry()
  context.register(createAgentSkillContextSource(agents, skills))

  const header = {
    formatVersion: SESSION_FORMAT_VERSION,
    sessionId: 'session-agent-skill',
    agentId: 'xiaoyu.code',
    createdAt: '2026-09-13T00:00:00.000Z',
  } as const
  const assembled = await context.assemble({
    header,
    snapshot: { header, events: [] },
    turnId: 'turn-1',
    stepId: 'step-1',
    signal: new AbortController().signal,
  })

  assert.match(assembled.content, /Xiaoyu Code/)
  assert.match(assembled.content, /Chinese product name: 小鱼管理智能体/)
  assert.match(assembled.content, /Canonical Chinese self-name: 小鱼/)
  assert.match(assembled.content, /Never rename or transliterate Xiaoyu as 小禹、小宇、晓雨/)
  assert.match(assembled.content, /Skill: Bug Fixing/)
  assert.match(assembled.content, /Skill: Code Testing/)
  assert.match(assembled.content, /必须提供可核验的完成证据/)
  assert.deepEqual(assembled.sections.map(section => section.sourceId), ['agent/skills'])
})

test('Skill binding fails loud when an Agent does not declare a required Tool or Brain capability', async () => {
  const { skills } = await foundation()
  const invalid: AgentDefinition = {
    ...structuredClone(codeAgent),
    id: 'test.invalid',
    tools: ['native.fs.read_text', 'native.fs.write_text'],
    brain: { required: ['text'], preferred: [] },
  }
  assert.throws(() => skills.resolveForAgent(invalid), /required Brain capability|required tool/)
})

test('Xiaoyu Manager can create a specialist Task while ordinary specialist delegation fails closed', async () => {
  const { agents } = await foundation()
  const delegation = new AgentDelegationService(agents)
  const task = delegation.createTask({
    id: 'task-code-1',
    requestedBy: { type: 'agent', agentId: 'xiaoyu' },
    assignedTo: 'xiaoyu.code',
    objective: '修复项目中的构建错误并给出验证证据',
    workspaceId: 'workspace-1',
    inputs: [{ issue: 'build failed' }],
  })

  assert.equal(task.status, 'queued')
  assert.equal(task.assignedTo, 'xiaoyu.code')
  assert.equal(task.requestedBy.type, 'agent')

  assert.throws(() => delegation.createTask({
    requestedBy: { type: 'agent', agentId: 'xiaoyu.code' },
    assignedTo: 'xiaoyu',
    objective: '尝试反向委派',
    workspaceId: 'workspace-1',
  }), /cannot delegate tasks/)
})
