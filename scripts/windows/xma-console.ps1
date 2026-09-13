<#
文件作用：XMA Windows 开发控制台，统一开发环境准备、Web/CLI/Desktop 运行、构建发布和全量检查。
关联模块：xma-dev.bat、xma-prepare.ps1、apps/desktop、package.json、Cargo.toml、xma-build-release.ps1。
当前实现：[1] 一次准备通用开发依赖；Web 直接启动；CLI 启动前在独立 Cargo target 离线增量构建 Native，并以唯一 staging exe 启动；Desktop 以 Electron 41.2.0 为主运行时，Tauri 2 为备用运行时。
职责边界：GitHub 推送不经过本文件；Electron Chromium Runtime 与 Tauri Rust crates 仍只在用户明确选择对应 Desktop 后准备。
#>

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
$Host.UI.RawUI.WindowTitle = 'XMA Development Console'
$ProjectVersion = Get-XmaProjectVersion -ProjectRoot $Root
$ElectronVersion = '41.2.0'
$TuiVersion = '0.74.0'

function Write-Header {
  Clear-Host
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Write-Host "  XMA $ProjectVersion · Xiaoyu Management Agent · Development Console" -ForegroundColor Cyan
  Write-Host '  TypeScript Agent Platform + Rust Native/Security Kernel' -ForegroundColor DarkGray
  Write-Host '====================================================================' -ForegroundColor DarkCyan
}

function Prepare-Environment {
  & (Join-Path $PSScriptRoot 'xma-prepare.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'XMA 开发环境准备失败。' }
}

function Assert-BasicRuntime {
  foreach ($command in @('node.exe','pnpm.cmd')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw '基础运行环境尚未准备。请先运行 [1] 一键准备开发环境。'
    }
  }
}

function Assert-CoreDependencies {
  Assert-BasicRuntime
  foreach ($tool in @('tsx.cmd','vite.cmd','tsc.cmd','tsup.cmd')) {
    $toolPath = Join-Path $Root "node_modules\.bin\$tool"
    if (-not (Test-Path $toolPath)) {
      throw 'XMA 通用项目依赖尚未准备。请先运行 [1] 一键准备开发环境。'
    }
  }
}

function Assert-CliJsDependencies {
  Assert-CoreDependencies
  $tuiPackage = Join-Path $Root 'apps\cli\node_modules\@earendil-works\pi-tui\package.json'
  if (-not (Test-Path $tuiPackage)) {
    throw 'Xiaoyu TUI 依赖尚未准备。源码升级后请先运行 [1] 一键准备开发环境。'
  }
  $installedTui = (Get-Content $tuiPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($installedTui -ne $TuiVersion) { throw "Xiaoyu TUI 版本不一致：期望 $TuiVersion，实际 $installedTui。" }
  Write-Host "[通过] Xiaoyu TUI framework 已就绪（@earendil-works/pi-tui $installedTui）。" -ForegroundColor Green
}

function Assert-DesktopJsDependencies {
  Assert-CoreDependencies
  $desktopPackage = Join-Path $Root 'apps\desktop\node_modules\electron\package.json'
  $tauriCmd = Join-Path $Root 'apps\desktop\node_modules\.bin\tauri.cmd'
  if (-not (Test-Path $desktopPackage) -or -not (Test-Path $tauriCmd)) {
    throw 'Desktop JavaScript 依赖尚未准备。请先运行 [1] 一键准备开发环境。'
  }
  $installedElectron = (Get-Content $desktopPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($installedElectron -ne $ElectronVersion) { throw "Electron 版本不一致：期望 $ElectronVersion，实际 $installedElectron。" }
  Write-Host "[通过] Desktop JavaScript 依赖已就绪（Electron package $installedElectron + Tauri 2 CLI）。" -ForegroundColor Green
}

function Ensure-ElectronDesktopRuntime {
  Assert-DesktopJsDependencies
  $electronRoot = Join-Path $Root 'apps\desktop\node_modules\electron'
  if (Test-XmaElectronRuntime -ElectronPackageRoot $electronRoot -ExpectedVersion $ElectronVersion) {
    Write-Host "[通过] Electron $ElectronVersion 主桌面运行时已安装在 XMA 项目依赖目录并通过文件状态校验。" -ForegroundColor Green
    return
  }

  Write-Host ''
  Write-Host "[Desktop] 你已明确选择 Electron 主桌面端，现在才允许下载 Electron $ElectronVersion Runtime。" -ForegroundColor Cyan
  Write-Host '[下载] Electron 包含 Chromium，体积较大；首次下载时间取决于网络，之后会复用 XMA 项目内 .cache\electron 缓存。' -ForegroundColor Yellow
  Write-Host '[进度] XMA 使用 Electron 官方 @electron/get 显示实时百分比/MB；Windows 解压使用系统 PowerShell Expand-Archive。' -ForegroundColor DarkYellow
  Write-Host '[容错] 官方源 45 秒没有任何新数据会主动中止并切换备用镜像；ZIP 继续使用 Electron 官方 checksums.json 校验。' -ForegroundColor DarkYellow
  Write-Host '[代理] 如果系统设置了 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY，下载器会使用现有代理。' -ForegroundColor DarkGray
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','apps/desktop/scripts/electron/install-runtime.ts')

  if (-not (Test-XmaElectronRuntime -ElectronPackageRoot $electronRoot -ExpectedVersion $ElectronVersion)) {
    throw 'Electron Runtime 下载/安装未完成。可重试 Electron，或返回 Desktop 菜单选择 Tauri 2 备用运行时。'
  }
  Write-Host '[验证] Electron dist/version、path.txt 与 electron.exe 状态一致。' -ForegroundColor DarkCyan
  Write-Host "[通过] Electron $ElectronVersion 主桌面运行时已准备完成。" -ForegroundColor Green
}

function Ensure-TauriDesktopRuntime {
  Assert-DesktopJsDependencies
  if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
    throw 'Tauri 2 备用桌面端需要 Rust/Cargo。请先运行 [1] 一键准备开发环境。'
  }

  Write-Host '[Desktop] 你已明确选择 Tauri 2 备用桌面端，现在开始准备 Tauri Rust crates。' -ForegroundColor Cyan
  Write-Host '[同步] 正在按需预取 Tauri 2 Rust crates...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')
  Write-Host '[验证] 正在验证 Tauri 2 CLI...' -ForegroundColor DarkCyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('--dir','apps/desktop','exec','tauri','--version')
  Write-Host '[说明] Tauri 2 在 Windows 使用系统 WebView2，是 Electron 下载异常时的备用桌面运行时。' -ForegroundColor DarkGray
  Write-Host '[通过] Tauri 2 备用桌面端运行依赖已准备完成。' -ForegroundColor Green
}

