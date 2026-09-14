<#
文件作用：Xiaoyu Windows 独立一键安装/升级/卸载器；正式 Release 资产名固定为 `xma-install.ps1`。
关联模块：GitHub Release `release-manifest.json`、scripts/release、portable xiaoyu bundle。
当前实现：按 CPU 架构选择预构建资产、HTTPS 下载、SHA-256 校验、staging 验证、每用户安装、用户 PATH 更新与卸载。
职责边界：普通用户安装不得 clone 源码、运行 pnpm/cargo/MSVC；脚本只安装官方预构建发行资产，不保存 Provider Secret。
#>
param(
  [string]$ManifestUrl = 'https://github.com/yubboo/xma/releases/latest/download/release-manifest.json',
  [string]$InstallDir = '',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'LOCALAPPDATA 不可用，无法确定 Xiaoyu 每用户安装目录。' }
  $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Xiaoyu'
}
$BinDir = Join-Path $InstallDir 'bin'

function Split-UserPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
  return @($Value.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Set-UserPathEntry([string]$Entry, [bool]$Present) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $items = @(Split-UserPath $current)
  $target = [IO.Path]::GetFullPath($Entry).TrimEnd('\')
  $next = @($items | Where-Object {
    try { [IO.Path]::GetFullPath($_).TrimEnd('\') -ine $target } catch { $_ -ine $Entry }
  })
  if ($Present) { $next += $Entry }
  [Environment]::SetEnvironmentVariable('Path', ($next -join ';'), 'User')
}

function Remove-Xiaoyu {
  Set-UserPathEntry -Entry $BinDir -Present $false
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  Write-Host '[完成] Xiaoyu 已从当前用户卸载。重新打开终端后 PATH 变更生效。' -ForegroundColor Green
}

if ($Uninstall) {
  Remove-Xiaoyu
  return
}

$processor = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE')
$architecture = switch -Regex ($processor) {
  'ARM64' { 'arm64'; break }
  'AMD64|x86_64' { 'x64'; break }
  default { throw "Xiaoyu 暂不支持此 Windows CPU 架构：$processor" }
}

Write-Host ''
Write-Host '  XIAOYU · Xiaoyu Management Agent' -ForegroundColor Cyan
Write-Host '  Model is replaceable. Agent is ours.' -ForegroundColor DarkGray
Write-Host ''
Write-Host "[检查] Windows / $architecture" -ForegroundColor Cyan
Write-Host '[获取] 正在读取 Xiaoyu Release Manifest...' -ForegroundColor Cyan
$manifest = Invoke-RestMethod -Uri $ManifestUrl -Method Get
if ($manifest.schemaVersion -ne 1 -or $manifest.product -ne 'xiaoyu') { throw 'Xiaoyu Release Manifest 格式不受支持。' }
$artifact = @($manifest.artifacts | Where-Object { $_.kind -eq 'cli-portable' -and $_.os -eq 'windows' -and $_.arch -eq $architecture }) | Select-Object -First 1
if ($null -eq $artifact) { throw "当前 Release 没有 windows/$architecture 的 Xiaoyu CLI 资产。" }
if (-not ([string]$artifact.url).StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) { throw 'Xiaoyu 安装资产必须使用 HTTPS。' }
if (-not ([string]$artifact.sha256 -match '^[0-9a-fA-F]{64}$')) { throw 'Xiaoyu Release Manifest 缺少有效 SHA-256。' }

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("xiaoyu-install-" + [Guid]::NewGuid().ToString('N'))
$archive = Join-Path $tempRoot ([string]$artifact.file)
$expanded = Join-Path $tempRoot 'expanded'
$backup = "$InstallDir.old-" + [Guid]::NewGuid().ToString('N')
New-Item -ItemType Directory -Force -Path $tempRoot, $expanded | Out-Null

try {
  Write-Host "[下载] Xiaoyu $($manifest.version) ..." -ForegroundColor Yellow
  Invoke-WebRequest -UseBasicParsing -Uri ([string]$artifact.url) -OutFile $archive
  $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
  $expected = ([string]$artifact.sha256).ToLowerInvariant()
  if ($actual -ne $expected) { throw "SHA-256 校验失败。期望 $expected，实际 $actual。" }
  Write-Host '[通过] SHA-256 校验通过。' -ForegroundColor Green

  Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
  foreach ($required in @('VERSION', 'bin\xiaoyu.cmd', 'runtime\node.exe', 'app\xiaoyu.exe', 'native\xma-native-runtime.exe')) {
    if (-not (Test-Path (Join-Path $expanded $required))) { throw "Xiaoyu 安装包缺少文件：$required" }
  }

  if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
  if (Test-Path $InstallDir) { Move-Item $InstallDir $backup }
  try {
    $parent = Split-Path -Parent $InstallDir
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Move-Item $expanded $InstallDir
  } catch {
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $backup) { Move-Item $backup $InstallDir }
    throw
  }
  if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }

  Set-UserPathEntry -Entry $BinDir -Present $true
  $installedVersion = (Get-Content (Join-Path $InstallDir 'VERSION') -Raw -Encoding UTF8).Trim()
  Write-Host ''
  Write-Host "[完成] Xiaoyu $installedVersion 已安装。" -ForegroundColor Green
  Write-Host "[目录] $InstallDir" -ForegroundColor DarkGray
  Write-Host '[下一步] 新开一个 PowerShell / Windows Terminal，然后在任意项目目录运行：' -ForegroundColor Cyan
  Write-Host '  xiaoyu' -ForegroundColor White
  Write-Host '[兼容] 也可使用短别名：xma' -ForegroundColor DarkGray
  Write-Host ''
} finally {
  if (Test-Path $tempRoot) { Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
