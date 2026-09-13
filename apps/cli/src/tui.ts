/**
 * 文件作用：实现 XMA `xiaoyu` 终端工作台的持续交互界面、视觉主题、命令分发与 Workspace 风险确认。
 * 关联模块：main.ts、core Agent Runtime、Workspace、Provider、Tool Approval 与 Native 文件 ToolSet。
 * 当前实现：XIAOYU 品牌首页、居中深色 Prompt 卡片、持续输入循环、Home/根目录风险确认、基础斜杠命令、流式回复、Doctor 与 Tool Approval。
 * 职责边界：TUI 只负责终端视觉和交互；不得复制 Agent Loop、Provider 协议、Workspace Policy 或 Native 安全逻辑。
 */

import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { ToolApprovalDecision, ToolApprovalRequest } from '../../../core/src/tool/policy.ts'

const ESC = '\u001b['
const reset = `${ESC}0m`
const dim = `${ESC}2m`
const bold = `${ESC}1m`
const orange = `${ESC}38;2;255;126;63m`
const orangeSoft = `${ESC}38;2;208;101;53m`
const text = `${ESC}38;2;226;226;226m`
const textSoft = `${ESC}38;2;160;160;160m`
const textFaint = `${ESC}38;2;106;106;106m`
const green = `${ESC}38;2;98;202;132m`
const yellow = `${ESC}38;2;224;190;72m`
const red = `${ESC}38;2;238;94;94m`
const blue = `${ESC}38;2;89;155;225m`
const panel = `${ESC}48;2;31;31;31m`
const panelSoft = `${ESC}48;2;25;25;25m`
const clearScreen = `${ESC}2J${ESC}H`
const enterAltScreen = `${ESC}?1049h`
const leaveAltScreen = `${ESC}?1049l`
const setTitle = (title: string) => `\u001b]0;${title}\u0007`

const LOGO_XIAO = [
  '██╗  ██╗ ██╗  █████╗  ██████╗ ',
  '╚██╗██╔╝ ██║ ██╔══██╗██╔═══██╗',
  ' ╚███╔╝  ██║ ███████║██║   ██║',
  ' ██╔██╗  ██║ ██╔══██║██║   ██║',
  '██╔╝ ██╗ ██║ ██║  ██║╚██████╔╝',
  '╚═╝  ╚═╝ ╚═╝ ╚═╝  ╚═╝ ╚═════╝ ',
] as const

const LOGO_YU = [
  '██╗   ██╗ ██╗   ██╗',
  '╚██╗ ██╔╝ ██║   ██║',
  ' ╚████╔╝  ██║   ██║',
  '  ╚██╔╝   ██║   ██║',
  '   ██║    ╚██████╔╝',
  '   ╚═╝     ╚═════╝ ',
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

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
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
  const ellipsis = '…'
  while (cellWidth(result) + cellWidth(ellipsis) > maxWidth && result.length > 0) result = result.slice(0, -1)
  return `${result}${ellipsis}`
}

function spaces(count: number): string {
  return ' '.repeat(Math.max(0, count))
}

function centerPlain(value: string, width: number): string {
  const clipped = truncateCells(value, width)
  const left = Math.max(0, Math.floor((width - cellWidth(clipped)) / 2))
  return `${spaces(left)}${clipped}`
}

