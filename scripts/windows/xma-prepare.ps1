<#
文件作用：XMA Windows 一键开发环境准备器，一次完成系统工具与通用项目依赖准备。
关联模块：xma-console.ps1、package.json、pnpm-workspace.yaml、Cargo.toml、apps/desktop。
当前实现：检查/安装 Git、Node.js、pnpm、Rust/Cargo、MSVC；安装 Workspace JavaScript 依赖但禁止 Desktop Runtime postinstall；准备 esbuild 与 XMA Native Rust crates；生成开发态 xiaoyu/xma 命令并自动注册到当前用户 PATH。
职责边界：Electron Chromium Runtime 只在用户明确选择 Electron Desktop/构建时下载；Tauri 2 Rust crates 只在用户明确选择 Tauri/构建时下载；开发命令只写 User PATH，不修改 Machine PATH，也不冒充正式 Release 安装。
#>

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
$ElectronVersion = '41.2.0'

function Confirm-XmaAction([string]$Message) {
  while ($true) {
    $answer = (Read-Host "$Message [Y/N]").Trim().ToLowerInvariant()
    if ($answer -in @('y','yes')) { return $true }
    if ($answer -in @('n','no')) { return $false }
    Write-Host '请输入 Y 或 N。' -ForegroundColor Yellow
  }
}

function Refresh-XmaPath {
  $machine = [Environment]::GetEnvironmentVariable('Path','Machine')
  $user = [Environment]::GetEnvironmentVariable('Path','User')
  $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
  $env:Path = "$cargoBin;$machine;$user"
}

function Ensure-XmaWinget {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw '未检测到 winget。请先安装或更新 Microsoft App Installer，再重新运行 XMA。'
  }
}


