<#
文件作用：XMA Windows 脚本公共基础函数，统一依赖根目录、Bun/Rust 环境恢复、版本读取与外部命令执行。
关联模块：xma-prepare.ps1、xma-console.ps1、xma-build-release.ps1、xma-sync.ps1、xma-github.ps1。
当前实现：把 XMA 自管依赖/状态统一收敛到 `xma-path`；默认跟随当前 checkout，也支持 D 盘或用户选择的其他真实盘符；后续入口统一从保存状态恢复 Bun 与 Rust/Cargo 并做真实可执行探针。
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

function Get-XmaStateRoot {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path (Get-XmaLocalPathRoot -ProjectRoot $ProjectRoot) 'state')
}

function Get-XmaDefaultBunHome {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path (Get-XmaLocalPathRoot -ProjectRoot $ProjectRoot) 'bun')
}

function Get-XmaDefaultRustRoot {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path (Get-XmaLocalPathRoot -ProjectRoot $ProjectRoot) 'rust')
}

function Get-XmaOpenTuiHomeFromBunHome {
  param([Parameter(Mandatory = $true)][string]$BunHome)
  $dependencyRoot = Split-Path -Parent ([IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($BunHome)))
  return (Join-Path $dependencyRoot 'opentui')
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

function Connect-XmaOpenTuiNodeModules {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$BunHome
  )
  $openTuiHome = Get-XmaOpenTuiHomeFromBunHome -BunHome $BunHome
  $target = Join-Path $openTuiHome 'node_modules'
  if (-not (Test-Path -LiteralPath $target -PathType Container)) { return $false }

  $runtimeRoot = Join-Path $ProjectRoot 'apps\cli\opentui-runtime'
  $link = Join-Path $runtimeRoot 'node_modules'
  if (Test-Path -LiteralPath $link -PathType Container) {
    try {
      $resolvedLink = [IO.Path]::GetFullPath((Get-Item -LiteralPath $link -Force).FullName)
      $resolvedTarget = [IO.Path]::GetFullPath($target)
      $item = Get-Item -LiteralPath $link -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        try {
          $actualTarget = [IO.Path]::GetFullPath([string]$item.Target)
          if ($actualTarget -ieq $resolvedTarget) { return $true }
        } catch {}
      }
    } catch {}
    Remove-XmaDirectoryEntry -Path $link
  } else {
    # 断开的 junction 可能让 Test-Path 返回 false，但目录项仍存在；先安全清掉再重建。
    try {
      $stale = Get-Item -LiteralPath $link -Force -ErrorAction Stop
      if (($stale.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($link) }
    } catch {}
  }

  New-Item -ItemType Junction -Path $link -Target $target -Force | Out-Null
  return (Test-Path -LiteralPath $link -PathType Container)
}

function Get-XmaRustEnvironmentStatePath {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path (Get-XmaStateRoot -ProjectRoot $ProjectRoot) 'rust-environment.json')
}

function Get-XmaBunEnvironmentStatePath {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  return (Join-Path (Get-XmaStateRoot -ProjectRoot $ProjectRoot) 'bun-environment.json')
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

function Get-XmaBunExecutableFromHome {
  param(
    [Parameter(Mandatory = $true)][string]$BunHome,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
  )
  $normalized = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($BunHome))
  return (Join-Path (Join-Path $normalized $ExpectedVersion) 'bun.exe')
}

function Save-XmaBunEnvironmentState {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$BunHome,
    [Parameter(Mandatory = $true)][string]$Version
  )
  $normalized = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($BunHome))
  $defaultHome = [IO.Path]::GetFullPath((Get-XmaDefaultBunHome -ProjectRoot $ProjectRoot))
  $stateFile = Get-XmaBunEnvironmentStatePath -ProjectRoot $ProjectRoot
  $stateDir = Split-Path -Parent $stateFile
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $isProject = $normalized -ieq $defaultHome
  $state = [ordered]@{
    formatVersion = 2
    location = if ($isProject) { 'project' } else { 'external' }
    bunHome = if ($isProject) { '' } else { $normalized }
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

  # 中文说明：当前 checkout 的 `xma-path/state` 是 XMA 自己的依赖位置真值；项目默认 Bun 位于 `xma-path/bun`，
  # 保存为相对“project”位置，因此整个仓库移动盘符后仍能自动恢复。User/Process 环境与旧 `.xma` 状态只作为 0.1.0 迁移兼容来源。
  $candidates = New-Object System.Collections.Generic.List[object]
  $stateFile = Get-XmaBunEnvironmentStatePath -ProjectRoot $ProjectRoot
  if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    try {
      $state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($state.formatVersion -eq 2 -and [string]$state.version -eq $ExpectedVersion) {
        if ([string]$state.location -eq 'project') {
          [void]$candidates.Add([pscustomobject]@{ Source = 'project-state'; BunHome = (Get-XmaDefaultBunHome -ProjectRoot $ProjectRoot) })
        } elseif ($state.bunHome) {
          [void]$candidates.Add([pscustomobject]@{ Source = 'project-state'; BunHome = [string]$state.bunHome })
        }
      }
    } catch {}
  }

  [void]$candidates.Add([pscustomobject]@{ Source = 'project-default'; BunHome = (Get-XmaDefaultBunHome -ProjectRoot $ProjectRoot) })

  $legacyStateFile = Join-Path $ProjectRoot '.xma\state\bun-environment.json'
  if (Test-Path -LiteralPath $legacyStateFile -PathType Leaf) {
    try {
      $legacy = Get-Content -LiteralPath $legacyStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($legacy.bunHome -and [string]$legacy.version -eq $ExpectedVersion) {
        [void]$candidates.Add([pscustomobject]@{ Source = 'legacy-state'; BunHome = [string]$legacy.bunHome })
      }
    } catch {}
  }

  $userBunHome = [Environment]::GetEnvironmentVariable('XMA_BUN_HOME','User')
  if (-not [string]::IsNullOrWhiteSpace($userBunHome)) { [void]$candidates.Add([pscustomobject]@{ Source = 'legacy-user-env'; BunHome = $userBunHome }) }
  if (-not [string]::IsNullOrWhiteSpace($env:XMA_BUN_HOME)) { [void]$candidates.Add([pscustomobject]@{ Source = 'process-env'; BunHome = $env:XMA_BUN_HOME }) }

  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($candidate in $candidates) {
    try {
      $bunHome = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$candidate.BunHome))
      if (-not $seen.Add($bunHome)) { continue }
      $bunExe = Get-XmaBunExecutableFromHome -BunHome $bunHome -ExpectedVersion $ExpectedVersion
    } catch { continue }
    if (-not (Test-Path -LiteralPath $bunExe -PathType Leaf)) { continue }

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $actual = @(& $bunExe --version 2>$null)
      $exitCode = $LASTEXITCODE
    } catch {
      $actual = @(); $exitCode = -1
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

function Import-XmaRustEnvironment {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)

  # 中文说明：优先使用当前 checkout `xma-path/state` 记录的 Rust 位置；默认安装在 `xma-path/rust` 并按项目相对位置恢复。
  # 旧 User 环境与 `.xma/state` 仍作为迁移兼容来源，找到可用工具链后 `[1]` 会写回新的 xma-path 状态。
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

  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($candidate in $candidates) {
    try { $cargoHome = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$candidate.CargoHome)) } catch { continue }
    if (-not $seen.Add($cargoHome)) { continue }
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
