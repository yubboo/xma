/**
 * 文件作用：回归验证 Xiaoyu OpenTUI Active Renderer 的响应式布局、原生输入依赖边界与禁止旧 ANSI 光标控制合同。
 * 关联模块：apps/cli/opentui-runtime、apps/cli/src/opentui-layout.ts、scripts/gates/distribution.ts。
 * 当前实现：纯 Node 环境检查布局函数、固定版本声明、动态加载入口与 Active Renderer 源码静态合同，不要求本机安装 OpenTUI Native Runtime。
 * 职责边界：本测试不替代 Windows Terminal 的真实光标、IME、鼠标与动画 E2E；这些仍需固定 Bun/OpenTUI 环境实机验收。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { openTuiContentWidth, openTuiSidePadding } from '../src/opentui-layout.ts'

test('OpenTUI content grid uses a wide centered body with symmetric side padding', () => {
  assert.equal(openTuiContentWidth(40), 36)
  assert.equal(openTuiContentWidth(64), 60)
  assert.equal(openTuiContentWidth(112), 102)
  assert.equal(openTuiContentWidth(160), 108)
  assert.equal(openTuiSidePadding(112), 5)
  assert.equal(openTuiSidePadding(160), 26)
})

test('OpenTUI runtime stays pinned to the MiMo-validated dependency baseline', () => {
  const pkg = JSON.parse(readFileSync('apps/cli/opentui-runtime/package.json', 'utf8')) as {
    dependencies?: Record<string, string>
  }
  assert.equal(pkg.dependencies?.['@opentui/core'], '0.1.101')
  assert.equal(pkg.dependencies?.['@opentui/solid'], '0.1.101')
  assert.equal(pkg.dependencies?.['solid-js'], '1.9.10')
})

test('Active OpenTUI source uses native textarea focus and never reintroduces legacy manual cursor control', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /createCliRenderer/)
  assert.match(source, /<textarea/)
  assert.match(source, /cursorColor=\{COLOR\.text\}/)
  assert.match(source, /event\.name === 'tab'/)
  assert.match(source, /prompt\?\.focus\(\)/)
  assert.doesNotMatch(source, /CURSOR_MARKER/)
  assert.doesNotMatch(source, /terminalMouseCaptureSequence/)
  assert.doesNotMatch(source, /\\u001b\[\?25[hl]/)
})

test('CLI loads OpenTUI only for the interactive workbench so doctor/help remain Node-loadable', () => {
  const source = readFileSync('apps/cli/src/main.ts', 'utf8')
  assert.match(source, /await import\('\.\.\/opentui-runtime\/app\.tsx'\)/)
  assert.doesNotMatch(source, /^import .*opentui-runtime\/app\.tsx/m)
})
