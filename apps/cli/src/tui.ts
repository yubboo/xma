/**
 * 文件作用：实现 XMA `xiaoyu` 终端工作台的交互界面、主题、命令分发与 Workspace 风险确认。
 * 关联模块：main.ts、Core Agent Runtime、Workspace、Provider、Tool Approval 与 Native 文件 ToolSet。
 * 当前实现：基于 Pi TUI 的差分渲染/真实 Editor，提供固定 Home/Prompt Dock、动态丰富视觉、Ctrl+P 命令面板、终端设置、风险确认、斜杠自动补全、流式回复与 Tool Approval。
 * 职责边界：TUI 只负责终端视觉和交互；不得复制 Agent Loop、Provider 协议、Workspace Policy 或 Native 安全逻辑。
 */

import { homedir } from 'node:os'
import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { ToolApprovalDecision, ToolApprovalRequest } from '../../../core/src/tool/policy.ts'

const ESC = '\u001b['
const reset = `${ESC}0m`
const bold = `${ESC}1m`
const orange = `${ESC}38;2;255;126;63m`
const text = `${ESC}38;2;226;226;226m`
const textSoft = `${ESC}38;2;164;164;164m`
const textFaint = `${ESC}38;2;98;98;98m`
const green = `${ESC}38;2;98;202;132m`
const yellow = `${ESC}38;2;224;190;72m`
const red = `${ESC}38;2;238;94;94m`
const panel = `${ESC}48;2;30;30;30m`
const clearScreen = `${ESC}2J${ESC}H`
const enterAltScreen = `${ESC}?1049h`
const leaveAltScreen = `${ESC}?1049l`
const setTitle = (title: string) => `\u001b]0;${title}\u0007`
const TUI_PACKAGE = '@earendil-works/pi-tui'
const SPINNER = ['✦', '✧', '·', '✧'] as const

const LOGO_XIAO = [
  '█   █  █████   ███    ███ ',
  ' █ █     █    █   █  █   █',
  '  █      █    █████  █   █',
  ' █ █     █    █   █  █   █',
  '█   █  █████  █   █   ███ ',
] as const

const LOGO_YU = [
  '█   █  █   █',
  ' █ █   █   █',
  '  █    █   █',
  '  █    █   █',
  '  █     ███ ',
] as const

const COMMANDS = [
  { value: 'help', label: 'help', description: '查看快捷命令' },
  { value: 'settings', label: 'settings', description: '打开终端设置' },
  { value: 'vivid', label: 'vivid', description: '切换丰富 / 简洁视觉' },
  { value: 'doctor', label: 'doctor', description: '检查当前运行环境' },
  { value: 'workspace', label: 'workspace', description: '查看当前 Workspace' },
  { value: 'provider', label: 'provider', description: '查看当前 Brain / Provider' },
  { value: 'agent', label: 'agent', description: '查看当前 Agent' },
  { value: 'clear', label: 'clear', description: '清空当前终端显示' },
  { value: 'exit', label: 'exit', description: '退出 Xiaoyu Terminal' },
] as const

const PALETTE_ACTIONS = [
  { value: 'settings', label: '终端设置', description: '视觉、提示与 Logo，仅影响 Terminal' },
  { value: 'visual', label: '切换丰富显示', description: '动态星点 / 简洁模式' },
  { value: 'doctor', label: '检查运行环境', description: '运行 Xiaoyu doctor' },
  { value: 'workspace', label: 'Workspace', description: '查看当前工作区' },
  { value: 'provider', label: 'Brain / Provider', description: '查看当前 Provider 状态' },
  { value: 'agent', label: 'Agent', description: '查看当前 Agent' },
  { value: 'clear', label: '清空显示', description: '清空当前会话的终端显示' },
  { value: 'exit', label: '退出 Xiaoyu', description: '返回父终端' },
] as const

export interface TerminalUiSettings {
  visual: 'vivid' | 'minimal'
  tips: boolean
  logo: 'auto' | 'compact'
}

export const DEFAULT_TERMINAL_UI_SETTINGS: Readonly<TerminalUiSettings> = Object.freeze({
  visual: 'vivid',
  tips: true,
  logo: 'auto',
})

function terminalSettingsPath(): string {
  const configured = process.env.XIAOYU_CONFIG_HOME?.trim()
  if (configured) return path.join(path.resolve(configured), 'tui.json')
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming')
    return path.join(roaming, 'Xiaoyu', 'tui.json')
  }
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Xiaoyu', 'tui.json')
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'xiaoyu', 'tui.json')
}

function loadTerminalUiSettings(): TerminalUiSettings {
  try {
    const raw = JSON.parse(readFileSync(terminalSettingsPath(), 'utf8')) as Partial<TerminalUiSettings>
    return {
      visual: raw.visual === 'minimal' ? 'minimal' : 'vivid',
      tips: raw.tips !== false,
      logo: raw.logo === 'compact' ? 'compact' : 'auto',
    }
  } catch {
    return { ...DEFAULT_TERMINAL_UI_SETTINGS }
  }
}

