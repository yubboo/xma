/**
 * 文件作用：把模型常见 Markdown 文本投影成适合终端普通 Text Renderable 的干净可读文本。
 * 关联模块：transcript-viewport.tsx、Terminal Transcript 回归测试。
 * 职责边界：只做 Host 展示层的有限 Markdown 清理；不得改写 Provider 原文语义，也不得处理用户输入或 Runtime 状态。
 */

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^([ \t]{0,3})#{1,6}[ \t]+/, '$1')
    .replace(/^([ \t]*)[-*+][ \t]+/, '$1• ')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, '$1 ($2)')
}

/**
 * OpenTUI 当前 Transcript 使用普通 <text>，因此只转换最常见、最影响可读性的 Markdown 标记。
 * fenced code 内文保持逐字内容，围栏本身不显示，避免把代码中的 * / # / ` 当作 Markdown 清掉。
 */
export function terminalAssistantText(value: string): string {
  let fenced = false
  const output: string[] = []
  for (const line of value.split('\n')) {
    if (/^[ \t]*```/.test(line)) {
      fenced = !fenced
      continue
    }
    output.push(fenced ? line : cleanMarkdownLine(line))
  }
  return output.join('\n')
}
