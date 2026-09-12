/**
 * 文件作用：防止 XMA Windows 固定工作流脚本在后续开发中被删坏或体验回退。
 * 关联模块：XMA.bat、XMA-Sync.bat、XMA-GitHub.bat、scripts/windows/*.ps1。
 * 当前实现：检查文件存在、PS1 UTF-8 BOM + CRLF、菜单推荐项、仓库/目标目录和窗口保留提示。
 * 职责边界：这里只检查静态约定，真实 Windows 行为仍必须由 Windows CI/用户环境验证。
 */

import { existsSync, readFileSync } from 'node:fs'

const required = [
  'XMA.bat', 'XMA-Sync.bat', 'XMA-GitHub.bat',
  'scripts/windows/xma-common.ps1',
  'scripts/windows/xma-console.ps1',
  'scripts/windows/xma-sync.ps1',
  'scripts/windows/xma-prepare.ps1',
  'scripts/windows/xma-github.ps1',
  'scripts/windows/xma-build-release.ps1',
]
for (const file of required) if (!existsSync(file)) throw new Error(`Windows helper missing: ${file}`)

for (const file of required.filter(file => file.endsWith('.ps1'))) {
  const bytes = readFileSync(file)
  if (!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) throw new Error(`PowerShell 5.1 UTF-8 BOM missing: ${file}`)
  const text = bytes.toString('utf8')
  if (!text.includes('\r\n')) throw new Error(`PowerShell CRLF missing: ${file}`)
}

// Windows PowerShell 5.1 默认文本编码不是 UTF-8。
// 所有读取 package.json 的脚本必须显式指定 -Encoding UTF8，否则中文元数据会被误解码并导致 ConvertFrom-Json 失败。
for (const file of required.filter(file => file.endsWith('.ps1'))) {
  const text = readFileSync(file, 'utf8')
  if (text.includes('package.json') && text.includes('Get-Content') && !text.includes('-Encoding UTF8')) {
    throw new Error(`PowerShell package.json read must declare UTF-8 explicitly: ${file}`)
  }
}


// PowerShell `$args` 是自动变量（大小写不敏感），不能作为自定义外部命令参数名。
// xma-prepare.ps1 现在只准备系统工具；项目依赖必须在运行/构建时惰性安装。
const prepareSource = readFileSync('scripts/windows/xma-prepare.ps1', 'utf8')
if (/\[string\[\]\]\$Args\b/i.test(prepareSource)) throw new Error('xma-prepare.ps1 must not use PowerShell automatic variable $args as a parameter')
for (const marker of [
  "Invoke-XmaExternal -FilePath 'rustup.exe' -ArgumentList @('toolchain','install','stable','--profile','minimal')",
  "Invoke-XmaExternal -FilePath 'rustup.exe' -ArgumentList @('default','stable')",
  '[检查] 正在检查 Git 是否可用...',
  '[完成] XMA 基础开发环境准备完成。',
  '不会执行 pnpm install、cargo fetch，也不会下载任何项目依赖',
]) {
  if (!prepareSource.includes(marker)) throw new Error(`XMA base-environment contract regression: missing ${marker}`)
}
for (const forbidden of [
  "-ArgumentList @('install')",
  "-ArgumentList @('fetch')",
  "--filter','@xma/desktop'",
  "-ArgumentList @('fetch')",
]) {
  if (prepareSource.includes(forbidden)) throw new Error(`Base environment preparation must not download project dependencies: ${forbidden}`)
}

// 所有会执行外部命令的 Windows 入口必须复用 xma-common.ps1。
// 历史问题：多个脚本各自声明 [string[]]$Args，触发 PowerShell 自动变量 $args 冲突，
// 导致 `pnpm check`、`rustup default stable` 等命令退化成裸 `pnpm` / `rustup`。
const commonSource = readFileSync('scripts/windows/xma-common.ps1', 'utf8')
for (const marker of [
  'function Invoke-XmaExternal',
  '& $FilePath @ArgumentList',
  'function Get-XmaProjectVersion',
  '-Encoding UTF8',
]) {
  if (!commonSource.includes(marker)) throw new Error(`XMA Windows common helper regression: missing ${marker}`)
}
if (/\[string\[\]\]\$Args\b/i.test(commonSource)) throw new Error('xma-common.ps1 must never use PowerShell automatic variable $args as a parameter')

for (const file of [
  'scripts/windows/xma-prepare.ps1',
  'scripts/windows/xma-github.ps1',
  'scripts/windows/xma-console.ps1',
  'scripts/windows/xma-build-release.ps1',
]) {
  const text = readFileSync(file, 'utf8')
  if (!text.includes(". (Join-Path $PSScriptRoot 'xma-common.ps1')")) {
    throw new Error(`Windows helper must reuse xma-common.ps1: ${file}`)
  }
  if (/function\s+(?:Run|Invoke-External)\b/.test(text)) {
    throw new Error(`Windows helper must not define a private external-command runner: ${file}`)
  }
  if (/\[string\[\]\]\$Args\b/i.test(text) || /@Args\b/i.test(text)) {
    throw new Error(`PowerShell automatic $args regression detected: ${file}`)
  }
}