function saveTerminalUiSettings(settings: TerminalUiSettings): void {
  try {
    const file = terminalSettingsPath()
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  } catch {
    // TUI 设置写入失败不应阻断 Agent Runtime；当前 Session 内仍继续生效。
  }
}

export interface DoctorItem {
  label: string
  ok: boolean
  detail: string
}

export interface TerminalBackend {
  version: string
  workspace: string
  agentLabel: string
  providerLabel: string
  providerReady: boolean
  sendMessage(
    input: string,
    write: (chunk: string) => void,
    signal: AbortSignal,
    approve: (request: ToolApprovalRequest, signal: AbortSignal) => Promise<ToolApprovalDecision>,
  ): Promise<void>
  doctor(): Promise<readonly DoctorItem[]>
  close(): Promise<void>
}

export interface WorkspaceRisk {
  risky: boolean
  level: 'normal' | 'home' | 'root'
  reason?: string
}

interface Viewport {
  columns: number
  rows: number
}

interface AutocompleteItem {
  value: string
  label: string
  description?: string
}

interface PiTuiToolkit {
  TUI: new (terminal: unknown, showHardwareCursor?: boolean) => any
  ProcessTerminal: new () => any
  Editor: new (tui: unknown, theme: unknown, options?: { paddingX?: number; autocompleteMaxVisible?: number }) => any
  Box: new (paddingX?: number, paddingY?: number, bgFn?: (value: string) => string) => any
  SelectList: new (items: readonly AutocompleteItem[], maxVisible: number, theme: unknown) => any
  visibleWidth(value: string): number
  matchesKey(data: string, key: string): boolean
}

interface TranscriptItem {
  role: 'user' | 'assistant' | 'system'
  text: string
}

interface ApprovalWaiter {
  request: ToolApprovalRequest
  resolve: (decision: ToolApprovalDecision) => void
  cleanup: () => void
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

function cellWidth(value: string): number {
  let width = 0
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint === 0) continue
    if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) continue
    width += isWideCodePoint(codePoint) ? 2 : 1
  }
  return width
}

function truncateCells(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  let width = 0
  let result = ''
  for (const char of value) {
    const charWidth = isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1
    if (width + charWidth > maxWidth) break
    result += char
    width += charWidth
  }
  if (result === value) return result
  while (cellWidth(result) + 1 > maxWidth && result.length > 0) result = result.slice(0, -1)
  return `${result}…`
}

function wrapPlain(value: string, maxWidth: number, maxLines: number): string[] {
  const normalized = value.replace(/\r/g, '')
  const lines: string[] = []
  for (const sourceLine of normalized.split('\n')) {
    let remaining = sourceLine
    if (!remaining) {
      lines.push('')
      continue
    }
    while (remaining && lines.length < maxLines) {
      const part = truncateCells(remaining, maxWidth)
      if (part.endsWith('…') && cellWidth(remaining) > maxWidth) {
        const withoutEllipsis = part.slice(0, -1)
        lines.push(withoutEllipsis)
        remaining = remaining.slice(withoutEllipsis.length)
      } else {
        lines.push(part)
        remaining = ''
      }
    }
    if (lines.length >= maxLines) break
  }
  return lines.slice(0, maxLines)
}

function spaces(count: number): string {
  return ' '.repeat(Math.max(0, count))
}

function centerPlain(value: string, width: number): string {
  const clipped = truncateCells(value, width)
  return `${spaces(Math.max(0, Math.floor((width - cellWidth(clipped)) / 2)))}${clipped}`
}

function viewport(): Viewport {
  return {
    columns: Math.max(58, output.columns ?? 100),
    rows: Math.max(24, output.rows ?? 32),
  }
}

function contentWidth(columns: number): number {
  return Math.max(54, Math.min(76, columns - 8))
}

function renderLogo(columns: number, mode: TerminalUiSettings['logo'] = 'auto'): string[] {
  if (mode === 'compact' || columns < 82) {
    return [
      centerPlain('✦  XIAOYU', columns).replace('XIAOYU', `${orange}${bold}XIAOYU${reset}`),
      centerPlain('Xiaoyu Management Agent', columns).replace('Xiaoyu Management Agent', `${textSoft}Xiaoyu Management Agent${reset}`),
    ]
  }

  const rows: string[] = []
  const logoWidth = cellWidth(LOGO_XIAO[0]) + 3 + cellWidth(LOGO_YU[0])
  const left = Math.max(0, Math.floor((columns - logoWidth) / 2))
  rows.push(`${spaces(Math.max(0, left + logoWidth - 8))}${textFaint}XIAOYU${reset}`)
  for (let index = 0; index < LOGO_XIAO.length; index += 1) {
    rows.push(`${spaces(left)}${orange}${LOGO_XIAO[index]}${reset}   ${textSoft}${LOGO_YU[index]}${reset}`)
  }
  return rows
}

