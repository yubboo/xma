<#
文件作用：XMA Windows 开发控制台，统一开发环境准备、Web/CLI/Desktop 运行、构建发布、全量检查和 Git 源码更新。
关联模块：xma-dev.bat、xma-prepare.ps1、apps/desktop、package.json、Cargo.toml、xma-build-release.ps1。
当前实现：[1] 一次准备通用开发依赖并注册开发态 xiaoyu/xma 命令；Bun/OpenTUI/Solid 统一由 pnpm Workspace node_modules 管理，[4]/[7] 只验证已安装依赖；Rust/Cargo 继续从独立 Home 恢复并做 offline 校验；Desktop 以 Electron 41.2.0 为主运行时，Tauri 2 为备用运行时；[10] 在当前正确 Git clone 上执行安全更新或显式强制恢复 GitHub main。
职责边界：GitHub push 仍只由 XMA-GitHub.bat 负责；[10] 只更新当前 clone，不提交/推送；运行/检查阶段不偷偷安装依赖；Electron Chromium Runtime 与 Tauri Rust crates 仍只在用户明确选择对应 Desktop 后准备。
#>

param(
  [ValidateSet('menu','prepare','web','desktop','cli','check','release','release-windows','js','bun','rust','update')]
  [string]$Command = 'menu',
  [string]$Workspace = ''
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
[void](Import-XmaRustEnvironment -ProjectRoot $Root)
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
  & (Join-Path $PSScriptRoot 'xma-prepare.ps1') -Component all
  if ($LASTEXITCODE -ne 0) { throw 'XMA 开发环境准备失败。' }
}

function Prepare-JavaScriptRuntime {
  & (Join-Path $PSScriptRoot 'xma-prepare.ps1') -Component bun
  if ($LASTEXITCODE -ne 0) { throw 'Workspace JavaScript Runtime 刷新失败。' }
}

function Prepare-RustRuntime {
  & (Join-Path $PSScriptRoot 'xma-prepare.ps1') -Component rust
  if ($LASTEXITCODE -ne 0) { throw 'Rust / Cargo 准备失败。' }
}



function Invoke-XmaGitCapture {
  param([Parameter(Mandatory = $true)][string[]]$ArgumentList)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & git.exe @ArgumentList 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    $message = (@($output | ForEach-Object { [string]$_ }) -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($message)) { $message = "git.exe $($ArgumentList -join ' ') failed with exit code $exitCode" }
    throw $message
  }
  return ((@($output | ForEach-Object { [string]$_ }) -join "`n").Trim())
}

function Assert-XmaGitCloneForUpdate {
  if (Test-Path -LiteralPath (Join-Path $Root '.xma-package\source-manifest.json') -PathType Leaf) {
    throw '当前目录是正式源码包，不是长期 Git clone；[10] 只允许更新真实 clone。源码包请继续使用 XMA-Sync.bat。'
  }
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw '未检测到 Git，无法更新项目。' }
  $inside = Invoke-XmaGitCapture -ArgumentList @('rev-parse','--is-inside-work-tree')
  if ($inside.Trim().ToLowerInvariant() -ne 'true') { throw '当前目录不是 Git 工作树，无法执行项目更新。' }
  $top = Invoke-XmaGitCapture -ArgumentList @('rev-parse','--show-toplevel')
  if ([IO.Path]::GetFullPath($top) -ine [IO.Path]::GetFullPath($Root)) {
    throw "当前脚本根目录不是 Git 顶层：$top"
  }
  $branch = Invoke-XmaGitCapture -ArgumentList @('rev-parse','--abbrev-ref','HEAD')
  if ($branch.Trim() -ne 'main') { throw "[10] 只更新 main 分支；当前分支是 $branch。请先切回 main 再执行。" }
  $origin = Invoke-XmaGitCapture -ArgumentList @('remote','get-url','origin')
  $normalized = $origin.Trim().ToLowerInvariant()
  $allowed = @(
    'https://github.com/yubboo/xma.git',
    'https://github.com/yubboo/xma',
    'git@github.com:yubboo/xma.git',
    'ssh://git@github.com/yubboo/xma.git'
  )
  if ($normalized -notin $allowed) {
    throw "当前 origin 不是 yubboo/xma，拒绝自动更新：$origin"
  }
  return $origin.Trim()
}

function Confirm-XmaGitReset {
  Write-Host ''
  Write-Host '[警告] 强制恢复会丢弃 Git 已跟踪文件的本地修改，并让源码与 origin/main 一致。' -ForegroundColor Yellow
  Write-Host '[保留] .git/xma-state、xma-path、node_modules、.cache、dist 等 Git 忽略的本地依赖/缓存不会被 reset --hard 删除。' -ForegroundColor DarkGray
  $answer = (Read-Host '确认强制恢复？请输入 YES 继续').Trim()
  return ($answer -ceq 'YES')
}

