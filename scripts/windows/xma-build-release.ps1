<#
文件作用：构建 XMA Desktop 可交付产物；复用 [1] 已准备的依赖，只构建用户明确选择的 Electron / Tauri 桌面端。
关联模块：apps/desktop、apps/web、xma-console.ps1、xma-prepare.ps1。
当前实现：Desktop 专用检查、Electron 41.2.0 Runtime 按需准备并强制复用、Electron Setup/Portable 与可选 Tauri 2 构建。
职责边界：本脚本不构建 Xiaoyu Terminal / CLI / Server，也不生成 CLI portable bundle；CLI 发行由 scripts/release/ 与 Release Workflow 独立负责。
#>
param(
  [switch]$WindowsPackages,
  [ValidateSet('electron','tauri','both')][string]$DesktopRuntime = 'electron'
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
[void](Import-XmaRustEnvironment -ProjectRoot $Root)
$ProjectVersion = Get-XmaProjectVersion -ProjectRoot $Root
$ElectronVersion = '41.2.0'
$TauriTargetDir = Join-Path $Root '.cache\tauri-target'
$DesktopCacheDir = Join-Path $Root '.cache\desktop'
$DesktopReleaseRoot = Join-Path $Root 'dist\release'

$requiredCommands = @('node.exe','pnpm.cmd')
$requiredFiles = @(
  (Join-Path $Root 'node_modules\.bin\tsx.cmd'),
  (Join-Path $Root 'node_modules\.bin\vite.cmd'),
  (Join-Path $Root 'node_modules\.bin\tsup.cmd')
)
if ($DesktopRuntime -in @('electron','both')) {
  $requiredFiles += (Join-Path $Root 'apps\desktop\node_modules\electron\package.json')
  $requiredFiles += (Join-Path $Root 'apps\desktop\node_modules\.bin\electron-builder.cmd')
}
if ($DesktopRuntime -in @('tauri','both')) {
  $requiredCommands += 'cargo.exe'
  $requiredFiles += (Join-Path $Root 'apps\desktop\node_modules\.bin\tauri.cmd')
}

$missing = New-Object System.Collections.Generic.List[string]
foreach ($command in ($requiredCommands | Select-Object -Unique)) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { [void]$missing.Add($command) }
}
foreach ($file in ($requiredFiles | Select-Object -Unique)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { [void]$missing.Add($file) }
}
if ($missing.Count -gt 0) {
  Write-Host '[缺少] Desktop 构建依赖不完整：' -ForegroundColor Yellow
  foreach ($item in $missing) { Write-Host "  - $item" -ForegroundColor DarkGray }
  throw '请先运行 xma-dev.bat → [1] 一键准备开发环境；Desktop 构建不会偷偷执行 pnpm install。'
}

Write-Host '[依赖] 复用 [1] 已准备的 Desktop/Web JavaScript 依赖；不会重复执行 pnpm install。' -ForegroundColor DarkCyan
Write-Host '[隔离] 本次只构建 Desktop；不会构建或打包 Xiaoyu Terminal / CLI / Server。' -ForegroundColor Green

if ($DesktopRuntime -in @('electron','both')) {
  $electronRoot = Join-Path $Root 'apps\desktop\node_modules\electron'
  if (-not (Test-XmaElectronRuntime -ElectronPackageRoot $electronRoot -ExpectedVersion $ElectronVersion)) {
    Write-Host "[下载] 正在准备 Electron $ElectronVersion 主桌面 Runtime；首次下载包含 Chromium，之后复用缓存。" -ForegroundColor Yellow
    Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','apps/desktop/scripts/electron/install-runtime.ts')
  }
  if (-not (Test-XmaElectronRuntime -ElectronPackageRoot $electronRoot -ExpectedVersion $ElectronVersion)) {
    throw 'Electron Runtime 未准备成功；可重试或选择 Tauri 2 备用桌面端。'
  }
  Write-Host "[通过] Electron $ElectronVersion Runtime 已就绪。" -ForegroundColor Green
  Write-Host '[复用] electron-builder 将通过 electronDist 使用上述 Runtime，不会再次下载 Electron。' -ForegroundColor DarkCyan
}

