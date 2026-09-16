/**
 * 文件作用：保留 Xiaoyu Terminal 的 Workspace Trust、共享纯合同/布局函数与迁移期 Pi TUI 历史回归兼容实现。
 * 关联模块：main.ts、apps/cli/opentui-runtime/app.tsx、brain.ts、旧 TUI 回归测试与 Workspace Trust。
 * 当前实现：Active 工作台已迁移到 Bun/OpenTUI；本文件继续提供 Workspace 风险确认、TerminalBackend/模式/菜单纯合同，并暂存不再由 main.ts 调用的旧 Pi TUI Renderer 以支持迁移期回归。
 * 职责边界：不得把本文件的 Pi TUI/手写 ANSI 光标与 mouse-reporting 重新接回 Active 工作台；Agent Loop、Provider、Session 与 Native 安全仍由各自 ownership 实现。
 */

import type { AgentWorkModeId } from 'xma-agent-loop'
import { homedir } from 'node:os'
import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { providerErrorPresentation, type JsonObject } from 'xma-ai'
import type { SessionRuntimeMetrics } from 'xma-session'
import type { PermissionProfileId, ToolApprovalDecision, ToolApprovalRequest } from 'xma-tools'
import type { TerminalBrainProfileView } from './brain.ts'
import { filterTuiMenuShortcutPrefix, moveTuiMenuSelection, projectTuiMenu, type TuiMenuItem } from './tui-menu.ts'

const ESC = '\u001b['
const reset = `${ESC}0m`
const bold = `${ESC}1m`
const blink = `${ESC}5m`
const underline = `${ESC}4m`
const orange = `${ESC}38;2;255;126;63m`
const text = `${ESC}38;2;226;226;226m`
const textSoft = `${ESC}38;2;164;164;164m`
const textFaint = `${ESC}38;2;98;98;98m`
const green = `${ESC}38;2;98;202;132m`
const blue = `${ESC}38;2;111;174;255m`
const yellow = `${ESC}38;2;224;190;72m`
const red = `${ESC}38;2;238;94;94m`
const clearScreen = `${ESC}2J${ESC}H`
const hideHardwareCursor = `${ESC}?25l`
const showHardwareCursor = `${ESC}?25h`
const enterAltScreen = `${ESC}?1049h`
const leaveAltScreen = `${ESC}?1049l`
export const terminalMouseCaptureSequence = `${ESC}?1000h${ESC}?1002h${ESC}?1003h${ESC}?1006h`
export const terminalMouseReleaseSequence = `${ESC}?1006l${ESC}?1003l${ESC}?1002l${ESC}?1000l`
const setTitle = (title: string) => `\u001b]0;${title}\u0007`
const TUI_PACKAGE = '@earendil-works/pi-tui'
const SPINNER = ['✦', '✧', '·', '✧'] as const
const HOME_TIPS = [
  'Ctrl+P 打开命令面板',
  'Ctrl+K 直接搜索命令',
  '输入 /+首字母筛选快捷命令',
  'Tab / Shift+Tab 切换工作模式',
  '↑↓ 浏览输入历史',
] as const

export function terminalHomeTip(index: number, providerConfigured: boolean, providerReady: boolean): string {
  if (!providerConfigured) return '模型未配置 · Ctrl+P → 模型 / 提供方，或输入 /provider'
  if (!providerReady) return '模型已配置 · 凭据未就绪 · Ctrl+P → 模型 / 提供方检查凭据'
  const normalized = ((index % HOME_TIPS.length) + HOME_TIPS.length) % HOME_TIPS.length
  return `模型已就绪 · ${HOME_TIPS[normalized]!}`
}

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

/**
 * Terminal slash 命令的唯一产品真值源。
 * Ctrl+P/Ctrl+K、slash prefix 居中命令面板与 /help 必须全部从这里派生，禁止再维护第二份命令表。
 */
const TERMINAL_COMMAND_CATALOG: readonly TuiMenuItem[] = [
  { value: 'help', label: '帮助', description: '查看全部快捷命令与用途说明', shortcut: '/help', keywords: ['help', 'commands', '帮助', '命令'] },
  { value: 'settings', label: '设置', description: '外观 / 特效 / 系统', shortcut: '/settings', keywords: ['terminal', 'settings', 'appearance', 'effects', 'system', '设置', '外观', '特效', '系统'] },
  { value: 'vivid', label: '切换丰富显示', description: '动态视觉 / 简洁模式', shortcut: '/vivid', keywords: ['visual', 'vivid'] },
  { value: 'doctor', label: '检查运行环境', description: '运行 Xiaoyu doctor', shortcut: '/doctor', keywords: ['doctor', '检查'] },
  { value: 'workspace', label: '工作区', description: '查看当前目录', shortcut: '/workspace', keywords: ['workspace', '目录'] },
  { value: 'provider', label: '模型 / 提供方', description: '配置模型与 API Key', shortcut: '/provider', keywords: ['provider', 'model', 'api key', 'deepseek', '模型', '提供方'] },
  { value: 'model', label: '模型切换', description: '切换当前真实模型', shortcut: '/model', keywords: ['model', 'deepseek', '模型'] },
  { value: 'permission', label: '权限 / 审批', description: '请求批准 / 替我审批 / 完全权限', shortcut: '/permission', keywords: ['permission', 'approval', '权限', '审批', '完全权限'] },
  { value: 'agent', label: '智能体', description: '查看当前智能体', shortcut: '/agent', keywords: ['agent', '智能体'] },
  { value: 'clear', label: '清空显示', description: '清空当前会话显示', shortcut: '/clear', keywords: ['clear', '清空'] },
  { value: 'exit', label: '退出 Xiaoyu', description: '返回父终端', shortcut: '/exit', keywords: ['exit', 'quit', '退出'] },
]

export interface TerminalUiSettings {
  visual: 'vivid' | 'minimal'
  tips: boolean
  logo: 'auto' | 'compact'
  stars: boolean
  meteors: boolean
  logoGradient: boolean
  permissionProfile: PermissionProfileId
}