function Update-XmaProject {
  $origin = Assert-XmaGitCloneForUpdate
  while ($true) {
    Write-Host ''
    Write-Host '====================================================================' -ForegroundColor DarkCyan
    Write-Host '  XMA 项目更新' -ForegroundColor Cyan
    Write-Host "  Repo: $origin" -ForegroundColor DarkGray
    Write-Host "  Worktree: $Root" -ForegroundColor DarkGray
    Write-Host '====================================================================' -ForegroundColor DarkCyan
    Write-Host '  [1] 安全更新                         fetch + pull --rebase --autostash' -ForegroundColor Green
    Write-Host '      保留本地修改；如出现冲突会停止并明确提示。' -ForegroundColor DarkGray
    Write-Host '  [2] 强制恢复 GitHub main             fetch + reset --hard origin/main'
    Write-Host '      丢弃已跟踪文件本地修改；不删除 Git 忽略的依赖/缓存。' -ForegroundColor DarkGray
    Write-Host '  [0] 返回'
    Write-Host ''
    $updateChoice = (Read-Host '请选择更新方式').Trim()
    switch ($updateChoice) {
      '1' {
        Write-Host '[更新] 正在获取 origin/main...' -ForegroundColor Cyan
        Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('fetch','origin','main') | Out-Host
        Write-Host '[更新] 正在安全同步当前分支...' -ForegroundColor Cyan
        Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('pull','--rebase','--autostash','origin','main') | Out-Host
        Write-Host '[完成] XMA 源码已安全更新。请关闭本控制台并重新运行 xma-dev.bat，让新脚本完整生效。' -ForegroundColor Green
        exit 0
      }
      '2' {
        if (-not (Confirm-XmaGitReset)) { Write-Host '[取消] 未执行强制恢复。' -ForegroundColor Yellow; continue }
        Write-Host '[更新] 正在获取 origin/main...' -ForegroundColor Cyan
        Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('fetch','origin','main') | Out-Host
        Write-Host '[恢复] 正在用 origin/main 覆盖当前已跟踪源码...' -ForegroundColor Yellow
        Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('reset','--hard','origin/main') | Out-Host
        Write-Host '[完成] 当前源码已强制恢复到 GitHub main。请关闭本控制台并重新运行 xma-dev.bat。' -ForegroundColor Green
        exit 0
      }
      '0' { return }
      default { Write-Host '无效选项。' -ForegroundColor Yellow }
    }
  }
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

function Resolve-XmaCargoRuntime {
  $importedRust = Import-XmaRustEnvironment -ProjectRoot $Root -DiscoverExternal
  if ($importedRust -and $importedRust.Source -eq 'drive-scan') {
    Write-Host "[恢复] checkout 状态缺失；已从现有磁盘自动重新接管 Rust/Cargo：$($importedRust.CargoHome)" -ForegroundColor DarkCyan
  }
  $cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
  if (-not $cargoCommand) {
    throw '未检测到 Rust/Cargo。请运行主菜单 [9] 单独安装 Rust/Cargo，或重新运行 [1]。'
  }
  $cargoHome = Get-XmaEffectiveCargoHome -CargoExecutable $cargoCommand.Source
  $rustupHome = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { '' }
  return [pscustomobject]@{
    Cargo = $cargoCommand.Source
    CargoHome = $cargoHome
    RustupHome = $rustupHome
  }
}

function Assert-XmaCargoOfflineReady {
  param([Parameter(Mandatory = $true)]$CargoRuntime, [string]$Purpose = '当前操作')
  if (-not (Test-XmaCargoOfflineDependencies -ProjectRoot $Root -CargoExecutable $CargoRuntime.Cargo)) {
    $location = if ($CargoRuntime.CargoHome) { $CargoRuntime.CargoHome } else { '(未解析)' }
    throw "$Purpose 需要的 Rust crates 尚未完整准备（CARGO_HOME=$location）。请运行主菜单 [9] 补齐 Rust/Cargo crates，或重新运行 [1]；运行/检查阶段不会偷偷联网下载。"
  }
  Write-Host "[通过] Rust/Cargo 环境已恢复：CARGO_HOME=$($CargoRuntime.CargoHome)" -ForegroundColor Green
  if ($CargoRuntime.RustupHome) { Write-Host "[位置] RUSTUP_HOME=$($CargoRuntime.RustupHome)" -ForegroundColor DarkGray }
}

function Resolve-XmaBunRuntime {
  $packageJson = Join-Path $Root 'node_modules\bun\package.json'
  $bunExe = Join-Path $Root 'node_modules\bun\bin\bun.exe'
  if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf) -or -not (Test-Path -LiteralPath $bunExe -PathType Leaf)) {
    throw '未检测到 Workspace Bun Runtime。请运行主菜单 [1]，或使用 [8] 刷新 JavaScript Runtime。'
  }
  $version = [string]((Get-Content -LiteralPath $packageJson -Raw -Encoding UTF8 | ConvertFrom-Json).version)
  $probe = Invoke-XmaProbe -FilePath $bunExe -ArgumentList @('--version')
  if ($probe.ExitCode -ne 0 -or (($probe.Output -join ' ').Trim() -ne $version)) {
    throw "node_modules 中 Bun Runtime 版本探针失败：package=$version · exe=$bunExe。请运行 [1]/[8] 重新执行 pnpm 安装。"
  }
  return [pscustomobject]@{ BunExe = $bunExe; Version = $version }
}

