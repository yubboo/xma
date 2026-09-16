<#
文件作用：XMA Windows 脚本公共基础函数，统一依赖根目录、Rust/Cargo 环境恢复、版本读取与外部命令执行。
关联模块：xma-prepare.ps1、xma-console.ps1、xma-build-release.ps1、xma-sync.ps1、xma-github.ps1、开发态 xiaoyu/xma shim。
当前实现：Rust/Cargo 使用项目本地 `runtime/rust/{cargo,rustup}`，与根 `node_modules` 同属 checkout 本地依赖；XMA 通过 `CARGO_HOME/RUSTUP_HOME` 让 rustup、cargo、crates 与 toolchain 跟随项目目录，不写入 `%USERPROFILE%\.cargo/.rustup`，也不再维护旧 `xma-path/rust`。Bun/OpenTUI 统一由根 pnpm Workspace `node_modules` 管理；开发态 `xiaoyu/xma` shim 的生成、UTF-8 自检与单 checkout User PATH 路由也统一在此共享，供 `[1]` 与 Source Sync 复用。
职责边界：这里只提供跨 Windows 入口共享的项目本地 Rust 路径、开发 shim 与命令基础能力；Invoke-XmaProbe 仅做短命令静默探测，Resolve-XmaRustRuntime 只解析当前项目 `runtime/rust` 中已真实可运行的 Rust/Cargo，不负责联网安装；开发 shim helper 只写 checkout 控制状态与 User PATH，不安装依赖；联网安装仍只由 xma-prepare.ps1 的 [1]/[9] 负责。
#>

function Get-XmaProjectVersion {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  $packageFile = Join-Path $ProjectRoot 'package.json'
  return (Get-Content $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json).version
}

function Get-XmaProjectRustRuntimeRoot {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path $ProjectRoot 'runtime\rust')
}

function Get-XmaProjectCargoHome {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path (Get-XmaProjectRustRuntimeRoot -ProjectRoot $ProjectRoot) 'cargo')
}

function Get-XmaProjectRustupHome {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path (Get-XmaProjectRustRuntimeRoot -ProjectRoot $ProjectRoot) 'rustup')
}

function Use-XmaProjectRustEnvironment {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)

  $rustRoot = Get-XmaProjectRustRuntimeRoot -ProjectRoot $ProjectRoot
  $cargoHome = Get-XmaProjectCargoHome -ProjectRoot $ProjectRoot
  $rustupHome = Get-XmaProjectRustupHome -ProjectRoot $ProjectRoot
  $cargoBin = Join-Path $cargoHome 'bin'

  $env:CARGO_HOME = $cargoHome
  $env:RUSTUP_HOME = $rustupHome
  Add-XmaProcessPathFront -Directory $cargoBin

  return [pscustomobject]@{
    RustRoot = $rustRoot
    CargoHome = $cargoHome
    RustupHome = $rustupHome
    CargoBin = $cargoBin
  }
}

function Get-XmaCheckoutStateRoot {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  $gitEntry = Join-Path $ProjectRoot '.git'
  if (Test-Path -LiteralPath $gitEntry -PathType Container) {
    return (Join-Path $gitEntry 'xma-state')
  }
  if (Test-Path -LiteralPath $gitEntry -PathType Leaf) {
    try {
      $line = (Get-Content -LiteralPath $gitEntry -Raw -Encoding UTF8).Trim()
      if ($line -match '^gitdir:\s*(.+)$') {
        $gitDirText = [Environment]::ExpandEnvironmentVariables($Matches[1].Trim())
        $gitDir = if ([IO.Path]::IsPathRooted($gitDirText)) { [IO.Path]::GetFullPath($gitDirText) } else { [IO.Path]::GetFullPath((Join-Path $ProjectRoot $gitDirText)) }
        return (Join-Path $gitDir 'xma-state')
      }
    } catch {}
  }
  # 中文说明：正式源码开发通常是 Git checkout；无 `.git` 的源码包/临时树只把控制状态放入可删除的 `.cache`，不制造根 `xma-path`。
  return (Join-Path $ProjectRoot '.cache\xma-state')
}

