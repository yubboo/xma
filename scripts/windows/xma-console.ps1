<#
文件作用：XMA Windows 开发控制台，统一基础环境准备、按需项目依赖、开发运行、构建发布和全量检查。
关联模块：XMA.bat、xma-prepare.ps1、apps/desktop、package.json、Cargo.toml、xma-build-release.ps1。
当前实现：菜单式启动 Web/Desktop/CLI；Desktop 以 Electron 41.2.0 为主运行时，Tauri 2 为备用运行时。
职责边界：GitHub 推送不经过本文件；[1] 只准备系统工具，不下载任何项目依赖。
#>

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
$Host.UI.RawUI.WindowTitle = 'XMA Development Console'
$ProjectVersion = Get-XmaProjectVersion -ProjectRoot $Root
$ElectronVersion = '41.2.0'

function Write-Header {
  Clear-Host
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Write-Host "  XMA $ProjectVersion · Xiaoyu Management Agent · Development Console" -ForegroundColor Cyan
  Write-Host '  TypeScript Agent Platform + Rust Native/Security Kernel' -ForegroundColor DarkGray
  Write-Host '====================================================================' -ForegroundColor DarkCyan
}

function Prepare-Environment {
  & (Join-Path $PSScriptRoot 'xma-prepare.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'XMA 基础环境准备失败。' }
}

function Assert-BasicRuntime {
  foreach ($command in @('node.exe','pnpm.cmd')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw '基础运行环境尚未准备。请先运行 [1] 一键准备基础环境。'
    }
  }
}

function Ensure-CoreDependencies {
  Assert-BasicRuntime
  $tsx = Join-Path $Root 'node_modules\.bin\tsx.cmd'
  $vite = Join-Path $Root 'node_modules\.bin\vite.cmd'
  $esbuild = Join-Path $Root 'node_modules\.bin\esbuild.cmd'
  if ((Test-Path $tsx) -and (Test-Path $vite) -and (Test-Path $esbuild)) {
    Write-Host '[通过] TypeScript / Web / CLI 基础依赖已就绪。' -ForegroundColor Green
    return
  }

  Write-Host '[依赖] 当前操作需要 TypeScript / Web / CLI 基础依赖，现在开始按需安装。' -ForegroundColor Yellow
  Write-Host '[规则] 不安装 Desktop Workspace，不下载 Electron/Tauri；Desktop 只有明确选择后才准备。' -ForegroundColor DarkYellow
  Write-Host '[安装] 正在安装 XMA Root/Core 依赖（忽略所有依赖脚本）...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--filter','xma','install','--ignore-scripts')
  Write-Host '[安装] 正在准备 esbuild 当前平台 Native Binary...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('rebuild','esbuild')
  Write-Host '[验证] 正在验证 TypeScript 工具链...' -ForegroundColor DarkCyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','esbuild','--version')
  if (-not (Test-Path $tsx) -or -not (Test-Path $vite)) { throw '基础项目依赖安装后仍不完整。' }
  Write-Host '[通过] TypeScript / Web / CLI 基础依赖安装完成。' -ForegroundColor Green
}

function Ensure-DesktopJsDependencies {
  Ensure-CoreDependencies
  $desktopPackage = Join-Path $Root 'apps\desktop\node_modules\electron\package.json'
  $tauriCmd = Join-Path $Root 'apps\desktop\node_modules\.bin\tauri.cmd'
  if ((Test-Path $desktopPackage) -and (Test-Path $tauriCmd)) {
    $installedElectron = (Get-Content $desktopPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ($installedElectron -eq $ElectronVersion) {
      Write-Host "[通过] Desktop JavaScript 依赖已就绪（Electron $installedElectron + Tauri 2 CLI）。" -ForegroundColor Green
      return
    }
  }

  Write-Host '[安装] 正在安装 Desktop JavaScript 依赖元数据；此步骤明确禁止执行 postinstall。' -ForegroundColor Yellow
  Write-Host "[说明] Electron $ElectronVersion 的 Chromium 二进制不会在这里下载。" -ForegroundColor DarkGray
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--filter','@xma/desktop','install','--ignore-scripts')

  if (-not (Test-Path $desktopPackage)) { throw 'Electron package 元数据安装失败。' }
  $installedElectron = (Get-Content $desktopPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($installedElectron -ne $ElectronVersion) { throw "Electron 版本不一致：期望 $ElectronVersion，实际 $installedElectron。" }
  Write-Host "[通过] Desktop JavaScript 依赖已安装，Electron 版本锁定为 $ElectronVersion。" -ForegroundColor Green
}

function Ensure-ElectronDesktopDependencies {
  Ensure-DesktopJsDependencies
  $electronExe = Join-Path $Root 'apps\desktop\node_modules\electron\dist\electron.exe'
  if (Test-Path $electronExe) {
    Write-Host "[通过] Electron $ElectronVersion 主桌面运行时已缓存。" -ForegroundColor Green
    Invoke-XmaExternal -FilePath $electronExe -ArgumentList @('--version') -QuietCommand
    return
  }

  Write-Host ''
  Write-Host "[Desktop] 你已明确选择 Electron 主桌面端，现在才允许下载 Electron $ElectronVersion Runtime。" -ForegroundColor Cyan
  Write-Host '[下载] Electron 包含 Chromium，体积较大；首次下载时间取决于网络，之后会使用本地缓存。' -ForegroundColor Yellow
  Write-Host '[进度] @electron/get 下载超过约 30 秒会显示进度；本流程同时开启下载诊断，避免看起来像“卡死”。' -ForegroundColor DarkYellow
  Write-Host '[代理] 如果系统设置了 HTTP_PROXY / HTTPS_PROXY，XMA 会让 Electron 官方下载器使用该代理。' -ForegroundColor DarkGray

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

  if (-not (Test-Path $electronExe)) {
    throw 'Electron Runtime 下载/安装未完成。可重试 Electron，或返回 Desktop 菜单选择 Tauri 2 备用运行时。'
  }
  Write-Host '[验证] 正在验证 Electron Runtime...' -ForegroundColor DarkCyan
  Invoke-XmaExternal -FilePath $electronExe -ArgumentList @('--version')
  Write-Host "[通过] Electron $ElectronVersion 主桌面运行时已准备完成。" -ForegroundColor Green
}

function Ensure-TauriDesktopDependencies {
  Ensure-DesktopJsDependencies
  if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
    throw 'Tauri 2 备用桌面端需要 Rust/Cargo。请先运行 [1] 一键准备基础环境。'
  }

  Write-Host '[Desktop] 你已明确选择 Tauri 2 备用桌面端，现在开始准备 Rust crates。' -ForegroundColor Cyan
  Write-Host '[同步] 正在按需预取 Tauri 2 Rust crates...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')
  Write-Host '[验证] 正在验证 Tauri 2 CLI...' -ForegroundColor DarkCyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--dir','apps/desktop','exec','tauri','--version')
  Write-Host '[说明] Tauri 2 在 Windows 使用系统 WebView2，是 Electron 下载异常时的备用桌面运行时。' -ForegroundColor DarkGray
  Write-Host '[通过] Tauri 2 备用桌面端依赖已准备完成。' -ForegroundColor Green
}