function Get-XmaPathEntries([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
  return @($Value.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-XmaNormalizedPath([string]$Value) {
  try { $candidate = [IO.Path]::GetFullPath($Value) } catch { $candidate = $Value }
  return $candidate.TrimEnd([char[]]@('\','/'))
}

function Install-XmaDevelopmentCommands {
  # 中文说明：不把整个 Git 仓库加入 PATH，避免把维护脚本/其他文件都暴露为全局命令。
  # 只生成忽略提交的 .xma\dev-bin shim；它们始终回到当前 checkout 的 xma-dev.bat，并保留用户调用命令时的 Workspace。
  $devBin = Join-Path $Root '.xma\dev-bin'
  New-Item -ItemType Directory -Force -Path $devBin | Out-Null
  $launcher = @'
@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..\..") do set "XMA_DEV_ROOT=%%~fI"
call "%XMA_DEV_ROOT%\xma-dev.bat" cli "%CD%"
exit /b %ERRORLEVEL%
'@
  foreach ($name in @('xiaoyu.cmd','xma.cmd')) {
    [IO.File]::WriteAllText((Join-Path $devBin $name), ($launcher -replace "`r?`n", "`r`n"), ([Text.UTF8Encoding]::new($false)))
  }
  [IO.File]::WriteAllText((Join-Path $devBin 'source-root.txt'), "$Root`r`n", ([Text.UTF8Encoding]::new($false)))

  $normalizedDevBin = Get-XmaNormalizedPath $devBin
  $userEntries = @(Get-XmaPathEntries ([Environment]::GetEnvironmentVariable('Path','User')))
  $nextUserEntries = @($devBin)
  foreach ($entry in $userEntries) {
    $normalized = Get-XmaNormalizedPath $entry
    if ($normalized -ieq $normalizedDevBin) { continue }
    # 一个开发账号只激活一个 XMA checkout 的 xiaoyu/xma 开发 shim；旧 checkout 的 dev-bin 自动退出 PATH，避免命令指向错误仓库。
    if ($normalized -match '(?i)[\\/]\.xma[\\/]dev-bin$') { continue }
    $nextUserEntries += $entry
  }
  [Environment]::SetEnvironmentVariable('Path', ($nextUserEntries -join ';'), 'User')

  $processEntries = @(Get-XmaPathEntries $env:Path)
  if (-not ($processEntries | Where-Object { (Get-XmaNormalizedPath $_) -ieq $normalizedDevBin })) {
    $env:Path = "$devBin;$env:Path"
  }
  Write-Host "[通过] 开发态命令已注册到当前用户 PATH：xiaoyu / xma" -ForegroundColor Green
  Write-Host "[位置] $devBin" -ForegroundColor DarkGray
  Write-Host '[说明] 这是当前源码 checkout 的开发 shim；移动仓库后重新运行 xma-dev.bat → [1] 即可刷新。' -ForegroundColor DarkGray
}

Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '  XMA 一键准备开发环境' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '说明：本流程一次准备系统工具 + XMA 通用项目依赖。' -ForegroundColor DarkGray
Write-Host '说明：会安装 Workspace JavaScript 依赖、esbuild Native Binary 与 XMA Native Rust crates。' -ForegroundColor DarkGray
Write-Host "说明：不会下载 Electron $ElectronVersion Chromium Runtime，也不会预取 Tauri 2 Rust crates；这两项只在明确选择对应 Desktop 后执行。" -ForegroundColor DarkGray
Write-Host ''

Write-Host '[1/8] Git' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Git 是否可用...' -ForegroundColor DarkCyan
if (Get-Command git.exe -ErrorAction SilentlyContinue) {
  Write-Host "[通过] 已检测到 $(& git.exe --version)" -ForegroundColor Green
} else {
  Write-Host '[缺少] 当前没有检测到 Git。' -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否自动下载并安装 Git？')) { throw 'Git 是 XMA 开发与推送流程的必要依赖。' }
  Ensure-XmaWinget
  Write-Host '[安装] 正在通过 winget 下载并安装 Git...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('install','--id','Git.Git','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'Git 安装后仍未出现在 PATH，请重新打开终端后再运行。' }
  Write-Host "[完成] Git 安装完成：$(& git.exe --version)" -ForegroundColor Green
}

Write-Host ''
Write-Host '[2/8] Node.js 22+' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Node.js 版本...' -ForegroundColor DarkCyan
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host '[缺少] 当前没有检测到 Node.js。' -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否自动下载并安装 Node.js LTS？')) { throw 'Node.js 22+ 是 XMA TypeScript Runtime 的必要依赖。' }
  Ensure-XmaWinget
  Write-Host '[安装] 正在通过 winget 下载并安装 Node.js LTS...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('install','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 安装后仍未出现在 PATH，请重新打开终端后再运行。' }
$nodeVersion = (& node.exe --version).Trim()
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  Write-Host "[过旧] 当前 $nodeVersion，XMA 要求 Node.js 22+。" -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否通过 winget 自动升级 Node.js LTS？')) { throw 'Node.js 版本不足。' }
  Ensure-XmaWinget
  Write-Host '[升级] 正在升级 Node.js LTS...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('upgrade','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
  $nodeVersion = (& node.exe --version).Trim()
  $major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
  if ($major -lt 22) { throw "Node.js 升级后仍低于 22：$nodeVersion。请重新打开终端后重试。" }
}
Write-Host "[通过] Node.js $nodeVersion" -ForegroundColor Green

Write-Host ''
Write-Host '[3/8] pnpm 11.17.0' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 pnpm 版本...' -ForegroundColor DarkCyan
$pnpmVersion = if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) { (& pnpm.cmd --version).Trim() } else { '' }
if ($pnpmVersion -ne '11.17.0') {
  if ($pnpmVersion) { Write-Host "[调整] 当前 pnpm $pnpmVersion，项目固定使用 11.17.0。" -ForegroundColor Yellow }
  else { Write-Host '[缺少] 当前没有检测到 pnpm。' -ForegroundColor Yellow }
  Write-Host '[安装] 正在通过 npm 安装 pnpm 11.17.0...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'npm.cmd' -ArgumentList @('install','--global','pnpm@11.17.0')
  Refresh-XmaPath
}
$pnpmVersion = (& pnpm.cmd --version).Trim()
if ($pnpmVersion -ne '11.17.0') { throw "pnpm 版本校验失败：期望 11.17.0，实际 $pnpmVersion。" }
Write-Host "[通过] pnpm $pnpmVersion" -ForegroundColor Green

Write-Host ''
Write-Host '[4/8] Rust / Cargo' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Rust stable toolchain、rustc 与 Cargo...' -ForegroundColor DarkCyan
$hasCargo = [bool](Get-Command cargo.exe -ErrorAction SilentlyContinue)
$hasRustc = [bool](Get-Command rustc.exe -ErrorAction SilentlyContinue)
$hasRustup = [bool](Get-Command rustup.exe -ErrorAction SilentlyContinue)
if (-not $hasCargo -or -not $hasRustc) {
  Write-Host '[缺少] Rust toolchain 不完整。' -ForegroundColor Yellow
  if (-not $hasRustup) {
    if (-not (Confirm-XmaAction '是否通过 rustup 自动安装 Rust？')) { throw 'Rust 是 XMA Native Runtime 的必要依赖。' }
    Ensure-XmaWinget
    Write-Host '[安装] 正在安装 rustup...' -ForegroundColor Yellow
    Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('install','--id','Rustlang.Rustup','--exact','--accept-source-agreements','--accept-package-agreements')
    Refresh-XmaPath
  }
  if (-not (Get-Command rustup.exe -ErrorAction SilentlyContinue)) { throw 'rustup 安装后仍未出现在 PATH，请重新打开终端后再运行。' }
  Write-Host '[安装] 正在安装 Rust stable minimal toolchain...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'rustup.exe' -ArgumentList @('toolchain','install','stable','--profile','minimal')
  Invoke-XmaExternal -FilePath 'rustup.exe' -ArgumentList @('default','stable')
  Refresh-XmaPath
}
if (-not (Get-Command rustc.exe -ErrorAction SilentlyContinue)) { throw '未检测到 rustc。' }
if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { throw '未检测到 cargo。' }
Write-Host "[通过] $(& rustc.exe --version)" -ForegroundColor Green
Write-Host "[通过] $(& cargo.exe --version)" -ForegroundColor Green

Write-Host ''
Write-Host '[5/8] MSVC C++ Build Tools' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Windows C++ 编译与链接工具...' -ForegroundColor DarkCyan
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$msvcReady = $false
if (Test-Path $vswhere) {
  $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  $msvcReady = [bool]$install
}
if ($msvcReady) {
  Write-Host '[通过] Visual Studio C++ Build Tools 已安装。' -ForegroundColor Green
} else {
  Write-Host '[缺少] 未检测到 Visual Studio C++ Build Tools（Rust MSVC 链接器需要）。' -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否自动安装 Visual Studio 2022 Build Tools + C++ Toolchain？')) { throw 'Windows Rust Native 构建需要 MSVC C++ Build Tools。' }
  Ensure-XmaWinget
  Write-Host '[安装] 正在安装 Visual Studio 2022 Build Tools + C++ Toolchain，这一步可能需要几分钟...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @(
    'install','--id','Microsoft.VisualStudio.2022.BuildTools','--exact',
    '--accept-source-agreements','--accept-package-agreements',
    '--override','--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  )
  Write-Host '[完成] Visual Studio C++ Build Tools 安装命令已完成。' -ForegroundColor Green
}

Write-Host ''
Write-Host '[6/8] TypeScript / Web / CLI / Desktop JavaScript 依赖' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 XMA Workspace JavaScript 依赖...' -ForegroundColor DarkCyan
$tsx = Join-Path $Root 'node_modules\.bin\tsx.cmd'
$vite = Join-Path $Root 'node_modules\.bin\vite.cmd'
$tsc = Join-Path $Root 'node_modules\.bin\tsc.cmd'
$tsup = Join-Path $Root 'node_modules\.bin\tsup.cmd'
$cliTuiPackage = Join-Path $Root 'apps\cli\node_modules\@earendil-works\pi-tui\package.json'
$desktopElectronPackage = Join-Path $Root 'apps\desktop\node_modules\electron\package.json'
$desktopTauriCmd = Join-Path $Root 'apps\desktop\node_modules\.bin\tauri.cmd'

$jsReady = (Test-Path $tsx) -and (Test-Path $vite) -and (Test-Path $tsc) -and (Test-Path $tsup) -and (Test-Path $cliTuiPackage) -and (Test-Path $desktopElectronPackage) -and (Test-Path $desktopTauriCmd)
if ($jsReady) {
  Write-Host '[同步] Workspace 依赖已存在，正在快速校验 package/lockfile/node_modules 是否仍一致...' -ForegroundColor DarkCyan
} else {
  Write-Host '[安装] 正在安装全部 Workspace JavaScript 依赖元数据...' -ForegroundColor Yellow
}
Write-Host '[安全] 本步骤使用 --ignore-scripts，Electron Chromium Runtime 不会在这里下载。' -ForegroundColor DarkYellow
Write-Host '[依赖] pnpm-workspace.yaml 已固定 yauzl >= 3.3.1 override；Electron Chromium Runtime 仍不会在这里下载。' -ForegroundColor DarkYellow
# 中文说明：即使 node_modules 已存在也执行一次幂等 install，确保源码升级后的 package.json / pnpm-workspace.yaml / lockfile 不会与旧依赖树漂移。
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install','--ignore-scripts')

Write-Host '[安装] 正在准备 esbuild 当前平台 Native Binary...' -ForegroundColor Yellow
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('rebuild','esbuild')

Write-Host '[验证] 正在验证 TypeScript / Vite / tsx / tsup 工具链...' -ForegroundColor DarkCyan
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsc','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','vite','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsup','--version')
# 中文说明：esbuild 是 Vite/tsx/tsup 的内部依赖，不要求根目录暴露 `esbuild` 可执行文件。
# 使用 tsx 执行一段最小 TypeScript 来验证 esbuild Native Binary 真正可用，避免 pnpm strict linker 下 `pnpm exec esbuild` 误报找不到命令。
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','-e','const value: number = 1; if (value !== 1) process.exit(1)') -QuietCommand

if (-not (Test-Path $cliTuiPackage)) { throw 'Xiaoyu TUI package 元数据缺失。' }
$installedTui = (Get-Content $cliTuiPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($installedTui -ne '0.74.0') { throw "Xiaoyu TUI package 版本不一致：期望 0.74.0，实际 $installedTui。" }
Write-Host "[通过] Xiaoyu TUI framework 已准备完成：@earendil-works/pi-tui $installedTui。" -ForegroundColor Green

if (-not (Test-Path $desktopElectronPackage)) { throw 'Desktop Electron package 元数据缺失。' }
$installedElectron = (Get-Content $desktopElectronPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($installedElectron -ne $ElectronVersion) { throw "Electron package 版本不一致：期望 $ElectronVersion，实际 $installedElectron。" }
if (-not (Test-Path $desktopTauriCmd)) { throw 'Tauri 2 CLI package 未安装完整。' }
Write-Host "[通过] Workspace JavaScript 依赖已准备完成；Electron package 锁定 $ElectronVersion，未要求下载 Chromium Runtime。" -ForegroundColor Green

Write-Host ''
Write-Host '[7/8] XMA Native Rust crates' -ForegroundColor Cyan
Write-Host '[缓存] Rust 编译/测试产物统一写入 XMA 项目 .cache\cargo-target\；仓库根不再生成 target\。' -ForegroundColor DarkGray
Write-Host '[同步] 正在预取 XMA Native Runtime 所需 Rust crates...' -ForegroundColor Yellow
Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fetch')
Write-Host '[通过] XMA Native Rust crates 已准备完成。' -ForegroundColor Green

Write-Host ''
Write-Host '[8/8] 开发态 Xiaoyu 命令' -ForegroundColor Cyan
Write-Host '[PATH] 正在生成当前源码 checkout 的 xiaoyu/xma 开发命令并写入当前用户 PATH...' -ForegroundColor DarkCyan
Install-XmaDevelopmentCommands

Write-Host ''
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '[完成] XMA 开发环境与通用项目依赖已准备完成。' -ForegroundColor Green
Write-Host '[可直接运行] Web / Xiaoyu CLI / 全量检查不再重复安装依赖。' -ForegroundColor Cyan
Write-Host '[开发命令] 新开 PowerShell / Windows Terminal 后，可在任意 Workspace 直接输入 xiaoyu 或 xma 启动当前源码 CLI。' -ForegroundColor Cyan
Write-Host "[Desktop] Electron $ElectronVersion Chromium Runtime 仍只在你明确选择 Electron 时下载；Tauri 2 Rust crates 仍只在选择 Tauri 时预取。" -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
