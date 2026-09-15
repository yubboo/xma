<#
文件作用：XMA Windows 脚本公共基础函数，统一依赖根目录、Rust/Cargo 环境恢复、版本读取与外部命令执行。
关联模块：xma-prepare.ps1、xma-console.ps1、xma-build-release.ps1、xma-sync.ps1、xma-github.ps1。
当前实现：Rust/Cargo 使用项目本地 `runtime/rust/{cargo,rustup}`，与根 `node_modules` 同属 checkout 本地依赖；XMA 通过 `CARGO_HOME/RUSTUP_HOME` 让 rustup、cargo、crates 与 toolchain 跟随项目目录，不写入 `%USERPROFILE%\.cargo/.rustup`，也不再维护旧 `xma-path/rust`。Bun/OpenTUI 统一由根 pnpm Workspace `node_modules` 管理。
职责边界：这里只提供跨 Windows 入口共享的项目本地 Rust 路径、环境与命令基础能力；Invoke-XmaProbe 仅做短命令静默探测，Resolve-XmaRustRuntime 只解析当前项目 `runtime/rust` 中已真实可运行的 Rust/Cargo，不负责联网安装；联网安装由 xma-prepare.ps1 的 [1]/[9] 负责。
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
    # 中文说明：Directory.Delete 对目录链接只删除链接本身，不递归删除链接目标；禁止用递归删除误伤 xma-path 中的真实依赖。
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