const githubSource = readFileSync('scripts/windows/xma-github.ps1', 'utf8')
for (const forbidden of ['xma-prepare.ps1', "pnpm.cmd", "cargo.exe", "rustup.exe", "winget.exe", "npm.cmd", 'electron', 'tauri']) {
  if (githubSource.includes(forbidden)) throw new Error(`GitHub helper must be pure Git and must not prepare/download dependencies: ${forbidden}`)
}
for (const marker of [
  '纯 Git',
  'git.exe',
  'Test-ForbiddenGitPath',
  'Assert-StagedFilesSafe',
  'git.exe ls-files --cached --others --exclude-standard',
  "git.exe' -ArgumentList @('add','-A')",
  "git.exe' -ArgumentList @('push','-u','origin','main')",
]) {
  if (!githubSource.includes(marker)) throw new Error(`GitHub helper pure-Git contract regression: missing ${marker}`)
}

const gitignoreSource = readFileSync('.gitignore', 'utf8')
for (const marker of [
  'node_modules/', '.pnpm-store/', 'dist/', 'build/', '/runtime/', '.xma/', 'workspaces/',
  'native/target/', '**/target/', 'apps/desktop/release/', '.env', '*.pem', '*.key', '*.exe', '*.zip',
]) {
  if (!gitignoreSource.includes(marker)) throw new Error(`.gitignore repository hygiene regression: missing ${marker}`)
}


const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies?: Record<string, string> }
for (const forbiddenDesktopRuntime of ['electron', 'electron-builder', '@tauri-apps/cli', '@tauri-apps/api']) {
  if (rootPackage.devDependencies?.[forbiddenDesktopRuntime]) {
    throw new Error(`${forbiddenDesktopRuntime} must never be a root/common dependency`)
  }
}

const desktopPackage = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}
if (desktopPackage.devDependencies?.electron !== '41.2.0') throw new Error('Electron primary runtime must be pinned exactly to 41.2.0')
if (!desktopPackage.devDependencies?.['electron-builder']) throw new Error('electron-builder missing from Desktop primary runtime')
if (!desktopPackage.devDependencies?.['@tauri-apps/cli']) throw new Error('Tauri 2 CLI dependency missing from Desktop fallback')
if (!desktopPackage.dependencies?.['@tauri-apps/api']) throw new Error('Tauri 2 API dependency missing from Desktop fallback')
for (const script of ['dev:electron', 'build:electron', 'dev:tauri', 'build:tauri']) {
  if (!desktopPackage.scripts?.[script]) throw new Error(`Desktop runtime script missing: ${script}`)
}
for (const file of [
  'apps/desktop/src/main.ts',
  'apps/desktop/scripts/dev-electron.ts',
  'apps/desktop/electron-builder.yml',
  'apps/desktop/src-tauri/Cargo.toml',
  'apps/desktop/src-tauri/build.rs',
  'apps/desktop/src-tauri/src/main.rs',
  'apps/desktop/src-tauri/tauri.conf.json',
]) {
  if (!existsSync(file)) throw new Error(`Desktop runtime file missing: ${file}`)
}

const workspaceSource = readFileSync('pnpm-workspace.yaml', 'utf8')
for (const marker of ['allowBuilds:', 'electron: true', 'esbuild: true']) {
  if (!workspaceSource.includes(marker)) throw new Error(`pnpm 11 build-script allowlist regression: missing ${marker}`)
}
if (workspaceSource.includes('dangerouslyAllowAllBuilds')) throw new Error('pnpm workspace must never enable dangerouslyAllowAllBuilds')

const consoleSource = readFileSync('scripts/windows/xma-console.ps1', 'utf8')
for (const marker of [
  '[1] 一键准备基础环境',
  '← 推荐首次运行',
  '[3] 开发运行 · Desktop',
  'Electron 41.2.0',
  'Tauri 2',
  '主 / 推荐',
  '副 / 备用',
  "@('--filter','xma','install','--ignore-scripts')",
  "@('--filter','@xma/desktop','install','--ignore-scripts')",
  "@('--dir','apps/desktop','rebuild','electron')",
  "@('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')",
  '@electron/get',
  'ELECTRON_GET_USE_PROXY',
  "@('check','--workspace','--offline')",
  "@('test','--workspace','--offline')",
]) {
  if (!consoleSource.includes(marker)) throw new Error(`XMA console lazy-dependency/runtime contract missing: ${marker}`)
}
if (consoleSource.includes("pnpm.cmd' -ArgumentList @('install')")) {
  throw new Error('XMA console must not perform an unscoped pnpm install')
}
for (const marker of ['https://github.com/yubboo/xma.git', '[1] 一键推送', 'ForegroundColor Green']) {
  if (!githubSource.includes(marker)) throw new Error(`XMA GitHub helper marker missing: ${marker}`)
}
const syncSource = readFileSync('scripts/windows/xma-sync.ps1', 'utf8')
if (!syncSource.includes('H:\\一键部署\\xma')) throw new Error('XMA sync target contract missing')
if (!syncSource.includes("(Join-Path $Source 'runtime')")) throw new Error('XMA sync must exclude only root runtime, not native/runtime source')
if (syncSource.includes("'runtime','.xma'")) throw new Error('Generic runtime directory exclusion would drop native/runtime source')

for (const bat of required.filter(file => file.endsWith('.bat'))) {
  const text = readFileSync(bat, 'utf8')
  if (!text.toLowerCase().includes('pause')) throw new Error(`BAT must keep result window open: ${bat}`)
}
console.log('XMA Windows Helper Gate PASS')
