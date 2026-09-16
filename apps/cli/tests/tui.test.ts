import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import {
  applyTerminalRunEvent,
  approvalDecision,
  commandPaletteOptions,
  cycleTerminalAgentMode,
  DEFAULT_TERMINAL_UI_SETTINGS,
  isTerminalMouseInput,
  loadTerminalUiSettings,
  renderHome,
  saveTerminalUiSettings,
  needsInitialBrainSetup,
  renderWorkspaceTrustPrompt,
  SafePromptInput,
  slashCommandCompletionSuffix,
  slashCommandSuggestions,
  toggleTerminalVisual,
  terminalHomeLayout,
  terminalContentWidth,
  terminalChatLayout,
  terminalHintPlainLine,
  terminalHomeTip,
  terminalCommandHelpText,
  shouldReturnChatToHome,
  terminalMouseCaptureSequence,
  terminalMouseReleaseSequence,
  workspaceRisk,
  workspaceTrustDefaultSelection,
  type TerminalTranscriptItem,
} from '../src/tui.ts'
import { assertCliNativeRuntimeStatus, parseArgs, USER_CANCEL_EXIT_CODE } from '../src/main.ts'
import { filterTuiMenuItems, moveTuiMenuSelection, projectTuiMenu, tuiMenuCellWidth } from '../src/tui-menu.ts'



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

test('TUI opens Brain setup only when no Provider profile has been configured', () => {
  assert.equal(needsInitialBrainSetup(false), true)
  assert.equal(needsInitialBrainSetup(true), false)
})

test('TUI warns for home, filesystem root and Windows system directories but not a normal project directory', () => {
  assert.equal(workspaceRisk(homedir()).level, 'home')
  assert.equal(workspaceRisk(path.parse(path.resolve(process.cwd())).root).level, 'root')
  assert.equal(workspaceRisk('C:\\Windows\\System32').level, 'system')
  const normal = path.join(homedir(), 'xma-project')
  assert.equal(workspaceRisk(normal).risky, false)
})


test('TUI Workspace Trust renders on every launch and explains elevated risk when needed', () => {
  const normal = renderWorkspaceTrustPrompt(path.join(homedir(), 'xma-project'))
  assert.match(normal, /访问工作区/)
  assert.match(normal, /安全确认/)
  assert.match(normal, /是的，我信任此目录/)
  assert.match(normal, /否，退出/)
  assert.match(normal, /本次授权不会跳过下次启动确认/)

  const warning = renderWorkspaceTrustPrompt(homedir())
  assert.match(warning, /高风险工作区/)
  assert.match(warning, /用户主目录/)
  assert.match(warning, /↑↓ \/ Tab 选择 · Enter 确认/)
  assert.equal(workspaceTrustDefaultSelection(workspaceRisk(homedir())), 'exit')
  assert.equal(workspaceTrustDefaultSelection(workspaceRisk(path.join(homedir(), 'xma-project'))), 'trust')
})

test('TUI home renders the canonical xiaoyu identity and current runtime facts', () => {
  const output = renderHome({
    version: '0.1.0',
    workspace: '/tmp/project',
    agentLabel: 'Xiaoyu Code',
    providerLabel: '模型未配置',
    providerReady: false,
  }, { columns: 112, rows: 34 })
  assert.match(output, /XIAOYU/)
  assert.match(output, /Xiaoyu Code/)
  assert.match(output, /模型未配置/)
  assert.match(output, /\/doctor/)
  assert.doesNotMatch(output, /┌─/)
})