function renderStars(columns: number, phase = 0): string {
  if (columns < 80) return ''
  const layouts = [
    [[0.08, '✧', textFaint], [0.25, '·', textFaint], [0.38, '✦', yellow], [0.63, '·', textFaint], [0.81, '✦', textFaint]],
    [[0.06, '·', textFaint], [0.30, '✦', textFaint], [0.69, '✧', textFaint], [0.88, '·', textFaint]],
  ] as const
  const points = layouts[Math.floor(phase / 2) % layouts.length]!
  const chars = Array.from({ length: columns }, () => ' ')
  const styles = new Map<number, string>()
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const [ratio, glyph, style] = points[pointIndex]!
    const drift = ((phase + pointIndex) % 5) - 2
    const index = Math.max(0, Math.min(columns - 1, Math.floor(columns * ratio) + drift))
    chars[index] = phase % 4 === 0 && glyph === '·' ? '✧' : glyph
    styles.set(index, style)
  }
  return chars.map((char, index) => styles.has(index) ? `${styles.get(index)}${char}${reset}` : char).join('')
}

function padStyled(value: string, width: number, visibleWidth: (value: string) => number): string {
  return `${value}${spaces(Math.max(0, width - visibleWidth(value)))}`
}

function renderHintLine(width: number): string {
  const hint = `${bold}/${reset} ${textSoft}命令${reset}    ${bold}ctrl+p${reset} ${textSoft}命令面板${reset}    ${bold}↑↓${reset} ${textSoft}历史${reset}    ${bold}shift+enter${reset} ${textSoft}换行${reset}    ${bold}ctrl+c${reset} ${textSoft}中止${reset}`
  const plain = '/ 命令    ctrl+p 命令面板    ↑↓ 历史    shift+enter 换行    ctrl+c 中止'
  const left = Math.max(0, Math.floor((width - cellWidth(plain)) / 2))
  return `${spaces(left)}${hint}`
}

export function commandPaletteOptions(): readonly AutocompleteItem[] {
  return PALETTE_ACTIONS.map(item => ({ ...item }))
}

export function toggleTerminalVisual(settings: TerminalUiSettings): TerminalUiSettings {
  return { ...settings, visual: settings.visual === 'vivid' ? 'minimal' : 'vivid' }
}

export function workspaceRisk(workspace: string): WorkspaceRisk {
  const normalized = normalizeForCompare(workspace)
  const home = normalizeForCompare(homedir())
  const root = normalizeForCompare(path.parse(path.resolve(workspace)).root)
  if (normalized === root) {
    return { risky: true, level: 'root', reason: '当前 Workspace 是文件系统根目录，范围过大。' }
  }
  if (normalized === home) {
    return { risky: true, level: 'home', reason: '当前 Workspace 是用户主目录。' }
  }
  return { risky: false, level: 'normal' }
}

export function renderWorkspaceTrustWarning(
  workspace: string,
  risk = workspaceRisk(workspace),
  selected: 'exit' | 'trust' = 'exit',
): string {
  if (!risk.risky) return ''
  const label = risk.level === 'home' ? '用户主目录' : '文件系统根目录'
  const exitMark = selected === 'exit' ? `${green}●${reset}` : `${textFaint}○${reset}`
  const trustMark = selected === 'trust' ? `${green}●${reset}` : `${textFaint}○${reset}`
  return [
    '',
    `${textFaint}│${reset}`,
    `${yellow}${bold}▲  安全提示：你即将打开${label}。${reset}`,
    `${textFaint}│${reset}`,
    `${textFaint}│${reset}  ${text}${workspace}${reset}`,
    `${textFaint}│${reset}`,
    `${textFaint}│${reset}  ${textSoft}该目录通常包含个人文件、SSH 密钥、凭证或浏览器配置等内容。${reset}`,
    `${textFaint}│${reset}  ${textSoft}Agent 获得 Workspace Tool 权限后，可能读取或修改该范围内的文件。${reset}`,
    `${textFaint}│${reset}`,
    `${textFaint}│${reset}  ${red}除非你明确需要，否则不要把整个${label}作为 Agent Workspace。${reset}`,
    `${textFaint}│${reset}`,
    `${orange}${bold}◆${reset}`,
    `${textFaint}│${reset}  ${exitMark} 退出（推荐）`,
    `${textFaint}│${reset}  ${trustMark} 我了解风险，仅本次信任`,
    `${textFaint}│${reset}`,
    `${textFaint}└  ↑↓ 选择 · Enter 确认${reset}`,
    '',
  ].join('\n')
}

