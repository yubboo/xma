<#
文件作用：XMA Windows 脚本公共基础函数，统一依赖根目录、Rust/Cargo 环境恢复、版本读取与外部命令执行。
关联模块：xma-prepare.ps1、xma-console.ps1、xma-build-release.ps1、xma-sync.ps1、xma-github.ps1。
当前实现：Rust/Cargo 可放在项目 `xma-path/rust` 或用户选择的外部 `D:/xma-path/rust`/其他盘符；checkout 控制状态存 Git 本地元数据 `.git/xma-state`（非 Git 场景回退 `.cache/xma-state`）。Bun/OpenTUI 已归入 pnpm Workspace `node_modules`，不再由本文件维护独立 Runtime 状态。
职责边界：这里只提供跨 Windows 入口共享的路径、环境与命令基础能力，不负责联网安装、Git 提交流程或产品构建策略。
#>

function Get-XmaProjectVersion {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  $packageFile = Join-Path $ProjectRoot 'package.json'
  return (Get-Content $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json).version
}

function Get-XmaLocalPathRoot {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path $ProjectRoot 'xma-path')
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

function Get-XmaDefaultRustRoot {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path (Get-XmaLocalPathRoot -ProjectRoot $ProjectRoot) 'rust')
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
    # 中文说明：Directory.Delete 对目录链接只删除链接本身，不递归删除链接目标；禁止用递归删除误伤 xma-path 中的真实依赖。
    [IO.Directory]::Delete($Path)
    return
  }
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
}

function Get-XmaRustEnvironmentStatePath {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path (Get-XmaStateRoot -ProjectRoot $ProjectRoot) 'rust-environment.json')
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
  $cargo = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($CargoHome))
  $rustup = if ([string]::IsNullOrWhiteSpace($RustupHome)) { '' } else { [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($RustupHome)) }
  $defaultRoot = [IO.Path]::GetFullPath((Get-XmaDefaultRustRoot -ProjectRoot $ProjectRoot))
  $defaultCargo = Join-Path $defaultRoot 'cargo'
  $defaultRustup = Join-Path $defaultRoot 'rustup'
  $isProject = ($cargo -ieq $defaultCargo) -and ([string]::IsNullOrWhiteSpace($rustup) -or $rustup -ieq $defaultRustup)

  $stateFile = Get-XmaRustEnvironmentStatePath -ProjectRoot $ProjectRoot
  $stateDir = Split-Path -Parent $stateFile
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $state = [ordered]@{
    formatVersion = 2
    location = if ($isProject) { 'project' } else { 'external' }
    cargoHome = if ($isProject) { '' } else { $cargo }
    rustupHome = if ($isProject) { '' } else { $rustup }
  }
  $json = $state | ConvertTo-Json -Depth 3
  [IO.File]::WriteAllText($stateFile, "$json`r`n", ([Text.UTF8Encoding]::new($false)))
}


function Get-XmaDiscoveredRustHomes {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)

  # 中文说明：Rust 的 checkout 状态可能丢失，但实体仍位于用户选择的外部盘符。
  # 只扫描 XMA 自管的已知外部布局，不搜索整盘；所有候选必须真实通过 `cargo/rustc --version`。
  $results = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  foreach ($drive in [IO.DriveInfo]::GetDrives()) {
    try {
      if (-not $drive.IsReady) { continue }
      $driveRoot = $drive.RootDirectory.FullName
    } catch { continue }

    foreach ($rustRoot in @(
      (Join-Path $driveRoot 'xma-path\rust'),
      (Join-Path $driveRoot 'XMA\Rust')
    )) {
      $cargoHome = Join-Path $rustRoot 'cargo'
      $rustupHome = Join-Path $rustRoot 'rustup'
      try { $cargoHome = [IO.Path]::GetFullPath($cargoHome) } catch { continue }
      if ($seen.ContainsKey($cargoHome)) { continue }
      $seen[$cargoHome] = $true
      $cargoBin = Join-Path $cargoHome 'bin'
      $cargoExe = Join-Path $cargoBin 'cargo.exe'
      $rustcExe = Join-Path $cargoBin 'rustc.exe'
      if (-not (Test-Path -LiteralPath $cargoExe -PathType Leaf) -or -not (Test-Path -LiteralPath $rustcExe -PathType Leaf)) { continue }

      $previousPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        & $cargoExe --version *> $null
        $cargoOk = $LASTEXITCODE -eq 0
        & $rustcExe --version *> $null
        $rustcOk = $LASTEXITCODE -eq 0
      } catch {
        $cargoOk = $false; $rustcOk = $false
      } finally {
        $ErrorActionPreference = $previousPreference
      }
      if ($cargoOk -and $rustcOk) {
        $resolvedRustupHome = if (Test-Path -LiteralPath $rustupHome -PathType Container) { [IO.Path]::GetFullPath($rustupHome) } else { '' }
        [void]$results.Add([pscustomobject]@{
          CargoHome = $cargoHome
          RustupHome = $resolvedRustupHome
        })
      }
    }
  }
  return $results.ToArray()
}

