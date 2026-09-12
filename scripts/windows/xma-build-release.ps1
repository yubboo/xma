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

$requiredCommands = @('node.exe','pnpm.cmd','cargo.exe')
$requiredFiles = @(
  (Join-Path $Root 'node_modules\.bin\tsx.cmd'),
  (Join-Path $Root 'node_modules\.bin\vite.cmd'),
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
  Write-Host '[准备] 构建所需开发环境或通用依赖不完整，先执行 XMA 一键准备开发环境。' -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot 'xma-prepare.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'XMA 开发环境准备失败。' }
}

Write-Host '[同步] 构建前正在校验 Workspace 依赖图与当前 package.json/override 是否一致（不会触发 Electron postinstall）...' -ForegroundColor DarkCyan
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install','--ignore-scripts')
Write-Host '[依赖] pnpm-workspace.yaml 已固定 yauzl >= 3.3.1 override。' -ForegroundColor DarkGray

if ($DesktopRuntime -in @('electron','both')) {
  $electronRoot = Join-Path $Root 'apps\desktop\node_modules\electron'
  $electronExe = Join-Path $electronRoot 'dist\electron.exe'
  if (-not (Test-XmaElectronRuntime -ElectronPackageRoot $electronRoot -ExpectedVersion $ElectronVersion)) {
    Write-Host "[下载] 正在准备 Electron $ElectronVersion 主桌面 Runtime；首次下载包含 Chromium，可能需要数分钟。" -ForegroundColor Yellow
    Write-Host '[进度] 使用 XMA Electron Runtime 下载器显示实时百分比/MB；Windows 使用系统 PowerShell Expand-Archive 解压已校验 ZIP。' -ForegroundColor DarkYellow
    Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','apps/desktop/scripts/install-electron-runtime.ts')
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
Write-Host '[构建] 正在构建 Web / CLI / Server...' -ForegroundColor Cyan
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','build')
Write-Host '[构建] 正在构建 XMA Native Runtime...' -ForegroundColor Cyan
Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('build','--workspace','--release')

$release = Join-Path $Root 'dist\release'
New-Item -ItemType Directory -Force -Path $release | Out-Null
$nativeExe = Join-Path $Root 'target\release\xma-native-runtime.exe'
if (Test-Path $nativeExe) { Copy-Item $nativeExe (Join-Path $release 'xma-native-runtime.exe') -Force }

if ($DesktopRuntime -in @('electron','both')) {
  Write-Host "[构建] 正在构建 Electron $ElectronVersion 主桌面端..." -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','build:desktop:electron')
  $electronRelease = Join-Path $Root 'apps\desktop\release\electron'
  if (Test-Path $electronRelease) { Copy-Item $electronRelease (Join-Path $release 'electron') -Recurse -Force }
}

if ($DesktopRuntime -in @('tauri','both')) {
  Write-Host '[构建] 正在构建 Tauri 2 备用桌面端...' -ForegroundColor Cyan
  if ($WindowsPackages) {
    Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--dir','apps/desktop','exec','tauri','build','--bundles','nsis')
  } else {
    Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','build:desktop:tauri')
  }
  $tauriTarget = Join-Path $Root 'apps\desktop\src-tauri\target\release'
  if (Test-Path $tauriTarget) { Copy-Item $tauriTarget (Join-Path $release 'tauri') -Recurse -Force }
}

Write-Host "[完成] XMA $ProjectVersion 发布产物：$release" -ForegroundColor Green