function Start-Web {
  Assert-CoreDependencies
  Write-Host '[启动] 正在启动 XMA Web 开发环境...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:web')
}

function Remove-StaleCliNativeRuns {
  $runDir = Join-Path $Root '.cache\native-runtime\runs'
  if (-not (Test-Path -LiteralPath $runDir -PathType Container)) { return }
  foreach ($file in (Get-ChildItem -LiteralPath $runDir -Filter 'xma-native-runtime-*.exe' -File -ErrorAction SilentlyContinue)) {
    try {
      Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
    } catch {
      # 中文说明：仍在运行的旧 Xiaoyu 可能暂时锁住自己的 staging exe；新启动使用不同文件名，不应因此失败。
    }
  }
}

function Ensure-CliNativeRuntime {
  Assert-CliJsDependencies
  if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
    throw 'Xiaoyu Terminal 需要 XMA Native Runtime。未检测到 Cargo，请先运行 [1] 一键准备开发环境。'
  }

  # 中文说明：Windows 不允许覆盖仍被旧进程占用的 exe。CLI 构建使用独立 Cargo target，运行时再复制到唯一 staging 路径，
  # 这样并行/旧版 Xiaoyu 只锁住自己的 run copy，不会阻断当前源码的离线增量构建。
  $cliTargetDir = Join-Path $Root '.cache\cargo-target\cli'
  $previousCargoTargetDir = $env:CARGO_TARGET_DIR
  $env:CARGO_TARGET_DIR = $cliTargetDir
  try {
    Write-Host '[Native] 正在校验当前源码对应的 XMA Native Runtime（独立 Cargo target，离线增量构建，不下载依赖）...' -ForegroundColor DarkCyan
    Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('build','--package','xma-native-runtime','--offline') | Out-Host
  } finally {
    if ($null -eq $previousCargoTargetDir) { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue } else { $env:CARGO_TARGET_DIR = $previousCargoTargetDir }
  }

  $builtExe = Join-Path $cliTargetDir 'debug\xma-native-runtime.exe'
  if (-not (Test-Path -LiteralPath $builtExe -PathType Leaf)) {
    throw "XMA Native Runtime 构建结束但未找到：$builtExe"
  }

  Remove-StaleCliNativeRuns
  $runDir = Join-Path $Root '.cache\native-runtime\runs'
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $runId = "{0}-{1}" -f ([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')), $PID
  $runExe = Join-Path $runDir "xma-native-runtime-$runId.exe"
  Copy-Item -LiteralPath $builtExe -Destination $runExe -Force
  Write-Host "[通过] Xiaoyu Native Runtime 与当前源码一致：$runExe" -ForegroundColor Green
  return $runExe
}

function Start-Cli {
  $nativeExe = Ensure-CliNativeRuntime
  $previousNativeRuntime = $env:XIAOYU_NATIVE_RUNTIME
  $env:XIAOYU_NATIVE_RUNTIME = $nativeExe
  try {
    Write-Host '[启动] 正在启动 Xiaoyu Terminal / TUI...' -ForegroundColor Cyan
    Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:cli')
  } finally {
    if ($null -eq $previousNativeRuntime) { Remove-Item Env:XIAOYU_NATIVE_RUNTIME -ErrorAction SilentlyContinue } else { $env:XIAOYU_NATIVE_RUNTIME = $previousNativeRuntime }
    try { Remove-Item -LiteralPath $nativeExe -Force -ErrorAction Stop } catch {
      Write-Host "[提示] Native staging 仍被进程占用，将在下次启动时再次清理：$nativeExe" -ForegroundColor DarkGray
    }
  }
}

function Start-ElectronDesktop {
  Ensure-ElectronDesktopRuntime
  Write-Host "[启动] 正在启动 XMA Desktop / Electron $ElectronVersion（主）..." -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:desktop:electron')
}

function Start-TauriDesktop {
  Ensure-TauriDesktopRuntime
  $tauriTargetDir = Join-Path $Root '.cache\tauri-target'
  Write-Host "[启动] 正在启动 XMA Desktop / Tauri 2（备用）；Rust 缓存写入 $tauriTargetDir。" -ForegroundColor Cyan
  $previousCargoTargetDir = $env:CARGO_TARGET_DIR
  $env:CARGO_TARGET_DIR = $tauriTargetDir
  try {
    Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','dev:desktop:tauri')
  } finally {
    if ($null -eq $previousCargoTargetDir) { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue } else { $env:CARGO_TARGET_DIR = $previousCargoTargetDir }
  }
}

function Start-Desktop {
  while ($true) {
    Write-Host ''
    Write-Host '====================================================================' -ForegroundColor DarkCyan
    Write-Host '  XMA Desktop Runtime' -ForegroundColor Cyan
    Write-Host '====================================================================' -ForegroundColor DarkCyan
    Write-Host "  [1] Electron $ElectronVersion                 ← 主 / 推荐" -ForegroundColor Green
    Write-Host '      Chromium 行为一致；仅首次明确选择时下载 Runtime。' -ForegroundColor DarkGray
    Write-Host '  [2] Tauri 2                                  ← 副 / 备用'
    Write-Host '      使用系统 WebView2；仅明确选择时准备 Tauri Rust crates。' -ForegroundColor DarkGray
    Write-Host '  [0] 返回'
    Write-Host ''
    $desktopChoice = (Read-Host '请选择 Desktop Runtime（直接 Enter = Electron）').Trim()
    if ([string]::IsNullOrWhiteSpace($desktopChoice)) { $desktopChoice = '1' }
    switch ($desktopChoice) {
      '1' { Start-ElectronDesktop; return }
      '2' { Start-TauriDesktop; return }
      '0' { return }
      default { Write-Host '无效选项。' -ForegroundColor Yellow }
    }
  }
}

function Invoke-FullCheck {
  Assert-CoreDependencies
  Assert-CliJsDependencies
  Assert-DesktopJsDependencies
  if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { throw '未检测到 Cargo。请先运行 [1] 一键准备开发环境。' }
  Write-Host '[检查] 正在运行 TypeScript / Tests / Architecture Gates...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','check')
  Write-Host '[检查] 正在运行 Rust fmt / check / test（offline）...' -ForegroundColor Cyan
  Write-Host '[缓存] Cargo 输出位于 .cache\cargo-target\；dist\ 只保留 XMA 产品构建/发布产物。' -ForegroundColor DarkGray
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('fmt','--all','--','--check')
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('check','--workspace','--offline')
  Invoke-XmaExternal -FilePath 'cargo.exe' -ArgumentList @('test','--workspace','--offline')
  Write-Host '[完成] XMA 全量检查通过。' -ForegroundColor Green
}

while ($true) {
  Write-Header
  Write-Host '  [1] 一键准备开发环境                   ← 推荐首次运行' -ForegroundColor Green
  Write-Host '      系统工具 + Workspace JS 依赖 + XMA Native Rust crates' -ForegroundColor DarkGray
  Write-Host '  [2] 开发运行 · Web                    已准备后直接启动'
  Write-Host "  [3] 开发运行 · Desktop                Electron $ElectronVersion 主 / Tauri 2 副"
  Write-Host '  [4] 运行 · Xiaoyu Terminal            已准备后直接启动'
  Write-Host '  [5] 一键构建发布 · 当前平台            默认 Electron 主桌面端'
  Write-Host '  [6] 一键构建发布 · Windows             Electron Setup + Portable'
  Write-Host '  [7] 全量检查                          使用 [1] 已准备的依赖，不偷偷下载'
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