function centerStyled(plain: string, styled: string, width: number): string {
  const left = Math.max(0, Math.floor((width - cellWidth(plain)) / 2))
  return `${spaces(left)}${styled}`
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

function panelLine(plain: string, width: number, accent = false): string {
  const bar = accent ? `${orange}▌${reset}${panel}` : ' '
  const usable = width - 3
  const clipped = truncateCells(plain, usable)
  return `${panel}${bar} ${text}${clipped}${spaces(usable - cellWidth(clipped))} ${reset}`
}

function panelRichLine(segments: readonly { value: string; style?: string }[], width: number, accent = false): string {
  const plain = segments.map(segment => segment.value).join('')
  const clippedPlain = truncateCells(plain, width - 3)
  let remaining = cellWidth(clippedPlain)
  let rich = ''
  for (const segment of segments) {
    if (remaining <= 0) break
    const clipped = truncateCells(segment.value, remaining)
    rich += `${segment.style ?? text}${clipped}`
    remaining -= cellWidth(clipped)
  }
  const bar = accent ? `${orange}▌${reset}${panel}` : ' '
  const used = cellWidth(clippedPlain)
  return `${panel}${bar} ${rich}${panel}${spaces(Math.max(0, width - 3 - used))} ${reset}`
}

function renderLogo(columns: number): string[] {
  if (columns < 84) {
    return [
      centerPlain('✦  XIAOYU', columns).replace('XIAOYU', `${orange}${bold}XIAOYU${reset}`),
      centerPlain('Xiaoyu Management Agent', columns).replace('Xiaoyu Management Agent', `${textSoft}Xiaoyu Management Agent${reset}`),
    ]
  }

  const rows: string[] = []
  const logoWidth = cellWidth(LOGO_XIAO[0]) + 2 + cellWidth(LOGO_YU[0])
  const left = Math.max(0, Math.floor((columns - logoWidth) / 2))
  rows.push(`${spaces(Math.max(0, left + logoWidth - 11))}${textFaint}XIAOYU${reset}`)
  for (let index = 0; index < LOGO_XIAO.length; index += 1) {
    rows.push(`${spaces(left)}${orange}${LOGO_XIAO[index]}${reset}  ${textSoft}${LOGO_YU[index]}${reset}`)
  }
  return rows
}

function renderStars(columns: number): string[] {
  if (columns < 80) return ['']
  const points = [
    [0.13, '✦', textFaint],
    [0.27, '·', textFaint],
    [0.38, '✧', yellow],
    [0.63, '·', textFaint],
    [0.81, '✦', textFaint],
  ] as const
  const chars = Array.from({ length: columns }, () => ' ')
  const styles = new Map<number, string>()
  for (const [ratio, glyph, style] of points) {
    const index = Math.max(0, Math.min(columns - 1, Math.floor(columns * ratio)))
    chars[index] = glyph
    styles.set(index, style)
  }
  let line = ''
  for (let index = 0; index < chars.length; index += 1) {
    const style = styles.get(index)
    line += style ? `${style}${chars[index]}${reset}` : chars[index]
  }
  return [line]
}

export function workspaceRisk(workspace: string): WorkspaceRisk {
  const normalized = normalizeForCompare(workspace)
  const home = normalizeForCompare(homedir())
  const root = normalizeForCompare(path.parse(path.resolve(workspace)).root)
  if (normalized === root) {
    return {
      risky: true,
      level: 'root',
      reason: '你正在打开文件系统根目录，Agent 可能看到大量系统与个人文件。',
    }
  }
  if (normalized === home) {
    return {
      risky: true,
      level: 'home',
      reason: '你正在打开用户主目录，其中可能包含 SSH 密钥、凭证、浏览器配置与个人文件。',
    }
  }
  return { risky: false, level: 'normal' }
}

export function renderHome(
  backend: Pick<TerminalBackend, 'version' | 'workspace' | 'agentLabel' | 'providerLabel' | 'providerReady'>,
  size: Viewport = viewport(),
): string {
  const width = contentWidth(size.columns)
  const left = Math.max(0, Math.floor((size.columns - width) / 2))
  const indent = spaces(left)
  const providerDot = backend.providerReady ? `${green}●${reset}` : `${yellow}○${reset}`
  const statusProvider = backend.providerReady ? backend.providerLabel : 'Brain 未配置'
  const workspace = truncateCells(backend.workspace, Math.max(28, width - 18))
  const topPad = size.rows >= 36 ? 2 : 1

  const card = [
    `${indent}${panelLine('输入消息…（输入 / 唤起命令）', width, true)}`,
    `${indent}${panelLine('', width, true)}`,
    `${indent}${panelRichLine([
      { value: 'Build', style: `${orange}${bold}` },
      { value: ` · ${backend.agentLabel}`, style: text },
      { value: '   ', style: text },
      { value: backend.providerReady ? '● ' : '○ ', style: backend.providerReady ? green : yellow },
      { value: statusProvider, style: textSoft },
    ], width, true)}`,
  ]

  const hints = [
    { key: '/help', label: '命令' },
    { key: '/doctor', label: '检查' },
    { key: '/provider', label: 'Brain' },
    { key: '/agent', label: 'Agent' },
  ].map(item => `${bold}${item.key}${reset} ${textSoft}${item.label}${reset}`).join(`  ${textFaint}·${reset}  `)

  const tipPlain = '●  提示  输入 /help 查看快捷命令；/doctor 检查当前运行环境'
  const tip = `${orange}●  提示${reset}  ${textSoft}输入 ${text}/help${reset}${textSoft} 查看快捷命令；${text}/doctor${reset}${textSoft} 检查当前运行环境${reset}`
  const footerLeft = `${textFaint}${workspace}${reset}`
  const footerRight = `${textFaint}${backend.version}${reset}`
  const footerGap = Math.max(2, size.columns - cellWidth(workspace) - backend.version.length)

  return [
    ...Array.from({ length: topPad }, () => ''),
    ...renderStars(size.columns),
    '',
    ...renderLogo(size.columns),
    '',
    `${centerPlain('Model is replaceable. Agent is ours.', size.columns).replace('Model is replaceable. Agent is ours.', `${textFaint}Model is replaceable. Agent is ours.${reset}`)}`,
    '',
    ...card,
    `${indent}${spaces(2)}${hints}`,
    '',
    centerStyled(tipPlain, tip, size.columns),
    '',
    `${footerLeft}${spaces(footerGap)}${footerRight}`,
    '',
  ].join('\n')
}

export async function confirmWorkspaceTrust(workspace: string): Promise<boolean> {
  const risk = workspaceRisk(workspace)
  if (!risk.risky) return true
  if (!input.isTTY || !output.isTTY) return false

  const rl = createInterface({ input, output })
  try {
    const width = contentWidth(viewport().columns)
    output.write('\n')
    output.write(`${yellow}${bold}▲  Workspace 安全确认${reset}\n\n`)
    output.write(`${panelSoft}${spaces(width)}${reset}\n`)
    output.write(`${panelSoft}  ${text}${truncateCells(workspace, width - 4)}${spaces(Math.max(0, width - 4 - cellWidth(truncateCells(workspace, width - 4))))}  ${reset}\n`)
    output.write(`${panelSoft}${spaces(width)}${reset}\n\n`)
    output.write(`  ${textSoft}${risk.reason ?? '该目录包含高权限内容。'}${reset}\n`)
    output.write(`  ${red}只有明确需要时才把这么大的目录授权给 Agent。${reset}\n\n`)
    output.write(`  ${textFaint}[1]${reset} 退出（推荐）    ${green}[2]${reset} 我了解风险，仅本次信任\n\n`)
    const answer = (await rl.question(`${orange}❯${reset} `)).trim()
    return answer === '2'
  } finally {
    rl.close()
  }
}

function writeHelp(): void {
  const entries = [
    ['/help', '查看命令'],
    ['/doctor', '检查当前终端运行环境'],
    ['/workspace', '查看当前 Workspace'],
    ['/provider', '查看当前 Brain / Provider'],
    ['/agent', '查看当前 Agent'],
    ['/clear', '清屏并重绘首页'],
    ['/exit', '退出 Xiaoyu'],
  ] as const
  output.write(`\n${orange}${bold}◆  Xiaoyu Commands${reset}\n\n`)
  for (const [command, label] of entries) {
    output.write(`  ${text}${command.padEnd(12)}${reset}${textSoft}${label}${reset}\n`)
  }
  output.write('\n')
}

function writeDoctor(items: readonly DoctorItem[]): void {
  output.write(`\n${orange}${bold}◆  Xiaoyu Doctor${reset}\n\n`)
  for (const item of items) {
    const icon = item.ok ? `${green}●${reset}` : `${yellow}○${reset}`
    output.write(`  ${icon} ${text}${item.label.padEnd(14)}${reset}${textSoft}${item.detail}${reset}\n`)
  }
  output.write('\n')
}

function writeBrainMissing(): void {
  const width = Math.min(72, contentWidth(viewport().columns))
  output.write('\n')
  output.write(`${orangeSoft}▌${reset} ${yellow}${bold}Brain 尚未配置${reset}\n`)
  output.write(`  ${textSoft}连接 OpenAI-compatible Provider 后即可开始对话。${reset}\n`)
  output.write(`  ${textFaint}${truncateCells('XIAOYU_BASE_URL  ·  XIAOYU_MODEL  ·  XIAOYU_API_KEY（可选）', width)}${reset}\n`)
  output.write(`  ${textFaint}Secret 只从环境变量读取，不会写入 Session。${reset}\n\n`)
}

export function approvalDecision(answer: string): ToolApprovalDecision {
  const normalized = answer.trim()
  if (normalized === '2') return 'allow-once'
  if (normalized === '3') return 'allow-session'
  return 'deny'
}

async function requestApproval(rl: ReturnType<typeof createInterface>, request: ToolApprovalRequest, signal: AbortSignal): Promise<ToolApprovalDecision> {
  output.write(`\n${yellow}${bold}◆  Tool Approval${reset}\n`)
  output.write(`  ${text}${request.toolName}${reset} ${textFaint}· ${request.effect}${reset}\n\n`)
  for (const line of request.summary) output.write(`  ${textSoft}${line}${reset}\n`)
  output.write(`\n  ${textFaint}[1] 拒绝   [2] 仅本次允许   [3] 当前 Session 允许${reset}\n`)
  try {
    return approvalDecision(await rl.question(`${orange}❯${reset} `, { signal }))
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return 'deny'
    throw error
  }
}

function promptPrefix(): string {
  return `${orange}${bold}❯${reset} `
}

export async function runTui(backend: TerminalBackend): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Xiaoyu interactive TUI requires a TTY. Use `xiaoyu --help` for non-interactive usage.')
  }

  const rl = createInterface({ input, output })
  let activeController: AbortController | undefined
  const cancel = (): void => activeController?.abort()
  process.on('SIGINT', cancel)

  try {
    output.write(`${enterAltScreen}${setTitle('Xiaoyu')}${clearScreen}`)
    output.write(renderHome(backend))
    while (true) {
      const line = (await rl.question(promptPrefix())).trim()
      if (!line) continue

      if (line === '/' || line === '/help') {
        writeHelp()
        continue
      }
      if (line === '/exit' || line === '/quit') break
      if (line === '/clear') {
        output.write(clearScreen)
        output.write(renderHome(backend))
        continue
      }
      if (line === '/workspace') {
        output.write(`\n${orange}${bold}◆  Workspace${reset}\n  ${textSoft}${backend.workspace}${reset}\n\n`)
        continue
      }
      if (line === '/provider') {
        const dot = backend.providerReady ? `${green}●${reset}` : `${yellow}○${reset}`
        output.write(`\n${orange}${bold}◆  Brain${reset}\n  ${dot} ${textSoft}${backend.providerLabel}${reset}\n\n`)
        continue
      }
      if (line === '/agent') {
        output.write(`\n${orange}${bold}◆  Agent${reset}\n  ${textSoft}${backend.agentLabel}${reset}\n\n`)
        continue
      }
      if (line === '/doctor') {
        writeDoctor(await backend.doctor())
        continue
      }
      if (line.startsWith('/')) {
        output.write(`${yellow}未知命令${reset}${textFaint} · ${line} · 输入 /help 查看可用命令${reset}\n`)
        continue
      }

      if (!backend.providerReady) {
        writeBrainMissing()
        continue
      }

      activeController = new AbortController()
      let wrote = false
      output.write(`\n${orange}${bold}◆  Xiaoyu${reset}\n\n`)
      try {
        await backend.sendMessage(
          line,
          chunk => {
            wrote = true
            output.write(chunk)
          },
          activeController.signal,
          (request, signal) => requestApproval(rl, request, signal),
        )
        output.write(wrote ? '\n\n' : `${textFaint}(没有文本输出)${reset}\n\n`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        output.write(`\n${red}请求失败${reset}${textFaint} · ${message}${reset}\n\n`)
      } finally {
        activeController = undefined
      }
    }
  } finally {
    process.off('SIGINT', cancel)
    rl.close()
    await backend.close()
    output.write(`${reset}${clearScreen}${leaveAltScreen}`)
    output.write(`${textFaint}Xiaoyu 已退出。${reset}\n`)
  }
}
