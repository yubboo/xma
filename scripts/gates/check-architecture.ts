/**
 * 文件作用：阻止 XMA 核心架构在后续开发中回退或被业务污染。
 * 关联模块：AGENTS.md、core/、agents/、native/。
 * 当前实现：检查关键目录、TypeScript/Rust 边界、Runtime/Context/Provider 分层、Desktop 工程约束和 DeepSeek Harness 兼容层。
 * 职责边界：Gate 只做静态契约检查，不能替代真实测试。
 */

import { existsSync, readFileSync } from 'node:fs'

const required = [
  'AGENTS.md',
  '.cargo/config.toml',
  'core/src/agent.ts',
  'core/src/plugin.ts',
  'core/src/runtime.ts',
  'core/src/session.ts',
  'core/src/session-export.ts',
  'core/src/context.ts',
  'core/src/provider.ts',
  'core/src/tool-schema.ts',
  'core/src/tool-policy.ts',
  'core/src/tools.ts',
  'core/src/native.ts',
  'plugins/providers/builtin.ts',
  'plugins/providers/openai-compatible.ts',
  'plugins/tools/native.ts',
  'apps/desktop/scripts/build-electron.ts',
  'apps/desktop/electron-builder.json',
  'apps/desktop/src-tauri/tauri.conf.json',
  'plugins/compat/deepseek-harness/index.ts',
  'native/protocol/src/lib.rs',
  'native/runtime/src/main.rs',
  'docs/architecture/PROJECT-ARCHITECTURE.md',
  'docs/architecture/AGENT-RUNTIME.md',
  'docs/architecture/MODEL-PROVIDER.md',
  'docs/architecture/PLUGIN-SYSTEM.md',
  'docs/development/UPSTREAM-REFERENCE.md',
  'docs/security/NATIVE-CAPABILITIES.md',
]
for (const path of required) if (!existsSync(path)) throw new Error(`XMA Architecture Gate: missing ${path}`)


const runtimeDoc = readFileSync('docs/architecture/AGENT-RUNTIME.md', 'utf8')
for (const marker of ['Session', 'Turn', 'Step', 'Model-visible', 'ToolPlan', 'Tool Pipeline']) {
  if (!runtimeDoc.includes(marker)) throw new Error(`XMA Agent Runtime architecture marker missing: ${marker}`)
}
const providerDoc = readFileSync('docs/architecture/MODEL-PROVIDER.md', 'utf8')
for (const marker of ['Provider Capabilities', 'Model Catalog', 'Brain Ready Probe', 'Conformance Tests']) {
  if (!providerDoc.includes(marker)) throw new Error(`XMA Model Provider architecture marker missing: ${marker}`)
}


