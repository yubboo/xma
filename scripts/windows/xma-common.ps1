<#
文件作用：XMA Windows 脚本公共基础函数，统一版本读取与外部命令执行，避免不同入口重复实现造成参数丢失。
关联模块：xma-prepare.ps1、xma-github.ps1、xma-console.ps1、xma-build-release.ps1；所有外部命令包装必须复用本文件。
当前实现：UTF-8 读取 package.json；使用 FilePath + ArgumentList 安全转发外部命令；统一恢复 `[1]` 选择的 XMA_BUN_HOME 与 CARGO_HOME/RUSTUP_HOME，并提供 Bun/Cargo 真实探针。
职责边界：这里只提供跨 Windows 入口共享的环境/命令基础能力，不负责联网安装、Git 提交流程或产品构建策略。
#>

function Get-XmaProjectVersion {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  $packageFile = Join-Path $ProjectRoot 'package.json'
  return (Get-Content $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json).version
}

function Get-XmaRustEnvironmentStatePath {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path $ProjectRoot '.xma\state\rust-environment.json')
}

function Get-XmaBunEnvironmentStatePath {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path $ProjectRoot '.xma\state\bun-environment.json')
}

function Get-XmaBunExecutableFromHome {
  param(
    [Parameter(Mandatory = $true)][string]$BunHome,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
  )
  $expanded = [Environment]::ExpandEnvironmentVariables($BunHome)
  $normalized = [IO.Path]::GetFullPath($expanded)
  return (Join-Path (Join-Path $normalized $ExpectedVersion) 'bun.exe')
}

function Save-XmaBunEnvironmentState {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$BunHome,
    [Parameter(Mandatory = $true)][string]$Version
  )
  if ([string]::IsNullOrWhiteSpace($BunHome)) { return }
  $stateFile = Get-XmaBunEnvironmentStatePath -ProjectRoot $ProjectRoot
  $stateDir = Split-Path -Parent $stateFile
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $state = [ordered]@{
    formatVersion = 1
    bunHome = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($BunHome))
    version = $Version
  }
  $json = $state | ConvertTo-Json -Depth 3
  [IO.File]::WriteAllText($stateFile, "$json`r`n", ([Text.UTF8Encoding]::new($false)))
}

function Import-XmaBunEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
  )

  # 中文说明：Bun 的安装位置由 `[1]` 用户选择并持久化到 User XMA_BUN_HOME；项目状态只作为旧终端/环境变量尚未刷新时的恢复备份。
  # 所有候选都必须真实执行 bun.exe --version，不能只因为目录存在就当成 Runtime 已准备。
  $candidates = New-Object System.Collections.Generic.List[object]
  $userBunHome = [Environment]::GetEnvironmentVariable('XMA_BUN_HOME','User')
  if (-not [string]::IsNullOrWhiteSpace($userBunHome)) {
    [void]$candidates.Add([pscustomobject]@{ Source = 'user-env'; BunHome = $userBunHome })
  }

  $stateFile = Get-XmaBunEnvironmentStatePath -ProjectRoot $ProjectRoot
  if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    try {
      $state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($state.formatVersion -eq 1 -and $state.bunHome -and [string]$state.version -eq $ExpectedVersion) {
        [void]$candidates.Add([pscustomobject]@{ Source = 'project-state'; BunHome = [string]$state.bunHome })
      }
    } catch {
      # 本地状态损坏时继续尝试 Process 环境；状态文件本身不能阻断源码开发入口。
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:XMA_BUN_HOME)) {
    [void]$candidates.Add([pscustomobject]@{ Source = 'process-env'; BunHome = $env:XMA_BUN_HOME })
  }

  foreach ($candidate in $candidates) {
    try {
      $bunHome = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$candidate.BunHome))
      $bunExe = Get-XmaBunExecutableFromHome -BunHome $bunHome -ExpectedVersion $ExpectedVersion
    } catch { continue }
    if (-not (Test-Path -LiteralPath $bunExe -PathType Leaf)) { continue }

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $actual = @(& $bunExe --version 2>$null)
      $exitCode = $LASTEXITCODE
    } catch {
      $actual = @()
      $exitCode = -1
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    $version = ($actual -join ' ').Trim()
    if ($exitCode -ne 0 -or $version -ne $ExpectedVersion) { continue }

    $env:XMA_BUN_HOME = $bunHome
    return [pscustomobject]@{ Source = $candidate.Source; BunHome = $bunHome; BunExe = $bunExe; Version = $version }
  }
  return $null
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

