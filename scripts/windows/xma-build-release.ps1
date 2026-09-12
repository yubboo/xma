<#
文件作用：构建 XMA 可交付产物；只有用户明确选择构建时才安装项目构建依赖和桌面运行时依赖。
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

foreach ($command in @('node.exe','pnpm.cmd','cargo.exe')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    Write-Host '[准备] 构建所需系统环境不完整，先进入 XMA 基础环境准备。' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'xma-prepare.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'XMA 基础环境准备失败。' }
    break
  }
}

Write-Host '[构建依赖] 你已明确选择构建，现在允许安装项目构建依赖。' -ForegroundColor Cyan
Write-Host '[安装] 正在安装 Root/Core 构建依赖（忽略依赖脚本）...' -ForegroundColor Yellow
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--filter','xma','install','--ignore-scripts')
Write-Host '[安装] 正在安装 Desktop JavaScript 依赖元数据（忽略 postinstall）...' -ForegroundColor Yellow
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--filter','@xma/desktop','install','--ignore-scripts')
Write-Host '[安装] 正在准备 esbuild Native Binary...' -ForegroundColor Yellow
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('rebuild','esbuild')
Write-Host '[同步] 正在预取 XMA Native Rust crates...' -ForegroundColor Yellow
Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fetch')

if ($DesktopRuntime -in @('electron','both')) {
  $electronExe = Join-Path $Root 'apps\desktop\node_modules\electron\dist\electron.exe'
  if (-not (Test-Path $electronExe)) {
    Write-Host "[下载] 正在准备 Electron $ElectronVersion 主桌面 Runtime；首次下载包含 Chromium，可能需要数分钟。" -ForegroundColor Yellow
    Write-Host '[进度] @electron/get 超过约 30 秒会显示下载进度，并使用本地缓存加速以后构建。' -ForegroundColor DarkYellow
    $oldDebug = $env:DEBUG
    $oldProgress = $env:ELECTRON_GET_NO_PROGRESS
    $oldProxy = $env:ELECTRON_GET_USE_PROXY
    try {
      $env:DEBUG = '@electron/get*'
      Remove-Item Env:ELECTRON_GET_NO_PROGRESS -ErrorAction SilentlyContinue
      if ($env:HTTP_PROXY -or $env:HTTPS_PROXY -or $env:ALL_PROXY) { $env:ELECTRON_GET_USE_PROXY = '1' }
      Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--dir','apps/desktop','rebuild','electron')
    } finally {
      if ($null -eq $oldDebug) { Remove-Item Env:DEBUG -ErrorAction SilentlyContinue } else { $env:DEBUG = $oldDebug }
      if ($null -eq $oldProgress) { Remove-Item Env:ELECTRON_GET_NO_PROGRESS -ErrorAction SilentlyContinue } else { $env:ELECTRON_GET_NO_PROGRESS = $oldProgress }
      if ($null -eq $oldProxy) { Remove-Item Env:ELECTRON_GET_USE_PROXY -ErrorAction SilentlyContinue } else { $env:ELECTRON_GET_USE_PROXY = $oldProxy }
    }
  }
  if (-not (Test-Path $electronExe)) { throw 'Electron Runtime 未准备成功；可重试或使用 -DesktopRuntime tauri 构建备用桌面端。' }
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