function Get-XmaStateRoot {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Get-XmaCheckoutStateRoot -ProjectRoot $ProjectRoot)
}

function Get-XmaNormalizedPath {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
  $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
  if ([string]::IsNullOrWhiteSpace($expanded)) { return '' }
  try { return [IO.Path]::GetFullPath($expanded).TrimEnd([char[]]@('\','/')) }
  catch { return $expanded.TrimEnd([char[]]@('\','/')) }
}

function Get-XmaPathEntries {
  param([string]$PathValue)
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return @() }
  $entries = New-Object System.Collections.Generic.List[string]
  foreach ($entry in ($PathValue -split ';')) {
    if ([string]::IsNullOrWhiteSpace($entry)) { continue }
    $candidate = $entry.Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    [void]$entries.Add($candidate)
  }
  return $entries.ToArray()
}

function Test-XmaDevelopmentCommandPath {
  param([string]$Path)
  $normalized = Get-XmaNormalizedPath $Path
  if ([string]::IsNullOrWhiteSpace($normalized)) { return $false }
  if ($normalized -match '(?i)[\\/]\.xma[\\/]dev-bin$') { return $true }
  return ($normalized -match '(?i)[\\/]xma-state[\\/]dev-bin$')
}

function Get-XmaRegisteredDevelopmentCommandEntries {
  $entries = New-Object System.Collections.Generic.List[string]
  foreach ($entry in @(Get-XmaPathEntries ([Environment]::GetEnvironmentVariable('Path','User')))) {
    if (Test-XmaDevelopmentCommandPath -Path $entry) { [void]$entries.Add($entry) }
  }
  return $entries.ToArray()
}

function Get-XmaDevelopmentCommandSourceRoot {
  param([Parameter(Mandatory = $true)][string]$DevBin)
  $rootFile = Join-Path $DevBin 'source-root.txt'
  if (-not (Test-Path -LiteralPath $rootFile -PathType Leaf)) { return '' }
  try {
    return ([IO.File]::ReadAllText($rootFile, [Text.Encoding]::UTF8).Trim())
  } catch {
    return ''
  }
}

function Assert-XmaDevelopmentCommandTarget {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  $expectedRoot = Get-XmaNormalizedPath $ProjectRoot
  $expectedDevBin = Get-XmaNormalizedPath (Join-Path (Get-XmaStateRoot -ProjectRoot $ProjectRoot) 'dev-bin')
  $registered = @(Get-XmaRegisteredDevelopmentCommandEntries)
  if ($registered.Count -ne 1) {
    throw "开发态 xiaoyu/xma User PATH 应只保留 1 个 XMA dev-bin，当前检测到 $($registered.Count) 个。请在目标 checkout 运行 xma-dev.bat → [1] 修复。"
  }
  $actualDevBin = Get-XmaNormalizedPath $registered[0]
  if ($actualDevBin -ine $expectedDevBin) {
    throw "开发态 xiaoyu/xma 仍指向其他 checkout：$actualDevBin；期望：$expectedDevBin。"
  }
  $actualRoot = Get-XmaNormalizedPath (Get-XmaDevelopmentCommandSourceRoot -DevBin $registered[0])
  if ($actualRoot -ine $expectedRoot) {
    throw "开发态 xiaoyu/xma source-root.txt 指向错误：$actualRoot；期望：$expectedRoot。"
  }
}

function Install-XmaDevelopmentCommands {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [switch]$OnlyIfAlreadyRegistered,
    [string]$Reason = '开发环境准备'
  )

  $registeredBefore = @(Get-XmaRegisteredDevelopmentCommandEntries)
  if ($OnlyIfAlreadyRegistered -and $registeredBefore.Count -eq 0) {
    Write-Host '[开发命令] 当前用户尚未注册开发态 xiaoyu/xma；Source Sync 不主动新增 User PATH。需要全局开发命令时，在目标 checkout 运行 xma-dev.bat → [1]。' -ForegroundColor DarkGray
    return
  }

  $root = [IO.Path]::GetFullPath($ProjectRoot)
  $console = Join-Path $root 'scripts\windows\xma-console.ps1'
  if (-not (Test-Path -LiteralPath $console -PathType Leaf)) {
    throw "无法注册开发态 xiaoyu/xma：目标 checkout 缺少 scripts\\windows\\xma-console.ps1：$root"
  }

  # 开发 shim 属于 checkout 控制状态，不属于 JavaScript/Rust 依赖实体。放到 `.git/xma-state/dev-bin`（非 Git 树回退 `.cache/xma-state/dev-bin`）。
  $devBin = Join-Path (Get-XmaStateRoot -ProjectRoot $root) 'dev-bin'
  New-Item -ItemType Directory -Force -Path $devBin | Out-Null
  # `.cmd` 只做纯 ASCII 跳板；中文 checkout 路径始终由 PowerShell/.NET UTF-8 读取并直接进入 PowerShell 控制台。
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
  if (Set-XmaTextFileIfChanged -Path (Join-Path $devBin 'source-root.txt') -Content "$root`r`n") { $shimChanged = $true }

  $normalizedDevBin = Get-XmaNormalizedPath $devBin
  $currentUserPath = [Environment]::GetEnvironmentVariable('Path','User')
  $userEntries = @(Get-XmaPathEntries $currentUserPath)
  $nextUserEntries = @($devBin)
  foreach ($entry in $userEntries) {
    $normalized = Get-XmaNormalizedPath $entry
    if ($normalized -ieq $normalizedDevBin) { continue }
    # 同一用户只激活一个 XMA checkout；清掉旧 `.xma/dev-bin` 以及其他 checkout/git-worktree 的 `xma-state/dev-bin`。
    if (Test-XmaDevelopmentCommandPath -Path $entry) { continue }
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
    if (Test-XmaDevelopmentCommandPath -Path $entry) { continue }
    $nextProcessEntries += $entry
  }
  $env:Path = ($nextProcessEntries -join ';')

  # 用刚生成的真实 `.cmd -> PowerShell UTF-8 shim` 链路做一次自检，但不启动 TUI。
  $previousShimVerify = $env:XMA_DEV_SHIM_VERIFY
  try {
    $env:XMA_DEV_SHIM_VERIFY = '1'
    Invoke-XmaExternal -FilePath (Join-Path $devBin 'xiaoyu.cmd') -ArgumentList @() -QuietCommand
  } finally {
    if ($null -eq $previousShimVerify) { Remove-Item Env:XMA_DEV_SHIM_VERIFY -ErrorAction SilentlyContinue }
    else { $env:XMA_DEV_SHIM_VERIFY = $previousShimVerify }
  }
  Assert-XmaDevelopmentCommandTarget -ProjectRoot $root
  Write-Host '[验证] 开发态 xiaoyu / xma shim 已通过当前 checkout UTF-8 路径自检。' -ForegroundColor Green
  Write-Host "[验证] 开发态 xiaoyu / xma shim 已绑定当前 checkout：$root" -ForegroundColor Green

  if ($pathChanged -or $shimChanged) { Write-Host "[更新] ${Reason}：开发态 xiaoyu / xma shim 与 User PATH 已同步。" -ForegroundColor Green }
  else { Write-Host '[缓存] 开发态 xiaoyu / xma shim 与 User PATH 已匹配，跳过重复写入。' -ForegroundColor DarkCyan }
  Write-Host "[位置] $devBin" -ForegroundColor DarkGray
}

function Set-XmaTextFileIfChanged {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $normalized = ($Content -replace "`r?`n", "`r`n")
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    $current = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($current -eq $normalized) { return $false }
  }
  [IO.File]::WriteAllText($Path, $normalized, ([Text.UTF8Encoding]::new($false)))
  return $true
}

function Test-XmaWritableDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  try {
    $target = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path))
    New-Item -ItemType Directory -Force -Path $target -ErrorAction Stop | Out-Null
    $probe = Join-Path $target ('.xma-write-test-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($probe, 'xma', ([Text.UTF8Encoding]::new($false)))
    Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Remove-XmaDirectoryEntry {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    try {
      $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { return }
    } catch { return }
  }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
    # 中文说明：Directory.Delete 对目录链接只删除链接本身，不递归删除链接目标；禁止用递归删除误伤链接目标中的真实依赖。
    [IO.Directory]::Delete($Path)
    return
  }
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
}

function Add-XmaProcessPathFront {
  param([Parameter(Mandatory = $true)][string]$Directory)
  if ([string]::IsNullOrWhiteSpace($Directory)) { return }
  $target = [IO.Path]::GetFullPath($Directory).TrimEnd([char[]]@('\','/'))
  $entries = New-Object System.Collections.Generic.List[string]
  [void]$entries.Add($target)
  foreach ($entry in @($env:Path -split ';')) {
    if ([string]::IsNullOrWhiteSpace($entry)) { continue }
    $candidate = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"'))
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    try { $normalized = [IO.Path]::GetFullPath($candidate).TrimEnd([char[]]@('\','/')) } catch { $normalized = $candidate.TrimEnd([char[]]@('\','/')) }
    if ($normalized -ieq $target) { continue }
    [void]$entries.Add($candidate)
  }
  $env:Path = ($entries -join ';')
}


function Resolve-XmaRustRuntime {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)

  # XMA 只解析当前 checkout 的项目本地 Rust。系统 Rust / %USERPROFILE%\.cargo 不参与项目运行，
  # 防止源码移动后继续误用旧路径，也避免依赖默认落到 C 盘用户目录。
  $layout = Use-XmaProjectRustEnvironment -ProjectRoot $ProjectRoot
  $cargoExe = Join-Path $layout.CargoBin 'cargo.exe'
  $rustcExe = Join-Path $layout.CargoBin 'rustc.exe'
  $rustupExe = Join-Path $layout.CargoBin 'rustup.exe'

  if (-not (Test-Path -LiteralPath $cargoExe -PathType Leaf)) { return $null }
  if (-not (Test-Path -LiteralPath $rustcExe -PathType Leaf)) { return $null }

  $cargoProbe = Invoke-XmaProbe -FilePath $cargoExe -ArgumentList @('--version')
  $rustcProbe = Invoke-XmaProbe -FilePath $rustcExe -ArgumentList @('--version')
  if ($cargoProbe.ExitCode -ne 0 -or $rustcProbe.ExitCode -ne 0) { return $null }

  if (-not (Test-Path -LiteralPath $rustupExe -PathType Leaf)) { $rustupExe = '' }

  return [pscustomobject]@{
    Source = 'project-runtime'
    RustRoot = $layout.RustRoot
    CargoHome = $layout.CargoHome
    RustupHome = $layout.RustupHome
    CargoExe = $cargoExe
    RustcExe = $rustcExe
    RustupExe = $rustupExe
  }
}

function Get-XmaEffectiveCargoHome {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Get-XmaProjectCargoHome -ProjectRoot $ProjectRoot)
}

function Test-XmaCargoOfflineDependencies {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [string]$CargoExecutable = 'cargo.exe'
  )
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  Push-Location $ProjectRoot
  try {
    & $CargoExecutable fetch --locked --offline *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    Pop-Location
    $ErrorActionPreference = $previousPreference
  }
}

function Get-XmaNativeRuntimeBuiltExecutable {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path $ProjectRoot '.cache\cargo-target\debug\xma-native-runtime.exe')
}

function Get-XmaNativeRuntimeBuildStampFile {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  $stateRoot = Get-XmaStateRoot -ProjectRoot $ProjectRoot
  New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
  return (Join-Path $stateRoot 'cli-native.sha256')
}

function Get-XmaNativeRuntimeInputFingerprint {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)]$RustRuntime
  )

  $files = New-Object System.Collections.Generic.List[string]
  foreach ($relative in @('Cargo.toml','Cargo.lock','.cargo\config.toml')) {
    $candidate = Join-Path $ProjectRoot $relative
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { [void]$files.Add($candidate) }
  }
  $nativeRoot = Join-Path $ProjectRoot 'native'
  if (Test-Path -LiteralPath $nativeRoot -PathType Container) {
    foreach ($file in @(Get-ChildItem -LiteralPath $nativeRoot -File -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName)) {
      if ($file.Extension -eq '.rs' -or $file.Name -eq 'Cargo.toml' -or $file.Name -eq 'build.rs') { [void]$files.Add($file.FullName) }
    }
  }

  $rustcProbe = Invoke-XmaProbe -FilePath $RustRuntime.RustcExe -ArgumentList @('--version')
  if ($rustcProbe.ExitCode -ne 0) { throw '无法读取当前项目 Rustc 版本，不能验证 Native Runtime 缓存。' }
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add("rustc=$((@($rustcProbe.Output) -join ' ').Trim())")
  foreach ($file in @($files.ToArray() | Sort-Object -Unique)) {
    $full = [IO.Path]::GetFullPath($file)
    $relative = $full.Substring($ProjectRoot.Length).TrimStart([char[]]@('\','/'))
    $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$lines.Add("$relative=$hash")
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Ensure-XmaNativeRuntimeBuildCache {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)]$RustRuntime
  )

  if (-not (Test-XmaCargoOfflineDependencies -ProjectRoot $ProjectRoot -CargoExecutable $RustRuntime.CargoExe)) {
    throw 'XMA Native Runtime 构建需要的 Rust crates 尚未完整准备。请先运行 [1]/[9] 完成 cargo fetch。'
  }

  $builtExe = Get-XmaNativeRuntimeBuiltExecutable -ProjectRoot $ProjectRoot
  $stampFile = Get-XmaNativeRuntimeBuildStampFile -ProjectRoot $ProjectRoot
  $fingerprint = Get-XmaNativeRuntimeInputFingerprint -ProjectRoot $ProjectRoot -RustRuntime $RustRuntime
  $cachedFingerprint = if (Test-Path -LiteralPath $stampFile -PathType Leaf) { (Get-Content -LiteralPath $stampFile -Raw -Encoding UTF8).Trim() } else { '' }
  if ((Test-Path -LiteralPath $builtExe -PathType Leaf) -and $cachedFingerprint -eq $fingerprint) {
    Write-Host '[缓存] Xiaoyu Native Runtime 与当前 Rust 源码/依赖一致；无需重新 cargo build。' -ForegroundColor DarkCyan
    return
  }

  $targetDir = Join-Path $ProjectRoot '.cache\cargo-target'
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  $previousCargoTargetDir = $env:CARGO_TARGET_DIR
  $env:CARGO_TARGET_DIR = $targetDir
  try {
    Write-Host '[Native] 正在离线构建 Xiaoyu Native Runtime；完成 [1] 后日常 [4] 将直接复用该产物。' -ForegroundColor DarkCyan
    Invoke-XmaExternal -FilePath $RustRuntime.CargoExe -ArgumentList @('build','--package','xma-native-runtime','--offline')
  } finally {
    if ($null -eq $previousCargoTargetDir) { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue }
    else { $env:CARGO_TARGET_DIR = $previousCargoTargetDir }
  }

  if (-not (Test-Path -LiteralPath $builtExe -PathType Leaf)) { throw "XMA Native Runtime 构建结束但未找到：$builtExe" }
  [IO.File]::WriteAllText($stampFile, "$fingerprint`r`n", ([Text.UTF8Encoding]::new($false)))
  Write-Host '[完成] Xiaoyu Native Runtime 构建缓存已准备；[4] 可直接进入 Workspace Trust / TUI。' -ForegroundColor Green
}

