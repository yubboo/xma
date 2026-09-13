/**
 * 文件作用：阻止 XMA 核心架构在后续开发中回退或被业务污染。
 * 关联模块：AGENTS.md、core/、agents/、native/。
 * 当前实现：检查关键目录、语言边界、旧式 Go Core 回流和 DeepSeek Harness 兼容层。
 * 职责边界：Gate 只做静态契约检查，不能替代真实测试。
 */

import { existsSync, readFileSync } from 'node:fs'

const required = [
  'AGENTS.md',
  'core/src/agent.ts',
  'core/src/plugin.ts',
  'plugins/compat/deepseek-harness/index.ts',
  'native/protocol/src/lib.rs',
  'native/runtime/src/main.rs',
  'docs/architecture/PROJECT-ARCHITECTURE.md',
  'docs/architecture/PLUGIN-SYSTEM.md',
]
for (const path of required) if (!existsSync(path)) throw new Error(`XMA Architecture Gate: missing ${path}`)

const agents = readFileSync('core/src/agent.ts', 'utf8')
if (!agents.includes('provider.stream') || !agents.includes('tools.execute')) throw new Error('XMA Agent Loop must remain Model -> Tool -> Observation -> Model')
const compat = readFileSync('plugins/compat/deepseek-harness/index.ts', 'utf8')
for (const marker of ['inject', 'apply(context']) if (!compat.includes(marker)) throw new Error(`DeepSeek Harness compatibility marker missing: ${marker}`)

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
const webBuild = rootPackage.scripts?.['build:web'] ?? ''
if (!webBuild.includes('--emptyOutDir')) throw new Error('XMA Web build must explicitly empty the external dist/web output directory')
const cliBuild = rootPackage.scripts?.['build:cli'] ?? ''
if (cliBuild.includes('--banner')) throw new Error('XMA CLI build must not use unsupported tsup --banner CLI flags')
const cliSource = readFileSync('apps/cli/src/main.ts', 'utf8')
if (!cliSource.startsWith('#!/usr/bin/env node')) throw new Error('XMA CLI entry must carry its own Node hashbang')

const desktopPackage = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')) as { scripts?: Record<string, string> }
const desktopWebBuild = desktopPackage.scripts?.['web:build'] ?? ''
if (!desktopWebBuild.includes('--emptyOutDir')) throw new Error('XMA Desktop web build must explicitly empty apps/desktop/web')
if (!desktopWebBuild.includes('--base ./')) throw new Error('XMA Desktop packaged Web UI must use relative Vite asset paths for Electron file:// loading')
const desktopWebDev = desktopPackage.scripts?.['web:dev'] ?? ''
if (!desktopWebDev.includes('exec vite apps/web --host 127.0.0.1 --port 1420 --strictPort')) {
  throw new Error('XMA Desktop web:dev must bind Vite to 127.0.0.1:1420 without forwarding a literal -- argument')
}
if (desktopWebDev.includes(' -- --host')) throw new Error('XMA Desktop web:dev must not pass a literal -- to Vite')
const desktopLauncher = readFileSync('apps/desktop/scripts/dev-electron.ts', 'utf8')
if (desktopLauncher.includes('shell: true') || desktopLauncher.includes("shell: process.platform === 'win32'")) {
  throw new Error('XMA Desktop launcher must not use shell:true with child-process arguments (Node DEP0190)')
}
const desktopMain = readFileSync('apps/desktop/src/main.ts', 'utf8')
for (const marker of ["label: '文件'", "label: '编辑'", "label: '视图'", "label: '窗口'", "label: '帮助'"]) {
  if (!desktopMain.includes(marker)) throw new Error(`XMA Desktop Chinese menu regression: missing ${marker}`)
}
const webIndex = readFileSync('apps/web/index.html', 'utf8')
if (!webIndex.includes('lang="zh-CN"') || !webIndex.includes('<title>XMA · 小鱼管理智能体</title>')) {
  throw new Error('XMA Web/Desktop shell must declare the Chinese UI locale and title')
}

console.log('XMA Architecture Gate PASS (TypeScript Agent + Rust Native + plugin compatibility)')