function Assert-CliJsDependencies {
  Assert-CoreDependencies
  $bunRuntime = Resolve-XmaBunRuntime
  $runtimeRoot = Join-Path $Root 'apps\cli\opentui-runtime'
  $packages = @(
    (Join-Path $runtimeRoot 'node_modules\@opentui\core\package.json'),
    (Join-Path $runtimeRoot 'node_modules\@opentui\solid\package.json'),
    (Join-Path $runtimeRoot 'node_modules\solid-js\package.json'),
    (Join-Path $runtimeRoot 'node_modules\@types\bun\package.json')
  )
  foreach ($packageFile in $packages) {
    if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
      throw "Xiaoyu OpenTUI Workspace 依赖尚未准备：$packageFile。请运行 [1]，或主菜单 [8] 刷新 JavaScript Runtime。"
    }
  }
  $core = [string]((Get-Content -LiteralPath $packages[0] -Raw -Encoding UTF8 | ConvertFrom-Json).version)
  $solidRenderer = [string]((Get-Content -LiteralPath $packages[1] -Raw -Encoding UTF8 | ConvertFrom-Json).version)
  $solidJs = [string]((Get-Content -LiteralPath $packages[2] -Raw -Encoding UTF8 | ConvertFrom-Json).version)
  Write-Host "[通过] Xiaoyu OpenTUI Runtime 已就绪（Bun $($bunRuntime.Version) + OpenTUI core $core / solid $solidRenderer + Solid $solidJs）。" -ForegroundColor Green
  Write-Host "[Bun] $($bunRuntime.BunExe)" -ForegroundColor DarkGray
  Write-Host "[OpenTUI] $runtimeRoot\node_modules" -ForegroundColor DarkGray
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
  $cargoRuntime = Resolve-XmaCargoRuntime

  Write-Host '[Desktop] 你已明确选择 Tauri 2 备用桌面端，现在开始准备 Tauri Rust crates。' -ForegroundColor Cyan
  Write-Host "[Rust] 使用 `[1]` 确认的 Cargo Home：$($cargoRuntime.CargoHome)" -ForegroundColor DarkGray
  Write-Host '[同步] 正在按需预取 Tauri 2 Rust crates...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath $cargoRuntime.Cargo -ArgumentList @('fetch','--manifest-path','apps/desktop/src-tauri/Cargo.toml')
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
  $cargoRuntime = Resolve-XmaCargoRuntime
  Assert-XmaCargoOfflineReady -CargoRuntime $cargoRuntime -Purpose 'Xiaoyu Terminal Native Runtime'

  # 中文说明：Windows 不允许覆盖仍被旧进程占用的 exe。CLI 构建复用项目统一 .cache\cargo-target 增量缓存，运行时再复制到唯一 staging 路径，
  # 这样并行/旧版 Xiaoyu 只锁住自己的 run copy，不会阻断当前源码的离线增量构建。
  $cliTargetDir = Join-Path $Root '.cache\cargo-target'
  $previousCargoTargetDir = $env:CARGO_TARGET_DIR
  $env:CARGO_TARGET_DIR = $cliTargetDir
  try {
    Write-Host '[Native] 正在校验当前源码对应的 XMA Native Runtime（复用 Cargo 增量缓存，离线构建，不下载依赖）...' -ForegroundColor DarkCyan
    Invoke-XmaExternal -FilePath $cargoRuntime.Cargo -ArgumentList @('build','--package','xma-native-runtime','--offline') | Out-Host
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

function Start-Cli([string]$WorkspacePath = '') {
  $nativeExe = Ensure-CliNativeRuntime
  $previousNativeRuntime = $env:XIAOYU_NATIVE_RUNTIME
  $env:XIAOYU_NATIVE_RUNTIME = $nativeExe
  try {
    $cliArguments = @('run','dev:cli')
    if (-not [string]::IsNullOrWhiteSpace($WorkspacePath)) {
      $resolvedWorkspace = (Resolve-Path -LiteralPath $WorkspacePath).Path
      $cliArguments += @('--', $resolvedWorkspace)
      Write-Host "[Workspace] $resolvedWorkspace" -ForegroundColor DarkGray
    }
    Write-Host '[启动] 正在启动 Xiaoyu Terminal / TUI...' -ForegroundColor Cyan
    Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList $cliArguments
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
  $cargoRuntime = Resolve-XmaCargoRuntime
  # 中文说明：全量检查必须完全离线；先验证 `[1]` 记录的 Cargo Home 与 crate 缓存，
  # 缺失时立即返回准备入口，避免 TypeScript/CLI 都跑完以后才在最后一步暴露 serde/index 等 Cargo 底层错误。
  Assert-XmaCargoOfflineReady -CargoRuntime $cargoRuntime -Purpose 'XMA 全量检查'
  & $cargoRuntime.Cargo fmt --version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw '未检测到 rustfmt/cargo-fmt。请运行主菜单 [9] 补齐 Rust/rustfmt，或重新运行 [1]；[7] 不会联网补装 Rust 组件。'
  }
  Write-Host '[通过] Rust rustfmt 已就绪；[7] 将保持 offline。' -ForegroundColor Green
  Write-Host '[检查] 正在运行 TypeScript / Tests / Architecture Gates...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','check')
  Write-Host '[检查] 正在编译并烟测 Bun/OpenTUI Xiaoyu CLI...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','build:cli')
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('run','smoke:cli')
  Write-Host '[检查] 正在运行 Rust fmt / check / test（offline）...' -ForegroundColor Cyan
  Write-Host '[缓存] Cargo 输出位于 .cache\cargo-target\；dist\ 只保留 XMA 产品构建/发布产物。' -ForegroundColor DarkGray
  Invoke-XmaExternal -FilePath $cargoRuntime.Cargo -ArgumentList @('fmt','--all','--','--check')
  Invoke-XmaExternal -FilePath $cargoRuntime.Cargo -ArgumentList @('check','--workspace','--offline')
  Invoke-XmaExternal -FilePath $cargoRuntime.Cargo -ArgumentList @('test','--workspace','--offline')
  Write-Host '[完成] XMA 全量检查通过。' -ForegroundColor Green
}