function Invoke-XmaExternal {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [switch]$QuietCommand
  )

  # 中文说明：PowerShell 的 `$args` 是自动变量且大小写不敏感，禁止把 Args 当成自定义参数名。
  # 所有外部程序都通过 ArgumentList 显式转发，避免 pnpm/cargo/rustup 被错误退化成“裸命令”。
  # 注意：本函数保留 native stdout/stderr 的终端语义。pnpm/rustup/cargo/git/winget/npm 等可见动作必须直接调用本函数，禁止再接 `| Out-Host`/ForEach-Object 等 PowerShell pipeline，
  # 否则会破坏 carriage-return 同行刷新，并可能把 UTF-8 中文路径按本地代码页二次解码。需要返回对象/路径时，必须把 native 动作与 Get-/Resolve-/Stage-* 读取步骤拆开。
  if (-not $QuietCommand) {
    $display = if ($ArgumentList.Count -gt 0) { "$FilePath $($ArgumentList -join ' ')" } else { $FilePath }
    Write-Host "> $display" -ForegroundColor DarkGray
  }
  & $FilePath @ArgumentList
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "$FilePath failed with exit code $exitCode" }
}

function Invoke-XmaProbe {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @()
  )

  # Probe 只用于 `--version` / `fmt --version` 这类短命令的静默能力探测。
  # 先解析并确认真实 executable 存在，避免 PowerShell 5.1 将“命令不存在”的非终止错误误判成 ExitCode=0。
  # 禁止用于 pnpm install/cargo fetch/winget 等需要实时终端输出的动作命令。
  $resolved = $FilePath
  $looksLikePath = [IO.Path]::IsPathRooted($FilePath) -or $FilePath.Contains('\') -or $FilePath.Contains('/')
  if ($looksLikePath) {
    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
      return [pscustomobject]@{ ExitCode = -1; Output = [string[]]@("executable not found: $FilePath") }
    }
    try { $resolved = [IO.Path]::GetFullPath($FilePath) } catch { $resolved = $FilePath }
  } else {
    $command = Get-Command $FilePath -CommandType Application -ErrorAction SilentlyContinue
    if (-not $command) {
      return [pscustomobject]@{ ExitCode = -1; Output = [string[]]@("command not found: $FilePath") }
    }
    $resolved = $command.Source
  }

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Stop'
  $lines = @()
  $exitCode = -1
  try {
    $rawOutput = & $resolved @ArgumentList 2>&1
    $exitCode = if ($null -eq $LASTEXITCODE) { -1 } else { [int]$LASTEXITCODE }
    $lines = @($rawOutput | ForEach-Object { [string]$_ })
  } catch {
    $exitCode = if ($null -eq $LASTEXITCODE -or [int]$LASTEXITCODE -eq 0) { -1 } else { [int]$LASTEXITCODE }
    $lines = @([string]$_.Exception.Message)
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = [string[]]$lines
  }
}

