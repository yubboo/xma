/**
 * 文件作用：实现 XMA `xiaoyu` 终端工作台的交互界面、主题、命令分发与 Workspace 风险确认。
 * 关联模块：main.ts、Core Agent Runtime、Workspace、Provider、Tool Approval 与 Native 文件 ToolSet。
 * 当前实现：基于 Pi TUI 的差分渲染/真实 Editor，提供居中品牌首页、Prompt 卡片、持续输入、风险确认、斜杠命令自动补全、流式回复与 Tool Approval。
 * 职责边界：TUI 只负责终端视觉和交互；不得复制 Agent Loop、Provider 协议、Workspace Policy 或 Native 安全逻辑。
 */

import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { ToolApprovalDecision, ToolApprovalRequest } from '../../../core/src/tool/policy.ts'

const ESC = '\u001b['
const CURSOR_MARKER = '\u001b_pi:c\u0007'
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
  { value: 'doctor', label: 'doctor', description: '检查当前运行环境' },
  { value: 'workspace', label: 'workspace', description: '查看当前 Workspace' },
  { value: 'provider', label: 'provider', description: '查看当前 Brain / Provider' },
  { value: 'agent', label: 'agent', description: '查看当前 Agent' },
  { value: 'clear', label: 'clear', description: '清空当前终端显示' },
  { value: 'exit', label: 'exit', description: '退出 Xiaoyu Terminal' },
] as const

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