export function renderHome(
  backend: Pick<TerminalBackend, 'version' | 'workspace' | 'agentLabel' | 'providerLabel' | 'providerReady'>,
  size: Viewport = viewport(),
): string {
  const width = contentWidth(size.columns)
  const left = Math.max(0, Math.floor((size.columns - width) / 2))
  const indent = spaces(left)
  const provider = backend.providerReady ? backend.providerLabel : 'Brain 未配置'
  const card = [
    `${indent}${orange}▌${reset}${panel} ${textFaint}输入消息…（输入 / 唤起命令）${spaces(Math.max(0, width - 31))}${reset}`,
    `${indent}${orange}▌${reset}${panel}${spaces(width - 1)}${reset}`,
    `${indent}${orange}▌${reset}${panel} ${orange}${bold}Build${reset}${panel}${text} · ${backend.agentLabel}    ${backend.providerReady ? green : yellow}${backend.providerReady ? '●' : '○'}${reset}${panel}${textSoft} ${provider}${spaces(Math.max(0, width - 30 - cellWidth(backend.agentLabel) - cellWidth(provider)))}${reset}`,
  ]
  return [
    '',
    renderStars(size.columns),
    '',
    ...renderLogo(size.columns),
    '',
    centerPlain('Model is replaceable. Agent is ours.', size.columns).replace('Model is replaceable. Agent is ours.', `${textFaint}Model is replaceable. Agent is ours.${reset}`),
    '',
    ...card,
    renderHintLine(size.columns),
    '',
    centerPlain('●  提示  输入 / 查看快捷命令；/doctor 检查环境', size.columns).replace('●  提示', `${orange}●  提示${reset}`).replace('/doctor', `${text}/doctor${reset}${textSoft}`),
    '',
    `${textFaint}${truncateCells(backend.workspace, size.columns - backend.version.length - 4)}${spaces(Math.max(2, size.columns - cellWidth(backend.workspace) - backend.version.length))}${backend.version}${reset}`,
  ].join('\n')
}

async function confirmWorkspaceTrustFallback(workspace: string, risk: WorkspaceRisk): Promise<boolean> {
  const rl = createInterface({ input, output })
  try {
    output.write(renderWorkspaceTrustWarning(workspace, risk, 'exit'))
    const answer = (await rl.question(`${orange}请选择 1=退出 / 2=仅本次信任：${reset}`)).trim()
    return answer === '2'
  } finally {
    rl.close()
  }
}

export async function confirmWorkspaceTrust(workspace: string): Promise<boolean> {
  const risk = workspaceRisk(workspace)
  if (!risk.risky) return true
  if (!input.isTTY || !output.isTTY) return false
  if (!input.setRawMode) return confirmWorkspaceTrustFallback(workspace, risk)

  const previousRaw = Boolean(input.isRaw)
  let selected: 'exit' | 'trust' = 'exit'
  let settled = false

  const draw = (): void => {
    output.write(`${clearScreen}${setTitle('Xiaoyu · Workspace Trust')}${renderWorkspaceTrustWarning(workspace, risk, selected)}`)
  }

  try {
    input.setEncoding('utf8')
    input.setRawMode(true)
    input.resume()
    draw()
    return await new Promise<boolean>(resolve => {
      const finish = (value: boolean): void => {
        if (settled) return
        settled = true
        input.removeListener('data', onData)
        resolve(value)
      }
      const onData = (chunk: string | Buffer): void => {
        const data = String(chunk)
        if (data === '\u0003' || data === '\u001b') return finish(false)
        if (data === '\u001b[A' || data === '\u001b[B' || data === '\t' || data === ' ') {
          selected = selected === 'exit' ? 'trust' : 'exit'
          draw()
          return
        }
        if (data === '1') {
          selected = 'exit'
          draw()
          return
        }
        if (data === '2') {
          selected = 'trust'
          draw()
          return
        }
        if (data === '\r' || data === '\n') finish(selected === 'trust')
      }
      input.on('data', onData)
    })
  } finally {
    input.setRawMode(previousRaw)
    if (!previousRaw) input.pause()
    output.write(`${reset}${clearScreen}`)
  }
}

export function approvalDecision(answer: string): ToolApprovalDecision {
  if (answer.trim() === '2') return 'allow-once'
  if (answer.trim() === '3') return 'allow-session'
  return 'deny'
}

export function slashCommandSuggestions(prefix: string): readonly AutocompleteItem[] {
  const normalized = prefix.replace(/^\//, '').toLowerCase()
  return COMMANDS.filter(command => command.value.startsWith(normalized)).map(command => ({ ...command }))
}

class SlashAutocompleteProvider {
  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
    const line = lines[cursorLine] ?? ''
    const beforeCursor = line.slice(0, cursorCol)
    if (!beforeCursor.startsWith('/') || beforeCursor.includes(' ')) return null
    const items = [...slashCommandSuggestions(beforeCursor)]
    if (items.length === 0) return null
    return { items, prefix: beforeCursor }
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    const line = lines[cursorLine] ?? ''
    const before = line.slice(0, Math.max(0, cursorCol - prefix.length))
    const after = line.slice(cursorCol)
    const value = `${before}/${item.value} ${after}`
    const next = [...lines]
    next[cursorLine] = value
    return { lines: next, cursorLine, cursorCol: before.length + item.value.length + 2 }
  }

  shouldTriggerFileCompletion(): boolean {
    return false
  }
}