function Test-XmaElectronRuntime {
  param(
    [Parameter(Mandatory = $true)][string]$ElectronPackageRoot,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
  )

  # 中文说明：Electron.exe 是 Windows GUI 子系统程序。直接通过 PowerShell `& electron.exe --version`
  # 探测时，Windows PowerShell 5.1 可能不会像控制台程序一样同步等待，`$LASTEXITCODE` 也可能保留前一个命令的值。
  # 因此 Runtime 完整性只检查 Electron npm package 官方安装状态：dist/version + path.txt + 可执行文件。
  $dist = Join-Path $ElectronPackageRoot 'dist'
  $versionFile = Join-Path $dist 'version'
  $pathFile = Join-Path $ElectronPackageRoot 'path.txt'
  if (-not (Test-Path $versionFile) -or -not (Test-Path $pathFile)) { return $false }

  $installedVersion = (Get-Content $versionFile -Raw -Encoding UTF8).Trim().TrimStart('v')
  $relativeExe = (Get-Content $pathFile -Raw -Encoding UTF8).Trim()
  if ([string]::IsNullOrWhiteSpace($relativeExe)) { return $false }
  $executable = Join-Path $dist $relativeExe
  return ($installedVersion -eq $ExpectedVersion) -and (Test-Path $executable)
}
