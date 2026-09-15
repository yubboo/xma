/**
 * 文件作用：防止 XMA Windows 固定工作流脚本在后续开发中被删坏或体验回退。
 * 关联模块：xma-dev.bat、XMA-Sync.bat、XMA-GitHub.bat、scripts/windows/*.ps1。
 * 当前实现：检查文件存在、PS1 UTF-8 BOM + CRLF、菜单推荐项、仓库/目标目录和窗口保留提示。
 * 职责边界：这里只检查静态约定，真实 Windows 行为仍必须由 Windows CI/用户环境验证。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'

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

// Native tools must stay attached to the real terminal. PowerShell pipelines force byte decoding and can corrupt UTF-8 paths on Windows PowerShell 5.1.
for (const file of required.filter(file => file.endsWith('.ps1'))) {
  const text = readFileSync(file, 'utf8')
  if (/^\s*Invoke-XmaExternal[^\r\n]*\|/m.test(text)) {
    throw new Error(`Native command must not be piped through PowerShell output cmdlets: ${file}`)
  }
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

// Rust/Cargo 使用 checkout 本地 runtime/rust；旧用户目录/盘符扫描/状态机不得恢复。
const discoveryCommonSource = readFileSync('scripts/windows/xma-common.ps1', 'utf8')
for (const forbidden of [
  'function Get-XmaDiscoveredRustHomes', 'function Import-XmaRustEnvironment', 'function Save-XmaRustEnvironmentState',
  "Join-Path $driveRoot 'xma-path\\rust'", "Join-Path $driveRoot 'XMA\\Rust'", "Source = 'drive-scan'",
  "Join-Path $env:USERPROFILE '.cargo'", "Join-Path $env:USERPROFILE '.rustup'",
]) {
  if (discoveryCommonSource.includes(forbidden)) throw new Error(`XMA must not restore legacy/user-profile Rust state: ${forbidden}`)
}
for (const legacyBunState of ['Import-XmaBunEnvironment', 'Save-XmaBunEnvironmentState', 'Get-XmaDiscoveredBunHomes', 'Get-XmaBunEnvironmentStatePath', 'XMA_BUN_HOME']) {
  if (discoveryCommonSource.includes(legacyBunState)) throw new Error(`Bun must be pnpm/node_modules-managed; legacy Bun state helper remains in xma-common.ps1: ${legacyBunState}`)
}

const prepareSource = readFileSync('scripts/windows/xma-prepare.ps1', 'utf8')
// Bun/OpenTUI/Solid are root Workspace dependencies. Every [1] runs one plain root pnpm install; [8] alone refreshes latest; [4]/[7]/build only consume root node_modules.
const rootRuntimePackage = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> }
const openTuiSourcePackage = JSON.parse(readFileSync('apps/cli/opentui-runtime/package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
const expectedRuntimeVersions: Record<string, string> = {
  bun: '1.4.2',
  '@opentui/core': '0.5.11',
  '@opentui/solid': '0.5.11',
  'solid-js': '1.9.15',
  '@types/bun': '1.4.2',
}
for (const [name, version] of Object.entries(expectedRuntimeVersions)) {
  if (rootRuntimePackage.devDependencies?.[name] !== version) throw new Error(`Root JavaScript Runtime dependency must pin the verified version ${name}@${version}.`)
}
if (openTuiSourcePackage.dependencies || openTuiSourcePackage.devDependencies) throw new Error('OpenTUI source folder must not own nested dependencies.')
const workspaceSource = readFileSync('pnpm-workspace.yaml', 'utf8')
if (workspaceSource.includes('apps/cli/opentui-runtime')) throw new Error('OpenTUI source folder must not be a nested pnpm workspace package.')
if (rootRuntimePackage.scripts?.['runtime:update'] !== 'node scripts/runtime/update.mjs') throw new Error('Windows source preparation must share the single scripts/runtime/update.mjs entry.')
for (const marker of ['strictDepBuilds: true', 'bun: true', 'esbuild: true', 'electron: false', 'electron-winstaller: false', 'koffi: false']) {
  if (!workspaceSource.includes(marker)) throw new Error(`pnpm lifecycle policy regression: missing ${marker}`)
}
if (workspaceSource.includes('set this to true or false')) throw new Error('pnpm lifecycle policy must not contain unresolved allowBuilds decisions.')
const runtimeUpdaterSource = readFileSync('scripts/runtime/update.mjs', 'utf8')
const runtimeUpdaterTestSource = readFileSync('scripts/runtime/update.test.mjs', 'utf8')
for (const marker of ['Bun / OpenTUI / Solid latest', '--workspace-root', 'Workspace install belongs to [1]', 'ERR_PNPM_IGNORED_BUILDS', 'transaction snapshot']) {
  if (!runtimeUpdaterSource.includes(marker)) throw new Error(`Runtime updater transaction contract regression: missing ${marker}`)
}
for (const marker of ['mystery-native', 'calls.log', 'restores managed files when explicit runtime refresh fails']) {
  if (!runtimeUpdaterTestSource.includes(marker)) throw new Error(`Runtime updater transaction test regression: missing ${marker}`)
}
for (const marker of [
  'function Get-XmaWorkspaceJavaScriptRuntimeInfo',
  "Join-Path $Root 'node_modules\\bun\\package.json'",
  "Join-Path $Root 'node_modules\\bun\\bin\\bun.exe'",
  "Join-Path $Root 'node_modules\\@opentui\\core\\package.json'",
  "Join-Path $Root 'node_modules\\@opentui\\solid\\package.json'",
  "Join-Path $Root 'node_modules\\solid-js\\package.json'",
  "Join-Path $Root 'node_modules\\@types\\bun\\package.json'",
  'pnpm install 直接继承当前控制台 stdout/stderr，不经过 Out-Host 或其他 PowerShell pipeline',
  'function Install-XmaWorkspaceJavaScriptDependencies',
  "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install')",
  '[状态] node_modules 不存在；pnpm 将重新创建并恢复当前 Workspace 全部依赖。',
  '[状态] node_modules 已存在；仍执行 pnpm install，由 pnpm 自己复用 store、补齐新增/变更依赖。',
  'function Assert-XmaWorkspaceJavaScriptDependencies',
  'function Prepare-XmaCurrentJavaScriptDependencies',
  '动作与读取严格分离',
  'function Invoke-XmaManagedJavaScriptLatestUpdate',
  "Invoke-XmaExternal -FilePath 'node.exe' -ArgumentList @('scripts/runtime/update.mjs')",
  '[4/8] Workspace JavaScript Runtime · Bun / OpenTUI / Toolchain',
  'Workspace JavaScript 依赖直接执行原生 pnpm install',
  'Bun/OpenTUI/Solid 全部由 pnpm 管理并存放在根 node_modules；不再创建 OpenTUI 嵌套 node_modules。',
  '[缺少] 当前没有检测到 Git；这是 XMA 源码开发必需工具，正在自动安装稳定版。',
  '[缺少] 当前没有检测到 Node.js；XMA 要求 Node.js 22+，正在自动安装 Node.js LTS。',
  '[3/8] pnpm 11.x · 最低 11.17.0',
  'Ensure-XmaRustToolchain',
  '这是 XMA Windows Native 构建必需工具，正在自动安装',
]) {
  if (!prepareSource.includes(marker)) throw new Error(`pnpm root Workspace JS Runtime contract regression: missing ${marker}`)
}
if (prepareSource.includes('baseline install → Bun latest')) throw new Error('Windows [1] must not use the old five-stage Runtime bootstrap.')
const installLines = prepareSource.split('\n').filter((line) => line.includes("Invoke-XmaExternal -FilePath 'pnpm.cmd'") && line.includes("'install'"))
if (installLines.length !== 1) throw new Error('Windows [1] must execute exactly one Workspace pnpm install.')
if (installLines[0].trim() !== "Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install')") {
  throw new Error(`Windows [1] must delegate dependency sync to the exact plain pnpm install command; got: ${installLines[0].trim()}`)
}
const pnpmInstallFunction = prepareSource.slice(
  prepareSource.indexOf('function Install-XmaWorkspaceJavaScriptDependencies'),
  prepareSource.indexOf('function Invoke-XmaManagedJavaScriptLatestUpdate'),
)
if (pnpmInstallFunction.includes('Out-Host') || pnpmInstallFunction.includes('| ForEach-Object') || pnpmInstallFunction.includes('| Write-Host')) {
  throw new Error('Windows [1] pnpm install must inherit the console directly; PowerShell pipelines break same-line progress rendering and can corrupt Unicode output.')
}
for (const forbidden of ['--no-frozen-lockfile','--prefer-offline','--reporter=append-only','--config.confirmModulesPurge','npm_config_registry','Resolve-XmaWorkspaceInstallRegistry','Test-XmaWorkspaceRegistry']) {
  if (prepareSource.includes(forbidden)) throw new Error(`Windows [1] must not wrap plain pnpm install with custom dependency/download policy: ${forbidden}`)
}
if (prepareSource.includes("Test-XmaPrepareStamp -Name 'workspace-js'") || prepareSource.includes("Set-XmaPrepareStamp -Name 'workspace-js'")) {
  throw new Error('Windows [1] must never use a workspace-js prepare stamp to skip pnpm install; pnpm itself is the dependency truth.')
}
if (prepareSource.includes('Get-XmaWorkspaceDependencyFingerprint')) {
  throw new Error('Windows [1] must not maintain a second Workspace dependency fingerprint; every [1] runs pnpm install.')
}
if (prepareSource.includes('$jsRuntime = Prepare-XmaCurrentJavaScriptDependencies') || prepareSource.includes('$jsRuntime = Install-XmaWorkspaceJavaScriptDependencies')) {
  throw new Error('Windows bootstrap must not capture an action function that executes native commands; native stdout must remain visible in the Host.')
}
if (prepareSource.includes('function Invoke-XmaPrepareExternal')) {
  throw new Error('Windows bootstrap must not reintroduce an Out-Host native wrapper; native actions inherit the terminal directly.')
}
if (/Invoke-XmaExternal[^\r\n]*\|\s*(?:Out-Host|ForEach-Object|Write-Host)/.test(prepareSource)) {
  throw new Error('Windows bootstrap native commands must not cross a PowerShell pipeline; this breaks interactive rendering and Unicode path output.')
}
if (!/Ensure-XmaRustToolchain\r?\n\s*\$rustRuntime = Resolve-XmaRustRuntime -ProjectRoot \$Root/.test(prepareSource)) {
  throw new Error('Rust bootstrap must execute the action first and Resolve-XmaRustRuntime separately.')
}
if (prepareSource.includes('$rustRuntime = Ensure-XmaRustToolchain')) {
  throw new Error('Rust bootstrap action must not be captured as a return value; run the action first, then Resolve-XmaRustRuntime separately.')
}
if (!prepareSource.includes("if ($Component -eq 'js') { Prepare-XmaCurrentJavaScriptDependencies; exit 0 }")) throw new Error('Windows js component must install and validate current Workspace dependencies only.')
if (!prepareSource.includes("if ($Component -eq 'bun') { Prepare-XmaJavaScriptOnly; exit 0 }")) throw new Error('Windows bun component must remain the explicit latest refresh path.')
const ciSource = readFileSync('.github/workflows/ci.yml', 'utf8')
for (const marker of ['JavaScript Runtime · Windows PowerShell 5.1', 'shell: powershell', '.\\scripts\\windows\\xma-prepare.ps1 -Component js', 'pnpm build:cli', 'pnpm smoke:cli']) {
  if (!ciSource.includes(marker)) throw new Error(`Windows PowerShell 5.1 JavaScript CI regression: missing ${marker}`)
}
for (const forbidden of [
  'function Install-XmaBunRuntime', 'function Ensure-XmaBunOpenTuiRuntime', 'function Ensure-XmaOpenTuiDependencies',
  'BunNpmWindowsX64Sha512', 'SourceForge Bun 镜像', 'SHASUMS256', 'XMA_BUN_HOME', 'Save-XmaBunEnvironmentState',
  "@('install','--no-save')", "@('install','--ignore-scripts')",
]) {
  if (prepareSource.includes(forbidden)) throw new Error(`Legacy standalone Bun/OpenTUI installer must not return: ${forbidden}`)
}

const updateConsoleSource = readFileSync('scripts/windows/xma-console.ps1', 'utf8')
for (const marker of [
  "'update' { Update-XmaProject }",
  '[10] 更新项目',
  'function Assert-XmaGitCloneForUpdate',
  'https://github.com/yubboo/xma.git',
  "@('fetch','origin','main')",
  "@('pull','--rebase','--autostash','origin','main')",
  "@('reset','--hard','origin/main')",
  '确认强制恢复？请输入 YES 继续',
  '.xma-package\\source-manifest.json',
]) {
  if (!updateConsoleSource.includes(marker)) throw new Error(`XMA [10] project update contract regression: missing ${marker}`)
}
if (updateConsoleSource.includes("@('clean','-fd')") || updateConsoleSource.includes('git clean -fd')) {
  throw new Error('XMA [10] force update must not automatically git clean local dependencies/caches.')
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
if (prepareSource.includes('[Console]::ReadKey') || prepareSource.includes('[Console]::SetCursorPosition')) {
  throw new Error('Dependency arrow menu must use PowerShell Host RawUI; System.Console cursor/read APIs regress in Windows Terminal hosts.')
}
for (const marker of [
  'function Ensure-XmaRustToolchain',
  'function Get-XmaRustupInitTarget',
  'function Install-XmaProjectRustup',
  'function Remove-XmaObsoleteRustLayout',
  'https://static.rust-lang.org/rustup/dist/',
  'rustup-init.exe.sha256',
  "'-y','--no-modify-path','--profile','minimal','--default-toolchain','stable'",
  "@('component','add','rustfmt')",
  'Use-XmaProjectRustEnvironment -ProjectRoot $Root',
  'Resolve-XmaRustRuntime -ProjectRoot $Root',
  'runtime\\rust',
  'function Ensure-XmaMsvc',
  'function Ensure-XmaCargoCrates',
  'Refresh-XmaPath',
  '[检查] 正在检查 Git 是否可用...',
  '[完成] XMA 一键准备流程结束。',
  '[JS Runtime] Bun ',
  '[Rust/Cargo] CARGO_HOME=',
  '[Rustup] RUSTUP_HOME=',
  '[控制状态]',
  "Invoke-XmaExternal -FilePath $RustRuntime.CargoExe -ArgumentList @('fetch','--locked')",
  "@('exec','tsx','-e'",
  'Electron Chromium Runtime',
  'function Install-XmaDevelopmentCommands',
  "Get-XmaStateRoot -ProjectRoot $Root) 'dev-bin'",
  "@('xiaoyu.cmd','xma.cmd')",
  "if ($pathChanged) { [Environment]::SetEnvironmentVariable('Path', $nextUserPath, 'User') }",
  '[8/8] 开发态 Xiaoyu 命令',
  'Cargo 指纹未变化；仍验证实际 crate 缓存',
  'cargo fetch 完成后 offline 复检通过',
]) {
  if (!prepareSource.includes(marker)) throw new Error(`XMA development-environment contract regression: missing ${marker}`)
}
if (/SetEnvironmentVariable\([^)]*['"]Machine['"][^)]*\)/i.test(prepareSource)) throw new Error('XMA development preparation must not modify Machine PATH; use current-user PATH only')
if (prepareSource.includes("@('override','set','stable')")) throw new Error('Rust preparation must not use rustup directory override; it binds the checkout absolute path')
if (prepareSource.includes('function Select-XmaDependencyRoot') || prepareSource.includes('function Read-XmaArrowMenuChoice')) throw new Error('Rust preparation must not restore custom xma-path/drive selection UI.')
if (prepareSource.includes('Import-XmaRustEnvironment') || prepareSource.includes('Save-XmaRustEnvironmentState')) throw new Error('Active Rust preparation must not use checkout Rust state round-trips.')
if (prepareSource.includes('https://rsproxy.cn')) throw new Error('Project-local Rust bootstrap must use the official rustup distribution endpoint.')
if (prepareSource.includes('Rustlang.Rustup') || prepareSource.includes("Join-Path $env:USERPROFILE '.cargo")) throw new Error('Windows Rust must not fall back to user-profile Rust installation.')
if (prepareSource.includes("$devBin = Join-Path (Get-XmaLocalPathRoot -ProjectRoot $Root) 'dev-bin'")) throw new Error('dev shim belongs to checkout-local state, not xma-path')
if (prepareSource.includes("@('exec','esbuild','--version')")) throw new Error('XMA preparation must not validate transitive esbuild via pnpm exec esbuild')
if (prepareSource.includes("@('--dir','apps/desktop','rebuild','electron')")) throw new Error('XMA preparation must never download Electron Chromium Runtime')
if (prepareSource.includes("@('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')")) throw new Error('XMA preparation must not prefetch Tauri Rust crates')

const commonWindowsSource = readFileSync('scripts/windows/xma-common.ps1', 'utf8')
for (const marker of [
  'function Get-XmaProjectRustRuntimeRoot',
  "return (Join-Path $ProjectRoot 'runtime\\rust')",
  'function Get-XmaProjectCargoHome',
  'function Get-XmaProjectRustupHome',
  'function Use-XmaProjectRustEnvironment',
  '$env:CARGO_HOME = $cargoHome',
  '$env:RUSTUP_HOME = $rustupHome',
  'Add-XmaProcessPathFront -Directory $cargoBin',
  'function Resolve-XmaRustRuntime',
  "Source = 'project-runtime'",
  "Invoke-XmaProbe -FilePath $cargoExe -ArgumentList @('--version')",
  "Invoke-XmaProbe -FilePath $rustcExe -ArgumentList @('--version')",
]) {
  if (!commonWindowsSource.includes(marker)) throw new Error(`Project-local Rust runtime resolver contract missing: ${marker}`)
}
for (const forbidden of [
  'function Import-XmaRustEnvironment', 'function Save-XmaRustEnvironmentState', 'function Get-XmaDiscoveredRustHomes',
  'function Get-XmaLocalPathRoot', "Join-Path $driveRoot 'xma-path\\rust'", "Join-Path $driveRoot 'XMA\\Rust'", "Source = 'drive-scan'",
  "Join-Path $env:USERPROFILE '.cargo'", "Join-Path $env:USERPROFILE '.rustup'",
]) {
  if (commonWindowsSource.includes(forbidden)) throw new Error(`Legacy/user-profile Rust resolution must not remain active: ${forbidden}`)
}
for (const forbidden of ['Import-XmaBunEnvironment','Save-XmaBunEnvironmentState','Get-XmaDiscoveredBunHomes','Get-XmaOpenTuiHomeFromBunHome','Connect-XmaOpenTuiNodeModules']) {
  if (commonWindowsSource.includes(forbidden)) throw new Error(`Standalone Bun state must not remain in common helper: ${forbidden}`)
}

const cliConsoleSource = readFileSync('scripts/windows/xma-console.ps1', 'utf8')
for (const marker of [
  'function Assert-CliJsDependencies',
  'function Resolve-XmaBunRuntime',
  "Join-Path $Root 'node_modules\\bun\\package.json'",
  "Join-Path $Root 'node_modules\\bun\\bin\\bun.exe'",
  "Join-Path $Root 'node_modules\\@opentui\\core\\package.json'",
  'Xiaoyu OpenTUI Runtime 已就绪',
  "[ValidateSet('menu','prepare','web','desktop','cli','check','release','release-windows','js','bun','rust','update')]",
  "'cli' { Start-Cli -WorkspacePath $Workspace }",
  "$cliArguments += @('--', $resolvedWorkspace)",
  '未检测到 rustfmt/cargo-fmt。请运行主菜单 [9]',
  'Rust rustfmt 已就绪；[7] 将保持 offline',
  'function Resolve-XmaCargoRuntime',
  '$runtime = Resolve-XmaRustRuntime -ProjectRoot $Root',
  'function Assert-XmaCargoOfflineReady',
  '项目本地 Rust/Cargo 已就绪：CARGO_HOME=',
  '[8] 刷新 · JavaScript Runtime',
  '[9] 单独准备 · Rust / Cargo',
  '[10] 更新项目',
  "'js' { Prepare-JavaScriptRuntime }",
  "'bun' { Prepare-JavaScriptRuntime }",
  "'rust' { Prepare-RustRuntime }",
]) {
  if (!cliConsoleSource.includes(marker)) throw new Error(`XMA Console dependency contract regression: missing ${marker}`)
}
for (const forbidden of ['Import-XmaBunEnvironment','Get-XmaDiscoveredBunHomes','Get-XmaOpenTuiHomeFromBunHome','Connect-XmaOpenTuiNodeModules','[8] 单独安装 · Bun / OpenTUI']) {
  if (cliConsoleSource.includes(forbidden)) throw new Error(`Console must use pnpm/node_modules Bun runtime: ${forbidden}`)
}


const bunRunnerSource = readFileSync('scripts/cli/bun.ts', 'utf8')
for (const marker of [
  "path.join(root, 'node_modules', 'bun')",
  "path.join(packageRoot, 'package.json')",
  "path.join(root, 'node_modules'",
  'fileURLToPath(import.meta.url)',
  "path.join(root, '.cache', 'bun-compile', version)",
  'function createWindowsCompileAlias',
  'containsNonAscii(realCache)',
  'spawnSync(subst, [drive, realCache]',
  "spawnSync(subst, [drive, '/D']",
  "const compileTemp = path.join(alias.root, 'tmp')",
  "const compileRuntime = path.join(alias.root, 'runtime')",
  'childEnv.BUN_TMPDIR = compileTemp',
  'childEnv.TEMP = compileTemp',
  'childEnv.TMP = compileTemp',
  'let disposeCompileAlias: () => void = () => {}',
  'disposeCompileAlias()',
  "['run', '--no-install'",
]) {
  if (!bunRunnerSource.includes(marker)) throw new Error(`Bun node_modules/project-cache contract regression: missing ${marker}`)
}
for (const forbidden of ['XMA_BUN_HOME','bun-environment.json',"path.join(root, 'xma-path', 'bun')",'process.env.LOCALAPPDATA',"process.env.TEMP ? path.join","process.env.TMP ? path.join","'C:\\","'D:\\","'H:\\"]) {
  if (bunRunnerSource.includes(forbidden)) throw new Error(`Bun runner must not use standalone state/fixed temp/drive: ${forbidden}`)
}

// 所有会执行外部命令的 Windows 入口必须复用 xma-common.ps1。
const windowsPowerShellFiles = readdirSync('scripts/windows')
  .filter(file => file.endsWith('.ps1'))
  .map(file => `scripts/windows/${file}`)
const windowsPowerShellSources = windowsPowerShellFiles.map(file => readFileSync(file, 'utf8')).join('\n')
const danglingPowerShellComma = /,\s*\r?\n\s*[)\]}]+(?:\s*\{|\s*$)/m
for (const file of windowsPowerShellFiles) {
  const text = readFileSync(file, 'utf8')
  if (danglingPowerShellComma.test(text)) {
    throw new Error(`PowerShell syntax regression: dangling comma before closing delimiter: ${file}`)
  }

  // Windows PowerShell 5.1 中，反斜杠不是字符串转义符：'\\\\' 是两个字符，不能被转为 System.Char。
  // 所有显式 [char[]] 数组元素都必须是单字符字面量；TrimStart/TrimEnd 若要裁剪多个字符，必须显式传 char[]。
  for (const match of text.matchAll(/\[char\[\]\]@\(([^)]*)\)/g)) {
    for (const literal of match[1]!.matchAll(/'([^']*)'/g)) {
      if ([...literal[1]!].length !== 1) {
        throw new Error(`PowerShell char-array literal must contain exactly one character per item: ${file}: '${literal[1]}'`)
      }
    }
  }
  const multiCharTrim = text.match(/\.Trim(?:Start|End)\(\s*'([^']{2,})'\s*\)/)
  if (multiCharTrim) {
    throw new Error(`PowerShell TrimStart/TrimEnd multi-character literal must use explicit [char[]]: ${file}: '${multiCharTrim[1]}'`)
  }
}
const xmaFunctionDefinitions = new Set(
  Array.from(windowsPowerShellSources.matchAll(/^\s*function\s+([A-Za-z][A-Za-z0-9-]+)/gim), match => match[1]),
)
const xmaFunctionReferences = new Set(
  Array.from(windowsPowerShellSources.matchAll(/\b([A-Za-z][A-Za-z0-9]*-Xma[A-Za-z0-9-]*)\b/g), match => match[1]),
)
const missingXmaFunctions = [...xmaFunctionReferences].filter(name => !xmaFunctionDefinitions.has(name)).sort()
if (missingXmaFunctions.length) {
  throw new Error(`Windows custom helper closure regression: referenced but not defined/imported: ${missingXmaFunctions.join(', ')}`)
}

const commonSource = readFileSync('scripts/windows/xma-common.ps1', 'utf8')
for (const marker of [
  'function Invoke-XmaExternal', '& $FilePath @ArgumentList', 'function Invoke-XmaProbe', 'ExitCode = $exitCode', 'Output = [string[]]$lines', 'function Get-XmaProjectVersion', 'function Test-XmaElectronRuntime', 'function Test-XmaWritableDirectory', 'function Get-XmaNormalizedPath', 'function Get-XmaPathEntries',
  'function Resolve-XmaRustRuntime', 'function Get-XmaProjectRustRuntimeRoot', 'function Get-XmaProjectCargoHome', 'function Get-XmaProjectRustupHome', 'function Use-XmaProjectRustEnvironment',
  "return (Join-Path $ProjectRoot 'runtime\\rust')", 'function Get-XmaCheckoutStateRoot', "return (Join-Path $gitEntry 'xma-state')",
  "return (Join-Path $ProjectRoot '.cache\\xma-state')", 'function Test-XmaCargoOfflineDependencies',
  'dist/version + path.txt + 可执行文件', '-Encoding UTF8',
]) {
  if (!commonSource.includes(marker)) throw new Error(`XMA Windows common helper regression: missing ${marker}`)
}
if (/\[string\[\]\]\$Args\b/i.test(commonSource)) throw new Error('xma-common.ps1 must never use PowerShell automatic variable $args as a parameter')
if (!commonSource.includes('pnpm/rustup/cargo/git/winget/npm 等可见动作必须直接调用本函数')) throw new Error('Invoke-XmaExternal native-terminal output contract documentation missing')
if (!commonSource.includes('Probe 只用于 `--version` / `fmt --version` 这类短命令的静默能力探测')) throw new Error('Invoke-XmaProbe capture-only boundary documentation missing')
if (!commonSource.includes('executable not found: $FilePath')) throw new Error('Invoke-XmaProbe must fail missing absolute executables instead of treating PowerShell command-not-found output as success')
if (commonSource.includes("Join-Path $env:USERPROFILE '.cargo'") || commonSource.includes("Join-Path $env:USERPROFILE '.rustup'")) throw new Error('Windows Rust runtime must stay inside project runtime/rust, not the user profile.')
for (const file of ['scripts/windows/xma-prepare.ps1','scripts/windows/xma-console.ps1']) {
  const text = readFileSync(file, 'utf8')
  if (text.includes('Invoke-XmaProbe') && !commonSource.includes('function Invoke-XmaProbe')) throw new Error(`Windows probe caller requires shared Invoke-XmaProbe: ${file}`)
}

for (const file of ['scripts/windows/xma-prepare.ps1','scripts/windows/xma-github.ps1','scripts/windows/xma-console.ps1','scripts/windows/xma-build-release.ps1']) {
  const text = readFileSync(file, 'utf8')
  if (!text.includes(". (Join-Path $PSScriptRoot 'xma-common.ps1')")) throw new Error(`Windows helper must reuse xma-common.ps1: ${file}`)
  if (/function\s+(?:Run|Invoke-External)\b/.test(text)) throw new Error(`Windows helper must not define a private external-command runner: ${file}`)
  if (/\[string\[\]\]\$Args\b/i.test(text) || /@Args\b/i.test(text)) throw new Error(`PowerShell automatic $args regression detected: ${file}`)
}

const desktopReleaseSource = readFileSync('scripts/windows/xma-build-release.ps1', 'utf8')
for (const marker of [
  'Desktop 专用测试',
  'build:desktop:electron',
  'build:desktop:tauri',
  '不会构建或打包 Xiaoyu Terminal / CLI / Server',
  'Resolve-XmaRustRuntime',
  '使用 `[1]` 确认的 Cargo Home',
]) {
  if (!desktopReleaseSource.includes(marker)) throw new Error(`Desktop release isolation contract missing: ${marker}`)
}
for (const forbidden of ['scripts/release/cli.ts', "@('run','build')", 'build:cli', 'build:server', "@('build','--workspace','--release')"]) {
  if (desktopReleaseSource.includes(forbidden)) throw new Error(`Desktop release must not build CLI/Server/full Rust workspace: ${forbidden}`)
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

const workspaceYamlSource = readFileSync('pnpm-workspace.yaml', 'utf8')
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
  'Build-CliNativeRuntime',
  'Stage-CliNativeRuntime',
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
if (!/Build-CliNativeRuntime\r?\n\s*\$nativeExe = Stage-CliNativeRuntime/.test(consoleSource)) {
  throw new Error('Xiaoyu Terminal must build native runtime as a void native action, then stage/read the executable separately.')
}
if (consoleSource.includes('$nativeExe = Ensure-CliNativeRuntime')) {
  throw new Error('Xiaoyu Terminal must not capture cargo build output through a value-returning action function.')
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