function Start-Web {
  Ensure-CoreDependencies
  Write-Host '[启动] 正在启动 XMA Web 开发环境...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:web')
}

function Start-Cli {
  Ensure-CoreDependencies
  Write-Host '[启动] 正在启动 XiaoYu CLI / TUI...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:cli')
}

function Start-ElectronDesktop {
  Ensure-ElectronDesktopDependencies
  Write-Host "[启动] 正在启动 XMA Desktop / Electron $ElectronVersion（主）..." -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:desktop:electron')
}

function Start-TauriDesktop {
  Ensure-TauriDesktopDependencies
  Write-Host '[启动] 正在启动 XMA Desktop / Tauri 2（备用）...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:desktop:tauri')
}

function Start-Desktop {
  while ($true) {
    Write-Host ''
    Write-Host '====================================================================' -ForegroundColor DarkCyan
    Write-Host '  XMA Desktop Runtime' -ForegroundColor Cyan
    Write-Host '====================================================================' -ForegroundColor DarkCyan
    Write-Host "  [1] Electron $ElectronVersion                 ← 主 / 推荐" -ForegroundColor Green
    Write-Host '      Chromium 行为一致；首次运行才下载 Runtime。' -ForegroundColor DarkGray
    Write-Host '  [2] Tauri 2                                  ← 副 / 备用'
    Write-Host '      使用系统 WebView2；Electron 网络异常时可直接切换。' -ForegroundColor DarkGray
    Write-Host '  [0] 返回'
    Write-Host ''
    $desktopChoice = (Read-Host '请选择 Desktop Runtime').Trim()
    switch ($desktopChoice) {
      '1' { Start-ElectronDesktop; return }
      '2' { Start-TauriDesktop; return }
      '0' { return }
      default { Write-Host '无效选项。' -ForegroundColor Yellow }
    }
  }
}

function Invoke-FullCheck {
  Assert-BasicRuntime
  if (-not (Test-Path (Join-Path $Root 'node_modules\.bin\tsx.cmd'))) {
    throw 'Root/Core 依赖尚未安装。请先启动 Web/CLI/Desktop 或执行构建，让 XMA 按需准备依赖。'
  }
  if (-not (Test-Path (Join-Path $Root 'apps\desktop\node_modules\electron\package.json'))) {
    throw 'Desktop TypeScript 类型依赖尚未安装。请先进入 [3] Desktop 选择任一运行时，或执行构建。'
  }
  if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { throw '未检测到 Cargo。请先运行 [1] 一键准备基础环境。' }
  Write-Host '[检查] 正在运行 TypeScript / Tests / Architecture Gates...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','check')
  Write-Host '[检查] 正在运行 Rust fmt / check / test（offline）...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fmt','--all','--','--check')
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('check','--workspace','--offline')
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('test','--workspace','--offline')
  Write-Host '[完成] XMA 全量检查通过。' -ForegroundColor Green
}

while ($true) {
  Write-Header
  Write-Host '  [1] 一键准备基础环境                   ← 推荐首次运行' -ForegroundColor Green
  Write-Host '  [2] 开发运行 · Web                    按需安装 Web/Core 依赖'
  Write-Host "  [3] 开发运行 · Desktop                Electron $ElectronVersion 主 / Tauri 2 副"
  Write-Host '  [4] 运行 · XiaoYu CLI                 按需安装 CLI/Core 依赖'
  Write-Host '  [5] 一键构建发布 · 当前平台            默认 Electron 主桌面端'
  Write-Host '  [6] 一键构建发布 · Windows             Electron Setup + Portable'
  Write-Host '  [7] 全量检查                          不自动下载依赖'
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