function Save-XmaRustEnvironmentState {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$CargoHome,
    [string]$RustupHome = ''
  )
  if ([string]::IsNullOrWhiteSpace($CargoHome)) { return }
  $stateFile = Get-XmaRustEnvironmentStatePath -ProjectRoot $ProjectRoot
  $stateDir = Split-Path -Parent $stateFile
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $normalizedRustupHome = ''
  if (-not [string]::IsNullOrWhiteSpace($RustupHome)) { $normalizedRustupHome = [IO.Path]::GetFullPath($RustupHome) }
  $state = [ordered]@{
    formatVersion = 1
    cargoHome = [IO.Path]::GetFullPath($CargoHome)
    rustupHome = $normalizedRustupHome
  }
  $json = $state | ConvertTo-Json -Depth 3
  [IO.File]::WriteAllText($stateFile, "$json`r`n", ([Text.UTF8Encoding]::new($false)))
}

function Import-XmaRustEnvironment {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)

  # 中文说明：XMA 自己安装/确认过的 Rust 位置记录在项目本地 .xma/state 中。
  # 这样用户把 Rust 安装到 D:/E:/自定义目录后，新的 PowerShell 进程也能先恢复同一 CARGO_HOME/RUSTUP_HOME，
  # 不依赖启动这个终端时是否已经继承了最新 User 环境变量。
  $candidates = New-Object System.Collections.Generic.List[object]

  # User 环境是 `[1]` 持久化后的权威来源；直接读取注册表级 User 环境，
  # 即使当前 Windows Terminal 是旧进程、尚未继承最新变量，也能立即恢复用户选定的 D:/E:/自定义 Rust Home。
  $userCargoHome = [Environment]::GetEnvironmentVariable('CARGO_HOME','User')
  $userRustupHome = [Environment]::GetEnvironmentVariable('RUSTUP_HOME','User')
  if (-not [string]::IsNullOrWhiteSpace($userCargoHome)) {
    [void]$candidates.Add([pscustomobject]@{ Source = 'user-env'; CargoHome = $userCargoHome; RustupHome = $userRustupHome })
  }

  # 项目状态是第二层恢复来源，主要覆盖 User 环境尚未持久化/被外部工具暂时覆盖的情况。
  $stateFile = Get-XmaRustEnvironmentStatePath -ProjectRoot $ProjectRoot
  if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    try {
      $state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($state.formatVersion -eq 1 -and $state.cargoHome) {
        [void]$candidates.Add([pscustomobject]@{ Source = 'project-state'; CargoHome = [string]$state.cargoHome; RustupHome = [string]$state.rustupHome })
      }
    } catch {
      # 本地状态损坏时继续尝试 Process 环境，不让辅助状态阻断开发入口。
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CARGO_HOME)) {
    [void]$candidates.Add([pscustomobject]@{ Source = 'process-env'; CargoHome = $env:CARGO_HOME; RustupHome = $env:RUSTUP_HOME })
  }

  foreach ($candidate in $candidates) {
    try { $cargoHome = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$candidate.CargoHome)) } catch { continue }
    $cargoBin = Join-Path $cargoHome 'bin'
    $cargoExe = Join-Path $cargoBin 'cargo.exe'
    $rustcExe = Join-Path $cargoBin 'rustc.exe'
    if (-not (Test-Path -LiteralPath $cargoExe -PathType Leaf) -or -not (Test-Path -LiteralPath $rustcExe -PathType Leaf)) { continue }

    $env:CARGO_HOME = $cargoHome
    $rustupHome = ''
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate.RustupHome)) {
      try { $rustupHome = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$candidate.RustupHome)) } catch { $rustupHome = [string]$candidate.RustupHome }
      $env:RUSTUP_HOME = $rustupHome
    }
    Add-XmaProcessPathFront -Directory $cargoBin
    return [pscustomobject]@{ Source = $candidate.Source; CargoHome = $cargoHome; RustupHome = $rustupHome; CargoExe = $cargoExe; RustcExe = $rustcExe }
  }
  return $null
}

function Get-XmaEffectiveCargoHome {
  param([string]$CargoExecutable = '')
  if (-not [string]::IsNullOrWhiteSpace($env:CARGO_HOME)) {
    try { return [IO.Path]::GetFullPath($env:CARGO_HOME) } catch { return $env:CARGO_HOME }
  }
  if (-not [string]::IsNullOrWhiteSpace($CargoExecutable)) {
    try {
      $cargoBin = Split-Path -Parent ([IO.Path]::GetFullPath($CargoExecutable))
      return (Split-Path -Parent $cargoBin)
    } catch {}
  }
  return ''
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

function Invoke-XmaExternal {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [switch]$QuietCommand
  )

  # 中文说明：PowerShell 的 `$args` 是自动变量且大小写不敏感，禁止把 Args 当成自定义参数名。
  # 所有外部程序都通过 ArgumentList 显式转发，避免 pnpm/cargo/rustup 被错误退化成“裸命令”。
  if (-not $QuietCommand) {
    $display = if ($ArgumentList.Count -gt 0) { "$FilePath $($ArgumentList -join ' ')" } else { $FilePath }
    Write-Host "> $display" -ForegroundColor DarkGray
  }
  & $FilePath @ArgumentList
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "$FilePath failed with exit code $exitCode" }
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
