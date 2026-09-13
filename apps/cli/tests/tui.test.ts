import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  approvalDecision,
  commandPaletteOptions,
  DEFAULT_TERMINAL_UI_SETTINGS,
  renderHome,
  renderWorkspaceTrustWarning,
  SafePromptInput,
  slashCommandSuggestions,
  toggleTerminalVisual,
  workspaceRisk,
} from '../src/tui.ts'
import { assertCliNativeRuntimeStatus, parseArgs } from '../src/main.ts'



test('CLI rejects a stale Native Runtime that lacks required OS Credential capabilities', () => {
  assert.throws(() => assertCliNativeRuntimeStatus({
    name: 'XMA Native Runtime',
    version: '0.1.0',
    protocol: 'xma.native.v1',
    ready: true,
    policyConfigured: true,
    capabilities: ['runtime.status', 'fs.read_text', 'fs.write_text'],
  }), /当前源码不匹配.*credential\.status/)

  assert.doesNotThrow(() => assertCliNativeRuntimeStatus({
    name: 'XMA Native Runtime',
    version: '0.1.0',
    protocol: 'xma.native.v1',
    ready: true,
    policyConfigured: true,
    capabilities: [
      'runtime.status',
      'fs.read_text',
      'fs.write_text',
      'credential.status',
      'credential.read',
      'credential.write',
      'credential.delete',
    ],
  }))
})

test('CLI ignores the pnpm/npm -- separator before a workspace argument', () => {
  const workspace = path.join(process.cwd(), 'fixture-workspace')
  const parsed = parseArgs(['--', workspace])
  assert.equal(parsed.command, 'tui')
  assert.equal(parsed.workspace, path.resolve(workspace))
})

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
    providerLabel: 'Brain 未配置',
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
  assert.deepEqual(all.map(item => item.value), ['help', 'settings', 'vivid', 'doctor', 'workspace', 'provider', 'model', 'agent', 'clear', 'exit'])
  assert.deepEqual(slashCommandSuggestions('/pro').map(item => item.value), ['provider'])
  assert.deepEqual(slashCommandSuggestions('/mod').map(item => item.value), ['model'])
  assert.equal(slashCommandSuggestions('/missing').length, 0)
})

test('TUI command palette exposes only functional terminal actions', () => {
  const values = commandPaletteOptions().map(item => item.value)
  assert.deepEqual(values, ['settings', 'visual', 'doctor', 'workspace', 'provider', 'model', 'agent', 'clear', 'exit'])
})

test('TUI visual setting toggles vivid/minimal without changing other terminal settings', () => {
  const minimal = toggleTerminalVisual({ ...DEFAULT_TERMINAL_UI_SETTINGS })
  assert.equal(minimal.visual, 'minimal')
  assert.equal(minimal.tips, true)
  assert.equal(minimal.logo, 'auto')
  const vivid = toggleTerminalVisual(minimal)
  assert.equal(vivid.visual, 'vivid')
})

test('TUI trust warning defaults to exit and can render the one-time trust selection', () => {
  const exit = renderWorkspaceTrustWarning(homedir(), workspaceRisk(homedir()), 'exit')
  const trust = renderWorkspaceTrustWarning(homedir(), workspaceRisk(homedir()), 'trust')
  assert.match(exit, /●\u001b\[0m 退出（推荐）/)
  assert.match(trust, /●\u001b\[0m 我了解风险，仅本次信任/)
})


test('Safe Prompt uses only the hardware cursor marker and never reverse-video ANSI', () => {
  const toolkit = {
    CURSOR_MARKER: '<CURSOR>',
    matchesKey(data: string, key: string) {
      const map: Record<string, string> = { enter: '\r', backspace: '\u007f', left: '\u001b[D', right: '\u001b[C', up: '\u001b[A', down: '\u001b[B', tab: '\t' }
      return map[key] === data
    },
  } as any
  const input = new SafePromptInput(toolkit)
  input.focused = true
  input.handleInput('你')
  input.handleInput('好')
  const line = input.render(20).join('\n')
  assert.match(line, /<CURSOR>/)
  assert.match(line, /你好/)
  assert.doesNotMatch(line, /\u001b\[7m|\u001b\[27m/)
})

test('Safe Prompt secret rendering never exposes the stored credential text', () => {
  const toolkit = {
    CURSOR_MARKER: '<CURSOR>',
    matchesKey: () => false,
  } as any
  const input = new SafePromptInput(toolkit)
  input.focused = true
  input.setText('sk-secret-value')
  const line = input.renderSecret(40).join('\n')
  assert.doesNotMatch(line, /sk-secret-value|secret-value/)
  assert.match(line, /•/)
  assert.match(line, /<CURSOR>/)
})

test('Safe Prompt exposes slash suggestions without changing the fixed parent layout contract', () => {
  const toolkit = {
    CURSOR_MARKER: '<CURSOR>',
    matchesKey: () => false,
  } as any
  const input = new SafePromptInput(toolkit)
  input.focused = true
  input.handleInput('/pro')
  assert.deepEqual(input.suggestions().map(item => item.value), ['provider'])
  assert.equal(input.selectedSuggestionIndex(), 0)
})
