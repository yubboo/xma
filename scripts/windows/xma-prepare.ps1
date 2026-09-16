<#
文件作用：XMA Windows 一键开发环境准备器，一次完成系统工具与通用项目依赖准备。
关联模块：xma-console.ps1、package.json、pnpm-workspace.yaml、Cargo.toml、apps/desktop。
当前实现：[1] 自动确保 Git、Node.js、兼容 pnpm、Workspace JavaScript 依赖、项目本地 rustup/Rust/Cargo、MSVC 与 Native crates 全部就绪；JavaScript 每次运行 [1] 都在项目根无条件执行一次原生 pnpm install；Rust/Cargo 固定安装到当前 checkout 的 `runtime/rust/{cargo,rustup}`，与 node_modules 同属项目本地依赖，不再写入 `%USERPROFILE%\.cargo/.rustup`，也不再维护旧 `xma-path/rust`；已满足项目要求的工具直接复用，不为追新强制升级。
职责边界：Electron Chromium Runtime 只在用户明确选择 Electron Desktop/构建时下载；Tauri 2 Rust crates 只在用户明确选择 Tauri/构建时下载；Bootstrap 的 pnpm/rustup/cargo/winget/npm 等 native 动作必须直接继承当前终端 stdout/stderr，禁止 Out-Host/ForEach-Object 管道转码；开发命令只写 User PATH，不修改 Machine PATH，也不冒充正式 Release 安装。
#>

