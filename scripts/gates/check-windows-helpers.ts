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
if (!existsSync('.cargo/config.toml')) throw new Error('Cargo project-local config missing: .cargo/config.toml')
const cargoConfigSource = readFileSync('.cargo/config.toml', 'utf8')
if (!cargoConfigSource.includes('target-dir = ".cache/cargo-target"')) throw new Error('Cargo cache must be redirected from root target/ to .cache/cargo-target/')

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
// xma-prepare.ps1 现在负责一次准备系统工具与通用项目依赖；Desktop 重型运行时仍按用户选择准备。
const prepareSource = readFileSync('scripts/windows/xma-prepare.ps1', 'utf8')
if (/\[string\[\]\]\$Args\b/i.test(prepareSource)) throw new Error('xma-prepare.ps1 must not use PowerShell automatic variable $args as a parameter')
for (const marker of [
  "Invoke-XmaExternal -FilePath 'rustup.exe' -ArgumentList @('toolchain','install','stable','--profile','minimal')",
  "Invoke-XmaExternal -FilePath 'rustup.exe' -ArgumentList @('default','stable')",
  '[检查] 正在检查 Git 是否可用...',
  '[完成] XMA 开发环境与通用项目依赖已准备完成。',
  "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install','--ignore-scripts')",
  "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('rebuild','esbuild')",
  "Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fetch')",
  "@('exec','tsx','-e'",
  'Electron Chromium Runtime 不会在这里下载',
  'pnpm-workspace.yaml 已固定 yauzl >= 3.3.1 override',
  'package/lockfile/node_modules 是否仍一致',
]) {
  if (!prepareSource.includes(marker)) throw new Error(`XMA development-environment contract regression: missing ${marker}`)
}
if (prepareSource.includes("@('exec','esbuild','--version')")) {
  throw new Error('XMA preparation must not validate transitive esbuild via pnpm exec esbuild')
}
if (prepareSource.includes("@('--dir','apps/desktop','rebuild','electron')")) {
  throw new Error('XMA preparation must never download Electron Chromium Runtime')
}
if (prepareSource.includes("@('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')")) {
  throw new Error('XMA preparation must not prefetch Tauri Rust crates')
}

// 所有会执行外部命令的 Windows 入口必须复用 xma-common.ps1。
// 历史问题：多个脚本各自声明 [string[]]$Args，触发 PowerShell 自动变量 $args 冲突，
// 导致 `pnpm check`、`rustup default stable` 等命令退化成裸 `pnpm` / `rustup`。
const commonSource = readFileSync('scripts/windows/xma-common.ps1', 'utf8')
for (const marker of [
  'function Invoke-XmaExternal',
  '& $FilePath @ArgumentList',
  'function Get-XmaProjectVersion',
  'function Test-XmaElectronRuntime',
  "dist/version + path.txt + 可执行文件",
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


const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies?: Record<string, string>; scripts?: Record<string, string>; pnpm?: unknown }
for (const forbiddenDesktopRuntime of ['electron', 'electron-builder', '@tauri-apps/cli', '@tauri-apps/api']) {
  if (rootPackage.devDependencies?.[forbiddenDesktopRuntime]) {
    throw new Error(`${forbiddenDesktopRuntime} must never be a root/common dependency`)
  }
}
if (!rootPackage.scripts?.test?.includes('apps/desktop/tests/*.test.ts')) throw new Error('Root test script must include Electron runtime installer tests')
if (rootPackage.pnpm) throw new Error('pnpm 11 settings must live in pnpm-workspace.yaml; package.json -> pnpm is ignored')

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
  'apps/desktop/scripts/install-electron-runtime.ts',
  'apps/desktop/scripts/electron-runtime-core.ts',
  'apps/desktop/tests/electron-runtime-core.test.ts',
  'apps/desktop/electron-builder.yml',
  'apps/desktop/src-tauri/Cargo.toml',
  'apps/desktop/src-tauri/build.rs',
  'apps/desktop/src-tauri/src/main.rs',
  'apps/desktop/src-tauri/tauri.conf.json',
  'scripts/windows/xma-expand-archive.ps1',
]) {
  if (!existsSync(file)) throw new Error(`Desktop runtime file missing: ${file}`)
}

