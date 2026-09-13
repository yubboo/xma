<#
文件作用：构建 XMA 可交付产物；复用 [1] 已准备的通用依赖，只为明确选择的 Desktop Runtime 补齐运行时并执行构建。
关联模块：package.json、apps/desktop、Rust workspace、xma-prepare.ps1。
当前实现：TypeScript/Web/CLI/Server、Rust Native release、Electron 41.2.0 主桌面端；可选构建 Tauri 2 备用桌面端。
职责边界：macOS 安装包必须在 macOS Runner/机器构建；Linux 包必须在 Linux Runner/机器构建，不伪造跨平台完成。
#>
param(
  [switch]$WindowsPackages,
  [ValidateSet('electron','tauri','both')][string]$DesktopRuntime = 'electron'
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
$ProjectVersion = Get-XmaProjectVersion -ProjectRoot $Root
$ElectronVersion = '41.2.0'
$CargoTargetDir = Join-Path $Root '.cache\cargo-target'
$TauriTargetDir = Join-Path $Root '.cache\tauri-target'
$DesktopCacheDir = Join-Path $Root '.cache\desktop'

$requiredCommands = @('node.exe','pnpm.cmd','cargo.exe')
$requiredFiles = @(
  (Join-Path $Root 'node_modules\.bin\tsx.cmd'),
  (Join-Path $Root 'node_modules\.bin\vite.cmd'),
  (Join-Path $Root 'node_modules\.bin\tsc.cmd'),
  (Join-Path $Root 'node_modules\.bin\tsup.cmd'),
  (Join-Path $Root 'apps\desktop\node_modules\electron\package.json')
)
$needsPrepare = $false
foreach ($command in $requiredCommands) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { $needsPrepare = $true }
}
foreach ($file in $requiredFiles) {
  if (-not (Test-Path $file)) { $needsPrepare = $true }
}
if ($needsPrepare) {
  throw '构建所需开发环境或通用 Workspace 依赖不完整。请先运行 XMA.bat → [1] 一键准备开发环境；构建流程不会重复安装 Workspace 依赖。'
}

Write-Host '[依赖] 正在复用 [1] 已准备的 Workspace JavaScript / Rust 依赖；构建流程不会再次执行 pnpm install。' -ForegroundColor DarkCyan
Write-Host '[依赖] pnpm-workspace.yaml 已固定 yauzl >= 3.3.1 override。' -ForegroundColor DarkGray

if ($DesktopRuntime -in @('electron','both')) {
  $electronRoot = Join-Path $Root 'apps\desktop\node_modules\electron'
  $electronExe = Join-Path $electronRoot 'dist\electron.exe'
  if (-not (Test-XmaElectronRuntime -ElectronPackageRoot $electronRoot -ExpectedVersion $ElectronVersion)) {
    Write-Host "[下载] 正在准备 Electron $ElectronVersion 主桌面 Runtime；首次下载包含 Chromium，可能需要数分钟。" -ForegroundColor Yellow
    Write-Host '[进度] 使用 XMA Electron Runtime 下载器显示实时百分比/MB；Windows 使用系统 PowerShell Expand-Archive 解压已校验 ZIP。' -ForegroundColor DarkYellow
    Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','apps/desktop/scripts/electron/install-runtime.ts')
  }
  if (-not (Test-XmaElectronRuntime -ElectronPackageRoot $electronRoot -ExpectedVersion $ElectronVersion)) { throw 'Electron Runtime 未准备成功；可重试或使用 -DesktopRuntime tauri 构建备用桌面端。' }
  Write-Host "[通过] Electron $ElectronVersion Runtime 已就绪。" -ForegroundColor Green
}

if ($DesktopRuntime -in @('tauri','both')) {
  Write-Host '[同步] 正在预取 Tauri 2 备用桌面端 Rust crates...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')
}

Write-Host '[检查] 正在运行 TypeScript / Tests / Architecture Gates...' -ForegroundColor Cyan
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','check')
Write-Host '[目录] XMA 中间产物统一进入 .cache\；正式产品统一进入 dist\；不再使用根 build\ / target\ 或 apps\desktop\dist|web|release。' -ForegroundColor DarkGray
Write-Host '[构建] 正在构建 Web / CLI / Server...' -ForegroundColor Cyan
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','build')
Write-Host "[构建] 正在构建 XMA Native Runtime；Cargo 中间产物统一写入 $CargoTargetDir，不再生成仓库根 target\ 目录。" -ForegroundColor Cyan
Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('build','--workspace','--release')

$release = Join-Path $Root 'dist\release'
if (Test-Path $release) { Remove-Item $release -Recurse -Force }
New-Item -ItemType Directory -Force -Path $release | Out-Null
$nativeExe = Join-Path $CargoTargetDir 'release\xma-native-runtime.exe'
if (Test-Path $nativeExe) { Copy-Item $nativeExe (Join-Path $release 'xma-native-runtime.exe') -Force }

if ($DesktopRuntime -in @('electron','both')) {
  Write-Host "[构建] 正在构建 Electron $ElectronVersion 主桌面端；staging 写入 $DesktopCacheDir，最终产物直接写入 dist\release\electron。" -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','build:desktop:electron')
  $electronRelease = Join-Path $release 'electron'
  if (-not (Test-Path $electronRelease)) { throw 'Electron 构建完成但 dist\release\electron 不存在。' }
}

if ($DesktopRuntime -in @('tauri','both')) {
  Write-Host "[构建] 正在构建 Tauri 2 备用桌面端；Tauri Rust 缓存写入 $TauriTargetDir。" -ForegroundColor Cyan
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
  $tauriOutput = Join-Path $release 'tauri'
  New-Item -ItemType Directory -Force -Path $tauriOutput | Out-Null
  $tauriExe = Join-Path $tauriRelease 'xma-desktop.exe'
  if (Test-Path $tauriExe) { Copy-Item $tauriExe (Join-Path $tauriOutput 'xma-desktop.exe') -Force }
  $tauriBundle = Join-Path $tauriRelease 'bundle'
  if (Test-Path $tauriBundle) { Copy-Item $tauriBundle (Join-Path $tauriOutput 'bundle') -Recurse -Force }
}

Write-Host "[完成] XMA $ProjectVersion 发布产物：$release" -ForegroundColor Green
