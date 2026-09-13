/**
 * 文件作用：实现 XMA `xiaoyu` 终端工作台的持续交互界面、命令分发与 Workspace 风险确认。
 * 关联模块：main.ts、core Agent Runtime、Workspace、Provider、Tool Approval 与 Native 文件 ToolSet。
 * 当前实现：品牌首页、持续输入循环、Home/根目录风险确认、基础斜杠命令、流式回复、Doctor 与 deny/allow-once/allow-session Tool Approval。
 * 职责边界：TUI 只负责终端交互；不得复制 Agent Loop、Provider 协议、Workspace Policy 或 Native 安全逻辑。
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
const orange = `${ESC}38;5;208m`
const cyan = `${ESC}36m`
const green = `${ESC}32m`
const yellow = `${ESC}33m`
const red = `${ESC}31m`
const gray = `${ESC}90m`

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

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
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

export function renderHome(backend: Pick<TerminalBackend, 'version' | 'workspace' | 'agentLabel' | 'providerLabel' | 'providerReady'>): string {
  const providerDot = backend.providerReady ? `${green}●${reset}` : `${yellow}○${reset}`
  const width = 76
  const line = '─'.repeat(width - 2)
  return [
    '',
    `${gray}✦${reset}                 ${orange}${bold}XIAOYU${reset}  ${bold}MANAGEMENT AGENT${reset}`,
    `${dim}                  Model is replaceable. Agent is ours.${reset}`,
    '',
    `${cyan}┌${line}┐${reset}`,
    `${cyan}│${reset} ${bold}Workspace${reset}  ${backend.workspace}`,
    `${cyan}│${reset} ${bold}Agent${reset}      ${backend.agentLabel}`,
    `${cyan}│${reset} ${bold}Brain${reset}      ${providerDot} ${backend.providerLabel}`,
    `${cyan}├${line}┤${reset}`,
    `${cyan}│${reset} 输入消息直接对话；输入 ${bold}/${reset} 查看命令。`,
    `${cyan}│${reset} ${dim}/help  /doctor  /workspace  /provider  /agent  /clear  /exit${reset}`,
    `${cyan}└${line}┘${reset}`,
    `${dim}xiaoyu ${backend.version}${reset}`,
    '',
  ].join('\n')
}

export async function confirmWorkspaceTrust(workspace: string): Promise<boolean> {
  const risk = workspaceRisk(workspace)
  if (!risk.risky) return true
  if (!input.isTTY || !output.isTTY) return false

  const rl = createInterface({ input, output })
  try {
    output.write([
      '',
      `${yellow}${bold}▲ Workspace 安全确认${reset}`,
      '',
      `  ${workspace}`,
      '',
      `  ${risk.reason ?? '该目录包含高权限内容。'}`,
      `  ${red}只有明确需要时才把这么大的目录授权给 Agent。${reset}`,
      '',
      `  ${dim}[1] 退出（推荐）${reset}`,
      `  ${green}[2] 我了解风险，仅本次信任${reset}`,
      '',
    ].join('\n'))
    const answer = (await rl.question('选择 [1/2]: ')).trim()
    return answer === '2'
  } finally {
    rl.close()
  }
}

function writeHelp(): void {
  output.write([
    '',
    `${bold}Xiaoyu Terminal Commands${reset}`,
    '  /help       查看命令',
    '  /doctor     检查当前终端运行环境',
    '  /workspace  查看当前 Workspace',
    '  /provider   查看当前 Brain / Provider',
    '  /agent      查看当前 Agent',
    '  /clear      清屏并重绘首页',
    '  /exit       退出 Xiaoyu',
    '',
  ].join('\n'))
}

function writeDoctor(items: readonly DoctorItem[]): void {
  output.write(`\n${bold}Xiaoyu Doctor${reset}\n`)
  for (const item of items) {
    const icon = item.ok ? `${green}✔${reset}` : `${red}✖${reset}`
    output.write(`  ${icon} ${item.label.padEnd(14)} ${item.detail}\n`)
  }
  output.write('\n')
}

export function approvalDecision(answer: string): ToolApprovalDecision {
  const normalized = answer.trim()
  if (normalized === '2') return 'allow-once'
  if (normalized === '3') return 'allow-session'
  return 'deny'
}

async function requestApproval(rl: ReturnType<typeof createInterface>, request: ToolApprovalRequest, signal: AbortSignal): Promise<ToolApprovalDecision> {
  output.write(`\n${yellow}${bold}◆ Tool Approval${reset}\n`)
  output.write(`  ${bold}${request.toolName}${reset} · ${request.effect}\n`)
  for (const line of request.summary) output.write(`  ${line}\n`)
  output.write(`  ${dim}[1] 拒绝  [2] 仅本次允许  [3] 当前 Session 允许${reset}\n`)
  try {
    return approvalDecision(await rl.question('选择 [1/2/3]: ', { signal }))
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return 'deny'
    throw error
  }
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
    output.write(`${ESC}2J${ESC}H`)
    output.write(renderHome(backend))
    while (true) {
      const line = (await rl.question(`${orange}${bold}xiaoyu${reset} ${gray}›${reset} `)).trim()
      if (!line) continue

      if (line === '/' || line === '/help') {
        writeHelp()
        continue
      }
      if (line === '/exit' || line === '/quit') break
      if (line === '/clear') {
        output.write(`${ESC}2J${ESC}H`)
        output.write(renderHome(backend))
        continue
      }
      if (line === '/workspace') {
        output.write(`\n${bold}Workspace${reset}\n  ${backend.workspace}\n\n`)
        continue
      }
      if (line === '/provider') {
        output.write(`\n${bold}Brain${reset}\n  ${backend.providerLabel}\n\n`)
        continue
      }
      if (line === '/agent') {
        output.write(`\n${bold}Agent${reset}\n  ${backend.agentLabel}\n\n`)
        continue
      }
      if (line === '/doctor') {
        writeDoctor(await backend.doctor())
        continue
      }
      if (line.startsWith('/')) {
        output.write(`${yellow}未知命令：${line}。输入 /help 查看可用命令。${reset}\n`)
        continue
      }

      if (!backend.providerReady) {
        output.write([
          '',
          `${yellow}Brain 尚未配置。${reset}`,
          `当前第一批终端 Runtime 支持通过环境变量连接 OpenAI-compatible Provider：`,
          `  XIAOYU_BASE_URL / XIAOYU_MODEL / XIAOYU_API_KEY（API Key 可选）`,
          `配置后重新运行 xiaoyu；XMA 不会把环境变量里的 Secret 写进 Session。`,
          '',
        ].join('\n'))
        continue
      }

      activeController = new AbortController()
      let wrote = false
      output.write(`\n${cyan}${bold}xiaoyu${reset} `)
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
        output.write(wrote ? '\n\n' : `${dim}(没有文本输出)${reset}\n\n`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        output.write(`\n${red}请求失败：${message}${reset}\n\n`)
      } finally {
        activeController = undefined
      }
    }
  } finally {
    process.off('SIGINT', cancel)
    rl.close()
    await backend.close()
    output.write(`${dim}Xiaoyu 已退出。${reset}\n`)
  }
}
