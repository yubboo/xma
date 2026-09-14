<#
文件作用：XMA Windows 一键开发环境准备器，一次完成系统工具与通用项目依赖准备。
关联模块：xma-console.ps1、package.json、pnpm-workspace.yaml、Cargo.toml、apps/desktop。
当前实现：检查/安装 Git、Node.js、pnpm、Rust/Cargo、MSVC；安装 Workspace JavaScript 依赖但禁止 Desktop Runtime postinstall；准备 esbuild 与 XMA Native Rust crates；生成开发态 xiaoyu/xma 命令并自动注册到当前用户 PATH。
职责边界：Electron Chromium Runtime 只在用户明确选择 Electron Desktop/构建时下载；Tauri 2 Rust crates 只在用户明确选择 Tauri/构建时下载；开发命令只写 User PATH，不修改 Machine PATH，也不冒充正式 Release 安装。
#>

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
[void](Import-XmaRustEnvironment -ProjectRoot $Root)
$ElectronVersion = '41.2.0'
$BunVersion = '1.3.14'
$OpenTuiVersion = '0.1.101'
$SolidJsVersion = '1.9.11'
$BunTypesVersion = '1.3.11'
$PrepareStateRoot = Join-Path $Root '.xma\state\prepare'

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

function Get-XmaWorkspaceDependencyFingerprint {
  $files = @((Join-Path $Root 'package.json'), (Join-Path $Root 'pnpm-lock.yaml'), (Join-Path $Root 'pnpm-workspace.yaml'))
  foreach ($group in @('apps','agents','packages','plugins')) {
    $groupRoot = Join-Path $Root $group
    if (-not (Test-Path -LiteralPath $groupRoot -PathType Container)) { continue }
    foreach ($directory in (Get-ChildItem -LiteralPath $groupRoot -Directory -ErrorAction SilentlyContinue)) {
      $packageFile = Join-Path $directory.FullName 'package.json'
      if (Test-Path -LiteralPath $packageFile -PathType Leaf) { $files += $packageFile }
    }
  }
  $corePackage = Join-Path $Root 'core\package.json'
  if (Test-Path -LiteralPath $corePackage -PathType Leaf) { $files += $corePackage }
  $arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  return Get-XmaFingerprint -Paths $files -Salt "pnpm=11.17.0;os=windows;arch=$arch"
}