test('configured model readiness depends on credential availability, not a mandatory connection probe', () => {
  const main = readFileSync('apps/cli/src/main.ts', 'utf8')
  assert.match(main, /return Boolean\(activeProfile\) && \(activeView\(\)\?\.credentialReady \?\? true\)/)
  assert.doesNotMatch(main, /get providerReady\(\) \{[\s\S]{0,300}brainProbeReadiness/)
  assert.match(main, /模型已就绪 · 连接测试可选/)
  const tui = readFileSync('apps/cli/src/tui.ts', 'utf8')
  const runtime = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(tui, /return `模型已就绪 · \$\{HOME_TIPS\[normalized\]!\}`/)
  assert.match(runtime, /label: providerReady\(\) \? modelLabel : `\$\{modelLabel\} · 凭据未就绪`/)
  const providerStatusStart = runtime.indexOf('  const providerStatus = createMemo')
  const providerStatusEnd = runtime.indexOf('  const [spinnerFrame', providerStatusStart)
  assert.doesNotMatch(runtime.slice(providerStatusStart, providerStatusEnd), /模型已就绪/)
})

test('TUI home falls back to a compact identity on narrow terminals', () => {
  const output = renderHome({
    version: '0.1.0',
    workspace: '/tmp/project',
    agentLabel: 'Xiaoyu Code',
    providerLabel: '模型就绪',
    providerReady: true,
  }, { columns: 64, rows: 24 })
  assert.match(output, /XIAOYU/)
  assert.match(output, /模型就绪/)
})

test('TUI Tool Approval maps only explicit Yes to one-shot allow', () => {
  assert.equal(approvalDecision('Y'), 'allow-once')
  assert.equal(approvalDecision('yes'), 'allow-once')
  assert.equal(approvalDecision('2'), 'allow-once')
  assert.equal(approvalDecision('N'), 'deny')
  assert.equal(approvalDecision('3'), 'deny')
  assert.equal(approvalDecision('anything-else'), 'deny')
})


test('TUI slash command discovery starts after the first letter and exposes canonical ghost suffixes', () => {
  assert.equal(slashCommandSuggestions('/').length, 0)
  assert.deepEqual(slashCommandSuggestions('/h').map(item => item.value), ['help'])
  assert.deepEqual(slashCommandSuggestions('/he').map(item => item.value), ['help'])
  assert.deepEqual(slashCommandSuggestions('/pro').map(item => item.value), ['provider'])
  assert.deepEqual(slashCommandSuggestions('/mod').map(item => item.value), ['model'])
  assert.equal(slashCommandSuggestions('/missing').length, 0)

  const help = slashCommandSuggestions('/he')[0]
  assert.equal(slashCommandCompletionSuffix('/he', help), 'lp')
  assert.equal(slashCommandCompletionSuffix('/hel', help), 'p')
  assert.equal(slashCommandCompletionSuffix('/help', help), '')
  assert.equal(slashCommandCompletionSuffix('/', help), '')
})

test('TUI command palette exposes only functional terminal actions with Chinese product labels', () => {
  const options = commandPaletteOptions()
  const values = options.map(item => item.value)
  assert.deepEqual(values, ['help', 'settings', 'vivid', 'doctor', 'workspace', 'provider', 'model', 'permission', 'agent', 'clear', 'exit'])
  assert.equal(options.find(item => item.value === 'help')?.shortcut, '/help')
  assert.equal(options.find(item => item.value === 'vivid')?.shortcut, '/vivid')
  assert.equal(options.find(item => item.value === 'workspace')?.label, '工作区')
  assert.equal(options.find(item => item.value === 'provider')?.label, '模型 / 提供方')
  assert.equal(options.find(item => item.value === 'agent')?.label, '智能体')
})

test('TUI /help text derives from the same canonical command catalog', () => {
  const help = terminalCommandHelpText()
  for (const command of ['/help', '/settings', '/vivid', '/doctor', '/workspace', '/provider', '/model', '/permission', '/agent', '/clear', '/exit']) {
    assert.match(help, new RegExp(command.replace('/', '\\/')))
  }
  assert.match(help, /查看全部快捷命令与用途说明/)
  assert.match(help, /配置模型与 API Key/)
})


test('TUI command palette search matches labels, descriptions and provider aliases', () => {
  const options = commandPaletteOptions()
  assert.deepEqual(filterTuiMenuItems(options, 'deep').map(item => item.value), ['provider', 'model'])
  assert.deepEqual(filterTuiMenuItems(options, 'API Key').map(item => item.value), ['provider'])
  assert.deepEqual(filterTuiMenuItems(options, '工作区').map(item => item.value), ['workspace'])
})

test('TUI menu projection keeps command, menu and description columns stable', () => {
  const projected = projectTuiMenu(commandPaletteOptions(), '', 0, 72, 10)
  assert.equal(projected.rows.length, 10)
  assert.equal(projected.rows[0]?.selected, true)
  for (const row of projected.rows) {
    assert.equal(tuiMenuCellWidth(row.label), projected.labelWidth)
    assert.equal(tuiMenuCellWidth(row.description), projected.descriptionWidth)
    assert.equal(tuiMenuCellWidth(row.shortcut), projected.shortcutWidth)
  }
  assert.equal(projected.rows[0]?.shortcut.startsWith('/settings'), true)
  assert.equal(projected.rows[0]?.shortcut.startsWith(' '), false)
  assert.equal(moveTuiMenuSelection(0, projected.filtered.length, -1), projected.filtered.length - 1)
})


test('TUI content width uses most of a normal terminal while keeping balanced side padding', () => {
  assert.equal(terminalContentWidth(64), 56)
  assert.equal(terminalContentWidth(112), 92)
  assert.equal(terminalContentWidth(160), 132)
})

test('TUI chat dock leaves a breathing row above the footer and keeps Esc as a real back action', () => {
  const layout = terminalChatLayout(34, false)
  assert.equal(layout.hintRow, 31)
  assert.equal(layout.promptEnd, 29)
  assert.equal(shouldReturnChatToHome(3, false, false), true)
  assert.equal(shouldReturnChatToHome(3, true, false), false)
  assert.equal(shouldReturnChatToHome(3, false, true), false)
  assert.equal(shouldReturnChatToHome(0, false, false), false)
})

test('TUI chat shortcut row distributes items evenly and aligns Esc to the same centered content width', () => {
  const line = terminalHintPlainLine(92, true)
  assert.equal(tuiMenuCellWidth(line), 92)
  const trimmed = line.trim()
  assert.match(trimmed, /^tab \/ shift\+tab 切换模式/)
  assert.match(trimmed, /esc 返回$/)
  const leftOuter = line.length - line.trimStart().length
  const rightOuter = line.length - line.trimEnd().length
  assert.equal(leftOuter, rightOuter)
  const gaps = [...trimmed.matchAll(/ {2,}/g)].map(match => match[0].length)
  assert.ok(gaps.length >= 4)
  assert.equal(Math.max(...gaps) - Math.min(...gaps), 0)
})

test('TUI home tips rotate when ready and become provider-aware when setup is incomplete', () => {
  assert.equal(terminalHomeTip(0, true, true), '模型已就绪 · Ctrl+P 打开命令面板')
  assert.equal(terminalHomeTip(1, true, true), '模型已就绪 · Ctrl+K 直接搜索命令')
  assert.match(terminalHomeTip(0, false, false), /模型未配置.*\/provider/)
  assert.match(terminalHomeTip(0, true, false), /模型已配置.*凭据未就绪.*检查凭据/)
})

test('TUI captures ordinary mouse drag while active and releases terminal state on exit', () => {
  assert.match(terminalMouseCaptureSequence, /\?1000h/)
  assert.match(terminalMouseCaptureSequence, /\?1002h/)
  assert.match(terminalMouseCaptureSequence, /\?1003h/)
  assert.match(terminalMouseCaptureSequence, /\?1006h/)
  assert.match(terminalMouseReleaseSequence, /\?1006l/)
  assert.match(terminalMouseReleaseSequence, /\?1003l/)
  assert.match(terminalMouseReleaseSequence, /\?1002l/)
  assert.match(terminalMouseReleaseSequence, /\?1000l/)
  assert.equal(isTerminalMouseInput('\u001b[<0;10;5M'), true)
  assert.equal(isTerminalMouseInput('\u001b[<0;10;5m'), true)
  assert.equal(isTerminalMouseInput('\u001b[A'), false)
})

test('CLI treats an explicit Workspace Trust decline as a clean user cancellation', () => {
  assert.equal(USER_CANCEL_EXIT_CODE, 0)
})


test('TUI home reserves breathing room and enters modal focus while an overlay is open', () => {
  const normal = terminalHomeLayout(34, false, true)
  assert.equal(normal.logoTop, 3)
  assert.equal(normal.showIdentity, true)
  assert.equal(normal.promptEnd, 24)
  assert.equal(normal.hintRow, 27)
  assert.equal(normal.tipRow, 30)

  const overlay = terminalHomeLayout(34, true, true)
  assert.equal(overlay.promptEnd, 31)
  assert.equal(overlay.showIdentity, false)
  assert.equal(overlay.hintRow, undefined)
  assert.equal(overlay.tipRow, undefined)

  const compact = terminalHomeLayout(24, false, true)
  assert.equal(compact.tipRow, undefined)
  assert.equal(compact.hintRow, 21)
  assert.equal(compact.promptEnd, 19)
})


test('TUI Tab mode cycle is Build -> Plan -> Compose and Shift+Tab reverses it', () => {
  assert.equal(cycleTerminalAgentMode('build'), 'plan')
  assert.equal(cycleTerminalAgentMode('plan'), 'compose')
  assert.equal(cycleTerminalAgentMode('compose'), 'build')
  assert.equal(cycleTerminalAgentMode('build', -1), 'compose')
})


test('Terminal exposes permission as a separate user setting instead of coupling it to Tab mode', () => {
  assert.equal(DEFAULT_TERMINAL_UI_SETTINGS.permissionProfile, 'ask')
  const permission = commandPaletteOptions().find(item => item.value === 'permission')
  assert.ok(permission)
  assert.equal(permission?.shortcut, '/permission')
  assert.match(permission?.description ?? '', /请求批准.*替我审批.*完全权限/)
})


test('Terminal permission profile persists independently from Build/Plan/Compose mode', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xma-tui-settings-'))
  const previous = process.env.XIAOYU_CONFIG_HOME
  process.env.XIAOYU_CONFIG_HOME = root
  try {
    saveTerminalUiSettings({ ...DEFAULT_TERMINAL_UI_SETTINGS, permissionProfile: 'full' })
    const restored = loadTerminalUiSettings()
    assert.equal(restored.permissionProfile, 'full')
    assert.equal(cycleTerminalAgentMode('build'), 'plan')
    assert.equal(restored.permissionProfile, 'full')
  } finally {
    if (previous === undefined) delete process.env.XIAOYU_CONFIG_HOME
    else process.env.XIAOYU_CONFIG_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
})


test('TUI live event projection streams reasoning, text and tool activity incrementally', () => {
  const transcript: TerminalTranscriptItem[] = [
    { role: 'user', text: '读取 package.json' },
    { role: 'assistant', text: '', placeholder: true },
  ]

  applyTerminalRunEvent(transcript, { type: 'reasoning-delta', stepId: 'step-1', text: '先检查项目' })
  applyTerminalRunEvent(transcript, { type: 'reasoning-delta', stepId: 'step-1', text: '规则。' })
  applyTerminalRunEvent(transcript, { type: 'tool-call', stepId: 'step-1', name: 'native.fs.read_text', arguments: { path: 'package.json' } })
  applyTerminalRunEvent(transcript, { type: 'tool-result', stepId: 'step-1', name: 'native.fs.read_text', ok: true, content: '{"name":"xma"}' })
  applyTerminalRunEvent(transcript, { type: 'text-delta', stepId: 'step-2', text: '项目名是 ' })
  applyTerminalRunEvent(transcript, { type: 'text-delta', stepId: 'step-2', text: 'xma。' })

  assert.equal(transcript.some(item => item.placeholder), false)
  assert.equal(transcript.find(item => item.role === 'reasoning')?.text, '先检查项目规则。')
  assert.match(transcript.find(item => item.role === 'tool' && item.text.includes('读取文件'))?.text ?? '', /native\.fs\.read_text/)
  assert.equal(transcript.find(item => item.role === 'assistant')?.text, '项目名是 xma。')
})

test('TUI visual setting toggles vivid/minimal without changing other terminal settings', () => {
  const minimal = toggleTerminalVisual({ ...DEFAULT_TERMINAL_UI_SETTINGS })
  assert.equal(minimal.visual, 'minimal')
  assert.equal(minimal.tips, true)
  assert.equal(minimal.logo, 'auto')
  assert.equal(minimal.stars, true)
  assert.equal(minimal.meteors, true)
  assert.equal(minimal.logoGradient, true)
  const vivid = toggleTerminalVisual(minimal)
  assert.equal(vivid.visual, 'vivid')
})

test('TUI Workspace Trust keeps high-risk default deny while still allowing explicit one-run trust', () => {
  const exit = renderWorkspaceTrustPrompt(homedir(), workspaceRisk(homedir()), 'exit')
  const trust = renderWorkspaceTrustPrompt(homedir(), workspaceRisk(homedir()), 'trust')
  assert.match(exit, /●\u001b\[0m .*否，退出/)
  assert.match(trust, /●\u001b\[0m .*是的，我信任此目录/)
})


test('Safe Prompt renders a software cursor without emitting a hardware cursor marker', () => {
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
  assert.doesNotMatch(line, /<CURSOR>/)
  assert.match(line, /你好/)
  assert.match(line, /\u001b\[4m/)
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
  assert.doesNotMatch(line, /<CURSOR>/)
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
