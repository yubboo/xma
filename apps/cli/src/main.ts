/**
 * 文件作用：XMA 命令行/TUI 的第一入口，提供产品化终端欢迎界面。
 * 关联模块：core、未来 Session/Agent Runtime、各 agents/*。
 * 当前实现：显示品牌、真实 Provider 未配置状态、专业 Agent 列表和基础命令提示。
 * 职责边界：CLI 只是 Shell，不得复制 Agent Loop 或创建“CLI 专用大脑”。
 */

import { codeAgent } from '../../../agents/code/agent.ts'
import { minecraftAgent } from '../../../agents/minecraft/agent.ts'
import { writerAgent } from '../../../agents/writer/agent.ts'

const ESC = '\u001b['
const clear = `${ESC}2J${ESC}H`
const cyan = `${ESC}36m`
const green = `${ESC}32m`
const dim = `${ESC}2m`
const reset = `${ESC}0m`

function render(): string {
  const agents = [minecraftAgent, codeAgent, writerAgent]
  const width = 72
  const line = '─'.repeat(width - 2)
  const rows = agents.map(agent => `│ ${agent.status === 'priority-development' ? '●' : '○'} ${agent.name.padEnd(22)} ${dim}${agent.description}${reset}`)
  return [
    clear,
    `${cyan}┌${line}┐${reset}`,
    `${cyan}│${reset} XMA · Xiaoyu Management Agent`.padEnd(width + 8) + `${cyan}│${reset}`,
    `${cyan}│${reset} ${green}Model is replaceable. Agent is ours.${reset}`.padEnd(width + 18) + `${cyan}│${reset}`,
    `${cyan}├${line}┤${reset}`,
    `${cyan}│${reset} Brain      未配置真实 Provider`.padEnd(width + 8) + `${cyan}│${reset}`,
    `${cyan}│${reset} Workspace  未选择`.padEnd(width + 8) + `${cyan}│${reset}`,
    `${cyan}├${line}┤${reset}`,
    ...rows.map(row => `${cyan}${row}${reset}`),
    `${cyan}├${line}┤${reset}`,
    `${cyan}│${reset} > /agent  /provider  /workspace  /plugins  /doctor  /help`.padEnd(width + 8) + `${cyan}│${reset}`,
    `${cyan}└${line}┘${reset}`,
  ].join('\n')
}

process.stdout.write(render() + '\n')