param(
  [ValidateSet('all','js','bun','rust')]
  [string]$Component = 'all'
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
$ElectronVersion = '41.2.0'
$PrepareStateRoot = Join-Path (Get-XmaStateRoot -ProjectRoot $Root) 'prepare'

function Get-XmaFingerprint([string[]]$Paths, [string]$Salt = '') {
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add("salt=$Salt")
  foreach ($file in @($Paths | Sort-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      [void]$lines.Add("missing=$file")
      continue
    }
    $relative = [IO.Path]::GetFullPath($file).Substring($Root.Length).TrimStart([char[]]@('\','/'))
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$lines.Add("$relative=$hash")
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Get-XmaCargoDependencyFingerprint {
  $files = @((Join-Path $Root 'Cargo.toml'), (Join-Path $Root 'Cargo.lock'))
  $nativeRoot = Join-Path $Root 'native'
  if (Test-Path -LiteralPath $nativeRoot -PathType Container) {
    $files += @(Get-ChildItem -LiteralPath $nativeRoot -Filter 'Cargo.toml' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  }
  $runtime = Resolve-XmaRustRuntime -ProjectRoot $Root
  if (-not $runtime) { return Get-XmaFingerprint -Paths $files -Salt 'cargo=missing' }
  $cargoHome = Get-XmaEffectiveCargoHome -ProjectRoot $Root
  return Get-XmaFingerprint -Paths $files -Salt "cargo=$(& $runtime.CargoExe --version);cargoHome=$cargoHome;rustupHome=$($runtime.RustupHome)"
}

function Test-XmaPrepareStamp([string]$Name, [string]$Fingerprint) {
  $file = Join-Path $PrepareStateRoot "$Name.sha256"
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
  return ((Get-Content -LiteralPath $file -Raw -Encoding UTF8).Trim() -eq $Fingerprint)
}

function Set-XmaPrepareStamp([string]$Name, [string]$Fingerprint) {
  New-Item -ItemType Directory -Force -Path $PrepareStateRoot | Out-Null
  [IO.File]::WriteAllText((Join-Path $PrepareStateRoot "$Name.sha256"), "$Fingerprint`r`n", ([Text.UTF8Encoding]::new($false)))
}

function Set-XmaTextFileIfChanged([string]$Path, [string]$Content) {
  $normalized = ($Content -replace "`r?`n", "`r`n")
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    $current = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($current -eq $normalized) { return $false }
  }
  [IO.File]::WriteAllText($Path, $normalized, ([Text.UTF8Encoding]::new($false)))
  return $true
}

function Refresh-XmaPath {
  # 新安装 Git/Node/MSVC 后，当前 PowerShell 可能仍持有旧 PATH；这里只刷新系统/用户 PATH。
  # 项目本地 Rust 由 Use-XmaProjectRustEnvironment 单独注入当前进程，不写 User/Machine PATH。
  $sources = @(
    [Environment]::GetEnvironmentVariable('Path','Machine'),
    [Environment]::GetEnvironmentVariable('Path','User'),
    $env:Path
  )
  $entries = New-Object System.Collections.Generic.List[string]
  $seen = @{}
  foreach ($source in $sources) {
    if ($null -eq $source) { continue }
    foreach ($entry in ([string]$source -split ';')) {
      $candidate = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"'))
      if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
      $normalized = $candidate.TrimEnd([char[]]@('\','/'))
      $seenKey = $normalized.ToLowerInvariant()
      if (-not $seen.ContainsKey($seenKey)) {
        $seen[$seenKey] = $true
        [void]$entries.Add($candidate)
      }
    }
  }
  $env:Path = ($entries -join ';')
}

function Ensure-XmaWinget {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw '未检测到 winget。请先安装或更新 Microsoft App Installer，再重新运行 XMA。'
  }
}

function Get-XmaRustupInitTarget {
  $arch = [string]$env:PROCESSOR_ARCHITECTURE
  if ($arch -ieq 'AMD64' -or $arch -ieq 'x86_64') { return 'x86_64-pc-windows-msvc' }
  if ($arch -ieq 'ARM64' -or $arch -ieq 'AARCH64') { return 'aarch64-pc-windows-msvc' }
  throw "当前 Windows CPU 架构暂不支持自动安装 Rust：$arch"
}

function Install-XmaProjectRustup {
  $layout = Use-XmaProjectRustEnvironment -ProjectRoot $Root
  if (-not (Test-XmaWritableDirectory -Path $layout.RustRoot)) {
    throw "项目本地 Rust 目录不可写：$($layout.RustRoot)"
  }

  New-Item -ItemType Directory -Force -Path $layout.CargoHome,$layout.RustupHome | Out-Null
  $bootstrapDir = Join-Path $layout.RustRoot '.bootstrap'
  New-Item -ItemType Directory -Force -Path $bootstrapDir | Out-Null
  $rustupInit = Join-Path $bootstrapDir 'rustup-init.exe'
  $rustupSha = Join-Path $bootstrapDir 'rustup-init.exe.sha256'
  $target = Get-XmaRustupInitTarget
  $url = "https://static.rust-lang.org/rustup/dist/$target/rustup-init.exe"

  Write-Host "[下载] 正在下载 Rustup 官方引导程序：$target" -ForegroundColor Cyan
  Write-Host "[位置] $($layout.RustRoot)" -ForegroundColor DarkGray
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $rustupInit
    Invoke-WebRequest -UseBasicParsing -Uri "$url.sha256" -OutFile $rustupSha
  } catch {
    throw "Rustup 官方引导程序下载失败：$($_.Exception.Message)"
  }
  if (-not (Test-Path -LiteralPath $rustupInit -PathType Leaf)) {
    throw "Rustup 引导程序下载后不存在：$rustupInit"
  }
  if (-not (Test-Path -LiteralPath $rustupSha -PathType Leaf)) {
    throw "Rustup SHA-256 文件下载后不存在：$rustupSha"
  }
  $expectedSha = ((Get-Content -LiteralPath $rustupSha -Raw -Encoding ASCII).Trim() -split '\s+')[0].ToLowerInvariant()
  $actualSha = (Get-FileHash -LiteralPath $rustupInit -Algorithm SHA256).Hash.ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($expectedSha) -or $actualSha -ne $expectedSha) {
    throw "Rustup 引导程序 SHA-256 校验失败：expected=$expectedSha actual=$actualSha"
  }
  Write-Host '[校验] Rustup 官方 SHA-256 校验通过。' -ForegroundColor Green

  Write-Host '[安装] 正在把 Rust stable 安装到当前 XMA 项目 runtime\rust...' -ForegroundColor Cyan
  try {
    Invoke-XmaExternal -FilePath $rustupInit -ArgumentList @(
      '-y','--no-modify-path','--profile','minimal','--default-toolchain','stable'
    )
  } finally {
    Remove-Item -LiteralPath $bootstrapDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  Use-XmaProjectRustEnvironment -ProjectRoot $Root | Out-Null
}

function Remove-XmaObsoleteRustLayout {
  # 旧 0.1.0 私有 Rust 曾位于项目根 xma-path\rust；新结构只认 runtime\rust。
  # 这里只清理当前 checkout 内明确属于 XMA 的旧 Rust 目录/状态，不扫描外部盘符。
  $legacyRust = Join-Path $Root 'xma-path\rust'
  if (Test-Path -LiteralPath $legacyRust) {
    Remove-XmaDirectoryEntry -Path $legacyRust
    Write-Host '[清理] 已移除旧 xma-path\rust；项目 Rust 现统一位于 runtime\rust。' -ForegroundColor DarkYellow
  }

  foreach ($stateFile in @(
    (Join-Path (Get-XmaStateRoot -ProjectRoot $Root) 'rust-environment.json'),
    (Join-Path $Root '.xma\state\rust-environment.json'),
    (Join-Path $Root 'xma-path\state\rust-environment.json')
  )) {
    if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
      Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    }
  }

  $legacyRoot = Join-Path $Root 'xma-path'
  if (Test-Path -LiteralPath $legacyRoot -PathType Container) {
    $children = @(Get-ChildItem -LiteralPath $legacyRoot -Force -ErrorAction SilentlyContinue)
    if ($children.Count -eq 0) { Remove-Item -LiteralPath $legacyRoot -Force -ErrorAction SilentlyContinue }
  }
}

function Ensure-XmaRustToolchain {
  Remove-XmaObsoleteRustLayout
  Use-XmaProjectRustEnvironment -ProjectRoot $Root | Out-Null
  $runtime = Resolve-XmaRustRuntime -ProjectRoot $Root

  if (-not $runtime) {
    Write-Host '[缺少] 当前项目 runtime\rust 中没有可运行的 Rust/Cargo；正在自动安装 stable。' -ForegroundColor Yellow
    Install-XmaProjectRustup
    $runtime = Resolve-XmaRustRuntime -ProjectRoot $Root
  }

  if (-not $runtime) {
    throw '项目本地 Rustup 安装完成后仍未检测到可运行的 rustc/cargo。'
  }

  $rustProbe = Invoke-XmaProbe -FilePath $runtime.RustcExe -ArgumentList @('--version')
  $cargoProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('--version')
  if ($rustProbe.ExitCode -ne 0) { throw "rustc 不可用：$($rustProbe.Output -join ' ')" }
  if ($cargoProbe.ExitCode -ne 0) { throw "cargo 不可用：$($cargoProbe.Output -join ' ')" }

  $rustfmtProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('fmt','--version')
  if ($rustfmtProbe.ExitCode -ne 0) {
    if ([string]::IsNullOrWhiteSpace([string]$runtime.RustupExe)) {
      throw "项目本地 Rust/Cargo 已可用，但缺少 rustfmt 且 rustup.exe 不存在：$($runtime.CargoHome)"
    }
    Write-Host '[缺少] rustfmt 未就绪；正在通过项目本地 rustup 自动补齐...' -ForegroundColor Yellow
    Invoke-XmaExternal -FilePath $runtime.RustupExe -ArgumentList @('component','add','rustfmt')
    $rustfmtProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('fmt','--version')
    if ($rustfmtProbe.ExitCode -ne 0) { throw "rustfmt 安装后仍不可用：$($rustfmtProbe.Output -join ' ')" }
  }

  Write-Host "[通过] $((($rustProbe.Output -join ' ').Trim()))" -ForegroundColor Green
  Write-Host "[通过] $((($cargoProbe.Output -join ' ').Trim()))" -ForegroundColor Green
  Write-Host "[通过] $((($rustfmtProbe.Output -join ' ').Trim()))" -ForegroundColor Green
  Write-Host '[版本策略] 项目本地 stable 可用即复用；只有缺失/损坏时才自动修复，不为了追新强制升级。' -ForegroundColor DarkGray
  Write-Host "[位置] runtime\rust · CARGO_HOME=$($runtime.CargoHome) · RUSTUP_HOME=$($runtime.RustupHome)" -ForegroundColor DarkGray
  # 动作函数不返回 Runtime 对象；调用方在动作完成后单独 Resolve，避免 native stdout 被变量捕获。
}

function Ensure-XmaMsvc {
  Write-Host '[检查] 正在检查 Windows C++ 编译与链接工具...' -ForegroundColor DarkCyan
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  $msvcReady = $false
  if (Test-Path $vswhere) {
    $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    $msvcReady = [bool]$install
  }
  if ($msvcReady) { Write-Host '[通过] Visual Studio C++ Build Tools 已安装。' -ForegroundColor Green; return }

  Write-Host '[缺少] 未检测到 Visual Studio C++ Build Tools；这是 XMA Windows Native 构建必需工具，正在自动安装。' -ForegroundColor Yellow
  Ensure-XmaWinget
  Write-Host '[安装] 正在安装 Visual Studio 2022 Build Tools + C++ Toolchain，这一步可能需要几分钟...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @(
    'install','--id','Microsoft.VisualStudio.2022.BuildTools','--exact',
    '--accept-source-agreements','--accept-package-agreements',
    '--override','--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  )
  Write-Host '[完成] Visual Studio C++ Build Tools 安装命令已完成。' -ForegroundColor Green
}

function Ensure-XmaCargoCrates($RustRuntime) {
  Write-Host '[缓存] Rust 编译/测试产物统一写入 XMA 项目 .cache\cargo-target\；仓库根不再生成 target\。' -ForegroundColor DarkGray
  $cargoFingerprint = Get-XmaCargoDependencyFingerprint
  $cargoHome = $RustRuntime.CargoHome
  $cargoStampReady = Test-XmaPrepareStamp -Name 'cargo-fetch' -Fingerprint $cargoFingerprint
  if ($cargoStampReady) {
    Write-Host '[校验] Cargo 指纹未变化；仍验证实际 crate 缓存，防止 Cargo Home 被清理后产生假命中。' -ForegroundColor DarkCyan
  } else {
    Write-Host '[校验] Cargo 配置或依赖指纹发生变化，正在离线验证当前 crate 缓存...' -ForegroundColor DarkCyan
  }
  if (Test-XmaCargoOfflineDependencies -ProjectRoot $Root -CargoExecutable $RustRuntime.CargoExe) {
    Set-XmaPrepareStamp -Name 'cargo-fetch' -Fingerprint $cargoFingerprint
    Write-Host "[缓存] 当前 Rust crates 已完整并通过 offline 验证：CARGO_HOME=$cargoHome" -ForegroundColor DarkCyan
    return
  }
  Write-Host "[同步] 当前 CARGO_HOME 缺少 Cargo.lock 所需 crates：$cargoHome" -ForegroundColor Yellow
  Write-Host '[同步] 准备入口允许联网，现在开始 cargo fetch --locked...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath $RustRuntime.CargoExe -ArgumentList @('fetch','--locked')
  if (-not (Test-XmaCargoOfflineDependencies -ProjectRoot $Root -CargoExecutable $RustRuntime.CargoExe)) {
    throw "Rust crates 下载后仍无法离线解析。请检查 CARGO_HOME/网络/代理：$cargoHome"
  }
  Set-XmaPrepareStamp -Name 'cargo-fetch' -Fingerprint $cargoFingerprint
  Write-Host '[验证] cargo fetch 完成后 offline 复检通过。' -ForegroundColor DarkCyan
}

function Install-XmaDevelopmentCommands {
  # 开发 shim 属于 checkout 控制状态，不属于 JavaScript/Rust 依赖实体。放到 `.git/xma-state/dev-bin`（非 Git 树回退 `.cache/xma-state/dev-bin`）。
  $devBin = Join-Path (Get-XmaStateRoot -ProjectRoot $Root) 'dev-bin'
  New-Item -ItemType Directory -Force -Path $devBin | Out-Null
  # `.cmd` 只做纯 ASCII 跳板；中文 checkout 路径始终由 PowerShell/.NET UTF-8 读取并直接进入 PowerShell 控制台。
  # 禁止再从 shim 回跳 xma-dev.bat/cmd.exe：Windows cmd 对中文 checkout 路径/代码页的二次解析会导致“系统找不到指定的路径”。
  $launcher = @'
@echo off
setlocal EnableExtensions DisableDelayedExpansion
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0xiaoyu-dev.ps1"
exit /b %ERRORLEVEL%
'@
  $powershellLauncher = @'
$ErrorActionPreference = 'Stop'
$rootFile = Join-Path $PSScriptRoot 'source-root.txt'
if (-not (Test-Path -LiteralPath $rootFile -PathType Leaf)) { Write-Error 'XMA development shim lost source-root.txt. Run xma-dev.bat -> [1] again.'; exit 1 }
$root = [IO.File]::ReadAllText($rootFile, [Text.Encoding]::UTF8).Trim()
$console = Join-Path $root 'scripts\windows\xma-console.ps1'
if (-not (Test-Path -LiteralPath $console -PathType Leaf)) { Write-Error "XMA source checkout no longer exists or is incomplete: $root. Run [1] in the active checkout to refresh the shim."; exit 1 }
if ($env:XMA_DEV_SHIM_VERIFY -eq '1') { Write-Output $root; exit 0 }
& $console -Command cli -Workspace (Get-Location).Path
exit $LASTEXITCODE
'@
  $shimChanged = $false
  foreach ($name in @('xiaoyu.cmd','xma.cmd')) {
    if (Set-XmaTextFileIfChanged -Path (Join-Path $devBin $name) -Content $launcher) { $shimChanged = $true }
  }
  if (Set-XmaTextFileIfChanged -Path (Join-Path $devBin 'xiaoyu-dev.ps1') -Content $powershellLauncher) { $shimChanged = $true }
  if (Set-XmaTextFileIfChanged -Path (Join-Path $devBin 'source-root.txt') -Content "$Root`r`n") { $shimChanged = $true }

  $normalizedDevBin = Get-XmaNormalizedPath $devBin
  $currentUserPath = [Environment]::GetEnvironmentVariable('Path','User')
  $userEntries = @(Get-XmaPathEntries $currentUserPath)
  $nextUserEntries = @($devBin)
  foreach ($entry in $userEntries) {
    $normalized = Get-XmaNormalizedPath $entry
    if ($normalized -ieq $normalizedDevBin) { continue }
    # 同一用户只激活一个 XMA checkout；清掉旧 `.xma/dev-bin` 以及其他 checkout 的 `.git/.cache/xma-state/dev-bin`。
    if ($normalized -match '(?i)[\\/]\.xma[\\/]dev-bin$') { continue }
    if ($normalized -match '(?i)[\\/](?:\.git|\.cache)[\\/]xma-state[\\/]dev-bin$') { continue }
    $nextUserEntries += $entry
  }
  $nextUserPath = ($nextUserEntries -join ';')
  $pathChanged = $currentUserPath -ne $nextUserPath
  if ($pathChanged) { [Environment]::SetEnvironmentVariable('Path', $nextUserPath, 'User') }

  $processEntries = @(Get-XmaPathEntries $env:Path)
  $nextProcessEntries = @($devBin)
  foreach ($entry in $processEntries) {
    $normalized = Get-XmaNormalizedPath $entry
    if ($normalized -ieq $normalizedDevBin) { continue }
    if ($normalized -match '(?i)[\\/]\.xma[\\/]dev-bin$') { continue }
    if ($normalized -match '(?i)[\\/](?:\.git|\.cache)[\\/]xma-state[\\/]dev-bin$') { continue }
    $nextProcessEntries += $entry
  }
  $env:Path = ($nextProcessEntries -join ';')

  # 用刚生成的真实 `.cmd -> PowerShell UTF-8 shim` 链路做一次自检，但不启动 TUI。
  # 这能在 [1] 内直接抓住中文 checkout 路径、source-root.txt 或 shim 转发错误，而不是等用户去任意目录才发现。
  $previousShimVerify = $env:XMA_DEV_SHIM_VERIFY
  try {
    $env:XMA_DEV_SHIM_VERIFY = '1'
    Invoke-XmaExternal -FilePath (Join-Path $devBin 'xiaoyu.cmd') -ArgumentList @() -QuietCommand
  } finally {
    if ($null -eq $previousShimVerify) { Remove-Item Env:XMA_DEV_SHIM_VERIFY -ErrorAction SilentlyContinue }
    else { $env:XMA_DEV_SHIM_VERIFY = $previousShimVerify }
  }
  Write-Host '[验证] 开发态 xiaoyu / xma shim 已通过当前 checkout UTF-8 路径自检。' -ForegroundColor Green

  if ($pathChanged -or $shimChanged) { Write-Host '[更新] 开发态 xiaoyu / xma shim 或 User PATH 已同步。' -ForegroundColor Green }
  else { Write-Host '[缓存] 开发态 xiaoyu / xma shim 与 User PATH 已匹配，跳过重复写入。' -ForegroundColor DarkCyan }
  Write-Host "[位置] $devBin" -ForegroundColor DarkGray
  Write-Host '[说明] 移动/重命名仓库后重新运行 xma-dev.bat → [1] 即可刷新。' -ForegroundColor DarkGray
}

function Remove-XmaLegacyLocalDirectory {
  $legacyRoot = Join-Path $Root '.xma'
  if (-not (Test-Path -LiteralPath $legacyRoot -PathType Container)) { return }
  # Source Sync 旧状态由 XMA-Sync.bat 自己迁移，准备器只清理开发环境旧目录，避免误删维护者同步记录。
  foreach ($legacy in @(
    (Join-Path $legacyRoot 'tools'),
    (Join-Path $legacyRoot 'dev-bin'),
    (Join-Path $legacyRoot 'state\prepare'),
    (Join-Path $legacyRoot 'state\bun-environment.json')
  )) { Remove-Item -LiteralPath $legacy -Recurse -Force -ErrorAction SilentlyContinue }
  try {
    $children = @(Get-ChildItem -LiteralPath $legacyRoot -Force -ErrorAction SilentlyContinue)
    if ($children.Count -eq 0) { Remove-Item -LiteralPath $legacyRoot -Force -ErrorAction SilentlyContinue }
  } catch {}
}

function Remove-XmaPackageMetadataFromGitWorktree {
  # `.xma-package` 只属于正式源码包。只要当前目录已经是 Git checkout，它就不再是长期工作目录的一部分。
  $gitDir = Join-Path $Root '.git'
  $packageMetadata = Join-Path $Root '.xma-package'
  if ((Test-Path -LiteralPath $gitDir) -and (Test-Path -LiteralPath $packageMetadata -PathType Container)) {
    Remove-Item -LiteralPath $packageMetadata -Recurse -Force -ErrorAction Stop
    Write-Host "[清理] 已移除 Git 工作目录中的源码包元数据：$packageMetadata" -ForegroundColor DarkYellow
  }
}

function Get-XmaInstalledPackageVersion([string]$PackageJson) {
  if (-not (Test-Path -LiteralPath $PackageJson -PathType Leaf)) { return '' }
  try { return [string]((Get-Content -LiteralPath $PackageJson -Raw -Encoding UTF8 | ConvertFrom-Json).version) } catch { return '' }
}

function Get-XmaWorkspaceJavaScriptRuntimeInfo {
  $bunPackage = Join-Path $Root 'node_modules\bun\package.json'
  $bunExe = if ($IsWindows -or $env:OS -eq 'Windows_NT') { Join-Path $Root 'node_modules\bun\bin\bun.exe' } else { Join-Path $Root 'node_modules\.bin\bun' }
  $corePackage = Join-Path $Root 'node_modules\@opentui\core\package.json'
  $solidPackage = Join-Path $Root 'node_modules\@opentui\solid\package.json'
  $solidJsPackage = Join-Path $Root 'node_modules\solid-js\package.json'
  $bunTypesPackage = Join-Path $Root 'node_modules\@types\bun\package.json'

  foreach ($file in @($bunPackage,$corePackage,$solidPackage,$solidJsPackage,$bunTypesPackage)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
  }
  if (-not (Test-Path -LiteralPath $bunExe -PathType Leaf)) { return $null }

  $bunVersion = Get-XmaInstalledPackageVersion $bunPackage
  $bunProbe = Invoke-XmaProbe -FilePath $bunExe -ArgumentList @('--version')
  if ($bunProbe.ExitCode -ne 0 -or (($bunProbe.Output -join ' ').Trim() -ne $bunVersion)) { return $null }

  return [pscustomobject]@{
    BunExe = $bunExe
    BunVersion = $bunVersion
    OpenTuiCoreVersion = (Get-XmaInstalledPackageVersion $corePackage)
    OpenTuiSolidVersion = (Get-XmaInstalledPackageVersion $solidPackage)
    SolidJsVersion = (Get-XmaInstalledPackageVersion $solidJsPackage)
    BunTypesVersion = (Get-XmaInstalledPackageVersion $bunTypesPackage)
  }
}

function Install-XmaWorkspaceJavaScriptDependencies {
  Write-Host '[安装] 正在项目根执行原生 pnpm install...' -ForegroundColor Cyan
  if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules') -PathType Container)) {
    Write-Host '[状态] node_modules 不存在；pnpm 将重新创建并恢复当前 Workspace 全部依赖。' -ForegroundColor Yellow
  } else {
    Write-Host '[状态] node_modules 已存在；仍执行 pnpm install，由 pnpm 自己复用 store、补齐新增/变更依赖。' -ForegroundColor DarkCyan
  }
  Write-Host '[pnpm] 以下直接交给 pnpm/Windows Terminal 原生渲染；不经过 PowerShell pipeline，保持同一行进度刷新与原始字符编码。' -ForegroundColor DarkGray
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install')
  Write-Host '[完成] pnpm install 已完成。' -ForegroundColor Green
}

function Invoke-XmaManagedJavaScriptLatestUpdate {
  Write-Host '[更新] 正在刷新 XMA JS Runtime：Bun / OpenTUI / Solid / @types/bun...' -ForegroundColor Cyan
  Write-Host '[策略] [8] 是显式升级入口；使用 pnpm 当前配置，不改变 [1] 的普通安装语义。' -ForegroundColor DarkGray
  Invoke-XmaExternal -FilePath 'node.exe' -ArgumentList @('scripts/runtime/update.mjs')
  Write-Host '[完成] Workspace JavaScript Runtime latest 刷新完成。' -ForegroundColor Green
}

function Assert-XmaWorkspaceJavaScriptDependencies {
  $tsx = Join-Path $Root 'node_modules\.bin\tsx.cmd'
  $vite = Join-Path $Root 'node_modules\.bin\vite.cmd'
  $tsc = Join-Path $Root 'node_modules\.bin\tsc.cmd'
  $tsup = Join-Path $Root 'node_modules\.bin\tsup.cmd'
  foreach ($tool in @($tsx,$vite,$tsc,$tsup)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Workspace JavaScript 工具缺失：$tool" }
  }

  $runtime = Get-XmaWorkspaceJavaScriptRuntimeInfo
  if (-not $runtime) { throw 'Bun/OpenTUI Workspace Runtime 未完整进入 node_modules。请检查上方 pnpm install 原生输出。' }

  Write-Host '[验证] 正在验证 TypeScript / Vite / tsx / tsup 工具链...' -ForegroundColor DarkCyan
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsc','--version')
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','vite','--version')
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','--version')
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsup','--version')
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','-e','const value: number = 1; if (value !== 1) process.exit(1)') -QuietCommand

  $desktopElectronPackage = Join-Path $Root 'apps\desktop\node_modules\electron\package.json'
  $desktopTauriCmd = Join-Path $Root 'apps\desktop\node_modules\.bin\tauri.cmd'
  if (-not (Test-Path -LiteralPath $desktopElectronPackage -PathType Leaf)) { throw 'Desktop Electron package 元数据缺失。' }
  $installedElectron = (Get-Content $desktopElectronPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($installedElectron -ne $ElectronVersion) { throw "Electron package 版本不一致：期望 $ElectronVersion，实际 $installedElectron。" }
  if (-not (Test-Path -LiteralPath $desktopTauriCmd -PathType Leaf)) { throw 'Tauri 2 CLI package 未安装完整。' }

  Write-Host "[通过] Workspace JS Runtime：Bun $($runtime.BunVersion) · OpenTUI core $($runtime.OpenTuiCoreVersion) / solid $($runtime.OpenTuiSolidVersion) · Solid $($runtime.SolidJsVersion)" -ForegroundColor Green
  Write-Host "[Bun] $($runtime.BunExe)" -ForegroundColor DarkGray
  Write-Host '[位置] Bun/OpenTUI/Solid 全部由 pnpm 管理并存放在根 node_modules；不再创建 OpenTUI 嵌套 node_modules。' -ForegroundColor DarkGray
}

function Prepare-XmaCurrentJavaScriptDependencies {
  # 动作与读取严格分离：pnpm install 直接继承当前控制台 stdout/stderr，不经过 Out-Host 或其他 PowerShell pipeline。
  # 这样 pnpm 的 carriage-return 进度条与 Unicode/ANSI 输出和开发者手工执行 pnpm install 保持一致。
  # 禁止把本动作函数赋值给变量；Runtime 对象必须在安装完成后由 Get-* 单独读取。
  Install-XmaWorkspaceJavaScriptDependencies
  Assert-XmaWorkspaceJavaScriptDependencies
}

function Prepare-XmaJavaScriptOnly {
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Write-Host '  XMA · 刷新 JavaScript Runtime' -ForegroundColor Cyan
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Invoke-XmaManagedJavaScriptLatestUpdate
  Assert-XmaWorkspaceJavaScriptDependencies
  Remove-XmaLegacyLocalDirectory
  Remove-XmaPackageMetadataFromGitWorktree
  Write-Host '[完成] Workspace JS / Bun / OpenTUI 已刷新到 registry latest；可返回菜单运行 [4] 或 [7]。' -ForegroundColor Green
}

function Prepare-XmaRustOnly {
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Write-Host '  XMA · 单独准备 Rust / Cargo' -ForegroundColor Cyan
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Ensure-XmaRustToolchain
  $rustRuntime = Resolve-XmaRustRuntime -ProjectRoot $Root
  if (-not $rustRuntime) { throw 'Rust 准备动作结束后未能解析项目本地 runtime\rust。' }
  Write-Host '[MSVC] 正在准备 Rust Native 构建所需 Windows C++ Toolchain...' -ForegroundColor Cyan
  Ensure-XmaMsvc
  Write-Host '[Crates] 正在准备 XMA Native Rust crates...' -ForegroundColor Cyan
  Ensure-XmaCargoCrates -RustRuntime $rustRuntime
  Ensure-XmaNativeRuntimeBuildCache -ProjectRoot $Root -RustRuntime $rustRuntime
  Remove-XmaLegacyLocalDirectory
  Remove-XmaPackageMetadataFromGitWorktree
  Write-Host '[完成] Rust / Cargo / rustfmt / Native crates 已准备，可返回菜单运行 [4] 或 [7]。' -ForegroundColor Green
}

if ($Component -eq 'js') { Prepare-XmaCurrentJavaScriptDependencies; exit 0 }
if ($Component -eq 'bun') { Prepare-XmaJavaScriptOnly; exit 0 }
if ($Component -eq 'rust') { Prepare-XmaRustOnly; exit 0 }

Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '  XMA 一键准备开发环境' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '说明：[1] 会自动确保当前 XMA 源码开发/运行所需工具与依赖全部就绪。' -ForegroundColor DarkGray
Write-Host '说明：Git / Node.js / pnpm / Rust / MSVC 缺失或不满足项目硬要求时自动修正；已满足要求就直接复用，不为追新强制升级。' -ForegroundColor DarkGray
Write-Host '说明：Workspace JavaScript 依赖直接执行原生 pnpm install；以后项目新增/调整依赖，重新运行 [1] 即会自动同步。' -ForegroundColor DarkGray
Write-Host '说明：Electron Chromium Runtime 与 Tauri Rust crates 属于明确 Desktop 选择后的按需依赖，不在通用 [1] 中预下载。' -ForegroundColor DarkGray
Write-Host ''
Refresh-XmaPath

Write-Host '[1/8] Git' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Git 是否可用...' -ForegroundColor DarkCyan
if (Get-Command git.exe -ErrorAction SilentlyContinue) { Write-Host "[通过] 已检测到 $(& git.exe --version)" -ForegroundColor Green }
else {
  Write-Host '[缺少] 当前没有检测到 Git；这是 XMA 源码开发必需工具，正在自动安装稳定版。' -ForegroundColor Yellow
  Ensure-XmaWinget
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('install','--id','Git.Git','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'Git 安装后仍未出现在 PATH，请重新打开终端后再运行。' }
  Write-Host "[完成] Git 安装完成：$(& git.exe --version)" -ForegroundColor Green
}

Write-Host ''
Write-Host '[2/8] Node.js 22+' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Node.js 版本...' -ForegroundColor DarkCyan
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host '[缺少] 当前没有检测到 Node.js；XMA 要求 Node.js 22+，正在自动安装 Node.js LTS。' -ForegroundColor Yellow
  Ensure-XmaWinget
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('install','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 安装后仍未出现在 PATH，请重新打开终端后再运行。' }
$nodeVersion = (& node.exe --version).Trim()
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  Write-Host "[过旧] 当前 $nodeVersion，低于 XMA 硬要求 Node.js 22+；正在自动升级到受支持的 LTS。" -ForegroundColor Yellow
  Ensure-XmaWinget
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('upgrade','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
  $nodeVersion = (& node.exe --version).Trim(); $major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
  if ($major -lt 22) { throw "Node.js 升级后仍低于 22：$nodeVersion。" }
}
Write-Host "[通过] Node.js $nodeVersion" -ForegroundColor Green
Write-Host '[版本策略] 当前版本已满足 XMA >=22；不会仅为了追最新稳定版强制升级。' -ForegroundColor DarkGray

Write-Host ''
Write-Host '[3/8] pnpm 11.x · 最低 11.17.0' -ForegroundColor Cyan
$pnpmVersion = if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) { (& pnpm.cmd --version).Trim() } else { '' }
$pnpmCompatible = $false
if ($pnpmVersion) {
  try {
    $pnpmNumeric = [version](($pnpmVersion -split '-')[0])
    $pnpmCompatible = ($pnpmNumeric.Major -eq 11) -and ($pnpmNumeric -ge [version]'11.17.0')
  } catch { $pnpmCompatible = $false }
}
if (-not $pnpmCompatible) {
  if ($pnpmVersion) {
    Write-Host "[不兼容] 当前 pnpm $pnpmVersion；XMA 当前支持 pnpm 11.x，最低 11.17.0。正在自动切换到项目基准稳定版 11.17.0。" -ForegroundColor Yellow
  } else {
    Write-Host '[缺少] 当前没有检测到 pnpm；正在自动安装项目基准稳定版 11.17.0。' -ForegroundColor Yellow
  }
  Invoke-XmaExternal -FilePath 'npm.cmd' -ArgumentList @('install','--global','pnpm@11.17.0')
  Refresh-XmaPath
  $pnpmVersion = (& pnpm.cmd --version).Trim()
  try {
    $pnpmNumeric = [version](($pnpmVersion -split '-')[0])
    $pnpmCompatible = ($pnpmNumeric.Major -eq 11) -and ($pnpmNumeric -ge [version]'11.17.0')
  } catch { $pnpmCompatible = $false }
}
if (-not $pnpmCompatible) { throw "pnpm 版本不满足 XMA 要求：当前 $pnpmVersion；要求 11.x 且 >= 11.17.0。" }
Write-Host "[通过] pnpm $pnpmVersion" -ForegroundColor Green
Write-Host '[版本策略] 兼容的 pnpm 11.x 直接复用；只有缺失、低于最低版本或跨到不兼容主版本时才自动修正。' -ForegroundColor DarkGray

Write-Host ''
Write-Host '[4/8] Workspace JavaScript Runtime · Bun / OpenTUI / Toolchain' -ForegroundColor Cyan
Write-Host '[同步] 每次 [1] 都在项目根无条件执行一次原生 pnpm install；依赖状态完全交给 pnpm。' -ForegroundColor DarkCyan
Prepare-XmaCurrentJavaScriptDependencies
$jsRuntime = Get-XmaWorkspaceJavaScriptRuntimeInfo

Write-Host ''
Write-Host '[5/8] Rust / Cargo' -ForegroundColor Cyan
Write-Host '[检查] 正在检查项目本地 runtime\rust；缺失时自动安装 stable 工具链。' -ForegroundColor DarkCyan
Ensure-XmaRustToolchain
$rustRuntime = Resolve-XmaRustRuntime -ProjectRoot $Root
if (-not $rustRuntime) { throw 'Rust 准备动作结束后未能解析项目本地 runtime\rust。' }

Write-Host ''
Write-Host '[6/8] MSVC C++ Build Tools' -ForegroundColor Cyan
Ensure-XmaMsvc

Write-Host ''
Write-Host '[7/8] XMA Native Rust crates + CLI Native Build Cache' -ForegroundColor Cyan
Ensure-XmaCargoCrates -RustRuntime $rustRuntime
Ensure-XmaNativeRuntimeBuildCache -ProjectRoot $Root -RustRuntime $rustRuntime

Write-Host ''
Write-Host '[8/8] 开发态 Xiaoyu 命令' -ForegroundColor Cyan
Write-Host '[PATH] 正在校验当前源码 checkout 的 xiaoyu/xma shim 与当前用户 PATH...' -ForegroundColor DarkCyan
Install-XmaDevelopmentCommands
Remove-XmaLegacyLocalDirectory
Remove-XmaPackageMetadataFromGitWorktree

Write-Host ''
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '[完成] XMA 一键准备流程结束。' -ForegroundColor Green
Write-Host "[JS Runtime] Bun $($jsRuntime.BunVersion) · OpenTUI $($jsRuntime.OpenTuiCoreVersion) · Solid $($jsRuntime.SolidJsVersion) · node_modules" -ForegroundColor Cyan
Write-Host '[依赖同步] 项目 package/workspace/Cargo 依赖以后有新增或调整，重新运行 [1] 即自动补齐；[4]/[7] 不偷偷联网。' -ForegroundColor DarkGray
Write-Host "[Rust/Cargo] CARGO_HOME=$($rustRuntime.CargoHome)" -ForegroundColor Cyan
Write-Host "[Rustup] RUSTUP_HOME=$($rustRuntime.RustupHome)" -ForegroundColor Cyan
Write-Host '[Rust] 已准备；[4]/[7] 直接复用当前项目 runtime\rust 工具链。' -ForegroundColor Cyan
Write-Host "[控制状态] $(Get-XmaStateRoot -ProjectRoot $Root)" -ForegroundColor DarkGray
Write-Host '[开发命令] 新开终端后，可在任意 Workspace 输入 xiaoyu / xma 启动当前源码 CLI。' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