export const DEFAULT_TERMINAL_UI_SETTINGS: Readonly<TerminalUiSettings> = Object.freeze({
  visual: 'vivid',
  tips: true,
  logo: 'auto',
  stars: true,
  meteors: true,
  logoGradient: true,
  permissionProfile: 'ask',
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

export function loadTerminalUiSettings(): TerminalUiSettings {
  try {
    const raw = JSON.parse(readFileSync(terminalSettingsPath(), 'utf8')) as Partial<TerminalUiSettings>
    return {
      visual: raw.visual === 'minimal' ? 'minimal' : 'vivid',
      tips: raw.tips !== false,
      logo: raw.logo === 'compact' ? 'compact' : 'auto',
      stars: raw.stars !== false,
      meteors: raw.meteors !== false,
      logoGradient: raw.logoGradient !== false,
      permissionProfile: raw.permissionProfile === 'smart' || raw.permissionProfile === 'full' ? raw.permissionProfile : 'ask',
    }
  } catch {
    return { ...DEFAULT_TERMINAL_UI_SETTINGS }
  }
}

export function saveTerminalUiSettings(settings: TerminalUiSettings): void {
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

export function needsInitialBrainSetup(providerConfigured: boolean): boolean {
  return !providerConfigured
}

export interface BrainProbeView {
  ready: boolean
  latencyMs: number
  message: string
}


export type TerminalAgentMode = AgentWorkModeId
export type TerminalReasoningEffort = 'default' | 'low' | 'high' | 'max'

export type TerminalRunEvent =
  | { type: 'text-delta'; stepId: string; text: string }
  | { type: 'reasoning-delta'; stepId: string; text: string }
  | { type: 'tool-call'; stepId: string; name: string; arguments: JsonObject }
  | { type: 'tool-result'; stepId: string; name: string; ok: boolean; content: string }

export interface TerminalActivityEntry {
  kind: 'status' | 'tool-call' | 'tool-result'
  text: string
  elapsedMs: number
  ok?: boolean
}

export interface TerminalActivitySummary {
  id: string
  startedAtMs: number
  elapsedMs: number
  outcome: 'running' | 'completed' | 'cancelled' | 'failed'
  expanded: boolean
  entries: readonly TerminalActivityEntry[]
}

export interface TerminalTranscriptItem {
  role: 'user' | 'assistant' | 'reasoning' | 'tool' | 'activity' | 'system'
  text: string
  stepId?: string
  placeholder?: boolean
  activity?: TerminalActivitySummary
  presentation?: 'command-help'
  menuItems?: readonly TuiMenuItem[]
}

function toolAction(name: string): string {
  if (name === 'native.fs.read_text') return '读取文件'
  if (name === 'native.fs.write_text') return '写入文件'
  if (name === 'native.process.run') return '运行程序'
  return '调用工具'
}

/**
 * 中文说明：把 Runtime live/durable 事件投影成纯 UI transcript。
 * 这里不保存 Session 事实；只负责让 reasoning/text/tool 在 TUI 中即时出现。
 */
export function applyTerminalRunEvent(transcript: TerminalTranscriptItem[], event: TerminalRunEvent): void {
  const placeholder = transcript[transcript.length - 1]
  if (placeholder?.placeholder === true) transcript.pop()

  if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
    const role = event.type === 'text-delta' ? 'assistant' : 'reasoning'
    const last = transcript[transcript.length - 1]
    if (last?.role === role && last.stepId === event.stepId) last.text += event.text
    else transcript.push({ role, stepId: event.stepId, text: event.text })
    return
  }

  if (event.type === 'tool-call') {
    transcript.push({ role: 'tool', stepId: event.stepId, text: `⏺ ${toolAction(event.name)} · ${event.name}` })
    return
  }

  const compact = event.content.replace(/\s+/g, ' ').trim()
  const summary = compact.length > 160 ? `${compact.slice(0, 157)}…` : compact
  transcript.push({
    role: 'tool',
    stepId: event.stepId,
    text: `${event.ok ? '⎿ ✓' : '⎿ ✗'} ${event.name}${summary ? ` · ${summary}` : ''}`,
  })
}

export function cycleTerminalAgentMode(current: TerminalAgentMode, direction: 1 | -1 = 1): TerminalAgentMode {
  const order: readonly TerminalAgentMode[] = ['build', 'plan', 'compose']
  const index = order.indexOf(current)
  return order[(index + direction + order.length) % order.length]!
}

function modeLabel(mode: TerminalAgentMode): string {
  return mode === 'build' ? 'Build' : mode === 'plan' ? 'Plan' : 'Compose'
}

function modeColor(mode: TerminalAgentMode): string {
  return mode === 'build' ? orange : mode === 'plan' ? green : blue
}

function modeDescription(mode: TerminalAgentMode): string {
  if (mode === 'build') return '完整工具模式'
  if (mode === 'plan') return '只读规划 · 无写入/执行工具'
  return '纯模型对话 · legacy'
}

function reasoningColor(effort: TerminalReasoningEffort): string {
  if (effort === 'max') return red
  if (effort === 'high') return yellow
  if (effort === 'low') return green
  return textSoft
}

export interface BrainProviderCatalogItem {
  id: string
  displayName: string
  description: string
  credentialRequired: boolean
  customEndpoint: boolean
}

export interface TerminalTurnResult {
  text: string
  mode: TerminalAgentMode
  plan?: { turnId: string; content: string; decision?: 'yes' | 'no' }
}

export interface TerminalBackend {
  version: string
  workspace: string
  agentLabel: string
  readonly providerLabel: string
  readonly providerConfigured: boolean
  readonly providerReady: boolean
  readonly reasoningSupported: boolean
  readonly reasoningEffort: TerminalReasoningEffort
  readonly sessionMetrics: SessionRuntimeMetrics
  readonly permissionProfile: PermissionProfileId
  setPermissionProfile(profile: PermissionProfileId): void
  listBrainProviderCatalog(): readonly BrainProviderCatalogItem[]
  listBrainProfiles(): readonly TerminalBrainProfileView[]
  saveBrainProfile(input: {
    providerId: string
    displayName?: string
    baseUrl?: string
    model?: string
    apiKey?: string
    credentialEnv?: string
  }): Promise<TerminalBrainProfileView>
  selectBrain(profileId: string): Promise<TerminalBrainProfileView>
  listBrainModels(): Promise<readonly string[]>
  selectBrainModel(model: string): Promise<TerminalBrainProfileView>
  selectBrainReasoning(effort: TerminalReasoningEffort): Promise<TerminalBrainProfileView>
  probeBrain(): Promise<BrainProbeView>
  sendMessage(
    input: string,
    mode: TerminalAgentMode,
    onEvent: (event: TerminalRunEvent) => void,
    signal: AbortSignal,
    approve: (request: ToolApprovalRequest, signal: AbortSignal) => Promise<ToolApprovalDecision>,
  ): Promise<TerminalTurnResult>
  decideLatestPlan(decision: 'yes' | 'no'): Promise<{ turnId: string; content: string; decision: 'yes' | 'no' } | undefined>
  doctor(): Promise<readonly DoctorItem[]>
  close(): Promise<void>
}

export interface WorkspaceRisk {
  risky: boolean
  level: 'normal' | 'home' | 'root' | 'system'
  reason?: string
}

interface Viewport {
  columns: number
  rows: number
}

interface PiTuiToolkit {
  TUI: new (terminal: unknown, showHardwareCursor?: boolean) => any
  ProcessTerminal: new () => any
  CURSOR_MARKER: string
  Box: new (paddingX?: number, paddingY?: number, bgFn?: (value: string) => string) => any
  visibleWidth(value: string): number
  matchesKey(data: string, key: string): boolean
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


function stripAnsi(value: string): string {
  return value.replace(/\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function visibleCellWidth(value: string): number {
  return cellWidth(stripAnsi(value))
}

function centeredBlockIndent(columns: number, lines: readonly string[], minPadding = 2): string {
  const widest = lines.reduce((max, line) => Math.max(max, visibleCellWidth(line)), 0)
  return spaces(Math.max(minPadding, Math.floor((columns - widest) / 2)))
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

/** 流式消息显示最新尾部，避免长回复超过固定行数后视觉上“卡住”。 */
function wrapTailPlain(value: string, maxWidth: number, maxLines: number): string[] {
  const source = value.length > 6000 ? value.slice(-6000) : value
  const normalized = source.replace(/\r/g, '')
  const lines: string[] = []
  for (const sourceLine of normalized.split('\n')) {
    let remaining = sourceLine
    if (!remaining) {
      lines.push('')
      continue
    }
    while (remaining) {
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
  }
  return lines.slice(-maxLines)
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

export function terminalContentWidth(columns: number): number {
  const safeColumns = Math.max(40, columns)
  const sidePadding = safeColumns >= 72 ? 20 : 8
  return Math.max(40, Math.min(132, safeColumns - sidePadding))
}

export interface TerminalHomeLayout {
  logoTop: number
  promptEnd: number
  showIdentity: boolean
  hintRow?: number
  tipRow?: number
}

/**
 * 中文说明：Home 的纵向节奏由一个纯函数统一计算，避免 Overlay、Prompt、提示区各自抢行。
 * Overlay 打开时进入 modal focus：底部只保留紧凑状态 Dock，把主要空间让给操作面板。
 */
export function terminalHomeLayout(rows: number, overlayOpen = false, tips = true): TerminalHomeLayout {
  const safeRows = Math.max(20, rows)
  const logoTop = Math.max(2, Math.min(5, Math.floor(safeRows * 0.10)))
  if (overlayOpen) {
    return { logoTop, promptEnd: safeRows - 3, showIdentity: false }
  }

  const tipRow = tips && safeRows >= 26 ? safeRows - 4 : undefined
  const hintRow = tipRow === undefined ? safeRows - 3 : tipRow - 3
  return {
    logoTop,
    showIdentity: true,
    // Prompt 与快捷键、提示区之间保留至少一行空气；高终端再多留一行，避免所有组件堆在底部。
    promptEnd: hintRow - (tipRow === undefined ? 2 : 3),
    hintRow,
    ...(tipRow === undefined ? {} : { tipRow }),
  }
}

export interface TerminalChatLayout {
  promptEnd: number
  hintRow?: number
}

/** 对话态底部 Dock 整体上移一行，为固定 footer 留出独立呼吸行。 */
export function terminalChatLayout(rows: number, overlayOpen = false): TerminalChatLayout {
  const safeRows = Math.max(20, rows)
  if (overlayOpen) return { promptEnd: safeRows - 3 }
  const hintRow = safeRows - 3
  return { promptEnd: hintRow - 2, hintRow }
}

export function shouldReturnChatToHome(transcriptCount: number, busy: boolean, overlayOpen: boolean): boolean {
  return transcriptCount > 0 && !busy && !overlayOpen
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

interface TerminalHintSegment {
  plain: string
  styled: string
}

function distributeHintSegments(width: number, segments: readonly TerminalHintSegment[]): string {
  if (segments.length === 0) return ''
  const total = segments.reduce((sum, segment) => sum + cellWidth(segment.plain), 0)
  if (segments.length === 1) {
    const outer = Math.max(0, width - total)
    const left = Math.floor(outer / 2)
    return `${spaces(left)}${segments[0]!.styled}${spaces(outer - left)}`
  }
  const available = Math.max(segments.length - 1, width - total)
  const gap = Math.max(1, Math.floor(available / (segments.length - 1)))
  const used = total + gap * (segments.length - 1)
  const outer = Math.max(0, width - used)
  const left = Math.floor(outer / 2)
  let output = spaces(left)
  segments.forEach((segment, index) => {
    output += segment.styled
    if (index < segments.length - 1) output += spaces(gap)
  })
  return `${output}${spaces(outer - left)}`
}

function terminalHintSegments(showEsc: boolean): readonly (readonly TerminalHintSegment[])[] {
  const tabFull = { plain: 'tab / shift+tab 切换模式', styled: `${bold}tab / shift+tab${reset} ${textSoft}切换模式${reset}` }
  const tabCompact = { plain: 'tab 模式', styled: `${bold}tab${reset} ${textSoft}模式${reset}` }
  const command = { plain: 'ctrl+p 命令', styled: `${bold}ctrl+p${reset} ${textSoft}命令${reset}` }
  const search = { plain: 'ctrl+k 搜索', styled: `${bold}ctrl+k${reset} ${textSoft}搜索${reset}` }
  const slash = { plain: '/ 快捷命令', styled: `${bold}/${reset} ${textSoft}快捷命令${reset}` }
  const cancel = { plain: 'ctrl+c 中止', styled: `${bold}ctrl+c${reset} ${textSoft}中止${reset}` }
  const back = { plain: 'esc 返回', styled: `${bold}esc${reset} ${textSoft}返回${reset}` }
  const withBack = (segments: readonly TerminalHintSegment[]) => showEsc ? [...segments, back] : segments
  return [
    withBack([tabFull, command, search, slash, cancel]),
    withBack([tabCompact, command, search, slash, cancel]),
    withBack([command, search, slash, cancel]),
    withBack([command, search, cancel]),
    withBack([command]),
    ...(showEsc ? [[back] as const] : []),
  ]
}

function chooseTerminalHintSegments(width: number, showEsc: boolean): readonly TerminalHintSegment[] {
  for (const segments of terminalHintSegments(showEsc)) {
    const total = segments.reduce((sum, segment) => sum + cellWidth(segment.plain), 0)
    if (total + Math.max(0, segments.length - 1) * 2 <= width) return segments
  }
  return terminalHintSegments(showEsc).at(-1) ?? []
}

export function terminalHintPlainLine(width: number, showEsc = false): string {
  const segments = chooseTerminalHintSegments(width, showEsc)
  return distributeHintSegments(width, segments.map(segment => ({ ...segment, styled: segment.plain })))
}

function renderHintLine(width: number, showEsc = false): string {
  return distributeHintSegments(width, chooseTerminalHintSegments(width, showEsc))
}

export function commandPaletteOptions(): readonly TuiMenuItem[] {
  return TERMINAL_COMMAND_CATALOG.map(item => ({ ...item }))
}

export function terminalCommandHelpText(): string {
  return TERMINAL_COMMAND_CATALOG
    .map(item => `${item.shortcut ?? `/${item.value}`}  ${item.label} · ${item.description ?? ''}`.trimEnd())
    .join('\n')
}

/**
 * 中文说明：Windows Terminal 在应用启用 SGR mouse reporting 后会把普通左键拖动交给 Xiaoyu，
 * 从而避免 TUI 文字被宿主终端选成大片白底；Shift+拖动仍由宿主终端保留为主动选择文本的逃生通道。
 */
export function isTerminalMouseInput(data: string): boolean {
  return data.startsWith('\u001b[<') || data.startsWith('\u001b[M')
}

export function toggleTerminalVisual(settings: TerminalUiSettings): TerminalUiSettings {
  return { ...settings, visual: settings.visual === 'vivid' ? 'minimal' : 'vivid' }
}

export function workspaceRisk(workspace: string): WorkspaceRisk {
  const normalized = normalizeForCompare(workspace)
  const home = normalizeForCompare(homedir())
  const root = normalizeForCompare(path.parse(path.resolve(workspace)).root)
  const windowsLike = workspace.replace(/\//g, '\\').replace(/\\+$/g, '')
  if (/^[A-Za-z]:\\Windows(?:\\|$)/i.test(windowsLike)) {
    return { risky: true, level: 'system', reason: '当前工作区位于 Windows 系统目录。' }
  }
  if (normalized === root) {
    return { risky: true, level: 'root', reason: '当前工作区是文件系统根目录，范围过大。' }
  }
  if (normalized === home) {
    return { risky: true, level: 'home', reason: '当前工作区是用户主目录。' }
  }
  return { risky: false, level: 'normal' }
}

export type WorkspaceTrustSelection = 'exit' | 'trust'

export function workspaceTrustDefaultSelection(risk: WorkspaceRisk): WorkspaceTrustSelection {
  return risk.risky ? 'exit' : 'trust'
}

export function renderWorkspaceTrustPrompt(
  workspace: string,
  risk = workspaceRisk(workspace),
  selected: WorkspaceTrustSelection = workspaceTrustDefaultSelection(risk),
): string {
  const exitMark = selected === 'exit' ? `${green}●${reset}` : `${textFaint}○${reset}`
  const trustMark = selected === 'trust' ? `${green}●${reset}` : `${textFaint}○${reset}`
  const lines = [
    '',
    `${orange}${bold}XIAOYU${reset}${textSoft} · Xiaoyu Management Agent${reset}`,
    '',
    `${textSoft}访问工作区：${reset}`,
    '',
    `${text}${workspace}${reset}`,
    '',
    `${text}${bold}安全确认：${reset}`,
    `${text}这是你自己创建或信任的工作区吗？${reset}`,
    '',
    `${textSoft}Xiaoyu 在获得授权后可能读取、编辑此目录中的文件，${reset}`,
    `${textSoft}并根据当前 Tool Policy 执行允许的操作。${reset}`,
  ]

  if (risk.risky) {
    const label = risk.level === 'home' ? '用户主目录' : risk.level === 'system' ? 'Windows 系统目录' : '文件系统根目录'
    lines.push(
      '',
      `${yellow}${bold}▲  高风险工作区：${label}${reset}`,
      `${textSoft}${risk.reason ?? '当前目录范围较大或包含敏感系统内容。'}${reset}`,
      `${red}除非你明确需要，否则建议退出并在具体项目目录重新运行 Xiaoyu。${reset}`,
    )
  }

  lines.push(
    '',
    `${trustMark} ${text}${selected === 'trust' ? bold : ''}是的，我信任此目录${reset}`,
    `${exitMark} ${textSoft}${selected === 'exit' ? bold : ''}否，退出${reset}`,
    '',
    `${textFaint}↑↓ / Tab 选择 · Enter 确认 · 本次授权不会跳过下次启动确认${reset}`,
    '',
  )
  return lines.join('\n')
}

export function renderHome(
  backend: Pick<TerminalBackend, 'version' | 'workspace' | 'agentLabel' | 'providerLabel' | 'providerReady'>,
  size: Viewport = viewport(),
): string {
  const width = terminalContentWidth(size.columns)
  const left = Math.max(0, Math.floor((size.columns - width) / 2))
  const indent = spaces(left)
  const provider = backend.providerLabel
  const card = [
    `${indent}${orange}▌${reset} ${textFaint}输入消息…（输入 / 唤起命令）${reset}`,
    `${indent}${orange}▌${reset}`,
    `${indent}${orange}▌${reset} ${orange}${bold}Build${reset}${text} · ${backend.agentLabel}${reset}   ${backend.providerReady ? green : yellow}${backend.providerReady ? '●' : '○'}${reset}${textSoft} ${provider}${reset}`,
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
    output.write(renderWorkspaceTrustPrompt(workspace, risk))
    const answer = (await rl.question(`${orange}请选择 1=信任当前目录 / 2=退出：${reset}`)).trim()
    return answer === '1'
  } finally {
    rl.close()
  }
}

export async function confirmWorkspaceTrust(workspace: string): Promise<boolean> {
  const risk = workspaceRisk(workspace)
  if (!input.isTTY || !output.isTTY) return false
  if (!input.setRawMode) return confirmWorkspaceTrustFallback(workspace, risk)

  const previousRaw = Boolean(input.isRaw)
  let selected: WorkspaceTrustSelection = workspaceTrustDefaultSelection(risk)
  let settled = false
  let accepted = false

  const draw = (): void => {
    output.write(`${clearScreen}${setTitle('Xiaoyu · Workspace Trust')}${renderWorkspaceTrustPrompt(workspace, risk, selected)}`)
  }

  try {
    input.setEncoding('utf8')
    input.setRawMode(true)
    input.resume()
    // Workspace Trust 仍是 OpenTUI 启动前的安全确认。Windows Text Cursor Indicator 会追踪硬件光标，
    // 因此 raw 选择界面期间显式隐藏硬件光标，避免出现蓝色上下标记；退出 Trust 后立即恢复。
    output.write(`${terminalMouseCaptureSequence}${hideHardwareCursor}`)
    draw()
    accepted = await new Promise<boolean>(resolve => {
      const finish = (value: boolean): void => {
        if (settled) return
        settled = true
        input.removeListener('data', onData)
        resolve(value)
      }
      const onData = (chunk: string | Buffer): void => {
        const data = String(chunk)
        if (isTerminalMouseInput(data)) return
        if (data === '\u0003' || data === '\u001b') return finish(false)
        if (data === '\u001b[A' || data === '\u001b[B' || data === '\t' || data === ' ') {
          selected = selected === 'exit' ? 'trust' : 'exit'
          draw()
          return
        }
        if (data === '1') {
          selected = 'trust'
          draw()
          return
        }
        if (data === '2') {
          selected = 'exit'
          draw()
          return
        }
        if (data === '\r' || data === '\n') finish(selected === 'trust')
      }
      input.on('data', onData)
    })
    return accepted
  } finally {
    input.setRawMode(previousRaw)
    if (!previousRaw) input.pause()
    // Trust 结束后始终把 terminal cursor 恢复给下一层。接受时由 OpenTUI/Textarea 接管真实 cursor，
    // 取消时则直接交还父 shell；禁止把隐藏 cursor 状态跨 Runtime 边界泄漏。
    output.write(`${terminalMouseReleaseSequence}${reset}${clearScreen}${showHardwareCursor}`)
  }
}

export function approvalDecision(answer: string): ToolApprovalDecision {
  const normalized = answer.trim().toLowerCase()
  if (normalized === 'y' || normalized === 'yes' || normalized === '2') return 'allow-once'
  return 'deny'
}

export function slashCommandSuggestions(prefix: string): readonly TuiMenuItem[] {
  return filterTuiMenuShortcutPrefix(TERMINAL_COMMAND_CATALOG, prefix).map(command => ({ ...command }))
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function previousGraphemeIndex(value: string, cursor: number): number {
  if (cursor <= 0) return 0
  let previous = 0
  for (const segment of graphemeSegmenter.segment(value.slice(0, cursor))) previous = segment.index
  return previous
}

function nextGraphemeIndex(value: string, cursor: number): number {
  if (cursor >= value.length) return value.length
  const segment = graphemeSegmenter.segment(value.slice(cursor))[Symbol.iterator]().next().value as Intl.SegmentData | undefined
  return segment ? cursor + segment.segment.length : Math.min(value.length, cursor + 1)
}

function sliceCells(value: string, startCell: number, width: number): string {
  if (width <= 0) return ''
  let cell = 0
  let out = ''
  for (const char of value) {
    const charWidth = isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1
    const next = cell + charWidth
    if (next <= startCell) {
      cell = next
      continue
    }
    if (cell >= startCell + width || next > startCell + width) break
    out += char
    cell = next
  }
  return out
}

function cursorCell(value: string, index: number): number {
  return cellWidth(value.slice(0, Math.max(0, Math.min(index, value.length))))
}

/**
 * Windows Terminal 安全 Prompt：主工作台完全不输出 Pi TUI CURSOR_MARKER，避免 Windows 文本光标指示器
 * 在终端边缘显示蓝色上下标记。可见输入焦点全部由 XMA 自己绘制软光标/闪烁首字，硬件光标始终隐藏。
 */
export class SafePromptInput {
  focused = false
  disableSubmit = false
  onSubmit?: (value: string) => void
  onChange?: (value: string) => void
  private value = ''
  private cursor = 0
  private history: string[] = []
  private historyIndex = -1
  private pasteBuffer = ''
  private pasting = false
  private selectedSuggestion = 0

  constructor(private readonly toolkit: PiTuiToolkit) {}

  invalidate(): void {
    // Prompt 不缓存渲染结果；保留 Component 兼容方法。
  }

  getText(): string {
    return this.value
  }

  setText(value: string): void {
    this.value = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '    ')
    this.cursor = this.value.length
    this.historyIndex = -1
    this.selectedSuggestion = 0
    this.onChange?.(this.value)
  }

  addToHistory(value: string): void {
    const trimmed = value.trim()
    if (!trimmed || this.history[0] === trimmed) return
    this.history.unshift(trimmed)
    if (this.history.length > 100) this.history.pop()
  }

  suggestions(): readonly TuiMenuItem[] {
    const trimmed = this.value.trimStart()
    if (!trimmed.startsWith('/') || trimmed.includes(' ')) return []
    return slashCommandSuggestions(trimmed)
  }

  selectedSuggestionIndex(): number {
    const items = this.suggestions()
    return items.length === 0 ? -1 : Math.min(this.selectedSuggestion, items.length - 1)
  }

  private emitChange(): void {
    this.selectedSuggestion = 0
    this.onChange?.(this.value)
  }

  private insert(value: string): void {
    this.value = this.value.slice(0, this.cursor) + value + this.value.slice(this.cursor)
    this.cursor += value.length
    this.emitChange()
  }

  private deleteBackward(): void {
    if (this.cursor <= 0) return
    const previous = previousGraphemeIndex(this.value, this.cursor)
    this.value = this.value.slice(0, previous) + this.value.slice(this.cursor)
    this.cursor = previous
    this.emitChange()
  }

  private deleteForward(): void {
    if (this.cursor >= this.value.length) return
    const next = nextGraphemeIndex(this.value, this.cursor)
    this.value = this.value.slice(0, this.cursor) + this.value.slice(next)
    this.emitChange()
  }

  private navigateHistory(direction: -1 | 1): void {
    if (this.value.includes('\n') || this.history.length === 0) return
    const next = this.historyIndex + (direction === -1 ? 1 : -1)
    if (next < -1 || next >= this.history.length) return
    this.historyIndex = next
    this.value = next === -1 ? '' : this.history[next] ?? ''
    this.cursor = this.value.length
    this.emitChange()
  }

  private applySelectedSuggestion(): boolean {
    const items = this.suggestions()
    if (items.length === 0) return false
    const item = items[Math.min(this.selectedSuggestion, items.length - 1)]
    if (!item) return false
    this.value = `/${item.value} `
    this.cursor = this.value.length
    this.selectedSuggestion = 0
    this.onChange?.(this.value)
    return true
  }

  private submit(): void {
    if (this.disableSubmit) return
    const result = this.value.trim()
    if (!result) return
    this.onSubmit?.(result)
  }

  handleInput(data: string): void {
    if (data.includes('\u001b[200~')) {
      this.pasting = true
      this.pasteBuffer = ''
      data = data.replace('\u001b[200~', '')
    }
    if (this.pasting) {
      this.pasteBuffer += data
      const end = this.pasteBuffer.indexOf('\u001b[201~')
      if (end < 0) return
      const pasted = this.pasteBuffer.slice(0, end).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '    ')
      const rest = this.pasteBuffer.slice(end + 6)
      this.pasteBuffer = ''
      this.pasting = false
      this.insert(pasted)
      if (rest) this.handleInput(rest)
      return
    }

    const suggestions = this.suggestions()
    const exactSlash = suggestions.some(item => `/${item.value}` === this.value.trim())
    if (suggestions.length > 0 && (this.toolkit.matchesKey(data, 'up') || data === '\u001b[A')) {
      this.selectedSuggestion = (this.selectedSuggestion - 1 + suggestions.length) % suggestions.length
      this.onChange?.(this.value)
      return
    }
    if (suggestions.length > 0 && (this.toolkit.matchesKey(data, 'down') || data === '\u001b[B')) {
      this.selectedSuggestion = (this.selectedSuggestion + 1) % suggestions.length
      this.onChange?.(this.value)
      return
    }
    if (suggestions.length > 0 && (this.toolkit.matchesKey(data, 'tab') || data === '\t')) {
      this.applySelectedSuggestion()
      return
    }
    if (!exactSlash && suggestions.length > 0 && (this.toolkit.matchesKey(data, 'enter') || data === '\r')) {
      this.applySelectedSuggestion()
      return
    }

    if (this.toolkit.matchesKey(data, 'shift+enter') || this.toolkit.matchesKey(data, 'ctrl+enter') || this.toolkit.matchesKey(data, 'alt+enter') || data === '\u001b\r') {
      this.insert('\n')
      return
    }
    if (this.toolkit.matchesKey(data, 'enter') || data === '\r' || data === '\n') {
      this.submit()
      return
    }
    if (this.toolkit.matchesKey(data, 'backspace') || data === '\u007f' || data === '\b') {
      this.deleteBackward()
      return
    }
    if (this.toolkit.matchesKey(data, 'delete') || data === '\u001b[3~') {
      this.deleteForward()
      return
    }
    if (this.toolkit.matchesKey(data, 'left') || data === '\u001b[D') {
      this.cursor = previousGraphemeIndex(this.value, this.cursor)
      this.onChange?.(this.value)
      return
    }
    if (this.toolkit.matchesKey(data, 'right') || data === '\u001b[C') {
      this.cursor = nextGraphemeIndex(this.value, this.cursor)
      this.onChange?.(this.value)
      return
    }
    if (this.toolkit.matchesKey(data, 'up') || data === '\u001b[A') {
      this.navigateHistory(-1)
      return
    }
    if (this.toolkit.matchesKey(data, 'down') || data === '\u001b[B') {
      this.navigateHistory(1)
      return
    }
    if (this.toolkit.matchesKey(data, 'ctrl+a') || data === '\u0001') {
      const lineStart = this.value.lastIndexOf('\n', Math.max(0, this.cursor - 1)) + 1
      this.cursor = lineStart
      this.onChange?.(this.value)
      return
    }
    if (this.toolkit.matchesKey(data, 'ctrl+e') || data === '\u0005') {
      const nextLine = this.value.indexOf('\n', this.cursor)
      this.cursor = nextLine < 0 ? this.value.length : nextLine
      this.onChange?.(this.value)
      return
    }
    if (this.toolkit.matchesKey(data, 'ctrl+u') || data === '\u0015') {
      const start = this.value.lastIndexOf('\n', Math.max(0, this.cursor - 1)) + 1
      this.value = this.value.slice(0, start) + this.value.slice(this.cursor)
      this.cursor = start
      this.emitChange()
      return
    }
    if (this.toolkit.matchesKey(data, 'ctrl+k') || data === '\u000b') {
      const end = this.value.indexOf('\n', this.cursor)
      this.value = this.value.slice(0, this.cursor) + (end < 0 ? '' : this.value.slice(end))
      this.emitChange()
      return
    }
    if (this.toolkit.matchesKey(data, 'ctrl+w') || data === '\u0017') {
      let start = this.cursor
      while (start > 0 && /\s/.test(this.value[start - 1] ?? '')) start -= 1
      while (start > 0 && !/\s/.test(this.value[start - 1] ?? '')) start -= 1
      this.value = this.value.slice(0, start) + this.value.slice(this.cursor)
      this.cursor = start
      this.emitChange()
      return
    }

    if (data.includes('\u001b') || [...data].some(char => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f)
    })) return
    if (data) this.insert(data)
  }

  private renderValue(value: string, cursor: number, width: number): string[] {
    const safeWidth = Math.max(4, width)
    const lines = value.split('\n')
    const beforeCursor = value.slice(0, cursor)
    const cursorLine = beforeCursor.split('\n').length - 1
    const cursorCol = beforeCursor.slice(beforeCursor.lastIndexOf('\n') + 1).length
    const firstVisible = Math.max(0, Math.min(cursorLine - 2, Math.max(0, lines.length - 4)))
    const visible = lines.slice(firstVisible, firstVisible + 4)
    const rendered: string[] = []

    visible.forEach((line, visibleIndex) => {
      const logicalIndex = firstVisible + visibleIndex
      if (logicalIndex !== cursorLine) {
        rendered.push(truncateCells(line, safeWidth))
        return
      }
      const cursorVisual = cursorCell(line, cursorCol)
      const startCell = Math.max(0, cursorVisual - safeWidth + 2)
      const before = sliceCells(line, startCell, Math.max(0, cursorVisual - startCell))
      if (!this.focused) {
        const afterWidth = Math.max(0, safeWidth - cellWidth(before))
        rendered.push(`${before}${sliceCells(line.slice(cursorCol), 0, afterWidth)}`)
        return
      }

      const cursorEnd = nextGraphemeIndex(line, cursorCol)
      const atCursor = line.slice(cursorCol, cursorEnd) || ' '
      const atCursorWidth = Math.max(1, cellWidth(atCursor))
      const afterWidth = Math.max(0, safeWidth - cellWidth(before) - atCursorWidth)
      const after = sliceCells(line.slice(cursorEnd), 0, afterWidth)
      const softCursor = `${orange}${underline}${atCursor}${reset}`
      rendered.push(`${before}${softCursor}${after}`)
    })

    if (rendered.length === 0) rendered.push(this.focused ? `${orange}${underline} ${reset}` : '')
    return rendered
  }

  render(width: number): string[] {
    return this.renderValue(this.value, this.cursor, width)
  }

  renderSecret(width: number): string[] {
    const mask = (value: string): string => {
      let out = ''
      for (const segment of graphemeSegmenter.segment(value)) out += segment.segment === '\n' ? '\n' : '•'
      return out
    }
    const before = mask(this.value.slice(0, this.cursor))
    const after = mask(this.value.slice(this.cursor))
    return this.renderValue(`${before}${after}`, before.length, width)
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
  readonly editor: SafePromptInput
  private readonly transcript: TerminalTranscriptItem[] = []
  private _notice = ''
  private noticeExpiresAt = 0
  private busy = false
  private activeController: AbortController | undefined
  private approval: ApprovalWaiter | undefined
  private exitResolve: (() => void) | undefined
  private animationTimer: ReturnType<typeof setInterval> | undefined
  private tipTimer: ReturnType<typeof setInterval> | undefined
  private starPhase = 0
  private tipIndex = 0
  private settings: TerminalUiSettings = { ...DEFAULT_TERMINAL_UI_SETTINGS }
  private overlayOpen = false
  private initialBrainSetupActive = false
  private agentMode: TerminalAgentMode = 'build'
  private forcedStreamRenderTimer: ReturnType<typeof setTimeout> | undefined
  private lastForcedStreamRenderAt = 0

  constructor(
    private readonly toolkit: PiTuiToolkit,
    private readonly tui: any,
    private readonly terminal: any,
    private readonly backend: TerminalBackend,
    initialSettings: TerminalUiSettings,
  ) {
    this.settings = { ...initialSettings }
    this.editor = new SafePromptInput(toolkit)
    this.editor.onChange = () => this.tui.requestRender()
    this.editor.onSubmit = (value: string) => { void this.submit(value) }

    this.animationTimer = setInterval(() => {
      if (this.settings.visual !== 'vivid' && !this.busy) return
      this.starPhase = (this.starPhase + 1) % 10_000
      this.tui.requestRender()
    }, 420)
    this.tipTimer = setInterval(() => {
      if (!this.settings.tips || this.overlayOpen || this.transcript.length > 0 || this.busy) return
      this.tipIndex = (this.tipIndex + 1) % HOME_TIPS.length
      this.tui.requestRender()
    }, 5_500)
  }

  private get notice(): string {
    return this._notice
  }

  private set notice(value: string) {
    this._notice = value
    this.noticeExpiresAt = value ? Date.now() + 5_500 : 0
  }

  private activeNotice(): string {
    return this.notice && Date.now() < this.noticeExpiresAt ? this.notice : ''
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

  /**
   * pi-tui 0.74.0 的差分渲染在“只追加聊天区域”的流式场景中可能出现漏刷。
   * 每个增量仍请求普通 render，并最多每 80ms 强制一次 full repaint；既保证实时性，也避免每个 token 都清屏。
   */
  private requestLiveRender(): void {
    this.tui.requestRender()
    const now = Date.now()
    const intervalMs = 80
    const elapsed = now - this.lastForcedStreamRenderAt
    if (elapsed >= intervalMs) {
      this.lastForcedStreamRenderAt = now
      this.tui.requestRender(true)
      return
    }
    if (this.forcedStreamRenderTimer) return
    this.forcedStreamRenderTimer = setTimeout(() => {
      this.forcedStreamRenderTimer = undefined
      this.lastForcedStreamRenderAt = Date.now()
      this.tui.requestRender(true)
    }, Math.max(1, intervalMs - elapsed))
  }

  handleInput(data: string): void {
    if (this.approval) {
      const normalized = data.toLowerCase()
      const decision = normalized === 'y' || data === '2' ? 'allow-once' : normalized === 'n' || data === '1' || data === '\u001b' ? 'deny' : undefined
      if (decision) this.resolveApproval(decision)
      return
    }
    const hasSlashSuggestions = this.editor.suggestions().length > 0
    if (!this.overlayOpen && !this.busy && !hasSlashSuggestions) {
      const backward = this.toolkit.matchesKey(data, 'shift+tab') || data === '\u001b[Z'
      const forward = this.toolkit.matchesKey(data, 'tab') || data === '\t'
      if (backward || forward) {
        this.agentMode = cycleTerminalAgentMode(this.agentMode, backward ? -1 : 1)
        this.notice = `模式已切换 · ${modeLabel(this.agentMode)} · ${modeDescription(this.agentMode)}`
        this.tui.requestRender()
        return
      }
    }
    this.editor.handleInput(data)
  }

  back(): boolean {
    if (!shouldReturnChatToHome(this.transcript.length, Boolean(this.activeController), this.overlayOpen)) return false
    this.editor.setText('')
    this.transcript.length = 0
    this.notice = ''
    this.tui.requestRender()
    return true
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
      this.notice = ''
      this.tui.requestRender()
      return true
    }
    return false
  }

  render(width: number): string[] {
    const columns = Math.max(40, width)
    const rows = Math.max(20, this.terminal.rows ?? 24)
    const cardWidth = terminalContentWidth(columns)
    const screen = Array.from({ length: rows }, () => '')

    const place = (row: number, lines: readonly string[]): void => {
      for (let index = 0; index < lines.length; index += 1) {
        const target = row + index
        if (target >= 0 && target < rows - 1) screen[target] = lines[index] ?? ''
      }
    }

    const fullPromptContent = this.renderPromptCard(cardWidth)
    const compactOverlayContent = [`${orange}▌${reset} ${this.renderPromptStatus(Math.max(24, cardWidth - 3))}`]
    const promptContent = this.overlayOpen ? compactOverlayContent : fullPromptContent
    const hintContent = renderHintLine(cardWidth, this.transcript.length > 0)
    const homeTip = this.busy
      ? `${SPINNER[Math.floor(Date.now() / 180) % SPINNER.length]!} Xiaoyu 正在工作；Ctrl+C 中止`
      : this.activeNotice() || terminalHomeTip(this.tipIndex, this.backend.providerConfigured, this.backend.providerReady)
    const clippedTip = truncateCells(homeTip, Math.max(12, cardWidth - 12))
    const tipContent = `${orange}●  提示${reset}${textSoft}  ${clippedTip}${reset}`
    const dockIndent = centeredBlockIndent(columns, [...promptContent, hintContent, tipContent], 2)
    const promptLines = promptContent.map(line => `${dockIndent}${line}`)
    const hintLine = `${dockIndent}${hintContent}`
    const tipLine = `${dockIndent}${tipContent}`

    if (this.transcript.length === 0) {
      const layout = terminalHomeLayout(rows, this.overlayOpen, this.settings.tips)
      const logoTop = layout.logoTop
      if (layout.showIdentity) {
        const logo = renderLogo(columns, this.settings.logo)
        if (this.settings.visual === 'vivid') screen[Math.max(1, logoTop - 2)] = renderStars(columns, this.starPhase)
        place(logoTop, logo)
        const sloganRow = Math.min(rows - 10, logoTop + logo.length + 1)
        screen[sloganRow] = centerPlain('Model is replaceable. Agent is ours.', columns)
          .replace('Model is replaceable. Agent is ours.', `${textFaint}Model is replaceable. Agent is ours.${reset}`)
      }

      // Home 使用固定底锚点；Overlay 打开时进入 modal focus，只保留一行状态 Dock，背景 Logo/星点/口号全部隐藏，避免与面板互相穿透。
      place(layout.promptEnd - promptLines.length + 1, promptLines)
      if (layout.hintRow !== undefined) screen[layout.hintRow] = hintLine
      if (layout.tipRow !== undefined) screen[layout.tipRow] = tipLine
    } else {
      // 对话态底部 Dock 整体上移，为 footer 留出独立呼吸行；Overlay 打开时仍进入 modal focus。
      const chatLayout = terminalChatLayout(rows, this.overlayOpen)
      const hintRow = chatLayout.hintRow
      const promptEnd = chatLayout.promptEnd
      const promptStart = Math.max(2, promptEnd - promptLines.length + 1)
      place(promptStart, promptLines)
      if (hintRow !== undefined) screen[hintRow] = hintLine

      const transcriptLines: string[] = []
      for (const item of this.transcript.slice(-12)) {
        const label = item.role === 'user'
          ? `${orange}${bold}You${reset}`
          : item.role === 'assistant'
            ? `${orange}${bold}Xiaoyu${reset}`
            : item.role === 'reasoning'
              ? `${yellow}${bold}Think${reset}`
              : item.role === 'tool'
                ? `${blue}${bold}Tool${reset}`
                : `${yellow}${bold}Info${reset}`
        const raw = item.text || (item.role === 'assistant' && item.placeholder && this.busy ? '等待模型首个增量…' : '')
        const maxLines = item.role === 'reasoning' ? 4 : item.role === 'tool' ? 3 : 5
        const live = this.busy && (item.role === 'assistant' || item.role === 'reasoning')
        const wrapped = live
          ? wrapTailPlain(raw, Math.max(24, cardWidth - 12), maxLines)
          : wrapPlain(raw, Math.max(24, cardWidth - 12), maxLines)
        const bodyStyle = item.role === 'assistant' ? text : item.role === 'tool' ? textSoft : textFaint
        wrapped.forEach((line, index) => transcriptLines.push(`${dockIndent}${index === 0 ? label : spaces(6)}${bodyStyle}  ${line}${reset}`))
        transcriptLines.push('')
      }
      const transcriptBottomGap = rows >= 30 ? 2 : 1
      const available = Math.max(1, promptStart - transcriptBottomGap - 1)
      const visible = transcriptLines.slice(-available)
      place(Math.max(1, promptStart - transcriptBottomGap - visible.length), visible)
    }

    if (this.approval) {
      const summary = [
        `${yellow}${bold}◆ Tool Approval${reset}`,
        `${text}${this.approval.request.toolName}${reset}${textFaint} · ${this.approval.request.effect}${reset}`,
        ...this.approval.request.summary.slice(0, 2).map(line => `${textSoft}${line}${reset}`),
        `${textFaint}[N] No · 不执行   ${text}[Y] Yes · 仅执行本次${reset}`,
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

  private renderPromptCard(width: number): string[] {
    const bodyWidth = Math.max(24, width - 3)
    const inputLines = this.editor.render(bodyWidth)
    const empty = !this.editor.getText()
    const lines: string[] = []
    const first = inputLines[0] ?? ''
    const placeholder = this.editor.focused
      ? `${blink}${bold}${text}输${reset}${textFaint}入消息…（输入 / 唤起命令）${reset}`
      : `${textFaint}输入消息…（输入 / 唤起命令）${reset}`
    lines.push(`${modeColor(this.agentMode)}▌${reset} ${empty ? placeholder : first}`)
    for (const line of inputLines.slice(1)) lines.push(`${modeColor(this.agentMode)}▌${reset} ${line}`)

    const suggestions = this.editor.suggestions()
    const selected = this.editor.selectedSuggestionIndex()
    if (suggestions.length > 0) {
      const visible = suggestions.slice(0, 6)
      for (let index = 0; index < visible.length; index += 1) {
        const item = visible[index]!
        const prefix = index === selected ? `${orange}${bold}›${reset}` : `${textFaint}·${reset}`
        const name = `/${item.label}`
        const description = item.description ?? ''
        const remaining = Math.max(8, bodyWidth - cellWidth(name) - 5)
        lines.push(`${orange}▌${reset}   ${prefix} ${index === selected ? `${text}${bold}${name}${reset}` : `${textSoft}${name}${reset}`}  ${textFaint}${truncateCells(description, remaining)}${reset}`)
      }
    }

    if (suggestions.length === 0) lines.push(`${modeColor(this.agentMode)}▌${reset}`)
    lines.push(`${modeColor(this.agentMode)}▌${reset} ${this.renderPromptStatus(bodyWidth)}`)
    return lines
  }

  private renderPromptStatus(width: number): string {
    const mode = modeLabel(this.agentMode)
    const left = `${modeColor(this.agentMode)}${bold}${mode}${reset}`
    const leftWidth = cellWidth(mode)

    if (!this.backend.providerConfigured) {
      const rightPlain = '○ 模型未配置 · Ctrl+P /provider'
      const right = `${yellow}○${reset} ${text}${rightPlain.slice(2)}${reset}`
      return `${left}${spaces(Math.max(1, width - leftWidth - cellWidth(rightPlain)))}${right}`
    }

    const effort = this.backend.reasoningSupported ? this.backend.reasoningEffort : 'default'
    const effortText = this.backend.reasoningSupported ? effort : 'reasoning n/a'
    const providerDot = this.backend.providerReady ? `${green}●${reset}` : `${yellow}○${reset}`
    const rightBudget = Math.max(8, width - leftWidth - cellWidth(effortText) - 8)
    const plainProvider = truncateCells(this.backend.providerLabel, rightBudget)
    const rightPlain = `○ ${plainProvider} · ${effortText}`
    const right = `${providerDot} ${text}${plainProvider}${reset}${textSoft} · ${reset}${reasoningColor(effort)}${bold}${effortText}${reset}`
    return `${left}${spaces(Math.max(1, width - leftWidth - cellWidth(rightPlain)))}${right}`
  }

  startInitialBrainSetup(): void {
    if (!needsInitialBrainSetup(this.backend.providerConfigured) || this.overlayOpen || this.approval) return
    this.initialBrainSetupActive = true
    this.notice = '首次使用 · 配置 Xiaoyu 模型；完成后以后启动会直接进入工作台，Ctrl+P 可随时修改。'
    this.tui.requestRender()
    this.openProviderCatalog('配置 Xiaoyu 模型')
  }

  private brainOverlayPosition(defaultRow: '14%' | '16%'): { anchor?: 'center'; row?: string; col?: string } {
    return this.initialBrainSetupActive ? { anchor: 'center' } : { row: defaultRow, col: '50%' }
  }

  private completeInitialBrainSetup(message = '模型已配置 · 已就绪'): void {
    if (this.initialBrainSetupActive) this.initialBrainSetupActive = false
    this.notice = message
    this.tui.requestRender()
  }

  private resumeInitialBrainSetup(message: string): void {
    if (!this.initialBrainSetupActive) return
    this.notice = message
    this.tui.requestRender()
    queueMicrotask(() => {
      if (!this.overlayOpen && this.initialBrainSetupActive) this.openProviderCatalog('配置 Xiaoyu 模型')
    })
  }

  openCommandPalette(): void {
    if (this.overlayOpen || this.approval) return
    this.showListOverlay('命令', commandPaletteOptions(), value => {
      void this.runPaletteAction(value)
    }, { centered: true, width: 76, maxHeight: 18, searchable: true })
  }

  private openSettings(): void {
    if (this.overlayOpen) return
    const visual = this.settings.visual === 'vivid' ? '丰富' : '简洁'
    const tips = this.settings.tips ? '开启' : '关闭'
    const logo = this.settings.logo === 'auto' ? '自动' : '紧凑'
    this.showListOverlay('终端设置', [
      { value: 'visual', label: '丰富显示', description: `当前：${visual}` },
      { value: 'tips', label: '提示信息', description: `当前：${tips}` },
      { value: 'logo', label: 'Logo 模式', description: `当前：${logo}` },
      { value: 'back', label: '返回命令面板', description: '返回主菜单' },
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

  private openProviderManager(title = '模型 / 提供方'): void {
    if (this.overlayOpen) return
    const profiles = this.backend.listBrainProfiles()
    const active = profiles.find(profile => profile.active)
    const items: TuiMenuItem[] = [
      { value: 'catalog', label: '添加提供方', description: '配置新的模型提供方' },
      { value: 'add-env', label: '自定义提供方', description: 'OpenAI 兼容接口 · 环境变量' },
    ]
    if (active) {
      items.push(
        { value: 'probe', label: '连接测试', description: `${active.displayName} · ${active.model}` },
        { value: 'models', label: '选择模型', description: `当前 ${active.model}` },
        ...(this.backend.reasoningSupported ? [{ value: 'reasoning', label: '推理强度', description: `当前 ${this.backend.reasoningEffort}` }] : []),
      )
    }
    const providerNames = new Map(this.backend.listBrainProviderCatalog().map(item => [item.id, item.displayName]))
    for (const profile of profiles) {
      const credential = profile.credential?.source === 'os'
        ? profile.credentialReady ? '系统凭据' : '缺少系统凭据'
        : profile.credential?.source === 'env'
          ? profile.credentialReady ? `环境变量 ${profile.credential.key}` : `缺少 ${profile.credential.key}`
          : '无需密钥'
      const providerName = providerNames.get(profile.providerId) ?? profile.providerId
      items.push({
        value: `select:${profile.id}`,
        label: `${profile.active ? '●' : '○'} ${profile.displayName}`,
        description: `${providerName} · ${profile.model} · ${credential}`,
      })
    }
    this.showListOverlay(title, items, value => {
      void this.runProviderAction(value)
    }, { centered: true, width: 70, maxHeight: '64%' })
  }

  private async runProviderAction(value: string): Promise<void> {
    try {
      if (value === 'catalog') {
        this.openProviderCatalog()
        return
      }
      if (value === 'add-env') {
        await this.addProviderWizard('custom-openai-compatible', 'env')
        return
      }
      if (value === 'probe') {
        this.notice = '正在执行连接测试…'
        this.tui.requestRender()
        const result = await this.backend.probeBrain()
        if (this.initialBrainSetupActive && result.ready) this.completeInitialBrainSetup(`模型已配置 · 已就绪 · 连接测试通过 · ${result.latencyMs}ms`)
        else {
          this.notice = `${result.ready ? '连接测试通过' : '连接测试失败'} · ${result.latencyMs}ms · ${result.message}`
          this.tui.requestRender()
        }
        return
      }
      if (value === 'models') {
        await this.openModelSelector()
        return
      }
      if (value === 'reasoning') {
        this.openReasoningSelector(this.initialBrainSetupActive)
        return
      }
      if (value.startsWith('select:')) {
        const profile = await this.backend.selectBrain(value.slice('select:'.length))
        this.notice = `模型配置已切换 · ${profile.displayName} · ${profile.model} · 已就绪`
        this.tui.requestRender()
        if (this.initialBrainSetupActive) this.completeInitialBrainSetup()
      }
    } catch (error) {
      this.notice = `模型配置操作失败 · ${error instanceof Error ? error.message : String(error)}`
      this.tui.requestRender()
    }
  }

  private openProviderCatalog(title = '添加提供方'): void {
    const catalog = this.backend.listBrainProviderCatalog()
    this.showListOverlay(title, catalog.map(item => ({
      value: `catalog:${item.id}`,
      label: item.displayName,
      description: item.description,
    })), value => {
      if (!value.startsWith('catalog:')) return
      void this.addProviderWizard(value.slice('catalog:'.length), 'os').catch(error => {
        const message = `提供方配置失败 · ${error instanceof Error ? error.message : String(error)}`
        if (this.initialBrainSetupActive) this.resumeInitialBrainSetup(message)
        else {
          this.notice = message
          this.tui.requestRender()
        }
      })
    }, { centered: true, width: 70, maxHeight: '56%' })
  }

  private async openModelSelector(afterSelect?: (profile: TerminalBrainProfileView) => void): Promise<void> {
    // Provider/Model 配置属于产品交互，任何失败都必须留在 TUI 内提示，禁止未处理 Promise 直接终止 CLI。
    if (!this.backend.providerConfigured) {
      this.notice = '模型未配置 · 请先在 Ctrl+P → 模型 / 提供方 添加并保存提供方。'
      this.tui.requestRender()
      return
    }

    this.notice = '正在读取提供方的真实模型列表…'
    this.tui.requestRender()
    try {
      const models = await this.backend.listBrainModels()
      if (models.length === 0) {
        this.notice = '提供方没有返回模型列表；当前配置保留已设置的模型 ID。'
        this.tui.requestRender()
        if (this.initialBrainSetupActive) {
          if (this.backend.reasoningSupported) this.openReasoningSelector(true)
          else this.completeInitialBrainSetup()
        }
        return
      }
      this.showListOverlay('选择真实模型', models.slice(0, 100).map(model => ({ value: model, label: model })), model => {
        void this.backend.selectBrainModel(model).then(async profile => {
          this.notice = `模型已切换 · ${profile.displayName} · ${profile.model}`
          this.tui.requestRender()
          if (afterSelect) {
            afterSelect(profile)
            return
          }
          if (this.initialBrainSetupActive) this.completeInitialBrainSetup()
          else {
            this.notice = `模型已切换 · ${profile.displayName} · ${profile.model} · 已就绪`
            this.tui.requestRender()
          }
        }).catch(error => {
          const message = `模型切换失败 · ${error instanceof Error ? error.message : String(error)}`
          if (this.initialBrainSetupActive) {
            this.notice = message
            this.tui.requestRender()
            queueMicrotask(() => {
              if (!this.overlayOpen && this.initialBrainSetupActive) this.openProviderManager('配置 Xiaoyu 模型')
            })
          } else {
            this.notice = message
            this.tui.requestRender()
          }
        })
      }, { centered: true, width: 74, maxHeight: '64%' })
    } catch (error) {
      const message = `模型列表读取失败 · ${error instanceof Error ? error.message : String(error)}`
      if (this.initialBrainSetupActive) {
        this.notice = message
        this.tui.requestRender()
        queueMicrotask(() => {
          if (!this.overlayOpen && this.initialBrainSetupActive) this.openProviderManager('配置 Xiaoyu 模型')
        })
      } else {
        this.notice = message
        this.tui.requestRender()
      }
    }
  }

  private openReasoningSelector(afterSetup = false): void {
    if (!this.backend.reasoningSupported) {
      this.notice = '当前提供方 / 模型未声明可配置推理强度。'
      this.tui.requestRender()
      return
    }
    const current = this.backend.reasoningEffort
    const items: TuiMenuItem[] = [
      { value: 'default', label: `${current === 'default' ? '● ' : ''}默认`, description: '使用提供方默认推理强度' },
      { value: 'high', label: `${current === 'high' ? '● ' : ''}高`, description: '高推理强度' },
      { value: 'max', label: `${current === 'max' ? '● ' : ''}最大`, description: '最大推理强度（提供方支持时）' },
    ]
    this.showListOverlay('选择推理强度', items, value => {
      void this.backend.selectBrainReasoning(value as TerminalReasoningEffort).then(async profile => {
        this.notice = `推理强度已切换 · ${profile.model} · ${this.backend.reasoningEffort}`
        this.tui.requestRender()
        if (!afterSetup) return
        this.completeInitialBrainSetup()
      }).catch(error => {
        const message = `推理强度切换失败 · ${error instanceof Error ? error.message : String(error)}`
        if (this.initialBrainSetupActive) {
          this.notice = message
          this.tui.requestRender()
          queueMicrotask(() => {
            if (!this.overlayOpen && this.initialBrainSetupActive) this.openProviderManager('配置 Xiaoyu 模型')
          })
        } else {
          this.notice = message
          this.tui.requestRender()
        }
      })
    }, { centered: true, width: 62, maxHeight: '46%' })
  }

  private async addProviderWizard(providerId: string, credentialMode: 'os' | 'env'): Promise<void> {
    const catalog = this.backend.listBrainProviderCatalog()
    const provider = catalog.find(item => item.id === providerId)
    if (!provider) throw new Error(`提供方目录不存在：${providerId}`)
    const existingProfiles = this.backend.listBrainProfiles().filter(item => item.providerId === providerId && item.source === 'config')
    const displayName = existingProfiles.length === 0 ? provider.displayName : `${provider.displayName} ${existingProfiles.length + 1}`
    let baseUrl: string | undefined
    let model: string | undefined
    if (provider.customEndpoint) {
      baseUrl = await this.showInputOverlay('Base URL', '例如：https://api.example.com/v1', '')
      if (baseUrl === undefined) { this.resumeInitialBrainSetup('首次模型配置尚未完成。'); return }
      model = await this.showInputOverlay('默认模型 ID', '请输入 endpoint 实际支持的 model ID', '')
      if (model === undefined) { this.resumeInitialBrainSetup('首次模型配置尚未完成。'); return }
    }
    // 品牌 Provider 的主流程固定为：API Key → 真实模型 → 推理强度；连接测试保留为可选诊断，不阻塞“已就绪”。
    const credentialInput = credentialMode === 'os'
      ? await this.showInputOverlay('API Key', provider.credentialRequired
          ? '安全写入系统凭据库；输入内容不会回显'
          : '安全写入系统凭据库；留空表示此 endpoint 无需鉴权', '', { secret: true })
      : await this.showInputOverlay('API Key 环境变量', '只保存变量名；留空表示无需鉴权', 'XIAOYU_API_KEY')
    if (credentialInput === undefined) { this.resumeInitialBrainSetup('首次模型配置尚未完成。'); return }
    if (credentialMode === 'os' && provider.credentialRequired && !credentialInput.trim()) {
      const message = `${provider.displayName} 官方 API 需要 API Key。`
      if (this.initialBrainSetupActive) this.resumeInitialBrainSetup(message)
      else { this.notice = message; this.tui.requestRender() }
      return
    }

    let profile: TerminalBrainProfileView
    try {
      profile = await this.backend.saveBrainProfile({
        providerId,
        displayName,
        ...(baseUrl !== undefined ? { baseUrl: baseUrl.trim() } : {}),
        ...(model !== undefined ? { model: model.trim() } : {}),
        ...(credentialMode === 'os' && credentialInput ? { apiKey: credentialInput } : {}),
        ...(credentialMode === 'env' && credentialInput.trim() ? { credentialEnv: credentialInput.trim() } : {}),
      })
    } catch (error) {
      const message = `提供方保存失败 · ${error instanceof Error ? error.message : String(error)}`
      if (this.initialBrainSetupActive) this.resumeInitialBrainSetup(message)
      else { this.notice = message; this.tui.requestRender() }
      return
    }

    // Profile 保存成功即成为当前 Brain。后续远端模型发现失败不能反过来伪装成“保存失败”或清掉已保存配置。
    this.notice = `提供方已保存并设为当前模型配置 · ${profile.displayName} · 正在读取真实模型…`
    this.tui.requestRender()
    await this.openModelSelector(() => {
      if (this.backend.reasoningSupported) {
        this.openReasoningSelector(true)
        return
      }
      if (this.initialBrainSetupActive) this.completeInitialBrainSetup()
      else {
        this.notice = `模型已配置 · ${profile.displayName} · ${profile.model} · 已就绪`
        this.tui.requestRender()
      }
    })
  }

  private showInputOverlay(
    title: string,
    description: string,
    initial: string,
    options: { secret?: boolean } = {},
  ): Promise<string | undefined> {
    if (this.overlayOpen) return Promise.resolve(undefined)
    this.overlayOpen = true
    return new Promise(resolve => {
      const field = new SafePromptInput(this.toolkit)
      field.setText(initial)
      let handle: any
      let settled = false
      const finish = (value: string | undefined): void => {
        if (settled) return
        settled = true
        this.overlayOpen = false
        try { handle?.hide?.() } catch { /* best effort */ }
        this.tui.setFocus(this)
        this.tui.requestRender()
        resolve(value)
      }
      field.onChange = () => this.tui.requestRender()
      field.onSubmit = value => finish(value)
      const frame = {
        _focused: false,
        get focused(): boolean { return this._focused },
        set focused(value: boolean) {
          this._focused = value
          field.focused = value
        },
        render: (width: number): string[] => {
          const inner = Math.max(24, width - 4)
          return [
            `${bold}${text}${title}${reset}${spaces(Math.max(1, inner - cellWidth(title) - 3))}${textFaint}esc${reset}`,
            `${textFaint}${truncateCells(description, inner)}${reset}`,
            '',
            ...(options.secret ? field.renderSecret(inner) : field.render(inner)),
            '',
            `${textFaint}Enter 确认 · Esc 取消${reset}`,
          ]
        },
        handleInput: (data: string): void => {
          if (this.toolkit.matchesKey(data, 'escape') || data === '\u001b') {
            finish(undefined)
            return
          }
          field.handleInput(data)
          this.tui.requestRender()
        },
      }
      handle = this.tui.showOverlay(frame, {
        width: '66%',
        maxHeight: 12,
        anchor: 'center',
        margin: 3,
      })
    })
  }

  private showListOverlay(
    title: string,
    items: readonly TuiMenuItem[],
    onSelect: (value: string) => void,
    layout: { centered?: boolean; width?: number | string; maxHeight?: number | string; searchable?: boolean } = {},
  ): void {
    if (this.overlayOpen) return
    this.overlayOpen = true
    const maxVisible = Math.min(10, Math.max(4, items.length))
    const searchable = layout.searchable === true
    let query = ''
    let selectedIndex = items.length > 0 ? 0 : -1
    let handle: any

    const close = (): void => {
      if (!this.overlayOpen) return
      this.overlayOpen = false
      try { handle?.hide?.() } catch { /* best effort */ }
      this.tui.setFocus(this)
      this.tui.requestRender()
    }
    const cancel = (): void => {
      if (this.initialBrainSetupActive) {
        this.notice = '首次模型配置尚未完成；完成配置后进入工作台，或按 Ctrl+C 退出 Xiaoyu。'
        this.tui.requestRender()
        return
      }
      close()
    }
    const projection = (inner: number) => {
      const projected = projectTuiMenu(items, query, selectedIndex, inner, maxVisible)
      selectedIndex = projected.selectedIndex
      return projected
    }
    const selectCurrent = (inner: number): void => {
      const projected = projection(inner)
      if (projected.selectedIndex < 0) return
      const item = projected.filtered[projected.selectedIndex]
      if (!item) return
      close()
      onSelect(item.value)
    }

    const frame = {
      render: (width: number): string[] => {
        const panelInset = 2
        const contentWidth = Math.max(28, width - 4 - panelInset * 2)
        const paintLine = (line = ''): string => `${spaces(panelInset)}${line}`
        const heading = `${bold}${text}${title}${reset}${spaces(Math.max(1, contentWidth - cellWidth(title) - 3))}${textFaint}esc${reset}`
        const projected = projection(contentWidth)
        const lines: string[] = ['', paintLine(heading), '']

        if (searchable) {
          const searchValue = query
            ? `${text}${query}${reset}${blink}${bold}${text}│${reset}`
            : `${blink}${bold}${text}│${reset}${textFaint} 输入关键词…${reset}`
          lines.push(paintLine(`${textFaint}搜索${reset}  ${searchValue}`), '')
        }

        if (projected.rows.length === 0) {
          lines.push(paintLine(`${textFaint}没有匹配项${reset}`))
        } else {
          for (const row of projected.rows) {
            const prefix = row.selected ? `${orange}${bold}→${reset}` : ' '
            const shortcut = row.shortcut ? `${textFaint}${row.shortcut}${reset}  ` : ''
            const label = row.selected ? `${orange}${bold}${row.label}${reset}` : `${text}${row.label}${reset}`
            const description = `${textSoft}${row.description}${reset}`
            lines.push(paintLine(`${prefix} ${shortcut}${label}  ${description}`))
          }
        }

        if (searchable) {
          lines.push('', paintLine(`${textFaint}输入搜索 · ↑↓ 选择 · Enter 执行 · Esc 返回${reset}`), '')
        } else {
          lines.push('')
        }
        return lines
      },
      handleInput: (data: string): void => {
        if (isTerminalMouseInput(data)) return
        if (this.toolkit.matchesKey(data, 'escape') || data === '\u001b') {
          cancel()
          return
        }

        const inner = Math.max(32, Number(this.terminal.columns ?? 76) - 12)
        const current = projection(inner)
        if (this.toolkit.matchesKey(data, 'up') || data === '\u001b[A') {
          selectedIndex = moveTuiMenuSelection(current.selectedIndex, current.filtered.length, -1)
          this.tui.requestRender()
          return
        }
        if (this.toolkit.matchesKey(data, 'down') || data === '\u001b[B') {
          selectedIndex = moveTuiMenuSelection(current.selectedIndex, current.filtered.length, 1)
          this.tui.requestRender()
          return
        }
        if (this.toolkit.matchesKey(data, 'enter') || data === '\r' || data === '\n') {
          selectCurrent(inner)
          return
        }
        if (!searchable) return
        if (this.toolkit.matchesKey(data, 'backspace') || data === '\u007f' || data === '\b') {
          if (query.length > 0) {
            query = query.slice(0, -1)
            selectedIndex = 0
            this.tui.requestRender()
          }
          return
        }
        if (this.toolkit.matchesKey(data, 'ctrl+u') || data === '\u0015') {
          query = ''
          selectedIndex = 0
          this.tui.requestRender()
          return
        }
        if (data.includes('\u001b') || [...data].some(char => {
          const code = char.charCodeAt(0)
          return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f)
        })) return
        if (data) {
          query += data
          selectedIndex = 0
          this.tui.requestRender()
        }
      },
    }
    const position = layout.centered ? { anchor: 'center' as const } : this.brainOverlayPosition('14%')
    handle = this.tui.showOverlay(frame, {
      width: layout.width ?? 68,
      maxHeight: layout.maxHeight ?? Math.min(20, Math.max(10, items.length + (searchable ? 9 : 6))),
      ...position,
      margin: 3,
    })
  }

  private async runPaletteAction(value: string): Promise<void> {
    try {
      if (value === 'settings') {
        this.openSettings()
        return
      }
      if (value === 'vivid') {
        this.settings = toggleTerminalVisual(this.settings)
        saveTerminalUiSettings(this.settings)
        this.notice = `终端视觉 · ${this.settings.visual === 'vivid' ? '丰富显示' : '简洁显示'}`
        this.tui.requestRender()
        return
      }
      await this.runTerminalCommand(value)
    } catch (error) {
      this.notice = `命令执行失败 · ${error instanceof Error ? error.message : String(error)}`
      this.tui.requestRender()
    }
  }

  private async runTerminalCommand(command: string): Promise<boolean> {
    try {
      if (command === 'help') {
        this.notice = terminalCommandHelpText()
        this.tui.requestRender()
        return true
      }
      if (command === 'settings') {
        this.openSettings()
        return true
      }
      if (command === 'vivid') {
        this.settings = toggleTerminalVisual(this.settings)
        saveTerminalUiSettings(this.settings)
        this.notice = `终端视觉 · ${this.settings.visual === 'vivid' ? '丰富显示' : '简洁显示'}`
        this.tui.requestRender()
        return true
      }
      if (command === 'permission') {
        this.showListOverlay('权限 / 审批', [
          { value: 'ask', label: '请求批准', description: '敏感 Tool 每次询问' },
          { value: 'smart', label: '替我审批', description: '按策略自动审批' },
          { value: 'full', label: '完全权限', description: '允许当前工作区内的完整 Tool 能力' },
        ], value => {
          if (value !== 'ask' && value !== 'smart' && value !== 'full') return
          this.backend.setPermissionProfile(value)
          this.notice = `权限 · ${value === 'ask' ? '请求批准' : value === 'smart' ? '替我审批' : '完全权限'}`
          this.tui.requestRender()
        }, { centered: true, width: 68, maxHeight: 12 })
        return true
      }
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
        this.notice = `工作区 · ${this.backend.workspace}`
        this.tui.requestRender()
        return true
      }
      if (command === 'provider') {
        this.openProviderManager()
        return true
      }
      if (command === 'model') {
        await this.openModelSelector()
        return true
      }
      if (command === 'agent') {
        this.notice = `智能体 · ${this.backend.agentLabel}`
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
    } catch (error) {
      this.notice = `命令执行失败 · ${error instanceof Error ? error.message : String(error)}`
      this.tui.requestRender()
      return true
    }
  }

  private async submit(raw: string): Promise<void> {
    const line = raw.trim()
    if (!line || this.busy || this.approval) return
    this.editor.addToHistory?.(line)
    this.editor.setText('')
    this.notice = ''

    if (line === '/') {
      await this.runTerminalCommand('help')
      return
    }
    if (line.startsWith('/') && await this.runTerminalCommand(line.slice(1))) return
    if (line.startsWith('/')) {
      this.notice = `未知命令 ${line} · 输入 /help 查看可用命令`
      this.tui.requestRender()
      return
    }
    if (!this.backend.providerConfigured) {
      this.notice = '模型未配置 · 按 Ctrl+P → 模型 / 提供方 添加真实提供方'
      this.tui.requestRender()
      return
    }

    const placeholder: TerminalTranscriptItem = { role: 'assistant', text: '', placeholder: true }
    this.transcript.push({ role: 'user', text: line }, placeholder)
    this.busy = true
    this.editor.disableSubmit = true
    this.activeController = new AbortController()
    this.requestLiveRender()
    try {
      await this.backend.sendMessage(
        line,
        this.agentMode,
        event => {
          applyTerminalRunEvent(this.transcript, event)
          this.requestLiveRender()
        },
        this.activeController.signal,
        (request, signal) => this.requestApproval(request, signal),
      )
      if (placeholder.placeholder && this.transcript.includes(placeholder)) placeholder.text = '(没有文本输出)'
      this.notice = '完成'
    } catch (error) {
      const aborted = this.activeController.signal.aborted
      const presentation = providerErrorPresentation(error)
      const message = aborted ? '已中止当前响应' : `请求失败 · ${presentation.message}`
      if (placeholder.placeholder && this.transcript.includes(placeholder)) {
        const index = this.transcript.indexOf(placeholder)
        this.transcript.splice(index, 1, { role: 'system', text: message })
      } else this.transcript.push({ role: 'system', text: message })
      this.notice = aborted ? '已中止当前响应' : presentation.message
    } finally {
      this.busy = false
      this.editor.disableSubmit = false
      this.activeController = undefined
      if (this.forcedStreamRenderTimer) {
        clearTimeout(this.forcedStreamRenderTimer)
        this.forcedStreamRenderTimer = undefined
      }
      this.lastForcedStreamRenderAt = Date.now()
      this.tui.requestRender(true)
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
    if (this.tipTimer) {
      clearInterval(this.tipTimer)
      this.tipTimer = undefined
    }
    if (this.forcedStreamRenderTimer) {
      clearTimeout(this.forcedStreamRenderTimer)
      this.forcedStreamRenderTimer = undefined
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
  const tui = new toolkit.TUI(terminal, false)
  const surface = new XiaoyuSurface(toolkit, tui, terminal, backend, loadTerminalUiSettings())
  let stopped = false

  try {
    output.write(`${enterAltScreen}${hideHardwareCursor}${setTitle('Xiaoyu')}${clearScreen}`)
    tui.addChild(surface)
    tui.setFocus(surface)
    tui.addInputListener((data: string) => {
      if (isTerminalMouseInput(data)) return { consume: true }
      const ctrlC = toolkit.matchesKey(data, 'ctrl+c') || data === '\u0003'
      const ctrlP = toolkit.matchesKey(data, 'ctrl+p') || data === '\u0010'
      const ctrlK = toolkit.matchesKey(data, 'ctrl+k') || data === '\u000b'
      const escape = toolkit.matchesKey(data, 'escape') || data === '\u001b'
      if (ctrlP || ctrlK) {
        surface.openCommandPalette()
        return { consume: true }
      }
      if (ctrlC) {
        if (surface.cancel()) return { consume: true }
        surface.requestExit()
        return { consume: true }
      }
      if (escape && (surface.back() || surface.cancel())) return { consume: true }
      return undefined
    })
    tui.start()
    output.write(`${hideHardwareCursor}${terminalMouseCaptureSequence}`)
    tui.requestRender(true)
    surface.startInitialBrainSetup()
    await new Promise<void>(resolve => surface.setExitResolver(resolve))
  } finally {
    surface.dispose()
    if (!stopped) {
      stopped = true
      try { tui.stop() } catch { /* best effort terminal restore */ }
    }
    await backend.close()
    output.write(`${terminalMouseReleaseSequence}${showHardwareCursor}${reset}${clearScreen}${leaveAltScreen}`)
    output.write(`${textFaint}Xiaoyu 已退出。${reset}\n`)
  }
}
