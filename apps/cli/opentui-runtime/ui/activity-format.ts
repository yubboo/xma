/**
 * 文件作用：把 Runtime 公开 Tool 事件转换为 Terminal Activity 文案，并统一做敏感信息脱敏。
 * 关联模块：app.tsx、tui.ts、transcript-viewport.tsx。
 * 职责边界：只格式化允许公开的活动摘要；不得泄露 reasoning 正文、Secret 或改变 Tool 执行语义。
 */

import type { TerminalRunEvent } from '../contracts.ts'

function redactActivityText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/(api[_-]?key|token|password|secret)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2***')
}

function compactActivityText(value: string, max = 160): string {
  const compact = redactActivityText(value.replace(/\s+/g, ' ').trim())
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

export function toolCallActivityText(event: Extract<TerminalRunEvent, { type: 'tool-call' }>): string {
  const args = event.arguments
  if (event.name === 'native.fs.read_text') {
    const path = typeof args.path === 'string' ? compactActivityText(args.path, 120) : ''
    return path ? `读取文件 · ${path}` : '读取文件'
  }
  if (event.name === 'native.fs.write_text') {
    const path = typeof args.path === 'string' ? compactActivityText(args.path, 120) : ''
    const length = typeof args.content === 'string' ? Array.from(args.content).length : undefined
    return `写入文件${path ? ` · ${path}` : ''}${length !== undefined ? ` · ${length} 字符` : ''}`
  }
  if (event.name === 'native.process.run') {
    const program = typeof args.program === 'string' ? compactActivityText(args.program, 100) : '程序'
    const rawArgv = Array.isArray(args.args) ? args.args.filter((value): value is string => typeof value === 'string') : []
    const safeArgv: string[] = []
    let redactNext = false
    for (const raw of rawArgv.slice(0, 10)) {
      const arg = compactActivityText(raw, 60)
      if (redactNext) {
        safeArgv.push('***')
        redactNext = false
        continue
      }
      if (/^--?(?:api[_-]?key|token|password|secret|authorization)$/i.test(arg)) {
        safeArgv.push(arg)
        redactNext = true
        continue
      }
      safeArgv.push(arg)
    }
    const suffix = rawArgv.length > safeArgv.length ? ' …' : ''
    return `运行程序 · ${program}${safeArgv.length > 0 ? ` ${safeArgv.join(' ')}${suffix}` : ''}`
  }
  const visibleArgs = Object.entries(args)
    .filter(([key]) => !/(content|api[_-]?key|token|password|secret|authorization)/i.test(key))
    .slice(0, 4)
    .map(([key, value]) => `${key}=${compactActivityText(typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value)), 56)}`)
  return `调用工具 · ${event.name}${visibleArgs.length > 0 ? ` · ${visibleArgs.join(' ')}` : ''}`
}

export function toolResultActivityText(event: Extract<TerminalRunEvent, { type: 'tool-result' }>): string {
  if (event.ok) return `完成 · ${event.name}`
  const detail = compactActivityText(event.content, 120)
  return `失败 · ${event.name}${detail ? ` · ${detail}` : ''}`
}