const contextSource = readFileSync('core/src/context.ts', 'utf8')
for (const marker of ['class ContextRegistry', 'maxCharacters', 'sha256', 'sourceId']) {
  if (!contextSource.includes(marker)) throw new Error(`XMA Context architecture marker missing: ${marker}`)
}
const sessionSource = readFileSync('core/src/session.ts', 'utf8')
for (const marker of ["type: 'context/snapshot'", 'contextDigest', 'requestContextForStep', 'requestMessagesForStep']) {
  if (!sessionSource.includes(marker)) throw new Error(`XMA Session reconstruction marker missing: ${marker}`)
}
const exportSource = readFileSync('core/src/session-export.ts', 'utf8')
for (const marker of ['SessionExportEnvelope', 'redacted: boolean', 'SessionMigrationRegistry']) {
  if (!exportSource.includes(marker)) throw new Error(`XMA Session export/migration marker missing: ${marker}`)
}
const providerSource = readFileSync('core/src/provider.ts', 'utf8')
for (const marker of ['ProviderRegistry', 'ProviderCapabilities', 'CredentialReference', 'BrainReadyProbeResult', 'ProviderRequestError']) {
  if (!providerSource.includes(marker)) throw new Error(`XMA Provider architecture marker missing: ${marker}`)
}
const providerAdapter = readFileSync('plugins/providers/openai-compatible.ts', 'utf8')
for (const marker of ["OPENAI_COMPATIBLE_ADAPTER_ID", "chat/completions", 'sseData', 'probe(']) {
  if (!providerAdapter.includes(marker)) throw new Error(`XMA OpenAI-compatible adapter marker missing: ${marker}`)
}
const toolsSource = readFileSync('core/src/tools.ts', 'utf8')
for (const marker of ['class ToolPlan', 'class ToolRouter', 'createPlan()', 'validateToolArguments', 'dispatchMany']) {
  if (!toolsSource.includes(marker)) throw new Error(`XMA ToolPlan architecture marker missing: ${marker}`)
}
const policySource = readFileSync('core/src/tool-policy.ts', 'utf8')
for (const marker of ['DefaultToolPolicy', 'ToolSecurityGuard', 'ToolApprovalProvider', 'allow-session']) {
  if (!policySource.includes(marker)) throw new Error(`XMA Tool Policy architecture marker missing: ${marker}`)
}
const nativeBridge = readFileSync('core/src/native.ts', 'utf8')
for (const marker of ['NativeCapabilityKind', 'NativeHostPolicy', 'issueCapability', 'runProcess', 'shell: false', '绝对可执行文件身份白名单']) {
  if (!nativeBridge.includes(marker)) throw new Error(`XMA Native bridge marker missing: ${marker}`)
}
const nativeTools = readFileSync('plugins/tools/native.ts', 'utf8')
for (const marker of ['native.fs.read_text', 'native.fs.write_text', 'native.process.run', 'issueCapability', 'programs: [program]']) {
  if (!nativeTools.includes(marker)) throw new Error(`XMA Native tool marker missing: ${marker}`)
}
const nativeProtocol = readFileSync('native/protocol/src/lib.rs', 'utf8')
for (const marker of ['filesystem.read', 'filesystem.write', 'process.spawn']) {
  if (!nativeProtocol.includes(marker)) throw new Error(`XMA Native protocol capability marker missing: ${marker}`)
}
const nativeRuntime = readFileSync('native/runtime/src/main.rs', 'utf8')
for (const marker of ['configure_policy', 'take_capability', 'fs::canonicalize', 'canonicalize_program', 'Command::new', 'process/run', 'absolute executable path']) {
  if (!nativeRuntime.includes(marker)) throw new Error(`XMA Native runtime security marker missing: ${marker}`)
}
const runtimeSource = readFileSync('core/src/runtime.ts', 'utf8')
if (runtimeSource.includes('chat/completions') || runtimeSource.includes('Authorization')) {
  throw new Error('XMA Core Runtime must not contain provider-specific HTTP/auth protocol details')
}
const modelSource = readFileSync('core/src/model.ts', 'utf8')
if (modelSource.includes('chat/completions') || modelSource.includes('x-api-key')) {
  throw new Error('XMA model Contract must remain provider-neutral')
}

const agents = readFileSync('core/src/agent.ts', 'utf8')
if (!agents.includes('provider.stream') || !agents.includes('createPlan()') || !agents.includes('createRouter()')) {
  throw new Error('XMA Agent Loop must remain Model -> frozen ToolPlan/Router -> Observation -> Model')
}
if (!runtimeSource.includes('toolPlanId: toolPlan.id') || !runtimeSource.includes('toolRouter.dispatchMany')) {
  throw new Error('XMA Runtime must bind each Step to one frozen ToolPlan and execute through its ToolRouter')
}
const compat = readFileSync('plugins/compat/deepseek-harness/index.ts', 'utf8')
for (const marker of ['inject', 'apply(context']) if (!compat.includes(marker)) throw new Error(`DeepSeek Harness compatibility marker missing: ${marker}`)