function Import-XmaRustEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [switch]$DiscoverExternal
  )

  # 中文说明：优先使用 checkout 本地 `.git/xma-state`（非 Git 树为 `.cache/xma-state`）记录的 Rust 位置；默认安装仍在 `xma-path/rust` 并按项目相对位置恢复。
  # 旧 `xma-path/state`、User 环境与 `.xma/state` 只作为迁移兼容来源，找到可用工具链后 `[1]` 会写回新的 checkout 状态。
  $candidates = New-Object System.Collections.Generic.List[object]
  $stateFile = Get-XmaRustEnvironmentStatePath -ProjectRoot $ProjectRoot
  if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    try {
      $state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($state.formatVersion -eq 2) {
        if ([string]$state.location -eq 'project') {
          $root = Get-XmaDefaultRustRoot -ProjectRoot $ProjectRoot
          [void]$candidates.Add([pscustomobject]@{ Source = 'project-state'; CargoHome = (Join-Path $root 'cargo'); RustupHome = (Join-Path $root 'rustup') })
        } elseif ($state.cargoHome) {
          [void]$candidates.Add([pscustomobject]@{ Source = 'project-state'; CargoHome = [string]$state.cargoHome; RustupHome = [string]$state.rustupHome })
        }
      }
    } catch {}
  }

  $defaultRustRoot = Get-XmaDefaultRustRoot -ProjectRoot $ProjectRoot
  $legacyProjectStateFile = Join-Path (Get-XmaLocalPathRoot -ProjectRoot $ProjectRoot) 'state\rust-environment.json'
  if (Test-Path -LiteralPath $legacyProjectStateFile -PathType Leaf) {
    try {
      $legacyProject = Get-Content -LiteralPath $legacyProjectStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($legacyProject.formatVersion -eq 2) {
        if ([string]$legacyProject.location -eq 'project') {
          [void]$candidates.Add([pscustomobject]@{ Source = 'legacy-project-state'; CargoHome = (Join-Path $defaultRustRoot 'cargo'); RustupHome = (Join-Path $defaultRustRoot 'rustup') })
        } elseif ($legacyProject.cargoHome) {
          [void]$candidates.Add([pscustomobject]@{ Source = 'legacy-project-state'; CargoHome = [string]$legacyProject.cargoHome; RustupHome = [string]$legacyProject.rustupHome })
        }
      }
    } catch {}
  }

  [void]$candidates.Add([pscustomobject]@{ Source = 'project-default'; CargoHome = (Join-Path $defaultRustRoot 'cargo'); RustupHome = (Join-Path $defaultRustRoot 'rustup') })

  $legacyStateFile = Join-Path $ProjectRoot '.xma\state\rust-environment.json'
  if (Test-Path -LiteralPath $legacyStateFile -PathType Leaf) {
    try {
      $legacy = Get-Content -LiteralPath $legacyStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($legacy.cargoHome) { [void]$candidates.Add([pscustomobject]@{ Source = 'legacy-state'; CargoHome = [string]$legacy.cargoHome; RustupHome = [string]$legacy.rustupHome }) }
    } catch {}
  }

  $userCargoHome = [Environment]::GetEnvironmentVariable('CARGO_HOME','User')
  $userRustupHome = [Environment]::GetEnvironmentVariable('RUSTUP_HOME','User')
  if (-not [string]::IsNullOrWhiteSpace($userCargoHome)) { [void]$candidates.Add([pscustomobject]@{ Source = 'legacy-user-env'; CargoHome = $userCargoHome; RustupHome = $userRustupHome }) }
  if (-not [string]::IsNullOrWhiteSpace($env:CARGO_HOME)) { [void]$candidates.Add([pscustomobject]@{ Source = 'process-env'; CargoHome = $env:CARGO_HOME; RustupHome = $env:RUSTUP_HOME }) }

  $seen = @{}
  foreach ($candidate in $candidates) {
    try { $cargoHome = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$candidate.CargoHome)) } catch { continue }
    if ($seen.ContainsKey($cargoHome)) { continue }
    $seen[$cargoHome] = $true
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
  if (-not $DiscoverExternal) { return $null }

  # 只有明确要求外部发现的入口才扫描盘符。普通 xma-dev 菜单启动只恢复已知状态，避免发现逻辑拖垮控制台入口。
  # checkout 状态缺失时，离线扫描 XMA 自管的外部 Rust 布局。唯一命中才自动接管，避免多套工具链时擅自猜测。
  $discovered = @(Get-XmaDiscoveredRustHomes -ProjectRoot $ProjectRoot)
  if ($discovered.Count -eq 1) {
    $cargoHome = [IO.Path]::GetFullPath([string]$discovered[0].CargoHome)
    $rustupHome = [string]$discovered[0].RustupHome
    $cargoBin = Join-Path $cargoHome 'bin'
    $cargoExe = Join-Path $cargoBin 'cargo.exe'
    $rustcExe = Join-Path $cargoBin 'rustc.exe'
    $env:CARGO_HOME = $cargoHome
    if (-not [string]::IsNullOrWhiteSpace($rustupHome)) { $env:RUSTUP_HOME = $rustupHome }
    Add-XmaProcessPathFront -Directory $cargoBin
    Save-XmaRustEnvironmentState -ProjectRoot $ProjectRoot -CargoHome $cargoHome -RustupHome $rustupHome
    return [pscustomobject]@{ Source = 'drive-scan'; CargoHome = $cargoHome; RustupHome = $rustupHome; CargoExe = $cargoExe; RustcExe = $rustcExe }
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
  # 注意：本函数保留原生 stdout 语义。终端进度型命令（尤其 pnpm install）必须直接调用本函数，禁止再接 `| Out-Host`/ForEach-Object 等 PowerShell pipeline，
  # 否则会破坏 carriage-return 同行刷新并可能触发 Windows PowerShell 5.1 转码乱码。只有确实需要返回对象/路径的非交互函数，才允许在其内部显式消费 stdout。
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
