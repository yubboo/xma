import assert from 'node:assert/strict'
import { test } from 'node:test'
import { terminalAssistantText } from '../opentui-runtime/ui/transcript-text.ts'

test('Terminal assistant text removes visible Markdown control markers without losing content', () => {
  const input = [
    '- **代码开发**：编写、重构、调试代码',
    '- **测试验证**：运行测试、检查结果',
    '### 工作计划',
    '使用 `pnpm test` 验证。',
  ].join('\n')
  assert.equal(
    terminalAssistantText(input),
    [
      '• 代码开发：编写、重构、调试代码',
      '• 测试验证：运行测试、检查结果',
      '工作计划',
      '使用 pnpm test 验证。',
    ].join('\n'),
  )
})

test('Terminal assistant text preserves fenced code body while hiding fence markers', () => {
  const input = ['```ts', 'const power = a ** b', '# not a heading inside code', '```'].join('\n')
  assert.equal(terminalAssistantText(input), ['const power = a ** b', '# not a heading inside code'].join('\n'))
})