const cargoConfig = readFileSync('.cargo/config.toml', 'utf8')
if (!cargoConfig.includes('target-dir = ".cache/cargo-target"')) {
  throw new Error('XMA Cargo build cache must live under .cache/cargo-target instead of root target/')
}

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
const webBuild = rootPackage.scripts?.['build:web'] ?? ''
if (!webBuild.includes('--emptyOutDir')) throw new Error('XMA Web build must explicitly empty the external dist/web output directory')
const cliBuild = rootPackage.scripts?.['build:cli'] ?? ''
if (cliBuild.includes('--banner')) throw new Error('XMA CLI build must not use unsupported tsup --banner CLI flags')
const cliSource = readFileSync('apps/cli/src/main.ts', 'utf8')
if (!cliSource.startsWith('#!/usr/bin/env node')) throw new Error('XMA CLI entry must carry its own Node hashbang')

const desktopPackage = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')) as { scripts?: Record<string, string> }
const desktopScripts = Object.values(desktopPackage.scripts ?? {}).join('\n').replaceAll('\\', '/')
for (const legacy of ['apps/desktop/dist', 'apps/desktop/web', 'apps/desktop/release', 'apps/desktop/native']) {
  if (desktopScripts.includes(legacy)) throw new Error(`XMA Desktop must not emit app-local build output: ${legacy}`)
}
const desktopTauriWebBuild = desktopPackage.scripts?.['web:build:tauri'] ?? ''
for (const marker of ['.cache/desktop/tauri/web', '--emptyOutDir', '--base ./']) {
  if (!desktopTauriWebBuild.includes(marker)) throw new Error(`XMA Tauri Web staging contract missing: ${marker}`)
}
const desktopDevMainBuild = desktopPackage.scripts?.['main:build:dev'] ?? ''
if (!desktopDevMainBuild.includes('.cache/desktop/electron/dev/main')) throw new Error('XMA Electron dev Main Process must build under .cache/desktop')
const desktopElectronBuild = desktopPackage.scripts?.['build:electron'] ?? ''
if (!desktopElectronBuild.includes('apps/desktop/scripts/build-electron.ts')) throw new Error('XMA Electron release build must use the unified build orchestrator')
const desktopWebDev = desktopPackage.scripts?.['web:dev'] ?? ''
if (!desktopWebDev.includes('exec vite apps/web --host 127.0.0.1 --port 1420 --strictPort')) {
  throw new Error('XMA Desktop web:dev must bind Vite to 127.0.0.1:1420 without forwarding a literal -- argument')
}
if (desktopWebDev.includes(' -- --host')) throw new Error('XMA Desktop web:dev must not pass a literal -- to Vite')
const electronBuildSource = readFileSync('apps/desktop/scripts/build-electron.ts', 'utf8')
for (const marker of ["'.cache', 'desktop', 'electron', 'app'", "'dist', 'release', 'electron'", "'--base', './'", "'--emptyOutDir'", 'ELECTRON_CACHE: electronCache', 'ELECTRON_BUILDER_CACHE: builderCache']) {
  if (!electronBuildSource.includes(marker)) throw new Error(`XMA Electron unified output contract missing: ${marker}`)
}
const electronBuilder = JSON.parse(readFileSync('apps/desktop/electron-builder.json', 'utf8')) as { electronVersion?: string; files?: string[] }
if (electronBuilder.electronVersion !== '41.2.0') throw new Error('XMA Electron builder template must pin Electron 41.2.0')
if (JSON.stringify(electronBuilder.files) !== JSON.stringify(['main/**', 'web/**', 'package.json'])) throw new Error('XMA Electron builder must package only staged main/web/package.json')
const tauriConfig = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8')) as { build?: { frontendDist?: string; beforeBuildCommand?: string } }
if (tauriConfig.build?.frontendDist !== '../../../.cache/desktop/tauri/web') throw new Error('XMA Tauri frontendDist must use .cache/desktop/tauri/web')
if (tauriConfig.build?.beforeBuildCommand !== 'pnpm run web:build:tauri') throw new Error('XMA Tauri build must use the dedicated cache-staging Web build')
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
