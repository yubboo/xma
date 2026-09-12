<#
文件作用：XMA Windows 开发控制台，统一环境准备、开发运行、构建发布和全量检查。
关联模块：XMA.bat、xma-prepare.ps1、package.json、Cargo.toml、xma-build-release.ps1。
当前实现：菜单式调用 Web/Desktop/CLI、环境准备、发布和检查。
职责边界：复杂环境安装逻辑集中在 xma-prepare.ps1；本文件只负责控制台编排。
#>

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
$Host.UI.RawUI.WindowTitle = 'XMA Development Console'
$ProjectVersion = Get-XmaProjectVersion -ProjectRoot $Root

function Write-Header {
  Clear-Host
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Write-Host "  XMA $ProjectVersion · Xiaoyu Management Agent · Development Console" -ForegroundColor Cyan
  Write-Host '  TypeScript Agent Platform + Rust Native/Security Kernel' -ForegroundColor DarkGray
  Write-Host '====================================================================' -ForegroundColor DarkCyan
}

function Prepare-Environment {
  & (Join-Path $PSScriptRoot 'xma-prepare.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'XMA 环境准备失败。' }
}

function Ensure-ProjectRuntime {
  $missing = (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) -or (-not (Test-Path 'node_modules')) -or (-not (Test-Path 'pnpm-lock.yaml'))
  if ($missing) {
    Write-Host '[准备] 当前运行所需依赖尚未准备，现在才进入一键环境准备。' -ForegroundColor Yellow
    Prepare-Environment
  }
}

function Start-Web {
  Ensure-ProjectRuntime
  Write-Host '[启动] 正在启动 XMA Web 开发环境...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:web')
}
function Start-Cli {
  Ensure-ProjectRuntime
  Write-Host '[启动] 正在启动 XiaoYu CLI / TUI...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:cli')
}
function Start-Desktop {
  Ensure-ProjectRuntime
  Write-Host '[提示] Desktop 开发模式会另开一个 Web 开发窗口。' -ForegroundColor DarkGray
  Start-Process powershell.exe -ArgumentList '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-Command',"Set-Location '$Root'; pnpm dev:web"
  Start-Sleep -Seconds 2
  $env:XMA_WEB_URL = 'http://127.0.0.1:5173'
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:desktop')
}

function Invoke-FullCheck {
  if ((-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) -or (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) -or (-not (Test-Path 'node_modules'))) { throw '本地检查环境尚未准备。请先运行 [1] 一键准备环境；全量检查不会自动下载依赖。' }
  Write-Host '[进行] TypeScript / Tests / Architecture Gates...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','check')
  Write-Host '[进行] Rust fmt/check/test...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fmt','--all','--','--check')
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('check','--workspace')
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('test','--workspace')
  Write-Host '[完成] XMA 全量检查通过。' -ForegroundColor Green
}

while ($true) {
  Write-Header
  Write-Host '  [1] 一键准备环境                       ← 推荐首次运行' -ForegroundColor Green
  Write-Host '  [2] 开发运行 · Web                    pnpm dev'
  Write-Host '  [3] 开发运行 · Desktop                Electron'
  Write-Host '  [4] 运行 · XiaoYu CLI                 美化终端 Agent'
  Write-Host '  [5] 一键构建发布 · 当前平台'
  Write-Host '  [6] 一键构建发布 · Windows Setup + Portable'
  Write-Host '  [7] 全量检查'
  Write-Host '  [0] 退出'
  Write-Host ''
  $choice = (Read-Host '请选择').Trim()
  try {
    switch ($choice) {
      '1' { Prepare-Environment }
      '2' { Start-Web }
      '3' { Start-Desktop }
      '4' { Start-Cli }
      '5' { & (Join-Path $PSScriptRoot 'xma-build-release.ps1'); if ($LASTEXITCODE -ne 0) { throw '构建失败' } }
      '6' { & (Join-Path $PSScriptRoot 'xma-build-release.ps1') -WindowsPackages; if ($LASTEXITCODE -ne 0) { throw 'Windows 发布构建失败' } }
      '7' { Invoke-FullCheck }
      '0' { exit 0 }
      default { Write-Host '无效选项。' -ForegroundColor Yellow }
    }
  } catch {
    Write-Host ''
    Write-Host "[失败] $($_.Exception.Message)" -ForegroundColor Red
  }
  Write-Host ''
  Read-Host '按 Enter 返回菜单' | Out-Null
}