async function loadPiTui(): Promise<PiTuiToolkit> {
  try {
    // @ts-ignore -- 依赖由 XMA [1] / portable build 安装；源码交付容器可能没有 node_modules。
    return await import('@earendil-works/pi-tui') as PiTuiToolkit
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Xiaoyu TUI 依赖 ${TUI_PACKAGE} 未就绪。开发源码请先运行 XMA [1] 一键准备开发环境。${message ? ` (${message})` : ''}`)
  }
}

class XiaoyuSurface {
  private _focused = false
  readonly editor: any
  private readonly promptBox: any
  private readonly transcript: TranscriptItem[] = []
  private notice = ''
  private busy = false
  private activeController: AbortController | undefined
  private approval: ApprovalWaiter | undefined
  private exitResolve: (() => void) | undefined
  private animationTimer: ReturnType<typeof setInterval> | undefined
  private starPhase = 0
  private settings: TerminalUiSettings = { ...DEFAULT_TERMINAL_UI_SETTINGS }
  private overlayOpen = false

  constructor(
    private readonly toolkit: PiTuiToolkit,
    private readonly tui: any,
    private readonly terminal: any,
    private readonly backend: TerminalBackend,
    initialSettings: TerminalUiSettings,
  ) {
    this.settings = { ...initialSettings }
    const mutedBorder = (value: string): string => `${textFaint}${value.replaceAll('─', ' ')}${reset}`
    const selectList = {
      selectedPrefix: (value: string) => `${orange}${value}${reset}`,
      selectedText: (value: string) => `${text}${bold}${value}${reset}`,
      description: (value: string) => `${textSoft}${value}${reset}`,
      scrollInfo: (value: string) => `${textFaint}${value}${reset}`,
      noMatch: (value: string) => `${textFaint}${value}${reset}`,
    }
    this.editor = new toolkit.Editor(tui, { borderColor: mutedBorder, selectList }, { paddingX: 0, autocompleteMaxVisible: 7 })
    this.editor.setAutocompleteProvider?.(new SlashAutocompleteProvider())
    this.editor.onChange = () => this.tui.requestRender()
    this.editor.onSubmit = (value: string) => { void this.submit(value) }

    // Prompt 只让 Pi TUI Editor 自己处理光标/IME；不再叠加手写 ANSI 背景，避免 Windows Terminal 反色泄漏。
    this.promptBox = new toolkit.Box(1, 0)
    this.promptBox.addChild({
      render: (width: number) => this.editor.getText?.()
        ? []
        : [`${textFaint}${truncateCells('输入消息…（输入 / 唤起命令）', width)}${reset}`],
    })
    this.promptBox.addChild(this.editor)
    this.promptBox.addChild({
      render: (width: number) => [this.renderPromptStatus(width)],
    })

    this.animationTimer = setInterval(() => {
      if (this.settings.visual !== 'vivid' && !this.busy) return
      this.starPhase = (this.starPhase + 1) % 10_000
      this.tui.requestRender()
    }, 420)
  }

  setExitResolver(resolve: () => void): void {
    this.exitResolve = resolve
  }

  requestExit(): void {
    this.exitResolve?.()
  }

  invalidate(): void {
    this.editor.invalidate?.()
  }

  get focused(): boolean {
    return this._focused
  }

  set focused(value: boolean) {
    this._focused = value
    this.editor.focused = value
  }

  handleInput(data: string): void {
    if (this.approval) {
      const decision = data === '2' ? 'allow-once' : data === '3' ? 'allow-session' : data === '1' || data === '\u001b' ? 'deny' : undefined
      if (decision) this.resolveApproval(decision)
      return
    }
    this.editor.handleInput(data)
  }

  cancel(): boolean {
    if (this.approval) {
      this.resolveApproval('deny')
      return true
    }
    if (this.activeController) {
      this.activeController.abort()
      return true
    }
    if (this.editor.getText?.()) {
      this.editor.setText('')
      this.notice = '已清空输入'
      this.tui.requestRender()
      return true
    }
    return false
  }

  render(width: number): string[] {
    const columns = Math.max(40, width)
    const rows = Math.max(20, this.terminal.rows ?? 24)
    const cardWidth = Math.max(48, Math.min(76, columns - 8))
    const indent = spaces(Math.max(0, Math.floor((columns - cardWidth) / 2)))
    const screen = Array.from({ length: rows }, () => '')

    const place = (row: number, lines: readonly string[]): void => {
      for (let index = 0; index < lines.length; index += 1) {
        const target = row + index
        if (target >= 0 && target < rows - 1) screen[target] = lines[index] ?? ''
      }
    }

    const boxWidth = Math.max(40, cardWidth - 1)
    const promptLines = (this.promptBox.render(boxWidth) as string[]).map(line => `${indent}${orange}▌${reset}${line}`)
    const hintLine = renderHintLine(columns)

    if (this.transcript.length === 0) {
      const logo = renderLogo(columns, this.settings.logo)
      const logoTop = Math.max(2, Math.min(6, Math.floor(rows * 0.12)))
      if (this.settings.visual === 'vivid') screen[Math.max(1, logoTop - 2)] = renderStars(columns, this.starPhase)
      place(logoTop, logo)
      const sloganRow = Math.min(rows - 10, logoTop + logo.length + 1)
      screen[sloganRow] = centerPlain('Model is replaceable. Agent is ours.', columns)
        .replace('Model is replaceable. Agent is ours.', `${textFaint}Model is replaceable. Agent is ours.${reset}`)

      // Home 的 Prompt 使用固定底锚点；自动补全只向上展开，Logo/底栏不会随内容高度移动。
      const hintRow = Math.min(rows - 5, Math.max(sloganRow + 7, Math.floor(rows * 0.70)))
      const promptEnd = hintRow - 1
      place(promptEnd - promptLines.length + 1, promptLines)
      screen[hintRow] = hintLine
      if (this.settings.tips && hintRow + 2 < rows - 1) {
        const spinner = SPINNER[Math.floor(Date.now() / 180) % SPINNER.length]!
        const tip = this.notice || (this.busy ? `${spinner} Xiaoyu 正在工作；Ctrl+C 中止` : 'Ctrl+P 打开命令面板；输入 / 查看快捷命令')
        screen[hintRow + 2] = centerPlain(`●  提示  ${tip}`, columns)
          .replace('●  提示', `${orange}●  提示${reset}`)
          .replace(tip, `${textSoft}${tip}${reset}`)
      }
    } else {
      // 对话态使用固定底部 Prompt Dock；上方内容变化不会推动输入区。
      const hintRow = rows - 2
      const promptEnd = hintRow - 1
      const promptStart = Math.max(2, promptEnd - promptLines.length + 1)
      place(promptStart, promptLines)
      screen[hintRow] = hintLine

      const transcriptLines: string[] = []
      for (const item of this.transcript.slice(-10)) {
        const label = item.role === 'user' ? `${orange}${bold}You${reset}` : item.role === 'assistant' ? `${orange}${bold}Xiaoyu${reset}` : `${yellow}${bold}Info${reset}`
        const raw = item.text || (item.role === 'assistant' && this.busy ? '思考中…' : '')
        const wrapped = wrapPlain(raw, Math.max(24, cardWidth - 12), 5)
        wrapped.forEach((line, index) => transcriptLines.push(`${indent}${index === 0 ? label : spaces(6)}${textFaint}  ${line}${reset}`))
        transcriptLines.push('')
      }
      const available = Math.max(1, promptStart - 3)
      const visible = transcriptLines.slice(-available)
      place(Math.max(1, promptStart - 2 - visible.length), visible)
    }

    if (this.approval) {
      const summary = [
        `${yellow}${bold}◆ Tool Approval${reset}`,
        `${text}${this.approval.request.toolName}${reset}${textFaint} · ${this.approval.request.effect}${reset}`,
        ...this.approval.request.summary.slice(0, 2).map(line => `${textSoft}${line}${reset}`),
        `${textFaint}[1] 拒绝   ${text}[2] 仅本次允许${reset}${textFaint}   ${text}[3] 当前 Session 允许${reset}`,
      ]
      const top = Math.max(2, Math.floor((rows - summary.length) / 2))
      summary.forEach((line, index) => {
        screen[top + index] = centerPlain(line.replace(/\u001b\[[0-9;]*m/g, ''), columns)
          .replace(line.replace(/\u001b\[[0-9;]*m/g, ''), line)
      })
    }

    const footerWorkspace = truncateCells(this.backend.workspace, Math.max(10, columns - this.backend.version.length - 4))
    screen[rows - 1] = `${textFaint}${footerWorkspace}${reset}${spaces(Math.max(2, columns - cellWidth(footerWorkspace) - this.backend.version.length))}${textFaint}${this.backend.version}${reset}`
    return screen
  }

  private renderPromptStatus(width: number): string {
    const providerDot = this.backend.providerReady ? `${green}●${reset}` : `${yellow}○${reset}`
    const provider = this.backend.providerReady ? this.backend.providerLabel : 'Brain 未配置'
    const plainAgent = truncateCells(this.backend.agentLabel, 24)
    const plainProvider = truncateCells(provider, Math.max(8, width - cellWidth(plainAgent) - 16))
    const styled = `${orange}${bold}Build${reset}${text} · ${plainAgent}${reset}   ${providerDot}${textSoft} ${plainProvider}${reset}`
    const visible = 8 + cellWidth(plainAgent) + 4 + 1 + cellWidth(plainProvider)
    return `${styled}${spaces(Math.max(0, width - visible))}`
  }

  openCommandPalette(): void {
    if (this.overlayOpen || this.approval) return
    this.showListOverlay('命令', commandPaletteOptions(), value => {
      void this.runPaletteAction(value)
    })
  }

  private openSettings(): void {
    if (this.overlayOpen) return
    const visual = this.settings.visual === 'vivid' ? '丰富' : '简洁'
    const tips = this.settings.tips ? '开启' : '关闭'
    const logo = this.settings.logo === 'auto' ? '自动' : '紧凑'
    this.showListOverlay('终端设置', [
      { value: 'visual', label: '丰富显示', description: `当前：${visual} · 动态星点，不改变主布局` },
      { value: 'tips', label: '提示信息', description: `当前：${tips}` },
      { value: 'logo', label: 'Logo 模式', description: `当前：${logo}` },
      { value: 'back', label: '返回命令面板', description: 'Esc 也可以关闭' },
    ], value => {
      if (value === 'visual') {
        this.settings = toggleTerminalVisual(this.settings)
        saveTerminalUiSettings(this.settings)
        this.notice = `终端视觉 · ${this.settings.visual === 'vivid' ? '丰富显示' : '简洁显示'}`
        this.tui.requestRender()
        this.openSettings()
        return
      }
      if (value === 'tips') {
        this.settings = { ...this.settings, tips: !this.settings.tips }
        saveTerminalUiSettings(this.settings)
        this.notice = `终端提示 · ${this.settings.tips ? '开启' : '关闭'}`
        this.tui.requestRender()
        this.openSettings()
        return
      }
      if (value === 'logo') {
        this.settings = { ...this.settings, logo: this.settings.logo === 'auto' ? 'compact' : 'auto' }
        saveTerminalUiSettings(this.settings)
        this.notice = `Logo · ${this.settings.logo === 'auto' ? '自动' : '紧凑'}`
        this.tui.requestRender()
        this.openSettings()
        return
      }
      this.openCommandPalette()
    })
  }

  private showListOverlay(
    title: string,
    items: readonly AutocompleteItem[],
    onSelect: (value: string) => void,
  ): void {
    if (this.overlayOpen) return
    this.overlayOpen = true
    const theme = {
      selectedPrefix: (value: string) => `${orange}${bold}${value}${reset}`,
      selectedText: (value: string) => `${orange}${bold}${value}${reset}`,
      description: (value: string) => `${textSoft}${value}${reset}`,
      scrollInfo: (value: string) => `${textFaint}${value}${reset}`,
      noMatch: (value: string) => `${textFaint}${value}${reset}`,
    }
    const list = new this.toolkit.SelectList(items, Math.min(10, Math.max(4, items.length)), theme)
    let handle: any
    const close = (): void => {
      if (!this.overlayOpen) return
      this.overlayOpen = false
      try { handle?.hide?.() } catch { /* best effort */ }
      this.tui.setFocus(this)
      this.tui.requestRender()
    }
    list.onSelect = (item: AutocompleteItem) => {
      close()
      onSelect(item.value)
    }
    list.onCancel = close
    const frame = {
      render: (width: number): string[] => {
        const inner = Math.max(28, width - 4)
        const heading = `${bold}${text}${title}${reset}${spaces(Math.max(1, inner - cellWidth(title) - 3))}${textFaint}esc${reset}`
        return [heading, '', ...list.render(inner)]
      },
      handleInput: (data: string): void => {
        if (this.toolkit.matchesKey(data, 'escape') || data === '\u001b') {
          close()
          return
        }
        list.handleInput?.(data)
      },
      invalidate: () => list.invalidate?.(),
    }
    handle = this.tui.showOverlay(frame, {
      width: 62,
      maxHeight: Math.min(18, Math.max(8, items.length + 4)),
      anchor: 'center',
      margin: 2,
    })
  }

  private async runPaletteAction(value: string): Promise<void> {
    if (value === 'settings') {
      this.openSettings()
      return
    }
    if (value === 'visual') {
      this.settings = toggleTerminalVisual(this.settings)
      saveTerminalUiSettings(this.settings)
      this.notice = `终端视觉 · ${this.settings.visual === 'vivid' ? '丰富显示' : '简洁显示'}`
      this.tui.requestRender()
      return
    }
    await this.runTerminalCommand(value)
  }

  private async runTerminalCommand(command: string): Promise<boolean> {
    if (command === 'exit' || command === 'quit') {
      this.requestExit()
      return true
    }
    if (command === 'clear') {
      this.transcript.length = 0
      this.notice = '会话显示已清空'
      this.tui.requestRender()
      return true
    }
    if (command === 'workspace') {
      this.notice = `Workspace · ${this.backend.workspace}`
      this.tui.requestRender()
      return true
    }
    if (command === 'provider') {
      this.notice = `Brain · ${this.backend.providerLabel}`
      this.tui.requestRender()
      return true
    }
    if (command === 'agent') {
      this.notice = `Agent · ${this.backend.agentLabel}`
      this.tui.requestRender()
      return true
    }
    if (command === 'doctor') {
      const items = await this.backend.doctor()
      this.notice = items.map(item => `${item.ok ? '●' : '○'} ${item.label}: ${item.detail}`).join('  ·  ')
      this.tui.requestRender()
      return true
    }
    return false
  }

  private async submit(raw: string): Promise<void> {
    const line = raw.trim()
    if (!line || this.busy || this.approval) return
    this.editor.addToHistory?.(line)
    this.editor.setText('')
    this.notice = ''

    if (line === '/' || line === '/help') {
      this.notice = '/settings 终端设置 · /vivid 视觉 · /doctor 检查 · /workspace · /provider · /agent · /clear · /exit'
      this.tui.requestRender()
      return
    }
    if (line === '/settings') {
      this.openSettings()
      return
    }
    if (line === '/vivid') {
      this.settings = toggleTerminalVisual(this.settings)
      saveTerminalUiSettings(this.settings)
      this.notice = `终端视觉 · ${this.settings.visual === 'vivid' ? '丰富显示' : '简洁显示'}`
      this.tui.requestRender()
      return
    }
    if (line.startsWith('/') && await this.runTerminalCommand(line.slice(1))) return
    if (line.startsWith('/')) {
      this.notice = `未知命令 ${line} · 输入 /help 查看可用命令`
      this.tui.requestRender()
      return
    }
    if (!this.backend.providerReady) {
      this.notice = 'Brain 未配置 · 设置 XIAOYU_BASE_URL / XIAOYU_MODEL / XIAOYU_API_KEY 后重新运行'
      this.tui.requestRender()
      return
    }

    this.transcript.push({ role: 'user', text: line }, { role: 'assistant', text: '' })
    const assistant = this.transcript[this.transcript.length - 1]!
    this.busy = true
    this.editor.disableSubmit = true
    this.activeController = new AbortController()
    this.tui.requestRender()
    try {
      await this.backend.sendMessage(
        line,
        chunk => {
          assistant.text += chunk
          this.tui.requestRender()
        },
        this.activeController.signal,
        (request, signal) => this.requestApproval(request, signal),
      )
      if (!assistant.text.trim()) assistant.text = '(没有文本输出)'
      this.notice = '完成'
    } catch (error) {
      assistant.text = `请求失败 · ${error instanceof Error ? error.message : String(error)}`
      this.notice = this.activeController.signal.aborted ? '已中止当前响应' : '请求失败'
    } finally {
      this.busy = false
      this.editor.disableSubmit = false
      this.activeController = undefined
      this.tui.requestRender()
    }
  }

  private requestApproval(request: ToolApprovalRequest, signal: AbortSignal): Promise<ToolApprovalDecision> {
    if (signal.aborted) return Promise.resolve('deny')
    if (this.approval) return Promise.resolve('deny')
    return new Promise<ToolApprovalDecision>(resolve => {
      const onAbort = (): void => this.resolveApproval('deny')
      signal.addEventListener('abort', onAbort, { once: true })
      this.approval = {
        request,
        resolve,
        cleanup: () => signal.removeEventListener('abort', onAbort),
      }
      this.tui.requestRender()
    })
  }

  private resolveApproval(decision: ToolApprovalDecision): void {
    const pending = this.approval
    if (!pending) return
    this.approval = undefined
    pending.cleanup()
    pending.resolve(decision)
    this.tui.requestRender()
  }

  dispose(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer)
      this.animationTimer = undefined
    }
    if (this.approval) this.resolveApproval('deny')
    this.activeController?.abort()
  }
}

export async function runTui(backend: TerminalBackend): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Xiaoyu interactive TUI requires a TTY. Use `xiaoyu --help` for non-interactive usage.')
  }

  const toolkit = await loadPiTui()
  const terminal = new toolkit.ProcessTerminal()
  const tui = new toolkit.TUI(terminal, true)
  const surface = new XiaoyuSurface(toolkit, tui, terminal, backend, loadTerminalUiSettings())
  let stopped = false

  try {
    output.write(`${enterAltScreen}${setTitle('Xiaoyu')}${clearScreen}`)
    tui.addChild(surface)
    tui.setFocus(surface)
    tui.addInputListener((data: string) => {
      const ctrlC = toolkit.matchesKey(data, 'ctrl+c') || data === '\u0003'
      const ctrlP = toolkit.matchesKey(data, 'ctrl+p') || data === '\u0010'
      const escape = toolkit.matchesKey(data, 'escape') || data === '\u001b'
      if (ctrlP) {
        surface.openCommandPalette()
        return { consume: true }
      }
      if (ctrlC) {
        if (surface.cancel()) return { consume: true }
        surface.requestExit()
        return { consume: true }
      }
      if (escape && surface.cancel()) return { consume: true }
      return undefined
    })
    tui.start()
    await new Promise<void>(resolve => surface.setExitResolver(resolve))
  } finally {
    surface.dispose()
    if (!stopped) {
      stopped = true
      try { tui.stop() } catch { /* best effort terminal restore */ }
    }
    await backend.close()
    output.write(`${reset}${clearScreen}${leaveAltScreen}`)
    output.write(`${textFaint}Xiaoyu 已退出。${reset}\n`)
  }
}
