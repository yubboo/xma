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
// 否则 Invoke-XmaExternal 可能吞掉 rustup/winget/npm/pnpm/cargo 的参数，退化成裸命令。
const prepareSource = readFileSync('scripts/windows/xma-prepare.ps1', 'utf8')
if (/\[string\[\]\]\$Args\b/i.test(prepareSource)) throw new Error('xma-prepare.ps1 must not use PowerShell automatic variable $args as a parameter')
for (const marker of [
  "Invoke-XmaExternal -FilePath 'rustup.exe' -ArgumentList @('toolchain','install','stable','--profile','minimal')",
  "Invoke-XmaExternal -FilePath 'rustup.exe' -ArgumentList @('default','stable')",
  "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install')",
  "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('rebuild','electron','electron-winstaller','esbuild')",
  "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','electron','--version')",
  "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','esbuild','--version')",
  "Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fetch')",
  '[检查] 正在检查 Git 是否可用...',
  '[安装] 正在安装/校验 TypeScript、Electron、Vite、构建工具及所有 Workspace 依赖...',
  '[验证] 正在验证 Electron Runtime...',
  '[完成] XMA 开发环境准备完成。',
]) {
  if (!prepareSource.includes(marker)) throw new Error(`XMA external command forwarding regression: missing ${marker}`)
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
for (const forbidden of ['xma-prepare.ps1', "pnpm.cmd", "cargo.exe", "rustup.exe", "winget.exe", "npm.cmd", 'electron']) {
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
  'node_modules/', '.pnpm-store/', 'dist/', 'build/', 'runtime/', '.xma/', 'workspaces/',
  'native/target/', '**/target/', 'apps/desktop/release/', '.env', '*.pem', '*.key', '*.exe', '*.zip',
]) {
  if (!gitignoreSource.includes(marker)) throw new Error(`.gitignore repository hygiene regression: missing ${marker}`)
}

const workspaceSource = readFileSync('pnpm-workspace.yaml', 'utf8')
for (const marker of [
  'allowBuilds:',
  'electron: true',
  'electron-winstaller: true',
  'esbuild: true',
]) {
  if (!workspaceSource.includes(marker)) throw new Error(`pnpm 11 build-script allowlist regression: missing ${marker}`)
}
if (workspaceSource.includes('dangerouslyAllowAllBuilds')) throw new Error('XMA must never globally allow all dependency build scripts')

const consoleSource = readFileSync('scripts/windows/xma-console.ps1', 'utf8')
for (const marker of ['[1] 一键准备环境', '← 推荐首次运行', '[6] 一键构建发布 · Windows Setup + Portable']) {
  if (!consoleSource.includes(marker)) throw new Error(`XMA console UX marker missing: ${marker}`)
}
for (const marker of ['https://github.com/yubboo/xma.git', '[1] 一键推送', 'ForegroundColor Green']) {
  if (!githubSource.includes(marker)) throw new Error(`XMA GitHub helper marker missing: ${marker}`)
}
const syncSource = readFileSync('scripts/windows/xma-sync.ps1', 'utf8')
if (!syncSource.includes('H:\\一键部署\\xma')) throw new Error('XMA sync target contract missing')

for (const bat of required.filter(file => file.endsWith('.bat'))) {
  const text = readFileSync(bat, 'utf8')
  if (!text.toLowerCase().includes('pause')) throw new Error(`BAT must keep result window open: ${bat}`)
}
console.log('XMA Windows Helper Gate PASS')