if ($Command -ne 'menu') {
  switch ($Command) {
    'prepare' { Prepare-Environment }
    'web' { Start-Web }
    'desktop' { Start-Desktop }
    'cli' { Start-Cli -WorkspacePath $Workspace }
    'check' { Invoke-FullCheck }
    'js' { Prepare-JavaScriptRuntime }
    'bun' { Prepare-JavaScriptRuntime }
    'rust' { Prepare-RustRuntime }
    'update' { Update-XmaProject }
    'release' { & (Join-Path $PSScriptRoot 'xma-build-release.ps1'); if ($LASTEXITCODE -ne 0) { throw '构建失败' } }
    'release-windows' { & (Join-Path $PSScriptRoot 'xma-build-release.ps1') -WindowsPackages; if ($LASTEXITCODE -ne 0) { throw 'Windows 发布构建失败' } }
  }
  exit 0
}

while ($true) {
  Write-Header
  Write-Host '  [1] 一键准备开发环境                   ← 推荐首次运行' -ForegroundColor Green
  Write-Host '      系统工具 + Workspace JS 依赖；一次 pnpm install，装完即可运行' -ForegroundColor DarkGray
  Write-Host '  [2] 开发运行 · Web                    已准备后直接启动'
  Write-Host "  [3] 开发运行 · Desktop                Electron $ElectronVersion 主 / Tauri 2 副"
  Write-Host '  [4] 运行 · Xiaoyu Terminal            已准备后直接启动'
  Write-Host '  [5] 构建发布 · Desktop 当前平台        默认 Electron 主桌面端'
  Write-Host '  [6] 构建发布 · Desktop Windows         Electron Setup + Portable'
  Write-Host '  [7] 全量检查                          使用已准备依赖，不偷偷下载'
  Write-Host '  [8] 刷新 · JavaScript Runtime         pnpm latest：Bun / OpenTUI / Solid'
  Write-Host '  [9] 单独安装 · Rust / Cargo           缺失时单独补齐'
  Write-Host '  [10] 更新项目                         安全更新 / 强制恢复 GitHub main'
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
      '8' { Prepare-JavaScriptRuntime }
      '9' { Prepare-RustRuntime }
      '10' { Update-XmaProject }
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