function renderLogo(columns: number): string[] {
  if (columns < 82) {
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

function renderStars(columns: number, variant = 0): string {
  if (columns < 80) return ''
  const layouts = [
    [[0.08, '✧', textFaint], [0.25, '·', textFaint], [0.38, '✦', yellow], [0.63, '·', textFaint], [0.81, '✦', textFaint]],
    [[0.06, '·', textFaint], [0.30, '✦', textFaint], [0.69, '✧', textFaint], [0.88, '·', textFaint]],
  ] as const
  const points = layouts[variant % layouts.length]!
  const chars = Array.from({ length: columns }, () => ' ')
  const styles = new Map<number, string>()
  for (const [ratio, glyph, style] of points) {
    const index = Math.max(0, Math.min(columns - 1, Math.floor(columns * ratio)))
    chars[index] = glyph
    styles.set(index, style)
  }
  return chars.map((char, index) => styles.has(index) ? `${styles.get(index)}${char}${reset}` : char).join('')
}

function padStyled(value: string, width: number, visibleWidth: (value: string) => number): string {
  return `${value}${spaces(Math.max(0, width - visibleWidth(value)))}`
}

function stylePanelLine(value: string, width: number, visibleWidth: (value: string) => number, accent = true): string {
  const innerWidth = Math.max(1, width - 2)
  const normalized = value.replaceAll(reset, `${reset}${panel}${text}`)
  const padded = padStyled(normalized, innerWidth, visibleWidth)
  return `${accent ? `${orange}▌${reset}` : ' '}${panel} ${text}${padded}${reset}`
}

function renderHintLine(width: number): string {
  const hint = `${bold}/${reset} ${textSoft}命令${reset}    ${bold}↑↓${reset} ${textSoft}历史${reset}    ${bold}shift+enter${reset} ${textSoft}换行${reset}    ${bold}ctrl+c${reset} ${textSoft}中止${reset}`
  const plain = '/ 命令    ↑↓ 历史    shift+enter 换行    ctrl+c 中止'
  const left = Math.max(0, Math.floor((width - cellWidth(plain)) / 2))
  return `${spaces(left)}${hint}`
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
  private readonly transcript: TranscriptItem[] = []
  private notice = ''
  private busy = false
  private activeController: AbortController | undefined
  private approval: ApprovalWaiter | undefined
  private exitResolve: (() => void) | undefined
  private animationTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly toolkit: PiTuiToolkit,
    private readonly tui: any,
    private readonly terminal: any,
    private readonly backend: TerminalBackend,
  ) {
    const mutedBorder = (value: string): string => `${panel}${textFaint}${value.replaceAll('─', ' ')}${reset}`
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
    const body: string[] = []

    body.push(renderStars(columns, 0), '')
    body.push(...renderLogo(columns), '')
    body.push(centerPlain('Model is replaceable. Agent is ours.', columns).replace('Model is replaceable. Agent is ours.', `${textFaint}Model is replaceable. Agent is ours.${reset}`), '')

    const recent = this.transcript.slice(-4)
    if (recent.length > 0) {
      const transcriptLines: string[] = []
      for (const item of recent) {
        const label = item.role === 'user' ? `${orange}${bold}You${reset}` : item.role === 'assistant' ? `${orange}${bold}Xiaoyu${reset}` : `${yellow}${bold}Info${reset}`
        const raw = item.text || (item.role === 'assistant' && this.busy ? '思考中…' : '')
        const wrapped = wrapPlain(raw, cardWidth - 12, 3)
        wrapped.forEach((line, index) => transcriptLines.push(`${indent}${index === 0 ? label : spaces(6)}${textFaint}  ${line}${reset}`))
      }
      body.push(...transcriptLines.slice(-7), '')
    }

    const editorWidth = Math.max(20, cardWidth - 2)
    let editorLines: string[] = this.editor.render(editorWidth)
    if (!this.editor.getText?.()) {
      const placeholder = `${textFaint}输入消息…（输入 / 唤起命令）${reset}`
      const cursor = `${CURSOR_MARKER}\u001b[7m \u001b[0m`
      editorLines = editorLines.map(line => line.replace(cursor, `${CURSOR_MARKER}${placeholder}`))
    }
    for (const line of editorLines) body.push(`${indent}${stylePanelLine(line, cardWidth, this.toolkit.visibleWidth, true)}`)

    const providerDot = this.backend.providerReady ? `${green}●${reset}` : `${yellow}○${reset}`
    const provider = this.backend.providerReady ? this.backend.providerLabel : 'Brain 未配置'
    const status = `${orange}${bold}Build${reset}${panel}${text} · ${this.backend.agentLabel}${reset}${panel}   ${providerDot}${panel}${textSoft} ${truncateCells(provider, 30)}${reset}`
    body.push(`${indent}${stylePanelLine(status, cardWidth, this.toolkit.visibleWidth, true)}`)
    body.push(renderHintLine(columns))

    if (this.approval) {
      body.push('')
      body.push(centerPlain('◆  Tool Approval', columns).replace('◆  Tool Approval', `${yellow}${bold}◆  Tool Approval${reset}`))
      body.push(centerPlain(`${this.approval.request.toolName} · ${this.approval.request.effect}`, columns).replace(`${this.approval.request.toolName} · ${this.approval.request.effect}`, `${text}${this.approval.request.toolName}${reset}${textFaint} · ${this.approval.request.effect}${reset}`))
      for (const line of this.approval.request.summary.slice(0, 3)) body.push(centerPlain(line, columns).replace(line, `${textSoft}${line}${reset}`))
      body.push(centerPlain('[1] 拒绝    [2] 仅本次允许    [3] 当前 Session 允许', columns).replace('[1] 拒绝    [2] 仅本次允许    [3] 当前 Session 允许', `${textFaint}[1] 拒绝    ${text}[2] 仅本次允许${reset}${textFaint}    ${text}[3] 当前 Session 允许${reset}`))
    } else {
      body.push('')
      const spinner = SPINNER[Math.floor(Date.now() / 140) % SPINNER.length]!
      const tip = this.notice || (this.busy ? `${spinner} Xiaoyu 正在工作；Ctrl+C 中止` : '输入 / 查看快捷命令；/doctor 检查当前运行环境')
      body.push(centerPlain(`●  提示  ${tip}`, columns).replace('●  提示', `${orange}●  提示${reset}`).replace(tip, `${textSoft}${tip}${reset}`))
    }

    const footerWorkspace = truncateCells(this.backend.workspace, Math.max(10, columns - this.backend.version.length - 4))
    const footer = `${textFaint}${footerWorkspace}${reset}`
    const version = `${textFaint}${this.backend.version}${reset}`
    const footerVisible = cellWidth(footerWorkspace) + this.backend.version.length
    const footerLine = `${footer}${spaces(Math.max(2, columns - footerVisible))}${version}`

    const desiredTop = Math.max(1, Math.floor((rows - body.length - 2) / 2))
    const lines = [...Array.from({ length: desiredTop }, () => ''), ...body]
    while (lines.length < rows - 1) lines.push('')
    lines.push(footerLine)
    return lines.slice(0, rows)
  }

  private startAnimation(): void {
    if (this.animationTimer) return
    this.animationTimer = setInterval(() => this.tui.requestRender(), 140)
  }

  private stopAnimation(): void {
    if (!this.animationTimer) return
    clearInterval(this.animationTimer)
    this.animationTimer = undefined
  }

  private async submit(raw: string): Promise<void> {
    const line = raw.trim()
    if (!line || this.busy || this.approval) return
    this.editor.addToHistory?.(line)
    this.editor.setText('')
    this.notice = ''

    if (line === '/' || line === '/help') {
      this.notice = '/doctor 检查 · /workspace 路径 · /provider Brain · /agent Agent · /clear 清空 · /exit 退出'
      this.tui.requestRender()
      return
    }
    if (line === '/exit' || line === '/quit') {
      this.requestExit()
      return
    }
    if (line === '/clear') {
      this.transcript.length = 0
      this.notice = '会话显示已清空'
      this.tui.requestRender()
      return
    }
    if (line === '/workspace') {
      this.notice = `Workspace · ${this.backend.workspace}`
      this.tui.requestRender()
      return
    }
    if (line === '/provider') {
      this.notice = `Brain · ${this.backend.providerLabel}`
      this.tui.requestRender()
      return
    }
    if (line === '/agent') {
      this.notice = `Agent · ${this.backend.agentLabel}`
      this.tui.requestRender()
      return
    }
    if (line === '/doctor') {
      const items = await this.backend.doctor()
      this.notice = items.map(item => `${item.ok ? '●' : '○'} ${item.label}: ${item.detail}`).join('  ·  ')
      this.tui.requestRender()
      return
    }
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
    this.startAnimation()
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
      this.stopAnimation()
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
    this.stopAnimation()
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
  const surface = new XiaoyuSurface(toolkit, tui, terminal, backend)
  let stopped = false

  try {
    output.write(`${enterAltScreen}${setTitle('Xiaoyu')}${clearScreen}`)
    tui.addChild(surface)
    tui.setFocus(surface)
    tui.addInputListener((data: string) => {
      const ctrlC = toolkit.matchesKey(data, 'ctrl+c') || data === '\u0003'
      const escape = toolkit.matchesKey(data, 'escape') || data === '\u001b'
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