if ($DesktopRuntime -in @('tauri','both')) {
  [void](Import-XmaRustEnvironment -ProjectRoot $Root)
  $cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
  if (-not $cargoCommand) { throw 'Tauri Desktop 需要 Rust/Cargo。请先运行 xma-dev.bat → [1]。' }
  $cargoHome = Get-XmaEffectiveCargoHome -CargoExecutable $cargoCommand.Source
  Write-Host '[检查] 正在验证 Tauri 2 / Cargo...' -ForegroundColor DarkCyan
  Write-Host "[Rust] 使用 `[1]` 确认的 Cargo Home：$cargoHome" -ForegroundColor DarkGray
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--dir','apps/desktop','exec','tauri','--version')
  Invoke-XmaExternal -FilePath $cargoCommand.Source -ArgumentList @('--version')
  Write-Host '[同步] 正在按需预取 Tauri 2 Rust crates...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath $cargoCommand.Source -ArgumentList @('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')
}

Write-Host '[检查] 正在运行 Desktop 专用测试；全项目 TypeScript / CLI / Gates 请使用菜单 [7]。' -ForegroundColor Cyan
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','--test','apps/desktop/tests/*.test.ts')
Write-Host '[目录] Desktop 中间产物统一进入 .cache\desktop；正式桌面产物进入 dist\release\electron|tauri。' -ForegroundColor DarkGray
New-Item -ItemType Directory -Force -Path $DesktopReleaseRoot | Out-Null

if ($DesktopRuntime -in @('electron','both')) {
  if ($WindowsPackages) {
    Write-Host "[构建] Electron $ElectronVersion · Windows Setup + Portable..." -ForegroundColor Cyan
  } else {
    Write-Host "[构建] Electron $ElectronVersion · 当前 Windows 平台..." -ForegroundColor Cyan
  }
  Write-Host "[staging] $DesktopCacheDir" -ForegroundColor DarkGray
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','build:desktop:electron')
  $electronRelease = Join-Path $DesktopReleaseRoot 'electron'
  if (-not (Test-Path -LiteralPath $electronRelease -PathType Container)) {
    throw 'Electron 构建完成但 dist\release\electron 不存在。'
  }
  Write-Host "[完成] Electron Desktop：$electronRelease" -ForegroundColor Green
}

if ($DesktopRuntime -in @('tauri','both')) {
  Write-Host "[构建] Tauri 2 备用桌面端；Rust 中间缓存：$TauriTargetDir" -ForegroundColor Cyan
  $previousCargoTargetDir = $env:CARGO_TARGET_DIR
  $env:CARGO_TARGET_DIR = $TauriTargetDir
  try {
    if ($WindowsPackages) {
      Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--dir','apps/desktop','exec','tauri','build','--bundles','nsis')
    } else {
      Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','build:desktop:tauri')
    }
  } finally {
    if ($null -eq $previousCargoTargetDir) { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue } else { $env:CARGO_TARGET_DIR = $previousCargoTargetDir }
  }

  $tauriRelease = Join-Path $TauriTargetDir 'release'
  $tauriOutput = Join-Path $DesktopReleaseRoot 'tauri'
  if (Test-Path -LiteralPath $tauriOutput) { Remove-Item -LiteralPath $tauriOutput -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $tauriOutput | Out-Null
  $tauriExe = Join-Path $tauriRelease 'xma-desktop.exe'
  if (Test-Path -LiteralPath $tauriExe -PathType Leaf) { Copy-Item -LiteralPath $tauriExe -Destination (Join-Path $tauriOutput 'xma-desktop.exe') -Force }
  $tauriBundle = Join-Path $tauriRelease 'bundle'
  if (Test-Path -LiteralPath $tauriBundle -PathType Container) { Copy-Item -LiteralPath $tauriBundle -Destination (Join-Path $tauriOutput 'bundle') -Recurse -Force }
  Write-Host "[完成] Tauri Desktop：$tauriOutput" -ForegroundColor Green
}

Write-Host "[完成] XMA $ProjectVersion Desktop 构建结束。" -ForegroundColor Green
Write-Host '[说明] Xiaoyu Terminal / CLI portable 发行与 Desktop 已解耦，不会因为 CLI 构建失败阻塞 Desktop 安装包。' -ForegroundColor DarkCyan
