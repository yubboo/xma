<#
文件作用：XMA Windows 基础开发环境准备器，只准备系统级开发工具，不下载任何项目依赖或 Desktop Runtime。
关联模块：xma-console.ps1、xma-build-release.ps1、package.json、Cargo.toml。
当前实现：检查/安装 Git、Node.js 22+、pnpm、Rustup/Rust/Cargo、MSVC C++ Build Tools。
职责边界：系统级安装必须经过用户 Y/N；pnpm install、cargo fetch、Electron/Tauri 项目依赖下载只允许在用户明确启动对应项目或构建发布时执行。
#>

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')

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

Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '  XMA 一键准备基础环境' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '说明：这里只准备系统工具；不会执行 pnpm install、cargo fetch，也不会下载任何项目依赖。' -ForegroundColor DarkGray
Write-Host '项目依赖只会在你明确启动 Web / Desktop / CLI 或执行构建发布时按需下载。' -ForegroundColor DarkGray
Write-Host ''

Write-Host '[1/5] Git' -ForegroundColor Cyan
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
Write-Host '[2/5] Node.js 22+' -ForegroundColor Cyan
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
Write-Host '[3/5] pnpm 11.17.0' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 pnpm 版本...' -ForegroundColor DarkCyan
$pnpmVersion = if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) { (& pnpm.cmd --version).Trim() } else { '' }
if ($pnpmVersion -ne '11.17.0') {
  if ($pnpmVersion) {
    Write-Host "[调整] 当前 pnpm $pnpmVersion，项目固定使用 11.17.0。" -ForegroundColor Yellow
  } else {
    Write-Host '[缺少] 当前没有检测到 pnpm。' -ForegroundColor Yellow
  }
  Write-Host '[安装] 正在通过 npm 安装 pnpm 11.17.0...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'npm.cmd' -ArgumentList @('install','--global','pnpm@11.17.0')
  Refresh-XmaPath
}
$pnpmVersion = (& pnpm.cmd --version).Trim()
if ($pnpmVersion -ne '11.17.0') { throw "pnpm 版本校验失败：期望 11.17.0，实际 $pnpmVersion。" }
Write-Host "[通过] pnpm $pnpmVersion" -ForegroundColor Green

Write-Host ''
Write-Host '[4/5] Rust / Cargo' -ForegroundColor Cyan
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
Write-Host '[5/5] MSVC C++ Build Tools' -ForegroundColor Cyan
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
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '[完成] XMA 基础开发环境准备完成。' -ForegroundColor Green
Write-Host '[说明] 尚未下载任何项目依赖。' -ForegroundColor Cyan
Write-Host '[说明] 选择 Web / Desktop / XiaoYu CLI 或构建发布时，XMA 才会按需安装对应依赖；Desktop 默认 Electron 41.2.0，Tauri 2 为备用。' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