const workspaceSource = readFileSync('pnpm-workspace.yaml', 'utf8')
for (const marker of ['allowBuilds:', 'esbuild: true', 'overrides:', 'yauzl: "^3.3.1"']) {
  if (!workspaceSource.includes(marker)) throw new Error(`pnpm 11 build-script allowlist regression: missing ${marker}`)
}
if (workspaceSource.includes('electron: true')) throw new Error('Electron must not be allowBuilds-approved; Chromium Runtime is installed only by XMA Desktop explicit runtime flow')
if (workspaceSource.includes('dangerouslyAllowAllBuilds')) throw new Error('pnpm workspace must never enable dangerouslyAllowAllBuilds')


const electronInstallerSource = readFileSync('apps/desktop/scripts/install-electron-runtime.ts', 'utf8')
const electronRuntimeCoreSource = readFileSync('apps/desktop/scripts/electron-runtime-core.ts', 'utf8')
for (const marker of [
  "downloadArtifact",
  "getProgressCallback",
  "checksums.json",
  "45_000",
  "https://npmmirror.com/mirrors/electron/",
  "Electron 官方 GitHub Releases",
  "installElectronRuntimeArchive",
  "const downloadedZip = await downloadArtifact",
  "requireDownloadArtifact",
  "void main().catch",
  "xma-expand-archive.ps1",
  "PowerShell Expand-Archive",
  "resolveElectronCacheRoot",
  "electronCacheRoot",
  "Node 24.16",
]) {
  if (!electronInstallerSource.includes(marker)) throw new Error(`Electron runtime downloader contract missing: ${marker}`)
}
for (const marker of [
  '.xma-electron-dist-',
  'await options.extractArchive',
  'Electron ZIP 版本不一致',
  'await renameWithRetry(stagingDir, distDir)',
  'await rename(pathTemp, pathFile)',
]) {
  if (!electronRuntimeCoreSource.includes(marker)) throw new Error(`Electron runtime atomic-install contract missing: ${marker}`)
}
if (!electronInstallerSource.includes("controller.abort()")) throw new Error('Electron runtime downloader must abort stalled downloads')
for (const forbidden of ['officialInstallScript', 'spawnSync(process.execPath', "path.join(electronDir, 'install.js')", "pnpm rebuild electron"]) {
  if (electronInstallerSource.includes(forbidden)) throw new Error(`Electron runtime downloader must not use split/black-box install path: ${forbidden}`)
}
if (!existsSync('apps/desktop/tests/electron-runtime-core.test.ts')) throw new Error('Electron runtime atomic installer tests missing')


const expandArchiveSource = readFileSync('scripts/windows/xma-expand-archive.ps1', 'utf8')
for (const marker of ['Expand-Archive', '-LiteralPath', "$ErrorActionPreference = 'Stop'"]) {
  if (!expandArchiveSource.includes(marker)) throw new Error(`Windows Electron extraction helper regression: missing ${marker}`)
}
const buildReleaseSource = readFileSync('scripts/windows/xma-build-release.ps1', 'utf8')
for (const marker of [
  '构建流程不会再次执行 pnpm install',
  'pnpm-workspace.yaml 已固定 yauzl >= 3.3.1 override',
  'apps/desktop/scripts/install-electron-runtime.ts',
  "$CargoTargetDir = Join-Path $Root '.cache\\cargo-target'",
  "$TauriTargetDir = Join-Path $Root '.cache\\tauri-target'",
  "$nativeExe = Join-Path $CargoTargetDir 'release\\xma-native-runtime.exe'",
  "$tauriBundle = Join-Path $tauriRelease 'bundle'",
  "$tauriExe = Join-Path $tauriRelease 'xma-desktop.exe'",
]) {
  if (!buildReleaseSource.includes(marker)) throw new Error(`Build release dependency/runtime contract missing: ${marker}`)
}
if (buildReleaseSource.includes("@('install','--ignore-scripts')")) {
  throw new Error('Build release must reuse [1] prepared Workspace dependencies instead of reinstalling them')
}
if (buildReleaseSource.includes('Copy-Item $tauriRelease (Join-Path $release')) throw new Error('Tauri Cargo release cache must not be copied wholesale into dist/release')

