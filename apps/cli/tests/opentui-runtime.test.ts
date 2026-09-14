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
  assert.equal(openTuiContentWidth(40), 40)
  assert.equal(openTuiContentWidth(64), 56)
  assert.equal(openTuiContentWidth(112), 92)
  assert.equal(openTuiContentWidth(160), 132)
  assert.equal(openTuiSidePadding(112), 10)
  assert.equal(openTuiSidePadding(160), 14)
})

test('OpenTUI runtime stays pinned to the MiMo-validated dependency baseline', () => {
  const pkg = JSON.parse(readFileSync('apps/cli/opentui-runtime/package.json', 'utf8')) as {
    dependencies?: Record<string, string>
  }
  assert.equal(pkg.dependencies?.['@opentui/core'], '0.1.101')
  assert.equal(pkg.dependencies?.['@opentui/solid'], '0.1.101')
  assert.equal(pkg.dependencies?.['solid-js'], '1.9.11')
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


test('OpenTUI build uses an explicit supported Bun compile target map', () => {
  const source = readFileSync('apps/cli/opentui-runtime/build.ts', 'utf8')
  for (const target of [
    'bun-windows-x64',
    'bun-windows-arm64',
    'bun-darwin-x64',
    'bun-darwin-arm64',
    'bun-linux-x64',
    'bun-linux-arm64',
  ]) assert.match(source, new RegExp(target))
  assert.doesNotMatch(source, /`bun-\$\{platformName\}-\$\{process\.arch\}`/)
})

test('OpenTUI visual migration preserves the existing Xiaoyu prompt rail instead of redesigning the workbench', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /placeholder="输入消息…（输入 \/ 唤起命令）"/)
  assert.ok((source.match(/<text fg=\{MODE_META\[mode\(\)\]\.color\}>▌<\/text>/g) ?? []).length >= 3)
  assert.doesNotMatch(source, /borderColor=\{COLOR\.faint\}/)
})

test('CLI loads OpenTUI only for the interactive workbench so doctor/help remain Node-loadable', () => {
  const source = readFileSync('apps/cli/src/main.ts', 'utf8')
  assert.match(source, /await import\('\.\.\/opentui-runtime\/app\.tsx'\)/)
  assert.doesNotMatch(source, /^import .*opentui-runtime\/app\.tsx/m)
})


test('Bun OpenTUI runner uses the runtime cwd and forbids implicit dependency downloads', () => {
  const source = readFileSync('scripts/cli/bun.ts', 'utf8')
  assert.match(source, /const runtimeRoot = path\.join\(root, 'apps', 'cli', 'opentui-runtime'\)/)
  assert.match(source, /const devArguments = forwarded\.length > 0 \? forwarded : \[root\]/)
  assert.match(source, /\['run', '--no-install', '\.\.\/src\/main\.ts', \.\.\.devArguments\]/)
  assert.match(source, /cwd: runtimeRoot/)
  assert.doesNotMatch(source, /\['--cwd'/)
})


test('OpenTUI logo keeps five glyph rows contiguous instead of inserting a blank row between every line', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  const logoStart = source.indexOf('function Logo(')
  const listStart = source.indexOf('function ListDialog(')
  const logoSource = source.slice(logoStart, listStart)
  assert.match(logoSource, /<box flexDirection="column" alignItems="center" backgroundColor=\{COLOR\.background\}>/)
  assert.match(logoSource, /<box flexDirection="column" backgroundColor=\{COLOR\.background\}>\s*<For each=\{LOGO_XIAO\}>/)
  assert.doesNotMatch(logoSource, /alignItems="center" gap=\{1\}/)
})

test('OpenTUI command palette backdrop never treats ordinary mouse clicks as Esc/back', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  const listStart = source.indexOf('function ListDialog(')
  const inputStart = source.indexOf('function SecretInput(')
  const listSource = source.slice(listStart, inputStart)
  assert.match(listSource, /event\.name === 'escape'/)
  assert.match(listSource, /onMouseUp=\{event => event\.stopPropagation\(\)\}/)
  assert.doesNotMatch(listSource, /onMouseUp=\{\(\) => finish\(undefined\)\}/)
})

test('OpenTUI vivid home uses a pixel sky with intermittent meteors and a centered dock card', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /const SKY_STARS = \[/)
  assert.match(source, /const METEOR_TRACKS = \[/)
  assert.match(source, /function BackgroundSky\(props: \{ width: number; height: number; frame: number; vivid: boolean \}\)/)
  assert.match(source, /backgroundColor=\{showLogo\(\) \? COLOR\.panel : COLOR\.background\}/)
  assert.match(source, /justifyContent=\{centerMode\(\) \? 'center' : 'flex-end'\}/)
})

test('Chinese comment gate never recursively enters the OpenTUI dependency island', () => {
  const source = readFileSync('scripts/gates/comments.ts', 'utf8')
  assert.match(source, /ignoredDirectories/)
  assert.match(source, /'node_modules'/)
  assert.match(source, /function hasIgnoredSegment/)
  assert.match(source, /const explicitFiles = \['apps\/cli\/opentui-runtime\/app\.tsx', 'apps\/cli\/opentui-runtime\/build\.ts'\]/)
  const rootsLine = source.split('\n').find(line => line.startsWith('const roots = ')) ?? ''
  assert.doesNotMatch(rootsLine, /apps\/cli\/opentui-runtime/)
})

test('OpenTUI live response uses a buffered typewriter and visible thinking state', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /const streamPump = setInterval\(pumpRunEvents, 30\)/)
  assert.match(source, /event => enqueueRunEvent\(event\)/)
  assert.match(source, /await waitForEventDrain\(\)/)
  assert.match(source, /role: 'reasoning', text: '', placeholder: true/)
  assert.match(source, /正在思考…/)
  assert.match(source, /正在生成回复…/)
})
