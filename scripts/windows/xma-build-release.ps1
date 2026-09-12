<#
文件作用：构建 XMA 可交付产物。
关联模块：package.json、apps/desktop/electron-builder.yml、Rust workspace。
当前实现：TS/Web/CLI/Server/Desktop 构建、Rust release、Windows NSIS + Portable。
职责边界：macOS 安装包必须在 macOS Runner/机器构建；Linux 包必须在 Linux Runner/机器构建，不伪造跨平台完成。
#>
param([switch]$WindowsPackages)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
$ProjectVersion = Get-XmaProjectVersion -ProjectRoot $Root

if ((-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) -or (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) -or (-not (Test-Path 'node_modules')) -or (-not (Test-Path 'pnpm-lock.yaml'))) {
  Write-Host '[准备] 构建依赖尚未完成，先执行 XMA 一键环境准备。' -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot 'xma-prepare.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'XMA 环境准备失败。' }
}

Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','check')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','build')
Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('build','--workspace','--release')

$release = Join-Path $Root 'dist\release'
New-Item -ItemType Directory -Force -Path $release | Out-Null
$nativeExe = Join-Path $Root 'target\release\xma-native-runtime.exe'
if (Test-Path $nativeExe) { Copy-Item $nativeExe (Join-Path $release 'xma-native-runtime.exe') -Force }

if ($WindowsPackages) {
  $desktopNative = Join-Path $Root 'apps\desktop\native'
  if (Test-Path $desktopNative) { Remove-Item $desktopNative -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $desktopNative | Out-Null
  if (Test-Path $nativeExe) { Copy-Item $nativeExe (Join-Path $desktopNative 'xma-native-runtime.exe') -Force }
  $desktopWeb = Join-Path $Root 'apps\desktop\web'
  if (Test-Path $desktopWeb) { Remove-Item $desktopWeb -Recurse -Force }
  Copy-Item (Join-Path $Root 'dist\web') $desktopWeb -Recurse -Force
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','electron-builder','--projectDir','apps/desktop','--config','electron-builder.yml','--win','nsis','portable')
  if (Test-Path 'apps\desktop\release') { Copy-Item 'apps\desktop\release\*' $release -Recurse -Force }
}

Write-Host "[完成] XMA $ProjectVersion 发布产物：$release" -ForegroundColor Green