const consoleSource = readFileSync('scripts/windows/xma-console.ps1', 'utf8')
for (const marker of [
  '[1] 一键准备开发环境',
  '← 推荐首次运行',
  '[2] 开发运行 · Web                    已准备后直接启动',
  '[4] 运行 · XiaoYu CLI                 已准备后直接启动',
  '[3] 开发运行 · Desktop',
  'Electron 41.2.0',
  'Tauri 2',
  '主 / 推荐',
  '副 / 备用',
  'Assert-CoreDependencies',
  "@('exec','tsx','apps/desktop/scripts/install-electron-runtime.ts')",
  "@('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')",
  'install-electron-runtime.ts',
  'checksums.json',
  '官方源 45 秒没有任何新数据',
  "@('check','--workspace','--offline')",
  "@('test','--workspace','--offline')",
  "Join-Path $Root '.cache\\tauri-target'",
  '$env:CARGO_TARGET_DIR = $tauriTargetDir',
]) {
  if (!consoleSource.includes(marker)) throw new Error(`XMA console prepared-dependency/runtime contract missing: ${marker}`)
}
for (const forbidden of [
  "@('install','--ignore-scripts')",
  "@('rebuild','esbuild')",
  "@('exec','esbuild','--version')",
  "@('--dir','apps/desktop','rebuild','electron')",
]) {
  if (consoleSource.includes(forbidden)) throw new Error(`Web/CLI console must not reinstall common dependencies after [1]: ${forbidden}`)
}

if (consoleSource.includes("Invoke-XmaExternal -FilePath $electronExe -ArgumentList @('--version')")) {
  throw new Error('Electron GUI executable must not be validated through PowerShell $LASTEXITCODE')
}
if (!consoleSource.includes('Test-XmaElectronRuntime -ElectronPackageRoot')) {
  throw new Error('Electron runtime must use deterministic file-state validation')
}

for (const marker of ['https://github.com/yubboo/xma.git', '[1] 一键推送', 'ForegroundColor Green']) {
  if (!githubSource.includes(marker)) throw new Error(`XMA GitHub helper marker missing: ${marker}`)
}
const syncSource = readFileSync('scripts/windows/xma-sync.ps1', 'utf8')
if (!syncSource.includes('H:\\一键部署\\xma')) throw new Error('XMA sync target contract missing')
if (!syncSource.includes("'node_modules','.cache'")) throw new Error('XMA sync must preserve project-local .cache downloads')
if (!syncSource.includes("(Join-Path $Source 'runtime')")) throw new Error('XMA sync must exclude only root runtime, not native/runtime source')
if (syncSource.includes("'runtime','.xma'")) throw new Error('Generic runtime directory exclusion would drop native/runtime source')
if (!syncSource.includes("@('pnpm-lock.yaml','Cargo.lock')")) throw new Error('XMA sync must preserve locally generated lockfiles when the source package omits them')
if (!syncSource.includes('若版本包暂未携带 lockfile，则保留本机已生成的')) throw new Error('XMA sync must explain conditional lockfile preservation policy')
if (!syncSource.includes("Join-Path $Target 'target'") || !syncSource.includes("apps\\desktop\\src-tauri\\target")) throw new Error('XMA sync must clean legacy Cargo target directories after cache migration')
if (!syncSource.includes('.cache/cargo-target') && !syncSource.includes('.cache\\cargo-target')) throw new Error('XMA sync must explain the new project-local Cargo cache location')

for (const bat of required.filter(file => file.endsWith('.bat'))) {
  const text = readFileSync(bat, 'utf8')
  if (!text.toLowerCase().includes('pause')) throw new Error(`BAT must keep result window open: ${bat}`)
}
console.log('XMA Windows Helper Gate PASS')
