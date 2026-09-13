import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir } from 'node:os'
import path from 'node:path'
import { approvalDecision, renderHome, workspaceRisk } from '../src/tui.ts'

test('TUI warns for the user home and filesystem root but not a normal project directory', () => {
  assert.equal(workspaceRisk(homedir()).level, 'home')
  assert.equal(workspaceRisk(path.parse(path.resolve(process.cwd())).root).level, 'root')
  const normal = path.join(homedir(), 'xma-project')
  assert.equal(workspaceRisk(normal).risky, false)
})

test('TUI home renders the canonical xiaoyu identity and current runtime facts', () => {
  const output = renderHome({
    version: '0.1.0',
    workspace: '/tmp/project',
    agentLabel: 'Xiaoyu Code',
    providerLabel: '未配置 Provider',
    providerReady: false,
  })
  assert.match(output, /XIAOYU/)
  assert.match(output, /Xiaoyu Code/)
  assert.match(output, /\/doctor/)
  assert.match(output, /\/exit/)
})


test('TUI Tool Approval maps only explicit choices to allow decisions', () => {
  assert.equal(approvalDecision('1'), 'deny')
  assert.equal(approvalDecision('2'), 'allow-once')
  assert.equal(approvalDecision('3'), 'allow-session')
  assert.equal(approvalDecision('anything-else'), 'deny')
})
