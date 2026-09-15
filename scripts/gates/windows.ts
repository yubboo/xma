/**
 * 文件作用：防止 XMA Windows 固定工作流脚本在后续开发中被删坏或体验回退。
 * 关联模块：xma-dev.bat、XMA-Sync.bat、XMA-GitHub.bat、scripts/windows/*.ps1。
 * 当前实现：检查文件存在、PS1 UTF-8 BOM + CRLF、菜单推荐项、仓库/目标目录和窗口保留提示。
 * 职责边界：这里只检查静态约定，真实 Windows 行为仍必须由 Windows CI/用户环境验证。
 */

import { existsSync, readFileSync } from 'node:fs'

const required = [
  'xma-dev.bat', 'XMA-Sync.bat', 'XMA-GitHub.bat',
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

// PowerShell 单引号不把反斜杠当转义符；`'\\'` 是两个字符，不能强制转换为 System.Char。
// 路径 TrimStart/TrimEnd 的 char[] 必须使用单个反斜杠字面量 `'\'`，避免 xma-dev 启动阶段直接崩溃。
for (const file of required.filter(file => file.endsWith('.ps1'))) {
  const text = readFileSync(file, 'utf8')
  if (text.includes("[char[]]@('\\\\','/')") || text.includes("[char[]]@('\\\\', '/')")) {
    throw new Error(`PowerShell path char-array must use a single backslash character: ${file}`)
  }
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
for (const marker of [
  "Ensure-XmaOpenTuiDependencies -BunExecutable $bunExe | Out-Host",
  "Invoke-XmaExternal -FilePath $installer -ArgumentList @('-y','--profile','minimal','--default-toolchain','stable','--no-modify-path') | Out-Host",
  "Invoke-XmaExternal -FilePath $rustupExe -ArgumentList @('component','add','rustfmt','--toolchain','stable') | Out-Host",
]) {
  if (!prepareSource.includes(marker)) throw new Error(`PowerShell value-return pipeline isolation regression: missing ${marker}`)
}
const devLauncherSource = readFileSync('xma-dev.bat', 'utf8')
for (const marker of ['%~dp0', 'scripts\\windows\\xma-console.ps1', 'CALLER_CWD=%CD%', 'DisableDelayedExpansion', 'pushd "%ROOT%"', '-Command cli -Workspace "%CALLER_CWD%"']) {
  if (!devLauncherSource.includes(marker)) throw new Error(`XMA Windows source-development launcher contract missing: ${marker}`)
}
if (/H:\\|H:\//i.test(devLauncherSource)) {
  throw new Error('xma-dev.bat must not hardcode maintainer drive paths.')
}
if (existsSync('XMA.bat') || existsSync('xma.bat')) {
  throw new Error('Source-development launcher must be xma-dev.bat; xma.bat/XMA.bat would collide conceptually with the installed xma product command.')
}

if (/\[string\[\]\]\$Args\b/i.test(prepareSource)) throw new Error('xma-prepare.ps1 must not use PowerShell automatic variable $args as a parameter')
for (const marker of [
  'function Invoke-XmaProbe',
  'function Read-XmaArrowMenuChoice',
  '[Console]::ReadKey($true)',
  '[ConsoleKey]::UpArrow',
  '[ConsoleKey]::DownArrow',
  '[ConsoleKey]::Enter',
  '↑/↓ 移动 · Enter 确认 · 数字键 1/2/3 直达',
  "Read-XmaArrowMenuChoice -Prompt '请选择'",
  'function Select-XmaDependencyRoot',
  "Get-XmaLocalPathRoot -ProjectRoot $Root",
  "$driveDRoot = 'D:\\xma-path'",
  '请输入真实盘符，例如 E',
  'function Install-XmaBunRuntime',
  'PromptIfMissing',
  '主菜单 [8] 单独安装',
  'Save-XmaBunEnvironmentState -ProjectRoot $Root',
  'Move-XmaLegacyBunToProjectDefault',
  'function Ensure-XmaRustToolchain',
  'function Install-XmaRustStable',
  '主菜单 [9] 单独安装',
  'rustup-init SHA-256 校验通过',
  "@('component','add','rustfmt','--toolchain','stable')",
  'function Ensure-XmaMsvc',
  'function Ensure-XmaCargoCrates',
  'Refresh-XmaPath',
  '[检查] 正在检查 Git 是否可用...',
  '[完成] XMA 一键准备流程结束。',
  "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install','--ignore-scripts')",
  "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('rebuild','esbuild')",
  "Invoke-XmaExternal -FilePath $RustRuntime.CargoExe -ArgumentList @('fetch','--locked')",
  "@('exec','tsx','-e'",
  'Electron Chromium Runtime',
  'Workspace package/lockfile/node_modules 指纹未变化',
  'function Ensure-XmaOpenTuiDependencies',
  'function Ensure-XmaBunOpenTuiRuntime',
  'Bun + OpenTUI 是一个运行组件',
  'OpenTUI Runtime 依赖不完整',
  '[缓存] Bun/OpenTUI 已由 [4/9] 完整准备，本步骤只做复检，不重复安装。',
  'function Remove-XmaPackageMetadataFromGitWorktree',
  '当前 checkout 状态不存在，但检测到可真实运行的外部 Rust/Cargo',
  "Get-XmaOpenTuiHomeFromBunHome -BunHome $bunHome",
  "Connect-XmaOpenTuiNodeModules -ProjectRoot $Root -BunHome $bunHome",
  "@('install','--no-save')",
  'Xiaoyu TUI framework 已准备完成',
  'function Install-XmaDevelopmentCommands',
  'function Remove-XmaLegacyProjectControlState',
  "Get-XmaStateRoot -ProjectRoot $Root) 'dev-bin'",
  "@('xiaoyu.cmd','xma.cmd')",
  "if ($pathChanged) { [Environment]::SetEnvironmentVariable('Path', $nextUserPath, 'User') }",
  '[9/9] 开发态 Xiaoyu 命令',
  'Test-XmaPrepareStamp',
  '跳过重复 pnpm install 与 esbuild rebuild',
  'Cargo 指纹未变化；仍验证实际 crate 缓存',
  'cargo fetch 完成后 offline 复检通过',
  '选择 N 会跳过',
]) {
  if (!prepareSource.includes(marker)) throw new Error(`XMA development-environment contract regression: missing ${marker}`)
}
if (/SetEnvironmentVariable\([^)]*['"]Machine['"][^)]*\)/i.test(prepareSource)) {
  throw new Error('XMA development preparation must not modify Machine PATH; use current-user PATH only')
}
if (/AppData\\Local\\XMA\\(?:Bun|Rust)/i.test(prepareSource)) throw new Error('Bun/Rust default install must follow project xma-path instead of system C user directories')
if (prepareSource.includes("$devBin = Join-Path (Get-XmaLocalPathRoot -ProjectRoot $Root) 'dev-bin'")) {
  throw new Error('External dependency selection must not create project xma-path only for dev-bin; dev shim belongs to checkout-local state')
}
const commonControlState = readFileSync('scripts/windows/xma-common.ps1', 'utf8')
if (commonControlState.includes("return (Join-Path (Get-XmaLocalPathRoot -ProjectRoot $ProjectRoot) 'state')")) {
  throw new Error('Checkout control state must not be hardwired to project xma-path/state')
}
for (const forbiddenEnv of ["SetEnvironmentVariable('CARGO_HOME'", "SetEnvironmentVariable('RUSTUP_HOME'"]) {
  if (prepareSource.includes(forbiddenEnv)) throw new Error(`XMA dependency homes must be restored from checkout-local state, not persisted globally: ${forbiddenEnv}`)
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

const desktopReleaseSource = readFileSync('scripts/windows/xma-build-release.ps1', 'utf8')
for (const marker of [
  'Desktop 专用测试',
  'build:desktop:electron',
  'build:desktop:tauri',
  '不会构建或打包 Xiaoyu Terminal / CLI / Server',
  'Import-XmaRustEnvironment -ProjectRoot $Root',
  '使用 `[1]` 确认的 Cargo Home',
]) {
  if (!desktopReleaseSource.includes(marker)) throw new Error(`Desktop release isolation contract missing: ${marker}`)
}
for (const forbidden of ['scripts/release/cli.ts', "@('run','build')", 'build:cli', 'build:server', "@('build','--workspace','--release')"]) {
  if (desktopReleaseSource.includes(forbidden)) throw new Error(`Desktop release must not build CLI/Server/full Rust workspace: ${forbidden}`)
}


const cliConsoleSource = readFileSync('scripts/windows/xma-console.ps1', 'utf8')
for (const marker of [
  'function Assert-CliJsDependencies',
  'function Resolve-XmaBunRuntime',
  'Get-XmaOpenTuiHomeFromBunHome -BunHome $bunRuntime.BunHome',
  "Join-Path $openTuiHome 'node_modules\\@opentui\\core\\package.json'",
  "Join-Path $openTuiHome 'node_modules\\@opentui\\solid\\package.json'",
  'Connect-XmaOpenTuiNodeModules -ProjectRoot $Root -BunHome $bunRuntime.BunHome',
  'Xiaoyu OpenTUI Runtime 已就绪',
  'Assert-CliJsDependencies\r\n  Assert-DesktopJsDependencies',
  "[ValidateSet('menu','prepare','web','desktop','cli','check','release','release-windows','bun','rust')]",
  "'cli' { Start-Cli -WorkspacePath $Workspace }",
  "$cliArguments += @('--', $resolvedWorkspace)",
  '未检测到 rustfmt/cargo-fmt。请运行主菜单 [9]',
  'Rust rustfmt 已就绪；[7] 将保持 offline',
  'function Resolve-XmaCargoRuntime',
  'function Assert-XmaCargoOfflineReady',
  'Rust/Cargo 环境已恢复：CARGO_HOME=',
  '[8] 单独安装 · Bun / OpenTUI',
  '[9] 单独安装 · Rust / Cargo',
  "'bun' { Prepare-BunRuntime }",
  "'rust' { Prepare-RustRuntime }",
]) {
  if (!cliConsoleSource.includes(marker)) throw new Error(`XMA Console TUI dependency contract regression: missing ${marker}`)
}


const bunRunnerSource = readFileSync('scripts/cli/bun.ts', 'utf8')
for (const marker of [
  'process.env.XMA_BUN_HOME',
  "path.join(checkoutStateRoot(), 'bun-environment.json')",
  "path.join(root, 'xma-path', 'state', 'bun-environment.json')",
  "path.join(root, 'xma-path', 'bun')",
  'function openTuiHomeFromBunHome',
  "path.join(openTuiHomeFromBunHome(runtime.home), 'node_modules')",
  "symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')",
  'bun-environment.json',
  'fileURLToPath(import.meta.url)',
  "path.join(root, '.cache', 'bun-compile', BUN_VERSION)",
  'function createWindowsCompileAlias',
  'containsNonAscii(realCache)',
  'spawnSync(subst, [drive, realCache]',
  "spawnSync(subst, [drive, '/D']",
  "const compileTemp = path.join(alias.root, 'tmp')",
  "const compileRuntime = path.join(alias.root, 'runtime')",
  'childEnv.BUN_TMPDIR = compileTemp',
  'childEnv.TEMP = compileTemp',
  'childEnv.TMP = compileTemp',
  'disposeCompileAlias()',
]) {
  if (!bunRunnerSource.includes(marker)) throw new Error(`Bun project-cache/Unicode-path contract regression: missing ${marker}`)
}
for (const forbidden of ['process.env.LOCALAPPDATA', "process.env.TEMP ? path.join", "process.env.TMP ? path.join", "'C:\\\\", "'D:\\\\", "'H:\\\\"]) {
  if (bunRunnerSource.includes(forbidden)) throw new Error(`Bun compile must not bind Windows user temp storage or a fixed drive: ${forbidden}`)
}

if (bunRunnerSource.includes("path.join(root, '.xma', 'tools', 'bun'")) throw new Error('Bun runner must restore checkout-local state instead of fixed checkout .xma/tools/bun')

// 所有会执行外部命令的 Windows 入口必须复用 xma-common.ps1。
// 历史问题：多个脚本各自声明 [string[]]$Args，触发 PowerShell 自动变量 $args 冲突，
// 导致 `pnpm check`、`rustup override set stable` 等命令退化成裸 `pnpm` / `rustup`。
const commonSource = readFileSync('scripts/windows/xma-common.ps1', 'utf8')
for (const marker of [
  'function Invoke-XmaExternal',
  '& $FilePath @ArgumentList',
  'function Get-XmaProjectVersion',
  'function Test-XmaElectronRuntime',
  'function Import-XmaBunEnvironment',
  'function Save-XmaBunEnvironmentState',
  'function Import-XmaRustEnvironment',
  'function Save-XmaRustEnvironmentState',
  'function Get-XmaLocalPathRoot',
  "return (Join-Path $ProjectRoot 'xma-path')",
  'function Get-XmaCheckoutStateRoot',
  "return (Join-Path $gitEntry 'xma-state')",
  "return (Join-Path $ProjectRoot '.cache\\xma-state')",
  'function Get-XmaOpenTuiHomeFromBunHome',
  'function Connect-XmaOpenTuiNodeModules',
  'function Test-XmaCargoOfflineDependencies',
  "dist/version + path.txt + 可执行文件",
  '-Encoding UTF8',
]) {
  if (!commonSource.includes(marker)) throw new Error(`XMA Windows common helper regression: missing ${marker}`)
}
if (/\[string\[\]\]\$Args\b/i.test(commonSource)) throw new Error('xma-common.ps1 must never use PowerShell automatic variable $args as a parameter')
if (!commonSource.includes('调用非交互安装命令必须显式 `| Out-Host`')) {
  throw new Error('Invoke-XmaExternal pipeline-output contract documentation missing')
}

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
  'Assert-GitWorkDirectory',
  '.xma-package\\source-manifest.json',
  'Get-XmaStateRoot -ProjectRoot $Root',
  '源码包目录只负责 Source Sync',
  'git.exe ls-files --cached --others --exclude-standard',
  "git.exe' -ArgumentList @('add','-A')",
  "git.exe' -ArgumentList @('update-index','--add','--chmod=+x'",
  "git.exe' -ArgumentList @('push','-u','origin','main')",
]) {
  if (!githubSource.includes(marker)) throw new Error(`GitHub helper pure-Git contract regression: missing ${marker}`)
}

const readmeSource = readFileSync('README.md', 'utf8')
for (const marker of ['## 快速开始', '.\\xma-dev.bat', '正式 `xma` 产品命令', 'Git clone 用户不需要运行 `XMA-Sync.bat`', '.git\\xma-state\\dev-bin', 'User PATH', '同一 Xiaoyu TUI']) {
  if (!readmeSource.includes(marker)) throw new Error(`README public source quick-start contract missing: ${marker}`)
}
const windowsWorkflowSource = readFileSync('docs/development/WINDOWS-WORKFLOW.md', 'utf8')
for (const marker of ['公共源码快速开始', '任意目录 / 任意盘符', 'XMA_TARGET_ROOT', '维护者 Source Manifest 同步工作流']) {
  if (!windowsWorkflowSource.includes(marker)) throw new Error(`Windows workflow portability contract missing: ${marker}`)
}

const agentRulesSource = readFileSync('AGENTS.md', 'utf8')
for (const marker of ['新增 / 更新 / 删除 / 未变化', 'Manifest 总文件数不得冒充本次实际变更数', '.git/xma-state/source-sync-last.txt']) {
  if (!agentRulesSource.includes(marker)) throw new Error(`AGENTS Source Sync UX contract regression: missing ${marker}`)
}

const syncMigrationSource = readFileSync('scripts/windows/xma-sync.ps1', 'utf8')
for (const marker of [
  '.xma-package\\source-manifest.json',
  'Get-XmaStateRoot -ProjectRoot $Target',
  "Join-Path $CheckoutStateRoot 'source-sync.json'",
  "Join-Path $CheckoutStateRoot 'source-sync-last.txt'",
  'Test-XmaFileContentEqual',
  '[变更摘要]',
  '[本次同步]',
  '[完整清单]',
  'Get-XmaPreviousManagedFiles',
  'Save-XmaSyncState',
  'Source Manifest 模式',
  '删除上一版已移除/重命名源码',
  '新增目录无需配置',
  'scripts/release 正式源码',
  'Resolve-XmaSyncTarget',
  '[选择] 检测到多个 origin 正确的 XMA Git 工作目录',
  '请输入已经 clone 好的 XMA Git 仓库目录',
  'XMA 不会自动创建替代 worktree 目录',
  '删除 Git 工作目录中无用的源码包元数据',
  'Git 工作目录与 origin 仍指向 yubboo/xma',
]) {
  if (!syncMigrationSource.includes(marker)) throw new Error(`XMA sync manifest contract regression: missing ${marker}`)
}

if (/H:\\一键部署\\xma/i.test(syncMigrationSource)) {
  throw new Error('XMA Sync must not hardcode the maintainer H: worktree path.')
}
if (/H:\\一键部署\\xma/i.test(githubSource)) {
  throw new Error('XMA GitHub helper must not hardcode the maintainer H: worktree path.')
}
if (syncMigrationSource.includes('xma-worktree')) throw new Error('XMA Sync must not invent xma-worktree clone target names; canonical git clone keeps the default xma directory.')
if (/git\.exe\s+init|remote\s+set-url/i.test(syncMigrationSource)) throw new Error('XMA Sync must never initialize a Git repository or rewrite an existing origin.')
if (syncMigrationSource.includes("'.git','node_modules','.cache','dist','build','.xma','xma-path','target','release'")) {
  throw new Error('XMA sync must not globally exclude every directory named release/build/dist; path ownership must be explicit.')
}
if (!existsSync('scripts/release/source-manifest.ts')) throw new Error('XMA source manifest generator missing: scripts/release/source-manifest.ts')
const sourceManifestGenerator = readFileSync('scripts/release/source-manifest.ts', 'utf8')
for (const marker of [
  "outputFile = join(outputDir, 'source-manifest.json')",
  "parts[0] === 'scripts'",
  "project: 'xma'",
  'formatVersion: 1',
  'allowedRootHiddenDirectories',
  "'.agents', '.cargo', '.claude', '.codex', '.github'",
  "'xma-path'",
]) {
  if (!sourceManifestGenerator.includes(marker)) throw new Error(`XMA source manifest generator regression: missing ${marker}`)
}

const namingGateSource = readFileSync('scripts/gates/naming.ts', 'utf8')
for (const marker of [
  "'node_modules'",
  "'dist'",
  "'build'",
  "'target'",
  "'release'",
  "apps/desktop/src-tauri/gen",
  'apps/desktop/tests/electron-runtime-core.test.ts',
]) {
  if (!namingGateSource.includes(marker)) throw new Error(`Naming Gate ownership/legacy contract regression: missing ${marker}`)
}

const gitignoreSource = readFileSync('.gitignore', 'utf8')
for (const marker of [
  'node_modules/', '.pnpm-store/', 'dist/', 'build/', '/runtime/', 'xma-path/', '.xma/', '.xma-package/', 'workspaces/',
  'native/target/', '**/target/', '.env', '*.pem', '*.key', '*.exe', '*.zip',
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
  'apps/desktop/scripts/electron/dev.ts',
  'apps/desktop/scripts/electron/install-runtime.ts',
  'apps/desktop/scripts/electron/runtime.ts',
  'apps/desktop/tests/electron-runtime.test.ts',
  'apps/desktop/electron-builder.json',
  'apps/desktop/scripts/electron/build.ts',
  'apps/desktop/tests/build-layout.test.ts',
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


const electronInstallerSource = readFileSync('apps/desktop/scripts/electron/install-runtime.ts', 'utf8')
const electronRuntimeCoreSource = readFileSync('apps/desktop/scripts/electron/runtime.ts', 'utf8')
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
if (!existsSync('apps/desktop/tests/electron-runtime.test.ts')) throw new Error('Electron runtime atomic installer tests missing')


const expandArchiveSource = readFileSync('scripts/windows/xma-expand-archive.ps1', 'utf8')
for (const marker of ['Expand-Archive', '-LiteralPath', "$ErrorActionPreference = 'Stop'"]) {
  if (!expandArchiveSource.includes(marker)) throw new Error(`Windows Electron extraction helper regression: missing ${marker}`)
}
const buildReleaseSource = readFileSync('scripts/windows/xma-build-release.ps1', 'utf8')
for (const marker of [
  'Desktop 专用测试',
  'Desktop 构建不会偷偷执行 pnpm install',
  'apps/desktop/scripts/electron/install-runtime.ts',
  'electronDist',
  '不会再次下载 Electron',
  "$TauriTargetDir = Join-Path $Root '.cache\\tauri-target'",
  "$DesktopCacheDir = Join-Path $Root '.cache\\desktop'",
  "$DesktopReleaseRoot = Join-Path $Root 'dist\\release'",
  'build:desktop:electron',
  'build:desktop:tauri',
  "Join-Path $DesktopReleaseRoot 'electron'",
  "Join-Path $DesktopReleaseRoot 'tauri'",
  '不会构建或打包 Xiaoyu Terminal / CLI / Server',
]) {
  if (!buildReleaseSource.includes(marker)) throw new Error(`Build release Desktop-isolation contract missing: ${marker}`)
}
for (const forbidden of [
  "@('install','--ignore-scripts')",
  'scripts/release/cli.ts',
  'build:cli',
  'build:server',
  "@('run','build')",
  "@('build','--workspace','--release')",
]) {
  if (buildReleaseSource.includes(forbidden)) throw new Error(`Desktop build must not prepare/package unrelated CLI/Server/full workspace: ${forbidden}`)
}
if (buildReleaseSource.includes('Copy-Item $tauriRelease (Join-Path $release')) throw new Error('Tauri Cargo release cache must not be copied wholesale into dist/release')
if (buildReleaseSource.includes('apps\desktop\release\electron')) throw new Error('Electron release must be written directly to dist/release/electron, not copied from apps/desktop/release')

const consoleSource = readFileSync('scripts/windows/xma-console.ps1', 'utf8')
for (const marker of [
  '[1] 一键准备开发环境',
  '← 推荐首次运行',
  '[2] 开发运行 · Web                    已准备后直接启动',
  '[4] 运行 · Xiaoyu Terminal            已准备后直接启动',
  'Ensure-CliNativeRuntime',
  "@('build','--package','xma-native-runtime','--offline')",
  "Join-Path $Root '.cache\\cargo-target'",
  "Join-Path $Root '.cache\\native-runtime\\runs'",
  '$env:XIAOYU_NATIVE_RUNTIME = $nativeExe',
  '复用 Cargo 增量缓存，离线构建，不下载依赖',
  '[3] 开发运行 · Desktop',
  '[5] 构建发布 · Desktop 当前平台',
  '[6] 构建发布 · Desktop Windows',
  'Electron 41.2.0',
  'Tauri 2',
  '主 / 推荐',
  '副 / 备用',
  'Assert-CoreDependencies',
  "@('exec','tsx','apps/desktop/scripts/electron/install-runtime.ts')",
  "@('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')",
  'install-runtime.ts',
  'checksums.json',
  '官方源 45 秒没有任何新数据',
  "@('check','--workspace','--offline')",
  "@('test','--workspace','--offline')",
  "Join-Path $Root '.cache\\tauri-target'",
  '$env:CARGO_TARGET_DIR = $tauriTargetDir',
]) {
  if (!consoleSource.includes(marker)) throw new Error(`XMA console prepared-dependency/runtime contract missing: ${marker}`)
}
if (consoleSource.includes(".cache\\cargo-target\\debug\\xma-native-runtime.exe")) {
  throw new Error('Xiaoyu Terminal must not execute the shared Cargo target exe directly on Windows; use unique native staging copies.')
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
for (const marker of [
  'Resolve-XmaSyncTarget',
  '[选择] 检测到多个 origin 正确的 XMA Git 工作目录',
  '请输入已经 clone 好的 XMA Git 仓库目录',
  'XMA 不会自动创建替代 worktree 目录',
  ".xma-package\\source-manifest.json",
  "Get-XmaStateRoot -ProjectRoot $Target",
  "Join-Path $CheckoutStateRoot 'source-sync.json'",
  "Join-Path $CheckoutStateRoot 'source-sync-last.txt'",
  'Test-XmaFileContentEqual',
  '[变更摘要]',
  '[本次同步]',
  '[完整清单]',
  'Get-XmaPreviousManagedFiles',
  'Save-XmaSyncState',
  'Source Manifest 模式',
  '新增目录无需配置',
]) {
  if (!syncSource.includes(marker)) throw new Error(`XMA sync target/manifest contract missing: ${marker}`)
}
if (syncSource.includes("'.git','node_modules','.cache','dist','build','.xma','xma-path','target','release'")) {
  throw new Error('XMA sync must not globally exclude release/build/dist by generic directory name.')
}
for (const marker of [
  "Join-Path $Target 'target'",
  "Join-Path $Target 'build'",
  "apps\\desktop\\dist",
  "apps\\desktop\\web",
  "apps\\desktop\\release",
  "apps\\desktop\\native",
  "apps\\desktop\\src-tauri\\target",
]) {
  if (!syncSource.includes(marker)) throw new Error(`XMA sync must clean legacy build directory: ${marker}`)
}
if (!syncSource.includes("(Join-Path $Source 'runtime')")) throw new Error('XMA sync fallback must exclude only root runtime, not native/runtime source')
if (!syncSource.includes('scripts/release 正式源码')) throw new Error('XMA sync must explicitly protect scripts/release as managed source')

for (const bat of required.filter(file => file.endsWith('.bat'))) {
  const text = readFileSync(bat, 'utf8')
  if (!text.toLowerCase().includes('pause')) throw new Error(`BAT must keep result window open: ${bat}`)
}
console.log('XMA Windows Helper Gate PASS')
