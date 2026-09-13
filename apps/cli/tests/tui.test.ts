import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir } from 'node:os'
import path from 'node:path'
import { approvalDecision, renderHome, renderWorkspaceTrustWarning, slashCommandSuggestions, workspaceRisk } from '../src/tui.ts'

test('TUI warns for the user home and filesystem root but not a normal project directory', () => {
  assert.equal(workspaceRisk(homedir()).level, 'home')
  assert.equal(workspaceRisk(path.parse(path.resolve(process.cwd())).root).level, 'root')
  const normal = path.join(homedir(), 'xma-project')
  assert.equal(workspaceRisk(normal).risky, false)
})


test('TUI risk screen explains home/root scope before entering the fullscreen workbench', () => {
  const warning = renderWorkspaceTrustWarning(homedir())
  assert.match(warning, /安全提示/)
  assert.match(warning, /用户主目录/)
  assert.match(warning, /仅本次信任/)
  assert.match(warning, /退出（推荐）/)
  assert.match(warning, /↑↓ 选择 · Enter 确认/)
})

test('TUI home renders the canonical xiaoyu identity and current runtime facts', () => {
  const output = renderHome({
    version: '0.1.0',
    workspace: '/tmp/project',
    agentLabel: 'Xiaoyu Code',
    providerLabel: '未配置 Provider',
    providerReady: false,
  }, { columns: 112, rows: 34 })
  assert.match(output, /XIAOYU/)
  assert.match(output, /Xiaoyu Code/)
  assert.match(output, /Brain 未配置/)
  assert.match(output, /\/doctor/)
  assert.doesNotMatch(output, /┌─/)
})

test('TUI home falls back to a compact identity on narrow terminals', () => {
  const output = renderHome({
    version: '0.1.0',
    workspace: '/tmp/project',
    agentLabel: 'Xiaoyu Code',
    providerLabel: 'Provider Ready',
    providerReady: true,
  }, { columns: 64, rows: 24 })
  assert.match(output, /XIAOYU/)
  assert.match(output, /Provider Ready/)
})

test('TUI Tool Approval maps only explicit choices to allow decisions', () => {
  assert.equal(approvalDecision('1'), 'deny')
  assert.equal(approvalDecision('2'), 'allow-once')
  assert.equal(approvalDecision('3'), 'allow-session')
  assert.equal(approvalDecision('anything-else'), 'deny')
})


test('TUI slash command suggestions expose only implemented terminal commands', () => {
  const all = slashCommandSuggestions('/')
  assert.deepEqual(all.map(item => item.value), ['help', 'doctor', 'workspace', 'provider', 'agent', 'clear', 'exit'])
  assert.deepEqual(slashCommandSuggestions('/pro').map(item => item.value), ['provider'])
  assert.equal(slashCommandSuggestions('/missing').length, 0)
})

test('TUI trust warning defaults to exit and can render the one-time trust selection', () => {
  const exit = renderWorkspaceTrustWarning(homedir(), workspaceRisk(homedir()), 'exit')
  const trust = renderWorkspaceTrustWarning(homedir(), workspaceRisk(homedir()), 'trust')
  assert.match(exit, /●\u001b\[0m 退出（推荐）/)
  assert.match(trust, /●\u001b\[0m 我了解风险，仅本次信任/)
})