function Get-XmaCargoDependencyFingerprint {
  $files = @((Join-Path $Root 'Cargo.toml'), (Join-Path $Root 'Cargo.lock'))
  $nativeRoot = Join-Path $Root 'native'
  if (Test-Path -LiteralPath $nativeRoot -PathType Container) {
    $files += @(Get-ChildItem -LiteralPath $nativeRoot -Filter 'Cargo.toml' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  }
  $cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
  $cargoPath = if ($cargoCommand) { $cargoCommand.Source } else { 'cargo.exe' }
  $cargoHome = Get-XmaEffectiveCargoHome -CargoExecutable $cargoPath
  $rustupHome = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { '' }
  return Get-XmaFingerprint -Paths $files -Salt "cargo=$(& $cargoPath --version);cargoHome=$cargoHome;rustupHome=$rustupHome"
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

function Confirm-XmaAction([string]$Message) {
  while ($true) {
    $answer = (Read-Host "$Message [Y/N]").Trim().ToLowerInvariant()
    if ($answer -in @('y','yes')) { return $true }
    if ($answer -in @('n','no')) { return $false }
    Write-Host '请输入 Y 或 N。' -ForegroundColor Yellow
  }
}

function Refresh-XmaPath {
  # 中文说明：新电脑上安装器刚写入 User/Machine PATH 后，当前 PowerShell 仍可能保留旧 PATH。
  # Rust 允许用户选择 C / D / 自定义位置，因此同时识别进程级与 User 级 CARGO_HOME；禁止只假设 %USERPROFILE%\.cargo。
  $cargoHomes = @(
    $env:CARGO_HOME,
    [Environment]::GetEnvironmentVariable('CARGO_HOME','User'),
    (Join-Path $env:USERPROFILE '.cargo')
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
  $cargoBins = @($cargoHomes | ForEach-Object { Join-Path $_ 'bin' })
  $sources = @(
    $cargoBins,
    [Environment]::GetEnvironmentVariable('Path','Machine'),
    [Environment]::GetEnvironmentVariable('Path','User'),
    $env:Path
  )
  $entries = New-Object System.Collections.Generic.List[string]
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($source in $sources) {
    if ($null -eq $source) { continue }
    foreach ($value in @($source)) {
      if ([string]::IsNullOrWhiteSpace([string]$value)) { continue }
      foreach ($entry in ([string]$value -split ';')) {
        $candidate = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"'))
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        $normalized = $candidate.TrimEnd([char[]]@('\','/'))
        if ($seen.Add($normalized)) { [void]$entries.Add($candidate) }
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


function Get-XmaBunExecutable {
  return (Join-Path $Root ".xma\tools\bun\$BunVersion\bun.exe")
}

function Install-XmaBunRuntime {
  $bunExe = Get-XmaBunExecutable
  if (Test-Path $bunExe) {
    $actual = (& $bunExe --version).Trim()
    if ($actual -eq $BunVersion) {
      # 中文说明：旧版本准备器可能残留下载 ZIP / extract 副本；固定 bun.exe 已就绪时顺手清理一次性安装介质。
      Remove-Item -LiteralPath (Join-Path $Root '.cache\bun') -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "[缓存] Bun $actual · Xiaoyu OpenTUI Runtime 已存在，跳过重复下载。" -ForegroundColor DarkCyan
      Write-Host "[位置] $bunExe" -ForegroundColor DarkGray
      return $bunExe
    }
  }

  $arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  $assetArch = if ($arch -eq 'arm64') { 'aarch64' } else { 'x64' }
  $toolsRoot = Join-Path $Root '.xma\tools\bun'
  $targetRoot = Join-Path $toolsRoot $BunVersion
  $cacheRoot = Join-Path $Root '.cache\bun'
  $zip = Join-Path $cacheRoot "bun-windows-$assetArch-$BunVersion.zip"
  $extract = Join-Path $cacheRoot "extract-$BunVersion-$assetArch"
  New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }

  $url = "https://github.com/oven-sh/bun/releases/download/bun-v$BunVersion/bun-windows-$assetArch.zip"
  Write-Host "[下载] 正在准备固定 Bun $BunVersion（OpenTUI Runtime）..." -ForegroundColor Yellow
  Write-Host "[来源] $url" -ForegroundColor DarkGray
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
    $downloaded = Get-ChildItem -Path $extract -Filter 'bun.exe' -File -Recurse | Select-Object -First 1
    if (-not $downloaded) { throw 'Bun ZIP 已下载，但没有找到 bun.exe。' }
    if (Test-Path $targetRoot) { Remove-Item $targetRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
    Copy-Item -LiteralPath $downloaded.FullName -Destination $bunExe -Force
    $actual = (& $bunExe --version).Trim()
    if ($actual -ne $BunVersion) { throw "Bun 版本校验失败：期望 $BunVersion，实际 $actual。" }
    Write-Host "[通过] Bun $actual · Xiaoyu OpenTUI Runtime" -ForegroundColor Green
    Write-Host "[位置] $bunExe" -ForegroundColor DarkGray
    return $bunExe
  } finally {
    # 中文说明：Bun ZIP/解压目录只是一次性安装介质。固定 bun.exe 已复制到 .xma	ools 后立即清理，避免项目里长期多占一份压缩包和解压副本。
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
  }
}


function Test-XmaOpenTuiDependencies([string]$RuntimeRoot) {
  $expected = @{
    '@opentui/core' = $OpenTuiVersion
    '@opentui/solid' = $OpenTuiVersion
    'solid-js' = $SolidJsVersion
    '@types/bun' = $BunTypesVersion
  }
  foreach ($name in $expected.Keys) {
    $packageFile = Join-Path $RuntimeRoot ("node_modules\{0}\package.json" -f $name)
    if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) { return $false }
    try {
      $version = (Get-Content -LiteralPath $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json).version
      if ($version -ne $expected[$name]) { return $false }
    } catch { return $false }
  }
  return $true
}

function Get-XmaPathEntries([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
  return @($Value.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-XmaNormalizedPath([string]$Value) {
  try { $candidate = [IO.Path]::GetFullPath($Value) } catch { $candidate = $Value }
  return $candidate.TrimEnd([char[]]@('\','/'))
}


function Invoke-XmaProbe([string]$FilePath, [string[]]$ArgumentList = @()) {
  # 中文说明：rustup 在“已安装 shim、但没有 toolchain/default”时会把 warn 写到 stderr。
  # 这属于“依赖尚未准备”的可恢复状态，不能被 $ErrorActionPreference='Stop' 提前升级成整个 [1] 失败。
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& $FilePath @ArgumentList 2>$null)
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
  } catch {
    return [pscustomobject]@{ ExitCode = -1; Output = @($_.Exception.Message) }
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Add-XmaUserPathEntry([string]$Directory) {
  $normalizedTarget = Get-XmaNormalizedPath $Directory
  $current = [Environment]::GetEnvironmentVariable('Path','User')
  $entries = @(Get-XmaPathEntries $current)
  if ($entries | Where-Object { (Get-XmaNormalizedPath $_) -ieq $normalizedTarget }) { return $false }
  $next = (@($Directory) + $entries) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $next, 'User')
  return $true
}

function Test-XmaWritableDirectory([string]$Path) {
  try {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    $probe = Join-Path $Path ('.xma-write-probe-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($probe, 'ok', ([Text.UTF8Encoding]::new($false)))
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    return $true
  } catch {
    return $false
  }
}

function Select-XmaRustInstallRoot {
  $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
  if ([string]::IsNullOrWhiteSpace($localAppData)) { $localAppData = Join-Path $env:USERPROFILE 'AppData\Local' }
  $defaultRoot = Join-Path $localAppData 'XMA\Rust'
  $driveD = 'D:\XMA\Rust'

  while ($true) {
    Write-Host ''
    Write-Host '[Rust 安装位置] 未检测到可用的 stable toolchain，请选择安装位置：' -ForegroundColor Cyan
    Write-Host "  [1] 系统盘默认位置（推荐）  $defaultRoot" -ForegroundColor Green
    Write-Host "  [2] D 盘                    $driveD" -ForegroundColor Gray
    Write-Host '  [3] 自定义安装位置' -ForegroundColor Gray
    $choice = (Read-Host '请选择 [1]').Trim()
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = '1' }

    if ($choice -eq '1') {
      if (-not (Test-XmaWritableDirectory $defaultRoot)) { Write-Host '[不可用] 系统盘默认目录不可写，请选择其他位置。' -ForegroundColor Yellow; continue }
      return $defaultRoot
    }
    if ($choice -eq '2') {
      if (-not (Test-Path -LiteralPath 'D:\' -PathType Container)) {
        Write-Host '[不可用] 当前电脑没有 D: 盘，请选择 [1] 或 [3]。' -ForegroundColor Yellow
        continue
      }
      if (-not (Test-XmaWritableDirectory $driveD)) { Write-Host '[不可用] D 盘目标目录不可写，请选择其他位置。' -ForegroundColor Yellow; continue }
      Write-Host "[提示] 已准备 $driveD，将在其中保存 rustup / cargo。" -ForegroundColor DarkCyan
      return $driveD
    }
    if ($choice -eq '3') {
      $custom = (Read-Host '请输入 Rust 安装根目录，例如 E:\DevTools\XMA-Rust').Trim().Trim('"')
      if ([string]::IsNullOrWhiteSpace($custom)) {
        Write-Host '[提示] 自定义路径不能为空。' -ForegroundColor Yellow
        continue
      }
      try { $resolved = [IO.Path]::GetFullPath($custom) } catch {
        Write-Host '[提示] 路径格式无效，请重新输入。' -ForegroundColor Yellow
        continue
      }
      if (-not (Test-XmaWritableDirectory $resolved)) { Write-Host '[不可用] 自定义目标目录不可写，请重新选择。' -ForegroundColor Yellow; continue }
      Write-Host "[提示] 已准备 $resolved，将在其中保存 rustup / cargo。" -ForegroundColor DarkCyan
      return $resolved
    }
    Write-Host '请输入 1、2 或 3。' -ForegroundColor Yellow
  }
}

function Set-XmaRustHomes([string]$InstallRoot) {
  $rustupHome = Join-Path $InstallRoot 'rustup'
  $cargoHome = Join-Path $InstallRoot 'cargo'
  New-Item -ItemType Directory -Force -Path $rustupHome | Out-Null
  New-Item -ItemType Directory -Force -Path $cargoHome | Out-Null

  # 先只作用于当前安装进程；只有 rustup-init + 校验真正成功后，才持久化 User 环境，避免失败安装污染后续终端。
  $env:RUSTUP_HOME = $rustupHome
  $env:CARGO_HOME = $cargoHome
  $cargoBin = Join-Path $cargoHome 'bin'
  return [pscustomobject]@{ Root = $InstallRoot; RustupHome = $rustupHome; CargoHome = $cargoHome; CargoBin = $cargoBin }
}

function Save-XmaRustHomes($Homes) {
  [Environment]::SetEnvironmentVariable('RUSTUP_HOME', $Homes.RustupHome, 'User')
  [Environment]::SetEnvironmentVariable('CARGO_HOME', $Homes.CargoHome, 'User')
  [void](Add-XmaUserPathEntry $Homes.CargoBin)
  Refresh-XmaPath
}

function Install-XmaRustStable {
  $installRoot = Select-XmaRustInstallRoot
  $homes = Set-XmaRustHomes $installRoot
  $arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  $triple = if ($arch -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
  $cacheRoot = Join-Path $Root '.cache\rustup'
  $installer = Join-Path $cacheRoot "rustup-init-$triple.exe"
  $checksumFile = "$installer.sha256"
  $url = "https://static.rust-lang.org/rustup/dist/$triple/rustup-init.exe"
  $checksumUrl = "$url.sha256"
  New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

  Write-Host "[安装位置] $($homes.Root)" -ForegroundColor Cyan
  Write-Host "[下载] 正在下载 Rust 官方 rustup-init（$triple）..." -ForegroundColor Yellow
  Write-Host "[来源] $url" -ForegroundColor DarkGray
  try {
    Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
    Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumFile -UseBasicParsing
    $expected = ((Get-Content -LiteralPath $checksumFile -Raw -Encoding ASCII).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw 'rustup-init SHA-256 校验失败，已拒绝执行。' }
    Write-Host '[验证] rustup-init SHA-256 校验通过。' -ForegroundColor DarkCyan
    Invoke-XmaExternal -FilePath $installer -ArgumentList @('-y','--profile','minimal','--default-toolchain','stable','--no-modify-path')
  } finally {
    Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $checksumFile -Force -ErrorAction SilentlyContinue
  }

  $rustupExe = Join-Path $homes.CargoBin 'rustup.exe'
  if (-not (Test-Path -LiteralPath $rustupExe -PathType Leaf)) { throw "Rust 安装完成但未找到 rustup：$rustupExe" }
  Save-XmaRustHomes $homes
  Push-Location $Root
  try {
    Invoke-XmaExternal -FilePath $rustupExe -ArgumentList @('override','set','stable')
  } finally {
    Pop-Location
  }
  Write-Host "[完成] Rust stable 已安装：$($homes.Root)" -ForegroundColor Green
}

function Install-XmaDevelopmentCommands {
  # 中文说明：不把整个 Git 仓库加入 PATH，避免把维护脚本/其他文件都暴露为全局命令。
  # 只生成忽略提交的 .xma\dev-bin shim；它们始终回到当前 checkout 的 xma-dev.bat，并保留用户调用命令时的 Workspace。
  $devBin = Join-Path $Root '.xma\dev-bin'
  New-Item -ItemType Directory -Force -Path $devBin | Out-Null
  $launcher = @'
@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..\..") do set "XMA_DEV_ROOT=%%~fI"
call "%XMA_DEV_ROOT%\xma-dev.bat" cli "%CD%"
exit /b %ERRORLEVEL%
'@
  $shimChanged = $false
  foreach ($name in @('xiaoyu.cmd','xma.cmd')) {
    if (Set-XmaTextFileIfChanged -Path (Join-Path $devBin $name) -Content $launcher) { $shimChanged = $true }
  }
  if (Set-XmaTextFileIfChanged -Path (Join-Path $devBin 'source-root.txt') -Content "$Root`r`n") { $shimChanged = $true }

  $normalizedDevBin = Get-XmaNormalizedPath $devBin
  $currentUserPath = [Environment]::GetEnvironmentVariable('Path','User')
  $userEntries = @(Get-XmaPathEntries $currentUserPath)
  $nextUserEntries = @($devBin)
  foreach ($entry in $userEntries) {
    $normalized = Get-XmaNormalizedPath $entry
    if ($normalized -ieq $normalizedDevBin) { continue }
    # 一个开发账号只激活一个 XMA checkout 的 xiaoyu/xma 开发 shim；旧 checkout 的 dev-bin 自动退出 PATH，避免命令指向错误仓库。
    if ($normalized -match '(?i)[\\/]\.xma[\\/]dev-bin$') { continue }
    $nextUserEntries += $entry
  }
  $nextUserPath = ($nextUserEntries -join ';')
  $pathChanged = $currentUserPath -ne $nextUserPath
  if ($pathChanged) { [Environment]::SetEnvironmentVariable('Path', $nextUserPath, 'User') }

  $processEntries = @(Get-XmaPathEntries $env:Path)
  if (-not ($processEntries | Where-Object { (Get-XmaNormalizedPath $_) -ieq $normalizedDevBin })) {
    $env:Path = "$devBin;$env:Path"
  }
  if ($pathChanged -or $shimChanged) {
    Write-Host "[更新] 开发态 xiaoyu / xma shim 或 User PATH 已同步。" -ForegroundColor Green
  } else {
    Write-Host "[缓存] 开发态 xiaoyu / xma shim 与 User PATH 已匹配，跳过重复写入。" -ForegroundColor DarkCyan
  }
  Write-Host "[位置] $devBin" -ForegroundColor DarkGray
  Write-Host '[说明] 这是当前源码 checkout 的开发 shim；移动仓库后重新运行 xma-dev.bat → [1] 即可刷新。' -ForegroundColor DarkGray
}

Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '  XMA 一键准备开发环境' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '说明：本流程一次准备系统工具 + XMA 通用项目依赖。' -ForegroundColor DarkGray
Write-Host '说明：会安装 Workspace JavaScript 依赖、固定 Bun/OpenTUI Runtime、esbuild Native Binary 与 XMA Native Rust crates。' -ForegroundColor DarkGray
Write-Host "说明：不会下载 Electron $ElectronVersion Chromium Runtime，也不会预取 Tauri 2 Rust crates；这两项只在明确选择对应 Desktop 后执行。" -ForegroundColor DarkGray
Write-Host ''
# 中文说明：先刷新当前进程 PATH，确保新电脑刚安装到 User/Machine PATH 的工具无需重开终端即可被发现。
Refresh-XmaPath

Write-Host '[1/9] Git' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Git 是否可用...' -ForegroundColor DarkCyan
if (Get-Command git.exe -ErrorAction SilentlyContinue) {
  Write-Host "[通过] 已检测到 $(& git.exe --version)" -ForegroundColor Green
} else {
  Write-Host '[缺少] 当前没有检测到 Git。' -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否自动下载并安装 Git？')) { throw 'Git 是 XMA 开发与推送流程的必要依赖。' }
  Ensure-XmaWinget
  Write-Host '[安装] 正在通过 winget 下载并安装 Git...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('install','--id','Git.Git','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'Git 安装后仍未出现在 PATH，请重新打开终端后再运行。' }
  Write-Host "[完成] Git 安装完成：$(& git.exe --version)" -ForegroundColor Green
}

Write-Host ''
Write-Host '[2/9] Node.js 22+' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Node.js 版本...' -ForegroundColor DarkCyan
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host '[缺少] 当前没有检测到 Node.js。' -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否自动下载并安装 Node.js LTS？')) { throw 'Node.js 22+ 是 XMA TypeScript Runtime 的必要依赖。' }
  Ensure-XmaWinget
  Write-Host '[安装] 正在通过 winget 下载并安装 Node.js LTS...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('install','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 安装后仍未出现在 PATH，请重新打开终端后再运行。' }
$nodeVersion = (& node.exe --version).Trim()
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  Write-Host "[过旧] 当前 $nodeVersion，XMA 要求 Node.js 22+。" -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否通过 winget 自动升级 Node.js LTS？')) { throw 'Node.js 版本不足。' }
  Ensure-XmaWinget
  Write-Host '[升级] 正在升级 Node.js LTS...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('upgrade','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
  $nodeVersion = (& node.exe --version).Trim()
  $major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
  if ($major -lt 22) { throw "Node.js 升级后仍低于 22：$nodeVersion。请重新打开终端后重试。" }
}
Write-Host "[通过] Node.js $nodeVersion" -ForegroundColor Green

Write-Host ''
Write-Host '[3/9] pnpm 11.17.0' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 pnpm 版本...' -ForegroundColor DarkCyan
$pnpmVersion = if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) { (& pnpm.cmd --version).Trim() } else { '' }
if ($pnpmVersion -ne '11.17.0') {
  if ($pnpmVersion) { Write-Host "[调整] 当前 pnpm $pnpmVersion，项目固定使用 11.17.0。" -ForegroundColor Yellow }
  else { Write-Host '[缺少] 当前没有检测到 pnpm。' -ForegroundColor Yellow }
  Write-Host '[安装] 正在通过 npm 安装 pnpm 11.17.0...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'npm.cmd' -ArgumentList @('install','--global','pnpm@11.17.0')
  Refresh-XmaPath
}
$pnpmVersion = (& pnpm.cmd --version).Trim()
if ($pnpmVersion -ne '11.17.0') { throw "pnpm 版本校验失败：期望 11.17.0，实际 $pnpmVersion。" }
Write-Host "[通过] pnpm $pnpmVersion" -ForegroundColor Green

Write-Host ''
Write-Host '[4/9] Bun 1.3.14 / OpenTUI Runtime' -ForegroundColor Cyan
Write-Host '[检查] 正在准备 Xiaoyu OpenTUI 使用的固定 Bun Runtime...' -ForegroundColor DarkCyan
$bunExe = Install-XmaBunRuntime

Write-Host ''
Write-Host '[5/9] Rust / Cargo' -ForegroundColor Cyan
Write-Host '[检查] 正在真实验证 Rust stable toolchain、rustc 与 Cargo...' -ForegroundColor DarkCyan
Refresh-XmaPath

# 中文说明：先验证 rustc/cargo 是否真的能执行，不能再用“cargo.exe 文件存在”冒充 toolchain 已就绪。
$rustcCommand = Get-Command rustc.exe -ErrorAction SilentlyContinue
$cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
$rustReady = $false
if ($rustcCommand -and $cargoCommand) {
  $rustProbe = Invoke-XmaProbe -FilePath $rustcCommand.Source -ArgumentList @('--version')
  $cargoProbe = Invoke-XmaProbe -FilePath $cargoCommand.Source -ArgumentList @('--version')
  $rustReady = ($rustProbe.ExitCode -eq 0) -and ($cargoProbe.ExitCode -eq 0)
}

$rustupCommand = Get-Command rustup.exe -ErrorAction SilentlyContinue
if (-not $rustReady -and $rustupCommand) {
  # rustup shim 已存在但没有 default/toolchain 时，stderr 会输出 warn；Probe 必须把它当“未准备”而不是整个脚本失败。
  $toolchainProbe = Invoke-XmaProbe -FilePath $rustupCommand.Source -ArgumentList @('toolchain','list')
  $stableInstalled = ($toolchainProbe.ExitCode -eq 0) -and [bool]($toolchainProbe.Output | Where-Object { $_.ToString() -match '^stable(?:-|\s|$)' })
  if ($stableInstalled) {
    Write-Host '[修复] 已检测到 stable toolchain，但当前 XMA 目录没有激活它；正在绑定项目级 stable override...' -ForegroundColor Yellow
    Push-Location $Root
    try {
      Invoke-XmaExternal -FilePath $rustupCommand.Source -ArgumentList @('override','set','stable')
    } finally {
      Pop-Location
    }
    Refresh-XmaPath
    $rustcCommand = Get-Command rustc.exe -ErrorAction SilentlyContinue
    $cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
    if ($rustcCommand -and $cargoCommand) {
      $rustProbe = Invoke-XmaProbe -FilePath $rustcCommand.Source -ArgumentList @('--version')
      $cargoProbe = Invoke-XmaProbe -FilePath $cargoCommand.Source -ArgumentList @('--version')
      $rustReady = ($rustProbe.ExitCode -eq 0) -and ($cargoProbe.ExitCode -eq 0)
    }
  }
}

if (-not $rustReady) {
  Write-Host '[缺少] 没有检测到可实际运行的 Rust stable toolchain。' -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否由 XMA 下载并安装 Rust stable？')) { throw 'Rust stable 是 XMA Native Runtime 的必要依赖。' }
  Install-XmaRustStable
  Refresh-XmaPath
}

$rustcCommand = Get-Command rustc.exe -ErrorAction SilentlyContinue
$cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
if (-not $rustcCommand) { throw 'Rust 安装/修复后仍未检测到 rustc。' }
if (-not $cargoCommand) { throw 'Rust 安装/修复后仍未检测到 cargo。' }
$rustProbe = Invoke-XmaProbe -FilePath $rustcCommand.Source -ArgumentList @('--version')
$cargoProbe = Invoke-XmaProbe -FilePath $cargoCommand.Source -ArgumentList @('--version')
if ($rustProbe.ExitCode -ne 0) { throw "rustc toolchain 仍不可用：$($rustProbe.Output -join ' ')" }
if ($cargoProbe.ExitCode -ne 0) { throw "cargo toolchain 仍不可用：$($cargoProbe.Output -join ' ')" }
$rustcVersion = ($rustProbe.Output -join ' ').Trim()
$cargoVersion = ($cargoProbe.Output -join ' ').Trim()
Write-Host "[通过] $rustcVersion" -ForegroundColor Green
Write-Host "[通过] $cargoVersion" -ForegroundColor Green

# 中文说明：把 `[1]` 最终确认的 Rust/Cargo 位置记录在项目本地状态中。
# 后续 `[4]/[7]` 会优先恢复这一位置，确保用户选择 D:/E:/自定义目录后不会因为新终端未继承 User 环境而退回其他 Cargo Home。
$effectiveCargoHome = Get-XmaEffectiveCargoHome -CargoExecutable $cargoCommand.Source
$effectiveRustupHome = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { [Environment]::GetEnvironmentVariable('RUSTUP_HOME','User') }
if (-not [string]::IsNullOrWhiteSpace($effectiveCargoHome)) {
  Save-XmaRustEnvironmentState -ProjectRoot $Root -CargoHome $effectiveCargoHome -RustupHome $effectiveRustupHome
}

# 中文说明：`[7] 全量检查` 固定执行 `cargo fmt --check`，minimal stable 默认可能不包含 rustfmt。
# rustfmt 因此属于 `[1]` 必须准备的开发工具，而不是让 `[7]` 在离线检查阶段临时下载。
$rustfmtProbe = Invoke-XmaProbe -FilePath $cargoCommand.Source -ArgumentList @('fmt','--version')
if ($rustfmtProbe.ExitCode -ne 0) {
  $rustupCommand = Get-Command rustup.exe -ErrorAction SilentlyContinue
  if (-not $rustupCommand) {
    throw 'Rust stable 已可用，但缺少 rustfmt/cargo-fmt，且未检测到 rustup。请安装 rustfmt 后重新运行 [1]。'
  }
  Write-Host '[缺少] 未检测到 rustfmt；XMA 全量检查需要 cargo fmt --check。' -ForegroundColor Yellow
  Write-Host '[安装] 正在为 XMA stable toolchain 安装 rustfmt 组件...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath $rustupCommand.Source -ArgumentList @('component','add','rustfmt','--toolchain','stable')
  $rustfmtProbe = Invoke-XmaProbe -FilePath $cargoCommand.Source -ArgumentList @('fmt','--version')
  if ($rustfmtProbe.ExitCode -ne 0) { throw "rustfmt 安装后仍不可用：$($rustfmtProbe.Output -join ' ')" }
}
Write-Host "[通过] $((($rustfmtProbe.Output -join ' ').Trim()))" -ForegroundColor Green

if (-not [string]::IsNullOrWhiteSpace($env:RUSTUP_HOME) -or -not [string]::IsNullOrWhiteSpace($env:CARGO_HOME)) {
  Write-Host "[位置] RUSTUP_HOME=$env:RUSTUP_HOME · CARGO_HOME=$env:CARGO_HOME" -ForegroundColor DarkGray
} else {
  Write-Host "[位置] rustc=$($rustcCommand.Source) · cargo=$($cargoCommand.Source)" -ForegroundColor DarkGray
}

Write-Host '[6/9] MSVC C++ Build Tools' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Windows C++ 编译与链接工具...' -ForegroundColor DarkCyan
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$msvcReady = $false
if (Test-Path $vswhere) {
  $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  $msvcReady = [bool]$install
}
if ($msvcReady) {
  Write-Host '[通过] Visual Studio C++ Build Tools 已安装。' -ForegroundColor Green
} else {
  Write-Host '[缺少] 未检测到 Visual Studio C++ Build Tools（Rust MSVC 链接器需要）。' -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否自动安装 Visual Studio 2022 Build Tools + C++ Toolchain？')) { throw 'Windows Rust Native 构建需要 MSVC C++ Build Tools。' }
  Ensure-XmaWinget
  Write-Host '[安装] 正在安装 Visual Studio 2022 Build Tools + C++ Toolchain，这一步可能需要几分钟...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @(
    'install','--id','Microsoft.VisualStudio.2022.BuildTools','--exact',
    '--accept-source-agreements','--accept-package-agreements',
    '--override','--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  )
  Write-Host '[完成] Visual Studio C++ Build Tools 安装命令已完成。' -ForegroundColor Green
}

Write-Host ''
Write-Host '[7/9] TypeScript / Web / CLI / Desktop JavaScript 依赖' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 XMA Workspace JavaScript 依赖...' -ForegroundColor DarkCyan
$tsx = Join-Path $Root 'node_modules\.bin\tsx.cmd'
$vite = Join-Path $Root 'node_modules\.bin\vite.cmd'
$tsc = Join-Path $Root 'node_modules\.bin\tsc.cmd'
$tsup = Join-Path $Root 'node_modules\.bin\tsup.cmd'
$openTuiRuntimeRoot = Join-Path $Root 'apps\cli\opentui-runtime'
$cliOpenTuiCore = Join-Path $openTuiRuntimeRoot 'node_modules\@opentui\core\package.json'
$cliOpenTuiSolid = Join-Path $openTuiRuntimeRoot 'node_modules\@opentui\solid\package.json'
$desktopElectronPackage = Join-Path $Root 'apps\desktop\node_modules\electron\package.json'
$desktopTauriCmd = Join-Path $Root 'apps\desktop\node_modules\.bin\tauri.cmd'

$workspaceJsReady = (Test-Path $tsx) -and (Test-Path $vite) -and (Test-Path $tsc) -and (Test-Path $tsup) -and (Test-Path $desktopElectronPackage) -and (Test-Path $desktopTauriCmd)
$workspaceFingerprint = Get-XmaWorkspaceDependencyFingerprint
$workspaceStampReady = Test-XmaPrepareStamp -Name 'workspace-js' -Fingerprint $workspaceFingerprint
if ($workspaceJsReady -and -not $workspaceStampReady) {
  # 中文说明：升级到新的准备器时本地还没有指纹 stamp，但 node_modules 可能已经完全可用。
  # 先用 frozen+offline 做一次无下载验证，并执行最小 tsx/esbuild 探针；通过后直接认领当前缓存，避免为了生成 stamp 再联网/重建。
  Write-Host '[校验] 检测到现有 Workspace 依赖，正在离线确认 lockfile/node_modules 可直接复用...' -ForegroundColor DarkCyan
  & pnpm.cmd install --ignore-scripts --offline --frozen-lockfile *> $null
  $offlineInstallOk = $LASTEXITCODE -eq 0
  if ($offlineInstallOk) {
    & pnpm.cmd exec tsx -e 'const value: number = 1; if (value !== 1) process.exit(1)' *> $null
    $offlineInstallOk = $LASTEXITCODE -eq 0
  }
  if ($offlineInstallOk) {
    Set-XmaPrepareStamp -Name 'workspace-js' -Fingerprint $workspaceFingerprint
    $workspaceStampReady = $true
    Write-Host '[缓存] 现有 Workspace 依赖离线校验通过，直接复用；不下载、不 rebuild。' -ForegroundColor DarkCyan
  }
}
if ($workspaceJsReady -and $workspaceStampReady) {
  Write-Host '[缓存] Workspace package/lockfile/node_modules 指纹未变化，跳过重复 pnpm install 与 esbuild rebuild。' -ForegroundColor DarkCyan
} else {
  Write-Host '[安装] Workspace 依赖状态发生变化或本地缓存不完整，正在同步 JavaScript 依赖元数据...' -ForegroundColor Yellow
  Write-Host '[安全] 本步骤使用 --ignore-scripts，Electron Chromium Runtime 不会在这里下载。' -ForegroundColor DarkYellow
  Write-Host '[依赖] pnpm-workspace.yaml 已固定 yauzl >= 3.3.1 override；Electron Chromium Runtime 仍不会在这里下载。' -ForegroundColor DarkYellow
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install','--ignore-scripts')
  Write-Host '[安装] 正在准备 esbuild 当前平台 Native Binary...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('rebuild','esbuild')
  Set-XmaPrepareStamp -Name 'workspace-js' -Fingerprint $workspaceFingerprint
}

if (Test-XmaOpenTuiDependencies $openTuiRuntimeRoot) {
  Write-Host '[缓存] Xiaoyu Bun/OpenTUI 前端依赖版本已匹配，跳过重复 bun install。' -ForegroundColor DarkCyan
} else {
  Write-Host '[安装] 正在准备 Xiaoyu 独立 Bun/OpenTUI 前端依赖...' -ForegroundColor Yellow
  Push-Location $openTuiRuntimeRoot
  try {
    # 中文说明：OpenTUI 前端依赖由固定 Bun 独立管理，不进入 pnpm workspace lock；--no-save 避免准备环境污染源码锁文件。
    Invoke-XmaExternal -FilePath $bunExe -ArgumentList @('install','--no-save')
  } finally {
    Pop-Location
  }
}

Write-Host '[验证] 正在验证 TypeScript / Vite / tsx / tsup 工具链...' -ForegroundColor DarkCyan
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsc','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','vite','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsup','--version')
# 中文说明：esbuild 是 Vite/tsx/tsup 的内部依赖，不要求根目录暴露 `esbuild` 可执行文件。
# 使用 tsx 执行一段最小 TypeScript 来验证 esbuild Native Binary 真正可用，避免 pnpm strict linker 下 `pnpm exec esbuild` 误报找不到命令。
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','-e','const value: number = 1; if (value !== 1) process.exit(1)') -QuietCommand

if (-not (Test-XmaOpenTuiDependencies $openTuiRuntimeRoot)) {
  throw 'Xiaoyu OpenTUI 依赖准备后版本仍不完整，请重新运行 [1] 或检查网络/缓存。'
}
Write-Host "[通过] Xiaoyu TUI framework 已准备完成：OpenTUI $OpenTuiVersion + Solid $SolidJsVersion + Bun $BunVersion。" -ForegroundColor Green

if (-not (Test-Path $desktopElectronPackage)) { throw 'Desktop Electron package 元数据缺失。' }
$installedElectron = (Get-Content $desktopElectronPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($installedElectron -ne $ElectronVersion) { throw "Electron package 版本不一致：期望 $ElectronVersion，实际 $installedElectron。" }
if (-not (Test-Path $desktopTauriCmd)) { throw 'Tauri 2 CLI package 未安装完整。' }
Write-Host "[通过] Workspace JavaScript 依赖已准备完成；Electron package 锁定 $ElectronVersion，未要求下载 Chromium Runtime。" -ForegroundColor Green

Write-Host ''
Write-Host '[8/9] XMA Native Rust crates' -ForegroundColor Cyan
Write-Host '[缓存] Rust 编译/测试产物统一写入 XMA 项目 .cache\cargo-target\；仓库根不再生成 target\。' -ForegroundColor DarkGray
$cargoFingerprint = Get-XmaCargoDependencyFingerprint
$cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
if (-not $cargoCommand) { throw '未检测到 Cargo。请重新运行 [1] 的 Rust/Cargo 准备步骤。' }
$cargoHome = Get-XmaEffectiveCargoHome -CargoExecutable $cargoCommand.Source
$cargoStampReady = Test-XmaPrepareStamp -Name 'cargo-fetch' -Fingerprint $cargoFingerprint
if ($cargoStampReady) {
  Write-Host '[校验] Cargo 指纹未变化；仍验证实际 crate 缓存，防止 CARGO_HOME 移动/清理后产生假命中。' -ForegroundColor DarkCyan
} else {
  Write-Host '[校验] Cargo 配置或依赖指纹发生变化，正在离线验证当前 crate 缓存...' -ForegroundColor DarkCyan
}

if (Test-XmaCargoOfflineDependencies -ProjectRoot $Root -CargoExecutable $cargoCommand.Source) {
  Set-XmaPrepareStamp -Name 'cargo-fetch' -Fingerprint $cargoFingerprint
  Write-Host "[缓存] 当前 Rust crates 已完整并通过 offline 验证：CARGO_HOME=$cargoHome" -ForegroundColor DarkCyan
} else {
  Write-Host "[同步] 当前 CARGO_HOME 缺少 Cargo.lock 所需 crates：$cargoHome" -ForegroundColor Yellow
  Write-Host '[同步] `[1]` 是允许联网准备 Rust crates 的入口，现在开始 cargo fetch --locked...' -ForegroundColor Yellow
  Invoke-XmaExternal -FilePath $cargoCommand.Source -ArgumentList @('fetch','--locked')
  if (-not (Test-XmaCargoOfflineDependencies -ProjectRoot $Root -CargoExecutable $cargoCommand.Source)) {
    throw "Rust crates 下载后仍无法离线解析。请检查 CARGO_HOME/网络/代理：$cargoHome"
  }
  Set-XmaPrepareStamp -Name 'cargo-fetch' -Fingerprint $cargoFingerprint
  Write-Host '[验证] cargo fetch 完成后 offline 复检通过。' -ForegroundColor DarkCyan
}
Write-Host '[通过] XMA Native Rust crates 已准备完成。' -ForegroundColor Green

Write-Host ''
Write-Host '[9/9] 开发态 Xiaoyu 命令' -ForegroundColor Cyan
Write-Host '[PATH] 正在校验当前源码 checkout 的 xiaoyu/xma shim 与当前用户 PATH...' -ForegroundColor DarkCyan
Install-XmaDevelopmentCommands

Write-Host ''
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '[完成] XMA 开发环境与通用项目依赖已准备完成。' -ForegroundColor Green
Write-Host '[可直接运行] Web / Xiaoyu CLI / 全量检查不再重复安装依赖。' -ForegroundColor Cyan
Write-Host '[Rust 复用] Xiaoyu CLI / 全量检查会恢复 `[1]` 确认的 CARGO_HOME/RUSTUP_HOME，并只做 offline 构建/检查。' -ForegroundColor Cyan
Write-Host '[开发命令] 新开 PowerShell / Windows Terminal 后，可在任意 Workspace 直接输入 xiaoyu 或 xma 启动当前源码 CLI。' -ForegroundColor Cyan
Write-Host "[Desktop] Electron $ElectronVersion Chromium Runtime 仍只在你明确选择 Electron 时下载；Tauri 2 Rust crates 仍只在选择 Tauri 时预取。" -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
