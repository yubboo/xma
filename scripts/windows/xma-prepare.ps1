<#
文件作用：XMA Windows 一键开发环境准备器，一次完成系统工具与通用项目依赖准备。
关联模块：xma-console.ps1、package.json、pnpm-workspace.yaml、Cargo.toml、apps/desktop。
当前实现：检查/安装 Git、Node.js、pnpm、Bun、Rust/Cargo、MSVC；Bun/Rust 支持 ↑/↓ + Enter 或数字键选择并持久化安装位置；网络准备支持官方/镜像自动测速、停滞切换、实时进度与校验；安装 Workspace JavaScript 依赖但禁止 Desktop Runtime postinstall；准备 esbuild 与 XMA Native Rust crates；生成开发态 xiaoyu/xma 命令并自动注册到当前用户 PATH。
职责边界：Electron Chromium Runtime 只在用户明确选择 Electron Desktop/构建时下载；Tauri 2 Rust crates 只在用户明确选择 Tauri/构建时下载；开发命令只写 User PATH，不修改 Machine PATH，也不冒充正式 Release 安装。
#>

param(
  [ValidateSet('all','bun','rust')]
  [string]$Component = 'all'
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
[void](Import-XmaRustEnvironment -ProjectRoot $Root)
$ElectronVersion = '41.2.0'
$BunVersion = '1.3.14'
$BunWindowsX64Sha256 = '0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922'
$BunWindowsAarch64Sha256 = '89841f5a57f2348b67ec0839b718f4bf4ea7d07c371c9ba4b77b6c790f918953'
$OpenTuiVersion = '0.1.101'
$SolidJsVersion = '1.9.11'
$BunTypesVersion = '1.3.11'
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


function Get-XmaDownloadSourceMode {
  $mode = [string]$env:XMA_DOWNLOAD_SOURCE
  if ([string]::IsNullOrWhiteSpace($mode)) { return 'auto' }
  $normalized = $mode.Trim().ToLowerInvariant()
  if ($normalized -notin @('auto','official','mirror')) {
    Write-Host "[提示] XMA_DOWNLOAD_SOURCE=$mode 无效；使用 auto。可选：auto / official / mirror。" -ForegroundColor Yellow
    return 'auto'
  }
  return $normalized
}

function Measure-XmaDownloadProbe([string]$Url) {
  if ($null -eq $script:XmaDownloadProbeCache) { $script:XmaDownloadProbeCache = @{} }
  if ($script:XmaDownloadProbeCache.ContainsKey($Url)) { return [double]$script:XmaDownloadProbeCache[$Url] }

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) {
    $script:XmaDownloadProbeCache[$Url] = [double]::PositiveInfinity
    return [double]::PositiveInfinity
  }

  $watch = [Diagnostics.Stopwatch]::StartNew()
  $result = [double]::PositiveInfinity
  try {
    $curlTlsArgs = @()
    # Windows 自带 curl 使用 Schannel；当本机/网络无法访问证书吊销服务器时，默认会把“无法检查吊销”当成 TLS 失败。
    # best-effort 仍保留证书链验证，只在吊销服务离线时继续；Bun ZIP 之后还有固定 SHA-256 真值校验。
    if ($env:OS -eq 'Windows_NT') { $curlTlsArgs += '--ssl-revoke-best-effort' }
    & $curl.Source @curlTlsArgs '--fail' '--location' '--silent' '--show-error' '--connect-timeout' '3' '--max-time' '5' '--range' '0-0' '--output' 'NUL' $Url *> $null
    if ($LASTEXITCODE -eq 0) { $result = [math]::Round($watch.Elapsed.TotalMilliseconds) }
  } catch {
    $result = [double]::PositiveInfinity
  } finally {
    $watch.Stop()
  }
  $script:XmaDownloadProbeCache[$Url] = $result
  return $result
}

function Get-XmaOrderedDownloadSources {
  param([Parameter(Mandatory = $true)][object[]]$Sources)

  $official = @($Sources | Where-Object { $_.Kind -eq 'official' })
  $mirrors = @($Sources | Where-Object { $_.Kind -eq 'mirror' })
  $mode = Get-XmaDownloadSourceMode

  if ($mode -eq 'official') {
    Write-Host '[下载源] official · 只使用官方源。' -ForegroundColor DarkCyan
    return @($official)
  }
  if ($mode -eq 'mirror') {
    Write-Host '[下载源] mirror · 加速镜像优先，失败后回退官方源。' -ForegroundColor DarkCyan
    return @($mirrors + $official)
  }

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl -or $Sources.Count -lt 2) {
    Write-Host '[下载源] auto · 无法执行快速测速，官方源优先，失败后自动切换镜像。' -ForegroundColor DarkCyan
    return @($official + $mirrors)
  }

  $measured = @()
  foreach ($source in $Sources) {
    $probe = if ($source.ProbeUrl) { [string]$source.ProbeUrl } else { [string]$source.Url }
    $latency = Measure-XmaDownloadProbe -Url $probe
    $measured += [pscustomobject]@{ Source = $source; Latency = $latency }
  }
  $ready = @($measured | Where-Object { -not [double]::IsPositiveInfinity($_.Latency) } | Sort-Object Latency)
  $failed = @($measured | Where-Object { [double]::IsPositiveInfinity($_.Latency) })
  if ($ready.Count -eq 0) {
    Write-Host '[下载源] auto · 快速测速均失败，按官方 → 镜像顺序尝试并启用停滞切换。' -ForegroundColor DarkCyan
    return @($official + $mirrors)
  }

  $summary = @($measured | ForEach-Object {
    $latencyText = if ([double]::IsPositiveInfinity($_.Latency)) { '不可达' } else { "$([int]$_.Latency)ms" }
    "$($_.Source.Name)=$latencyText"
  }) -join ' · '
  Write-Host "[下载源] auto · $summary · 优先 $($ready[0].Source.Name)" -ForegroundColor DarkCyan
  return @($ready.Source + $failed.Source)
}

function Invoke-XmaDownloadFile {
  param(
    [Parameter(Mandatory = $true)][object[]]$Sources,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $ordered = @(Get-XmaOrderedDownloadSources -Sources $Sources)
  if ($ordered.Count -eq 0) { throw "$Label 没有可用下载源。" }
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  $lastError = ''

  foreach ($source in $ordered) {
    Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    Write-Host "[下载] $Label" -ForegroundColor Yellow
    Write-Host "[来源] $($source.Name) · $($source.Url)" -ForegroundColor DarkGray
    try {
      if ($curl) {
        # `--progress-bar` 把百分比/速度/剩余时间直接画到当前终端；连续 20 秒低于 2 KiB/s 视为停滞并自动切换下一源。
        # Windows Schannel 在吊销服务器离线时可能返回 CRYPT_E_REVOCATION_OFFLINE。best-effort 只放宽“吊销服务不可达”，
        # 不关闭 TLS 证书链验证；Bun/Rust 下载仍执行固定版本哈希校验。
        $curlTlsArgs = @()
        if ($env:OS -eq 'Windows_NT') { $curlTlsArgs += '--ssl-revoke-best-effort' }
        & $curl.Source @curlTlsArgs '--fail' '--location' '--show-error' '--progress-bar' '--connect-timeout' '10' '--speed-limit' '2048' '--speed-time' '20' '--retry' '1' '--retry-delay' '1' '--output' $Destination ([string]$source.Url)
        if ($LASTEXITCODE -ne 0) { throw "curl exit $LASTEXITCODE" }
      } else {
        Write-Host '[提示] 当前没有 curl.exe，回退 PowerShell Invoke-WebRequest；下载期间使用 PowerShell 自带进度显示。' -ForegroundColor DarkYellow
        $previousProgress = $ProgressPreference
        $ProgressPreference = 'Continue'
        try {
          Invoke-WebRequest -Uri ([string]$source.Url) -OutFile $Destination -UseBasicParsing
        } finally {
          $ProgressPreference = $previousProgress
        }
      }
      if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) { throw '下载结束但目标文件不存在。' }
      $size = (Get-Item -LiteralPath $Destination).Length
      if ($size -le 0) { throw '下载结果为空文件。' }
      Write-Host ("[完成] {0} · {1:N1} MiB · {2}" -f $Label, ($size / 1MB), $source.Name) -ForegroundColor Green
      return $source
    } catch {
      $lastError = $_.Exception.Message
      Write-Host "[切换] $($source.Name) 下载失败/停滞：$lastError" -ForegroundColor Yellow
    }
  }

  throw "$Label 下载失败；已尝试所有配置源。最后错误：$lastError"
}

function Invoke-XmaVisibleProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory = $true)][string]$Activity
  )

  $display = if ($ArgumentList.Count -gt 0) { "$FilePath $($ArgumentList -join ' ')" } else { $FilePath }
  Write-Host "> $display" -ForegroundColor DarkGray
  Write-Host "[进行中] $Activity；以下直接显示上游实时输出。" -ForegroundColor DarkCyan
  # Windows PowerShell 5.1 下，Start-Process 后自行轮询 Process.WaitForExit(timeout) 可能出现
  # 子进程已成功结束但 ExitCode 仍未稳定回填的情况，最终把成功安装误判成“failed with exit code <空>”。
  # 这里使用 Start-Process 自身的 -Wait 契约：保留 -NoNewWindow 让 Bun/rustup 直接继承当前终端，
  # 同时由 PowerShell 等待并回填稳定 ExitCode。下载文件本身仍由 curl progress-bar 提供百分比/速度。
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -NoNewWindow -Wait -PassThru
  $exitCode = $process.ExitCode
  if ($null -eq $exitCode) { throw "$FilePath 进程已结束，但 Windows PowerShell 未返回退出码。" }
  if ([int]$exitCode -ne 0) { throw "$FilePath failed with exit code $exitCode" }
}

function Get-XmaNpmRegistrySources {
  $sources = @(
    [pscustomobject]@{ Kind = 'official'; Name = 'npm 官方'; Url = 'https://registry.npmjs.org'; ProbeUrl = 'https://registry.npmjs.org/-/ping' },
    [pscustomobject]@{ Kind = 'mirror'; Name = 'npmmirror'; Url = 'https://registry.npmmirror.com'; ProbeUrl = 'https://registry.npmmirror.com/-/ping' }
  )
  return @(Get-XmaOrderedDownloadSources -Sources $sources)
}

function Get-XmaRustupSource {
  $sources = @(
    [pscustomobject]@{
      Kind = 'official'
      Name = 'Rust 官方'
      DistServer = 'https://static.rust-lang.org'
      UpdateRoot = 'https://static.rust-lang.org/rustup'
      Url = 'https://static.rust-lang.org'
      ProbeUrl = 'https://static.rust-lang.org/dist/channel-rust-stable.toml.sha256'
    },
    [pscustomobject]@{
      Kind = 'mirror'
      Name = 'RsProxy'
      DistServer = 'https://rsproxy.cn'
      UpdateRoot = 'https://rsproxy.cn/rustup'
      Url = 'https://rsproxy.cn'
      ProbeUrl = 'https://rsproxy.cn/dist/channel-rust-stable.toml.sha256'
    }
  )
  $ordered = @(Get-XmaOrderedDownloadSources -Sources $sources)
  return $ordered[0]
}

function Set-XmaRustupDownloadSource {
  $existingDist = [string]$env:RUSTUP_DIST_SERVER
  $existingUpdate = [string]$env:RUSTUP_UPDATE_ROOT
  if (-not [string]::IsNullOrWhiteSpace($existingDist) -or -not [string]::IsNullOrWhiteSpace($existingUpdate)) {
    Write-Host "[下载源] Rustup 使用用户当前环境配置：DIST=$existingDist · UPDATE=$existingUpdate" -ForegroundColor DarkCyan
    return [pscustomobject]@{ Kind = 'custom'; Name = '用户配置'; DistServer = $existingDist; UpdateRoot = $existingUpdate }
  }

  $source = Get-XmaRustupSource
  if ($source.Kind -eq 'mirror') {
    $env:RUSTUP_DIST_SERVER = $source.DistServer
    $env:RUSTUP_UPDATE_ROOT = $source.UpdateRoot
    Write-Host "[下载源] Rust stable / rustfmt 使用 RsProxy 加速；仅当前 XMA 进程生效，不写入 User/Machine 环境。" -ForegroundColor Cyan
  } else {
    Remove-Item Env:RUSTUP_DIST_SERVER -ErrorAction SilentlyContinue
    Remove-Item Env:RUSTUP_UPDATE_ROOT -ErrorAction SilentlyContinue
    Write-Host '[下载源] Rust stable / rustfmt 使用 Rust 官方源。' -ForegroundColor DarkCyan
  }
  return $source
}


function Read-XmaArrowMenuChoice {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [Parameter(Mandatory = $true)][string[]]$Items,
    [int]$DefaultChoice = 1
  )
  if ($Items.Count -lt 1) { throw '菜单至少需要一个选项。' }
  if ($DefaultChoice -lt 1 -or $DefaultChoice -gt $Items.Count) { $DefaultChoice = 1 }

  # 中文说明：安装位置菜单必须只有一份 `[1]/[2]/[3]` 选项。Windows Terminal / ConsoleHost 下由 RawUI
  # 直接接管 ↑/↓/Enter/数字键；旧 Read-Host 只能作为不支持 RawUI 的 fallback，绝不能与动态菜单重复打印。
  $interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
  $renderedInteractiveMenu = $false
  if ($interactive) {
    try {
      $rawUi = $Host.UI.RawUI
      if ($null -eq $rawUi) { throw '当前 PowerShell Host 不提供 RawUI。' }
      $selected = $DefaultChoice

      # 先顺序输出一次完整菜单。这样即使后续 ReadKey 不受 Host 支持，fallback 也只补输入提示，不再复制三行选项。
      for ($index = 0; $index -lt $Items.Count; $index++) {
        $number = $index + 1
        $prefix = if ($number -eq $selected) { '  > ' } else { '    ' }
        $line = "$prefix[$number] $($Items[$index])"
        if ($number -eq $selected) { Write-Host $line -ForegroundColor Green }
        else { Write-Host $line -ForegroundColor Gray }
      }
      Write-Host '    ↑/↓ 移动 · Enter 确认 · 数字键 1/2/3 直达' -ForegroundColor DarkGray
      $renderedInteractiveMenu = $true

      # 以已经完成输出后的真实 CursorPosition 反推菜单起点，避免窗口接近底部滚动后 menuTop 失真。
      $resumePosition = $rawUi.CursorPosition
      $menuTop = $resumePosition.Y - ($Items.Count + 1)

      while ($true) {
        $key = $rawUi.ReadKey('NoEcho,IncludeKeyDown')
        $next = $selected
        $confirm = $false

        if ($key.VirtualKeyCode -eq 38) { # VK_UP
          $next = if ($selected -le 1) { $Items.Count } else { $selected - 1 }
        } elseif ($key.VirtualKeyCode -eq 40) { # VK_DOWN
          $next = if ($selected -ge $Items.Count) { 1 } else { $selected + 1 }
        } elseif ($key.VirtualKeyCode -eq 13) { # VK_RETURN
          $confirm = $true
        } else {
          $digitText = [string]$key.Character
          if ($digitText -match '^\d$') {
            $digit = [int]$digitText
            if ($digit -ge 1 -and $digit -le $Items.Count) {
              $next = $digit
              $confirm = $true
            }
          }
        }

        if ($next -ne $selected) {
          $selected = $next
          # 只重绘三条真实选项行；不额外创建“当前选择”行，也不重复输出静态菜单。
          for ($index = 0; $index -lt $Items.Count; $index++) {
            $position = $rawUi.CursorPosition
            $position.X = 0
            $position.Y = $menuTop + $index
            $rawUi.CursorPosition = $position
            $number = $index + 1
            $prefix = if ($number -eq $selected) { '  > ' } else { '    ' }
            $line = "$prefix[$number] $($Items[$index])"
            if ($number -eq $selected) { Write-Host $line -NoNewline -ForegroundColor Green }
            else { Write-Host $line -NoNewline -ForegroundColor Gray }
          }
          $rawUi.CursorPosition = $resumePosition
        }

        if ($confirm) {
          $rawUi.CursorPosition = $resumePosition
          return [string]$selected
        }
      }
    } catch {
      # RawUI 不可用时退回数字输入。若三行动态菜单已经完整显示，只补一个输入提示，绝不再次打印选项。
      try { if ($renderedInteractiveMenu) { Write-Host '[兼容] 当前终端不支持方向键菜单，请输入数字选择。' -ForegroundColor DarkGray } } catch {}
    }
  }

  if (-not $renderedInteractiveMenu) {
    for ($index = 0; $index -lt $Items.Count; $index++) {
      Write-Host ("    [{0}] {1}" -f ($index + 1), $Items[$index]) -ForegroundColor Gray
    }
  }
  while ($true) {
    $fallback = (Read-Host "$Prompt [$DefaultChoice]").Trim()
    if ([string]::IsNullOrWhiteSpace($fallback)) { return [string]$DefaultChoice }
    if ($fallback -match '^\d+$') {
      $numeric = [int]$fallback
      if ($numeric -ge 1 -and $numeric -le $Items.Count) { return [string]$numeric }
    }
    Write-Host ("请输入 1-{0}。" -f $Items.Count) -ForegroundColor Yellow
  }
}

function Select-XmaDependencyRoot([string]$ComponentLabel) {
  $defaultRoot = Get-XmaLocalPathRoot -ProjectRoot $Root
  $driveDRoot = 'D:\xma-path'

  while ($true) {
    Write-Host ''
    Write-Host "[$ComponentLabel 安装位置] 请选择 XMA 依赖根目录：" -ForegroundColor Cyan
    $choice = Read-XmaArrowMenuChoice -Prompt '请选择' -Items @(
      "跟随当前项目（推荐）  $defaultRoot",
      "D 盘                    $driveDRoot",
      '自定义盘符              输入 E / F / G 等真实盘符'
    ) -DefaultChoice 1

    if ($choice -eq '1') {
      if (-not (Test-XmaWritableDirectory $defaultRoot)) { Write-Host '[不可用] 当前项目目录不可写，请选择其他位置。' -ForegroundColor Yellow; continue }
      return $defaultRoot
    }
    if ($choice -eq '2') {
      if (-not (Test-Path -LiteralPath 'D:\' -PathType Container)) {
        Write-Host '[不可用] 当前电脑没有 D: 盘，请选择 [1] 或 [3]。' -ForegroundColor Yellow
        continue
      }
      if (-not (Test-XmaWritableDirectory $driveDRoot)) { Write-Host '[不可用] D 盘 xma-path 不可写，请选择其他位置。' -ForegroundColor Yellow; continue }
      return $driveDRoot
    }
    if ($choice -eq '3') {
      $rawDrive = (Read-Host '请输入真实盘符，例如 E').Trim().Trim('"')
      if ($rawDrive -notmatch '^[A-Za-z](?::)?(?:\\)?$') {
        Write-Host '[提示] 这里只需要输入盘符，例如 E 或 E:。' -ForegroundColor Yellow
        continue
      }
      $driveLetter = $rawDrive.Substring(0,1).ToUpperInvariant()
      $driveRoot = "${driveLetter}:\\"
      if (-not (Test-Path -LiteralPath $driveRoot -PathType Container)) {
        Write-Host "[不可用] 没有检测到 $driveRoot，请输入这台电脑真实存在的盘符。" -ForegroundColor Yellow
        continue
      }
      $customRoot = Join-Path $driveRoot 'xma-path'
      if (-not (Test-XmaWritableDirectory $customRoot)) { Write-Host "[不可用] $customRoot 不可写，请重新选择。" -ForegroundColor Yellow; continue }
      return $customRoot
    }
    Write-Host '请输入 1、2 或 3。' -ForegroundColor Yellow
  }
}

function Test-XmaBunExecutable([string]$Executable) {
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
  $probe = Invoke-XmaProbe -FilePath $Executable -ArgumentList @('--version')
  return ($probe.ExitCode -eq 0) -and (($probe.Output -join ' ').Trim() -eq $BunVersion)
}

function Save-XmaBunHome([string]$BunHome) {
  $normalized = [IO.Path]::GetFullPath($BunHome)
  $env:XMA_BUN_HOME = $normalized
  Save-XmaBunEnvironmentState -ProjectRoot $Root -BunHome $normalized -Version $BunVersion
  # 中文说明：0.1.0 早期曾把 Bun Home 写入 User 环境。现在 checkout 自己的 `.git/xma-state`（非 Git 树为 `.cache/xma-state`）才是权威，
  # 避免移动 U 盘/切换仓库后旧绝对路径继续污染新终端。
  [Environment]::SetEnvironmentVariable('XMA_BUN_HOME', $null, 'User')
}

function Move-XmaLegacyBunToProjectDefault {
  $legacyExe = Join-Path $Root ".xma\tools\bun\$BunVersion\bun.exe"
  if (-not (Test-XmaBunExecutable $legacyExe)) { return $null }

  $bunHome = Get-XmaDefaultBunHome -ProjectRoot $Root
  $targetRoot = Join-Path $bunHome $BunVersion
  $bunExe = Join-Path $targetRoot 'bun.exe'
  New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
  Write-Host "[迁移] 检测到旧版项目内 Bun $BunVersion；正在迁移到 $bunHome，不重复下载。" -ForegroundColor Yellow
  Copy-Item -LiteralPath $legacyExe -Destination $bunExe -Force
  if (-not (Test-XmaBunExecutable $bunExe)) { throw "旧 Bun 迁移后校验失败：$bunExe" }
  Save-XmaBunHome -BunHome $bunHome
  Remove-Item -LiteralPath (Join-Path $Root '.xma\tools\bun') -Recurse -Force -ErrorAction SilentlyContinue
  return [pscustomobject]@{ BunHome = $bunHome; BunExe = $bunExe; Version = $BunVersion; Source = 'legacy-checkout-migration' }
}

function Install-XmaBunRuntime([switch]$PromptIfMissing) {
  # 先恢复已经配置的 Runtime；只要真实 `bun.exe --version` 通过，就绝不重复安装。
  $existing = Import-XmaBunEnvironment -ProjectRoot $Root -ExpectedVersion $BunVersion -DiscoverExternal
  if ($existing) {
    # 旧 state/User env 可能仍把 Bun 指回当前 checkout 的 `.xma/tools/bun`。即使真实可执行，也必须先迁移，不能把旧目录重新保存成 external Home。
    $legacyBunHome = [IO.Path]::GetFullPath((Join-Path $Root '.xma\tools\bun'))
    $existingHome = [IO.Path]::GetFullPath($existing.BunHome)
    if ($existingHome -ieq $legacyBunHome) {
      $migratedExisting = Move-XmaLegacyBunToProjectDefault
      if (-not $migratedExisting) { throw '检测到旧 .xma Bun 状态，但迁移校验失败。' }
      Write-Host "[通过] Bun $BunVersion 已从旧 .xma 自动迁移到项目 xma-path。" -ForegroundColor Green
      return $migratedExisting.BunExe
    }

    Save-XmaBunHome -BunHome $existing.BunHome
    Remove-Item -LiteralPath (Join-Path $Root '.cache\bun') -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[缓存] Bun $($existing.Version) 已安装并通过真实校验，跳过重复安装。" -ForegroundColor DarkCyan
    Write-Host "[位置] $($existing.BunHome)" -ForegroundColor DarkGray
    Write-Host "[运行时] $($existing.BunExe)" -ForegroundColor DarkGray
    return $existing.BunExe
  }

  # 旧 `.xma/tools/bun` 是 0.1.0 早期设计。存在时自动迁移到项目默认 xma-path，不让用户再次选位置/下载。
  $migrated = Move-XmaLegacyBunToProjectDefault
  if ($migrated) {
    Write-Host "[通过] Bun $BunVersion 已迁移到项目 xma-path。" -ForegroundColor Green
    return $migrated.BunExe
  }

  if ($PromptIfMissing) {
    Write-Host '[缺少] 当前没有可用 Bun/OpenTUI Runtime。' -ForegroundColor Yellow
    if (-not (Confirm-XmaAction "是否安装 Bun $BunVersion / OpenTUI Runtime？选择 N 会跳过，可稍后在主菜单 [8] 单独安装。")) {
      Write-Host '[跳过] Bun/OpenTUI Runtime 未安装；Web/Desktop 的通用 JS 依赖仍会继续准备。' -ForegroundColor Yellow
      return $null
    }
  }

  $dependencyRoot = Select-XmaDependencyRoot -ComponentLabel 'Bun / OpenTUI Runtime'
  $bunHome = Join-Path $dependencyRoot 'bun'
  $targetRoot = Join-Path $bunHome $BunVersion
  $bunExe = Join-Path $targetRoot 'bun.exe'
  New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

  if (Test-XmaBunExecutable $bunExe) {
    Write-Host "[发现] 目标位置已经存在可用 Bun $BunVersion，直接接管，不重复下载。" -ForegroundColor DarkCyan
  } else {
    $cacheRoot = Join-Path $Root '.cache\bun'
    $arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    $assetArch = if ($arch -eq 'arm64') { 'aarch64' } else { 'x64' }
    $assetName = "bun-windows-$assetArch.zip"
    $zip = Join-Path $cacheRoot "bun-windows-$assetArch-$BunVersion.zip"
    $expectedBunSha256 = if ($assetArch -eq 'aarch64') { $BunWindowsAarch64Sha256 } else { $BunWindowsX64Sha256 }
    $extract = Join-Path $cacheRoot "extract-$BunVersion-$assetArch"
    New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }

    $bunSources = @(
      [pscustomobject]@{
        Kind = 'official'
        Name = 'Bun GitHub 官方'
        Url = "https://github.com/oven-sh/bun/releases/download/bun-v$BunVersion/$assetName"
        ProbeUrl = "https://github.com/oven-sh/bun/releases/download/bun-v$BunVersion/$assetName"
      },
      [pscustomobject]@{
        Kind = 'mirror'
        Name = 'SourceForge Bun 镜像'
        Url = "https://sourceforge.net/projects/bun.mirror/files/bun-v$BunVersion/$assetName/download"
        ProbeUrl = "https://sourceforge.net/projects/bun.mirror/files/bun-v$BunVersion/$assetName/download"
      }
    )
    Write-Host "[下载] 正在准备固定 Bun $BunVersion（Xiaoyu OpenTUI Runtime）..." -ForegroundColor Yellow
    Write-Host "[依赖根] $dependencyRoot" -ForegroundColor Cyan
    Write-Host "[安装位置] $bunHome" -ForegroundColor Cyan
    try {
      [void](Invoke-XmaDownloadFile -Sources $bunSources -Destination $zip -Label "Bun $BunVersion Windows $assetArch")

      # 固定版本的官方 GitHub Release asset digest 是源码真值，不再为校验额外下载 SHASUMS256.txt。
      # 这样 GitHub/SourceForge 的校验清单端点被重置、CRL 服务离线时，也不会让首次 clone 的 `[1]` 在 ZIP 下载前就失败。
      $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($expectedBunSha256 -ne $actual) { throw "Bun ZIP SHA-256 校验失败：期望 $expectedBunSha256，实际 $actual。" }
      Write-Host "[验证] Bun ZIP SHA-256 校验通过：$assetName" -ForegroundColor DarkCyan

      Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
      $downloaded = Get-ChildItem -Path $extract -Filter 'bun.exe' -File -Recurse | Select-Object -First 1
      if (-not $downloaded) { throw 'Bun ZIP 已下载，但没有找到 bun.exe。' }
      Copy-Item -LiteralPath $downloaded.FullName -Destination $bunExe -Force
    } finally {
      Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  if (-not (Test-XmaBunExecutable $bunExe)) { throw "Bun $BunVersion 安装后真实执行校验失败：$bunExe" }
  Save-XmaBunHome -BunHome $bunHome
  Remove-Item -LiteralPath (Join-Path $Root '.cache\bun') -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "[通过] Bun $BunVersion · Xiaoyu OpenTUI Runtime" -ForegroundColor Green
  Write-Host "[位置] $bunHome" -ForegroundColor DarkGray
  Write-Host "[运行时] $bunExe" -ForegroundColor DarkGray
  return $bunExe
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

function Set-XmaRustHomes([string]$InstallRoot) {
  $rustupHome = Join-Path $InstallRoot 'rustup'
  $cargoHome = Join-Path $InstallRoot 'cargo'
  New-Item -ItemType Directory -Force -Path $rustupHome | Out-Null
  New-Item -ItemType Directory -Force -Path $cargoHome | Out-Null
  $env:RUSTUP_HOME = $rustupHome
  $env:CARGO_HOME = $cargoHome
  $cargoBin = Join-Path $cargoHome 'bin'
  Add-XmaProcessPathFront -Directory $cargoBin
  return [pscustomobject]@{ Root = $InstallRoot; RustupHome = $rustupHome; CargoHome = $cargoHome; CargoBin = $cargoBin }
}

function Install-XmaRustStable {
  $dependencyRoot = Select-XmaDependencyRoot -ComponentLabel 'Rust / Cargo'
  $installRoot = Join-Path $dependencyRoot 'rust'
  $homes = Set-XmaRustHomes $installRoot
  $cargoExe = Join-Path $homes.CargoBin 'cargo.exe'
  $rustcExe = Join-Path $homes.CargoBin 'rustc.exe'
  $rustupExe = Join-Path $homes.CargoBin 'rustup.exe'
  $rustupSource = Set-XmaRustupDownloadSource

  Write-Host "[依赖根] $dependencyRoot" -ForegroundColor Cyan
  Write-Host "[安装位置] $installRoot" -ForegroundColor Cyan

  # 中文说明：用户可能在同一 D:/自定义依赖根中留下了可用或半完成的 Rust。先真实探针；完整则直接接管，
  # 只有 rustup shim 存在但 toolchain 不完整时，用该 rustup 修复 stable，不重新跑 rustup-init 触发“already installed”警告。
  $existingCargo = Invoke-XmaProbe -FilePath $cargoExe -ArgumentList @('--version')
  $existingRustc = Invoke-XmaProbe -FilePath $rustcExe -ArgumentList @('--version')
  if ($existingCargo.ExitCode -eq 0 -and $existingRustc.ExitCode -eq 0) {
    Save-XmaRustEnvironmentState -ProjectRoot $Root -CargoHome $homes.CargoHome -RustupHome $homes.RustupHome
    Write-Host '[发现] 目标位置已有可实际运行的 Rust/Cargo，直接接管，不重复安装。' -ForegroundColor DarkCyan
    return (Import-XmaRustEnvironment -ProjectRoot $Root)
  }

  if (Test-Path -LiteralPath $rustupExe -PathType Leaf) {
    Write-Host '[修复] 目标位置已有 rustup，但 stable toolchain 尚未完整；正在复用现有 rustup 修复，不重复下载 rustup-init。' -ForegroundColor Yellow
    Invoke-XmaVisibleProcess -FilePath $rustupExe -ArgumentList @('toolchain','install','stable','--profile','minimal') -Activity 'Rust stable toolchain 下载/安装'
    Invoke-XmaVisibleProcess -FilePath $rustupExe -ArgumentList @('default','stable') -Activity 'Rust stable 设置'
    Save-XmaRustEnvironmentState -ProjectRoot $Root -CargoHome $homes.CargoHome -RustupHome $homes.RustupHome
    $repaired = Import-XmaRustEnvironment -ProjectRoot $Root
    if ($repaired) {
      $cargoProbe = Invoke-XmaProbe -FilePath $repaired.CargoExe -ArgumentList @('--version')
      $rustcProbe = Invoke-XmaProbe -FilePath $repaired.RustcExe -ArgumentList @('--version')
      if ($cargoProbe.ExitCode -eq 0 -and $rustcProbe.ExitCode -eq 0) {
        Write-Host '[完成] 现有 rustup 已修复 stable toolchain。' -ForegroundColor Green
        return $repaired
      }
    }
    throw "现有 rustup 修复 stable 后仍不可用：$installRoot"
  }

  $arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  $triple = if ($arch -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
  $cacheRoot = Join-Path $Root '.cache\rustup'
  $installer = Join-Path $cacheRoot "rustup-init-$triple.exe"
  $checksumFile = "$installer.sha256"
  New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

  $rustupInitSources = @(
    [pscustomobject]@{
      Kind = 'official'
      Name = 'Rust 官方'
      Url = "https://static.rust-lang.org/rustup/dist/$triple/rustup-init.exe"
      ProbeUrl = 'https://static.rust-lang.org/dist/channel-rust-stable.toml.sha256'
    },
    [pscustomobject]@{
      Kind = 'mirror'
      Name = 'RsProxy'
      Url = "https://rsproxy.cn/rustup/dist/$triple/rustup-init.exe"
      ProbeUrl = 'https://rsproxy.cn/dist/channel-rust-stable.toml.sha256'
    }
  )
  $rustupChecksumSources = @(
    [pscustomobject]@{
      Kind = 'official'
      Name = 'Rust 官方校验'
      Url = "https://static.rust-lang.org/rustup/dist/$triple/rustup-init.exe.sha256"
      ProbeUrl = 'https://static.rust-lang.org/dist/channel-rust-stable.toml.sha256'
    },
    [pscustomobject]@{
      Kind = 'mirror'
      Name = 'RsProxy 校验'
      Url = "https://rsproxy.cn/rustup/dist/$triple/rustup-init.exe.sha256"
      ProbeUrl = 'https://rsproxy.cn/dist/channel-rust-stable.toml.sha256'
    }
  )

  try {
    [void](Invoke-XmaDownloadFile -Sources $rustupChecksumSources -Destination $checksumFile -Label "rustup-init $triple SHA-256")
    $downloadedFrom = Invoke-XmaDownloadFile -Sources $rustupInitSources -Destination $installer -Label "Rust rustup-init $triple"
    $expected = ((Get-Content -LiteralPath $checksumFile -Raw -Encoding ASCII).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw 'rustup-init SHA-256 校验失败，已拒绝执行。' }
    Write-Host '[验证] rustup-init SHA-256 校验通过。' -ForegroundColor DarkCyan

    # 如果二进制实际从镜像回退成功，而当前没有用户自定义 rustup 源，让后续 stable/rustfmt 继续沿用同一加速源。
    if ($downloadedFrom.Kind -eq 'mirror' -and $rustupSource.Kind -ne 'custom') {
      $env:RUSTUP_DIST_SERVER = 'https://rsproxy.cn'
      $env:RUSTUP_UPDATE_ROOT = 'https://rsproxy.cn/rustup'
      Write-Host '[下载源] rustup-init 已切换 RsProxy；stable/rustfmt 继续复用该加速源。' -ForegroundColor Cyan
    }

    # 当前 PATH 可能还包含旧 Rust shim；XMA 已经显式隔离 CARGO_HOME/RUSTUP_HOME，因此让 rustup-init 跳过 PATH 冲突检查，避免误报“Rust is installed”。
    $previousSkipPathCheck = $env:RUSTUP_INIT_SKIP_PATH_CHECK
    $env:RUSTUP_INIT_SKIP_PATH_CHECK = 'yes'
    try {
      Invoke-XmaVisibleProcess -FilePath $installer -ArgumentList @('-y','--profile','minimal','--default-toolchain','stable','--no-modify-path') -Activity 'Rust stable toolchain 下载/安装'
    } finally {
      if ($null -eq $previousSkipPathCheck) { Remove-Item Env:RUSTUP_INIT_SKIP_PATH_CHECK -ErrorAction SilentlyContinue }
      else { $env:RUSTUP_INIT_SKIP_PATH_CHECK = $previousSkipPathCheck }
    }
  } finally {
    Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $checksumFile -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path -LiteralPath $rustupExe -PathType Leaf)) { throw "Rust 安装完成但未找到 rustup：$rustupExe" }
  Save-XmaRustEnvironmentState -ProjectRoot $Root -CargoHome $homes.CargoHome -RustupHome $homes.RustupHome
  # 不使用 `rustup override set stable`：override 会绑定当前 checkout 绝对路径，不适合 U 盘换盘符/项目移动。
  Write-Host "[完成] Rust stable 已安装：$installRoot" -ForegroundColor Green
  return (Import-XmaRustEnvironment -ProjectRoot $Root)
}

function Ensure-XmaRustToolchain([switch]$PromptIfMissing) {
  $runtime = Import-XmaRustEnvironment -ProjectRoot $Root -DiscoverExternal
  $rustReady = $false
  if ($runtime) {
    $rustProbe = Invoke-XmaProbe -FilePath $runtime.RustcExe -ArgumentList @('--version')
    $cargoProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('--version')
    $rustReady = ($rustProbe.ExitCode -eq 0) -and ($cargoProbe.ExitCode -eq 0)
  }

  # 兼容用户电脑上已经存在但尚未写入 checkout 本地状态的 Rust。只要真实探针通过，就接管并保存位置，不重复安装。
  if (-not $rustReady) {
    $rustcCommand = Get-Command rustc.exe -ErrorAction SilentlyContinue
    $cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
    if ($rustcCommand -and $cargoCommand) {
      $rustProbe = Invoke-XmaProbe -FilePath $rustcCommand.Source -ArgumentList @('--version')
      $cargoProbe = Invoke-XmaProbe -FilePath $cargoCommand.Source -ArgumentList @('--version')
      if ($rustProbe.ExitCode -eq 0 -and $cargoProbe.ExitCode -eq 0) {
        $cargoHome = Get-XmaEffectiveCargoHome -CargoExecutable $cargoCommand.Source
        $rustupHome = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { [Environment]::GetEnvironmentVariable('RUSTUP_HOME','User') }
        $stateFile = Get-XmaRustEnvironmentStatePath -ProjectRoot $Root
        $hadProjectState = Test-Path -LiteralPath $stateFile -PathType Leaf
        Save-XmaRustEnvironmentState -ProjectRoot $Root -CargoHome $cargoHome -RustupHome $rustupHome
        $runtime = Import-XmaRustEnvironment -ProjectRoot $Root
        $rustReady = $null -ne $runtime
        if ($rustReady -and -not $hadProjectState) {
          Write-Host "[恢复] 当前 checkout 状态不存在，但检测到可真实运行的外部 Rust/Cargo；已重新接管，不重复安装：$cargoHome" -ForegroundColor DarkCyan
        }
      }
    }
  }

  if (-not $rustReady) {
    if ($PromptIfMissing) {
      Write-Host '[缺少] 当前没有可实际运行的 Rust stable / Cargo。' -ForegroundColor Yellow
      if (-not (Confirm-XmaAction '是否安装 Rust / Cargo？选择 N 会跳过，可稍后在主菜单 [9] 单独安装。')) {
        Write-Host '[跳过] Rust/Cargo 未安装；与 Rust 无关的 JavaScript 环境会继续准备。' -ForegroundColor Yellow
        return $null
      }
    }
    $runtime = Install-XmaRustStable
    if (-not $runtime) { throw 'Rust 安装完成后仍无法恢复运行环境。' }
  }

  $rustProbe = Invoke-XmaProbe -FilePath $runtime.RustcExe -ArgumentList @('--version')
  $cargoProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('--version')
  if ($rustProbe.ExitCode -ne 0) { throw "rustc toolchain 仍不可用：$($rustProbe.Output -join ' ')" }
  if ($cargoProbe.ExitCode -ne 0) { throw "cargo toolchain 仍不可用：$($cargoProbe.Output -join ' ')" }
  Save-XmaRustEnvironmentState -ProjectRoot $Root -CargoHome $runtime.CargoHome -RustupHome $runtime.RustupHome
  Write-Host "[通过] $((($rustProbe.Output -join ' ').Trim()))" -ForegroundColor Green
  Write-Host "[通过] $((($cargoProbe.Output -join ' ').Trim()))" -ForegroundColor Green

  $rustupExe = Join-Path (Join-Path $runtime.CargoHome 'bin') 'rustup.exe'
  $rustfmtProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('fmt','--version')
  if ($rustfmtProbe.ExitCode -ne 0) {
    if (-not (Test-Path -LiteralPath $rustupExe -PathType Leaf)) { throw 'Rust stable 已可用，但缺少 rustfmt/cargo-fmt，且当前 Rust Home 没有 rustup.exe。' }
    Write-Host '[缺少] 未检测到 rustfmt；正在为当前 XMA Rust Home 安装 rustfmt 组件...' -ForegroundColor Yellow
    [void](Set-XmaRustupDownloadSource)
    Invoke-XmaVisibleProcess -FilePath $rustupExe -ArgumentList @('component','add','rustfmt','--toolchain','stable') -Activity 'Rust rustfmt 组件下载/安装'
    $rustfmtProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('fmt','--version')
    if ($rustfmtProbe.ExitCode -ne 0) { throw "rustfmt 安装后仍不可用：$($rustfmtProbe.Output -join ' ')" }
  }
  Write-Host "[通过] $((($rustfmtProbe.Output -join ' ').Trim()))" -ForegroundColor Green
  Write-Host "[位置] RUSTUP_HOME=$($runtime.RustupHome) · CARGO_HOME=$($runtime.CargoHome)" -ForegroundColor DarkGray
  return $runtime
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

  Write-Host '[缺少] 未检测到 Visual Studio C++ Build Tools（Rust MSVC 链接器需要）。' -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否自动安装 Visual Studio 2022 Build Tools + C++ Toolchain？')) {
    throw 'Windows Rust Native 构建需要 MSVC C++ Build Tools。可稍后在主菜单 [9] 重新准备 Rust/Cargo。'
  }
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
  # 开发 shim 属于 checkout 控制状态，不属于 Bun/Rust 依赖实体。放到 `.git/xma-state/dev-bin`（非 Git 树回退 `.cache/xma-state/dev-bin`），
  # 这样用户选择 D:/其他盘符安装依赖时，项目根不会仅为了 state/dev-bin 再生成一个空壳 xma-path。
  $devBin = Join-Path (Get-XmaStateRoot -ProjectRoot $Root) 'dev-bin'
  New-Item -ItemType Directory -Force -Path $devBin | Out-Null
  $launcher = @'
@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "XMA_DEV_ROOT="
if exist "%~dp0source-root.txt" set /p "XMA_DEV_ROOT="<"%~dp0source-root.txt"
if not defined XMA_DEV_ROOT (
  echo [ERROR] XMA development shim lost source-root.txt. Run xma-dev.bat ^> [1] again.
  exit /b 1
)
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
    # 同一用户只激活一个 XMA checkout；同时清掉旧 `.xma/dev-bin`、`xma-path/dev-bin` 与旧 checkout 的 `.git/.cache xma-state/dev-bin`。
    if ($normalized -match '(?i)[\\/]\.xma[\\/]dev-bin$') { continue }
    if ($normalized -match '(?i)[\\/]xma-path[\\/]dev-bin$') { continue }
    $nextUserEntries += $entry
  }
  $nextUserPath = ($nextUserEntries -join ';')
  $pathChanged = $currentUserPath -ne $nextUserPath
  if ($pathChanged) { [Environment]::SetEnvironmentVariable('Path', $nextUserPath, 'User') }

  $processEntries = @(Get-XmaPathEntries $env:Path)
  if (-not ($processEntries | Where-Object { (Get-XmaNormalizedPath $_) -ieq $normalizedDevBin })) { $env:Path = "$devBin;$env:Path" }
  if ($pathChanged -or $shimChanged) { Write-Host '[更新] 开发态 xiaoyu / xma shim 或 User PATH 已同步。' -ForegroundColor Green }
  else { Write-Host '[缓存] 开发态 xiaoyu / xma shim 与 User PATH 已匹配，跳过重复写入。' -ForegroundColor DarkCyan }
  Write-Host "[位置] $devBin" -ForegroundColor DarkGray
  Write-Host '[说明] 移动/重命名仓库后重新运行 xma-dev.bat → [1] 即可刷新。' -ForegroundColor DarkGray
}

function Remove-XmaLegacyProjectControlState {
  # 0.1.0 早期把状态与开发 shim 放进项目根 `xma-path/state|dev-bin`。新版控制状态已经进入 checkout 本地 Git 元数据，
  # 因此外部依赖（例如 D:\xma-path）时不应在源码根留下第二个 xma-path。先迁移 Source Sync 状态，再安全清理旧控制目录。
  $legacyPathRoot = Get-XmaLocalPathRoot -ProjectRoot $Root
  $legacyStateRoot = Join-Path $legacyPathRoot 'state'
  $stateRoot = Get-XmaStateRoot -ProjectRoot $Root
  foreach ($name in @('source-sync.json','source-sync-last.txt')) {
    $old = Join-Path $legacyStateRoot $name
    $next = Join-Path $stateRoot $name
    if ((Test-Path -LiteralPath $old -PathType Leaf) -and -not (Test-Path -LiteralPath $next -PathType Leaf)) {
      New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
      Copy-Item -LiteralPath $old -Destination $next -Force
    }
  }
  foreach ($oldControl in @((Join-Path $legacyPathRoot 'state'), (Join-Path $legacyPathRoot 'dev-bin'))) {
    if (Test-Path -LiteralPath $oldControl) { Remove-XmaDirectoryEntry -Path $oldControl }
  }
  if (Test-Path -LiteralPath $legacyPathRoot -PathType Container) {
    $children = @(Get-ChildItem -LiteralPath $legacyPathRoot -Force -ErrorAction SilentlyContinue)
    if ($children.Count -eq 0) {
      Remove-Item -LiteralPath $legacyPathRoot -Force -ErrorAction SilentlyContinue
      Write-Host '[清理] 项目根旧 xma-path 仅包含控制状态，已移除；外部依赖位置保持不变。' -ForegroundColor DarkYellow
    }
  }
}

function Remove-XmaLegacyLocalDirectory {
  $legacyRoot = Join-Path $Root '.xma'
  if (-not (Test-Path -LiteralPath $legacyRoot -PathType Container)) { return }
  # Source Sync 旧状态由 XMA-Sync.bat 自己迁移，准备器只清理开发环境旧目录，避免误删维护者同步记录。
  foreach ($legacy in @(
    (Join-Path $legacyRoot 'tools'),
    (Join-Path $legacyRoot 'dev-bin'),
    (Join-Path $legacyRoot 'state\prepare'),
    (Join-Path $legacyRoot 'state\bun-environment.json'),
    (Join-Path $legacyRoot 'state\rust-environment.json')
  )) { Remove-Item -LiteralPath $legacy -Recurse -Force -ErrorAction SilentlyContinue }
  try {
    $children = @(Get-ChildItem -LiteralPath $legacyRoot -Force -ErrorAction SilentlyContinue)
    if ($children.Count -eq 0) { Remove-Item -LiteralPath $legacyRoot -Force -ErrorAction SilentlyContinue }
  } catch {}
}

function Ensure-XmaOpenTuiDependencies([string]$BunExecutable) {
  $sourceRuntimeRoot = Join-Path $Root 'apps\cli\opentui-runtime'
  $bunVersionDir = Split-Path -Parent ([IO.Path]::GetFullPath($BunExecutable))
  $bunHome = Split-Path -Parent $bunVersionDir
  $openTuiHome = Get-XmaOpenTuiHomeFromBunHome -BunHome $bunHome
  $targetNodeModules = Join-Path $openTuiHome 'node_modules'
  $sourceNodeModules = Join-Path $sourceRuntimeRoot 'node_modules'
  $sourcePackage = Join-Path $sourceRuntimeRoot 'package.json'
  $sourceBunfig = Join-Path $sourceRuntimeRoot 'bunfig.toml'

  New-Item -ItemType Directory -Force -Path $openTuiHome | Out-Null
  # 依赖实体目录保留固定 package/bunfig 元数据，便于后续版本校验和独立补装；源码仍是 canonical source。
  Copy-Item -LiteralPath $sourcePackage -Destination (Join-Path $openTuiHome 'package.json') -Force
  if (Test-Path -LiteralPath $sourceBunfig -PathType Leaf) { Copy-Item -LiteralPath $sourceBunfig -Destination (Join-Path $openTuiHome 'bunfig.toml') -Force }

  if (-not (Test-XmaOpenTuiDependencies $openTuiHome)) {
    # 0.1.0 早期把 OpenTUI dependency island 实体放在源码目录 node_modules；如果它已经完整，先复制到新的 xma-path，避免重复联网安装。
    $sourceItem = Get-Item -LiteralPath $sourceNodeModules -Force -ErrorAction SilentlyContinue
    $sourceIsPhysical = $sourceItem -and (($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)
    if ($sourceIsPhysical -and (Test-XmaOpenTuiDependencies $sourceRuntimeRoot)) {
      Write-Host "[迁移] 检测到旧版 OpenTUI 本地依赖；正在迁移到 $openTuiHome，不重复下载。" -ForegroundColor Yellow
      if (Test-Path -LiteralPath $targetNodeModules -PathType Container) { Remove-Item -LiteralPath $targetNodeModules -Recurse -Force }
      Copy-Item -LiteralPath $sourceNodeModules -Destination $targetNodeModules -Recurse -Force
    }
  }

  if (-not (Test-XmaOpenTuiDependencies $openTuiHome)) {
    Write-Host '[安装] 正在准备 Xiaoyu 独立 Bun/OpenTUI 前端依赖...' -ForegroundColor Yellow
    Write-Host "[安装位置] $openTuiHome" -ForegroundColor Cyan
    $registrySources = @(Get-XmaNpmRegistrySources)
    $previousRegistry = $env:BUN_CONFIG_REGISTRY
    $installed = $false
    $lastRegistryError = ''
    Push-Location $openTuiHome
    try {
      foreach ($registrySource in $registrySources) {
        $env:BUN_CONFIG_REGISTRY = [string]$registrySource.Url
        Write-Host "[下载源] OpenTUI npm registry：$($registrySource.Name) · $($registrySource.Url)" -ForegroundColor DarkCyan
        try {
          # Start-Process -NoNewWindow -Wait 让 Bun 继承真实终端并由 PowerShell 稳定等待退出；保留上游实时输出，同时可靠读取退出码。
          Invoke-XmaVisibleProcess -FilePath $BunExecutable -ArgumentList @('install','--no-save') -Activity 'Bun / OpenTUI 依赖下载'
          $installed = $true
          break
        } catch {
          $lastRegistryError = $_.Exception.Message
          # 真值优先：如果 Bun 已经把固定版本依赖完整落盘，即使 Windows Host 在读取子进程状态时异常，
          # 也不能把“实体已完整”误判成安装失败并重复切换 registry。
          if (Test-XmaOpenTuiDependencies $openTuiHome) {
            Write-Host "[通过] $($registrySource.Name) 已形成完整 OpenTUI 依赖；按实体真值继续。" -ForegroundColor Green
            $installed = $true
            break
          }
          Write-Host "[切换] $($registrySource.Name) 安装失败：$lastRegistryError" -ForegroundColor Yellow
        }
      }
    } finally {
      Pop-Location
      if ($null -eq $previousRegistry) { Remove-Item Env:BUN_CONFIG_REGISTRY -ErrorAction SilentlyContinue }
      else { $env:BUN_CONFIG_REGISTRY = $previousRegistry }
    }
    if (-not $installed) { throw "OpenTUI 依赖安装失败；已尝试所有 npm registry。最后错误：$lastRegistryError" }
  }

  if (-not (Test-XmaOpenTuiDependencies $openTuiHome)) { throw "Xiaoyu OpenTUI 依赖准备后版本仍不完整：$openTuiHome" }
  if (-not (Connect-XmaOpenTuiNodeModules -ProjectRoot $Root -BunHome $bunHome)) {
    throw "OpenTUI 依赖已准备，但无法把源码 Runtime 连接到 xma-path：$openTuiHome"
  }
  if (-not (Test-XmaOpenTuiDependencies $sourceRuntimeRoot)) { throw 'OpenTUI 依赖链接建立后仍无法从源码 Runtime 解析。' }

  Write-Host "[通过] Xiaoyu TUI framework 已准备完成：OpenTUI $OpenTuiVersion + Solid $SolidJsVersion + Bun $BunVersion。" -ForegroundColor Green
  Write-Host "[OpenTUI] $openTuiHome" -ForegroundColor DarkGray
}

function Ensure-XmaBunOpenTuiRuntime([switch]$PromptIfMissing) {
  # 中文说明：Bun + OpenTUI 是一个运行组件。`[1]` 必须按“整组件真值”判断，
  # 不能只看到 bun.exe 就认为准备完成，否则用户删除 xma-path\opentui 后不会再次获得 Y/N 修复机会。
  $before = Import-XmaBunEnvironment -ProjectRoot $Root -ExpectedVersion $BunVersion -DiscoverExternal
  $bunExe = Install-XmaBunRuntime -PromptIfMissing:$PromptIfMissing
  if (-not $bunExe) { return $null }

  $bunVersionDir = Split-Path -Parent ([IO.Path]::GetFullPath($bunExe))
  $bunHome = Split-Path -Parent $bunVersionDir
  $openTuiHome = Get-XmaOpenTuiHomeFromBunHome -BunHome $bunHome
  $openTuiReady = Test-XmaOpenTuiDependencies $openTuiHome

  if (-not $openTuiReady -and $PromptIfMissing -and $before) {
    Write-Host "[缺少] Bun $BunVersion 已存在，但 OpenTUI Runtime 依赖不完整：$openTuiHome" -ForegroundColor Yellow
    if (-not (Confirm-XmaAction '是否修复/重新安装 OpenTUI Runtime？选择 N 会跳过，可稍后在主菜单 [8] 单独安装。')) {
      Write-Host '[跳过] OpenTUI Runtime 未修复；Bun 本体保留，但 [4]/[7] 仍会提示先运行 [8]。' -ForegroundColor Yellow
      return $null
    }
  }

  if (-not $openTuiReady) {
    # Bun 本轮刚由用户同意安装时，沿用同一次“Bun / OpenTUI Runtime”授权，不重复弹第二个 Y/N。
    # 旧版实体依赖如果完整，Ensure 会优先本地迁移；只有确实缺失时才联网安装。
    # 中文说明：该函数最终必须只返回 bun.exe 路径。Bun install 的 stdout 只能显示到 Host，不能进入 PowerShell 返回管道污染 `$bunExe`。
    Ensure-XmaOpenTuiDependencies -BunExecutable $bunExe | Out-Host
  } elseif (-not (Connect-XmaOpenTuiNodeModules -ProjectRoot $Root -BunHome $bunHome)) {
    throw "OpenTUI 依赖存在，但无法连接到源码 Runtime：$openTuiHome"
  }

  if (-not (Test-XmaOpenTuiDependencies $openTuiHome)) {
    throw "Bun/OpenTUI 组件准备结束但真实依赖仍不完整：$openTuiHome"
  }
  Write-Host "[通过] Bun/OpenTUI 整组件已就绪：Bun $BunVersion + OpenTUI $OpenTuiVersion" -ForegroundColor Green
  Write-Host "[OpenTUI] $openTuiHome" -ForegroundColor DarkGray
  return $bunExe
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

function Prepare-XmaBunOnly {
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Write-Host '  XMA · 单独安装 Bun / OpenTUI Runtime' -ForegroundColor Cyan
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  $bunExe = Ensure-XmaBunOpenTuiRuntime
  if (-not $bunExe) { throw 'Bun / OpenTUI Runtime 单独准备未完成。' }
  Remove-XmaLegacyLocalDirectory
  Remove-XmaLegacyProjectControlState
  Remove-XmaPackageMetadataFromGitWorktree
  Write-Host '[完成] Bun / OpenTUI Runtime 已准备，可返回菜单运行 [4] 或 [7]。' -ForegroundColor Green
}

function Prepare-XmaRustOnly {
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Write-Host '  XMA · 单独安装 Rust / Cargo' -ForegroundColor Cyan
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  $rustRuntime = Ensure-XmaRustToolchain
  Write-Host '[MSVC] 正在准备 Rust Native 构建所需 Windows C++ Toolchain...' -ForegroundColor Cyan
  Ensure-XmaMsvc
  Write-Host '[Crates] 正在准备 XMA Native Rust crates...' -ForegroundColor Cyan
  Ensure-XmaCargoCrates -RustRuntime $rustRuntime
  Remove-XmaLegacyLocalDirectory
  Remove-XmaLegacyProjectControlState
  Remove-XmaPackageMetadataFromGitWorktree
  Write-Host '[完成] Rust / Cargo / rustfmt / Native crates 已准备，可返回菜单运行 [4] 或 [7]。' -ForegroundColor Green
}

if ($Component -eq 'bun') { Prepare-XmaBunOnly; exit 0 }
if ($Component -eq 'rust') { Prepare-XmaRustOnly; exit 0 }

Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '  XMA 一键准备开发环境' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '说明：本流程一次准备系统工具 + XMA 通用项目依赖。' -ForegroundColor DarkGray
Write-Host '说明：Bun/OpenTUI 与 Rust/Cargo 如果尚未安装，会先询问 Y/N；选择 N 只跳过对应组件，不中断其余准备。' -ForegroundColor DarkGray
Write-Host '说明：默认依赖根跟随当前项目的 xma-path；不会主动把 XMA 自管 Bun/Rust 安装到系统 C 盘。' -ForegroundColor DarkGray
Write-Host '说明：下载源默认 auto：官方/镜像做快速测速，下载停滞或失败会自动切换；可用 XMA_DOWNLOAD_SOURCE=official|mirror 覆盖。' -ForegroundColor DarkGray
Write-Host "说明：不会下载 Electron $ElectronVersion Chromium Runtime，也不会预取 Tauri 2 Rust crates；这两项只在明确选择对应 Desktop 后执行。" -ForegroundColor DarkGray
Write-Host ''
Refresh-XmaPath

Write-Host '[1/9] Git' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 Git 是否可用...' -ForegroundColor DarkCyan
if (Get-Command git.exe -ErrorAction SilentlyContinue) { Write-Host "[通过] 已检测到 $(& git.exe --version)" -ForegroundColor Green }
else {
  Write-Host '[缺少] 当前没有检测到 Git。' -ForegroundColor Yellow
  if (-not (Confirm-XmaAction '是否自动下载并安装 Git？')) { throw 'Git 是 XMA 开发与推送流程的必要依赖。' }
  Ensure-XmaWinget
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
  Invoke-XmaExternal -FilePath 'winget.exe' -ArgumentList @('upgrade','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
  $nodeVersion = (& node.exe --version).Trim(); $major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
  if ($major -lt 22) { throw "Node.js 升级后仍低于 22：$nodeVersion。" }
}
Write-Host "[通过] Node.js $nodeVersion" -ForegroundColor Green

Write-Host ''
Write-Host '[3/9] pnpm 11.17.0' -ForegroundColor Cyan
$pnpmVersion = if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) { (& pnpm.cmd --version).Trim() } else { '' }
if ($pnpmVersion -ne '11.17.0') {
  if ($pnpmVersion) { Write-Host "[调整] 当前 pnpm $pnpmVersion，项目固定使用 11.17.0。" -ForegroundColor Yellow } else { Write-Host '[缺少] 当前没有检测到 pnpm。' -ForegroundColor Yellow }
  Invoke-XmaExternal -FilePath 'npm.cmd' -ArgumentList @('install','--global','pnpm@11.17.0')
  Refresh-XmaPath
}
$pnpmVersion = (& pnpm.cmd --version).Trim()
if ($pnpmVersion -ne '11.17.0') { throw "pnpm 版本校验失败：期望 11.17.0，实际 $pnpmVersion。" }
Write-Host "[通过] pnpm $pnpmVersion" -ForegroundColor Green

Write-Host ''
Write-Host '[4/9] Bun 1.3.14 / OpenTUI Runtime' -ForegroundColor Cyan
Write-Host '[检查] 正在真实恢复 Bun + OpenTUI 整组件；任一部分缺失时才询问是否安装/修复。' -ForegroundColor DarkCyan
$bunExe = Ensure-XmaBunOpenTuiRuntime -PromptIfMissing

Write-Host ''
Write-Host '[5/9] Rust / Cargo' -ForegroundColor Cyan
Write-Host '[检查] 正在真实恢复 Rust stable / Cargo；不存在时才询问是否安装。' -ForegroundColor DarkCyan
$rustRuntime = Ensure-XmaRustToolchain -PromptIfMissing

Write-Host ''
Write-Host '[6/9] MSVC C++ Build Tools' -ForegroundColor Cyan
if ($rustRuntime) { Ensure-XmaMsvc } else { Write-Host '[跳过] Rust/Cargo 未安装，因此本轮不准备 MSVC；可稍后主菜单 [9] 单独安装 Rust/Cargo。' -ForegroundColor Yellow }

Write-Host ''
Write-Host '[7/9] TypeScript / Web / CLI / Desktop JavaScript 依赖' -ForegroundColor Cyan
Write-Host '[检查] 正在检查 XMA Workspace JavaScript 依赖...' -ForegroundColor DarkCyan
$tsx = Join-Path $Root 'node_modules\.bin\tsx.cmd'
$vite = Join-Path $Root 'node_modules\.bin\vite.cmd'
$tsc = Join-Path $Root 'node_modules\.bin\tsc.cmd'
$tsup = Join-Path $Root 'node_modules\.bin\tsup.cmd'
$desktopElectronPackage = Join-Path $Root 'apps\desktop\node_modules\electron\package.json'
$desktopTauriCmd = Join-Path $Root 'apps\desktop\node_modules\.bin\tauri.cmd'
$workspaceJsReady = (Test-Path $tsx) -and (Test-Path $vite) -and (Test-Path $tsc) -and (Test-Path $tsup) -and (Test-Path $desktopElectronPackage) -and (Test-Path $desktopTauriCmd)
$workspaceFingerprint = Get-XmaWorkspaceDependencyFingerprint
$workspaceStampReady = Test-XmaPrepareStamp -Name 'workspace-js' -Fingerprint $workspaceFingerprint
if ($workspaceJsReady -and -not $workspaceStampReady) {
  Write-Host '[校验] 检测到现有 Workspace 依赖，正在离线确认可直接复用...' -ForegroundColor DarkCyan
  & pnpm.cmd install --ignore-scripts --offline --frozen-lockfile *> $null
  $offlineInstallOk = $LASTEXITCODE -eq 0
  if ($offlineInstallOk) { & pnpm.cmd exec tsx -e 'const value: number = 1; if (value !== 1) process.exit(1)' *> $null; $offlineInstallOk = $LASTEXITCODE -eq 0 }
  if ($offlineInstallOk) { Set-XmaPrepareStamp -Name 'workspace-js' -Fingerprint $workspaceFingerprint; $workspaceStampReady = $true; Write-Host '[缓存] 现有 Workspace 依赖离线校验通过，直接复用。' -ForegroundColor DarkCyan }
}
if ($workspaceJsReady -and $workspaceStampReady) { Write-Host '[缓存] Workspace package/lockfile/node_modules 指纹未变化，跳过重复 pnpm install 与 esbuild rebuild。' -ForegroundColor DarkCyan }
else {
  Write-Host '[安装] Workspace 依赖状态变化或缓存不完整，正在同步 JavaScript 依赖...' -ForegroundColor Yellow
  Write-Host '[安全] 使用 --ignore-scripts，Electron Chromium Runtime 不会在这里下载。' -ForegroundColor DarkYellow
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install','--ignore-scripts')
  Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('rebuild','esbuild')
  Set-XmaPrepareStamp -Name 'workspace-js' -Fingerprint $workspaceFingerprint
}
if ($bunExe) {
  $bunVersionDir = Split-Path -Parent ([IO.Path]::GetFullPath($bunExe))
  $bunHome = Split-Path -Parent $bunVersionDir
  $openTuiHome = Get-XmaOpenTuiHomeFromBunHome -BunHome $bunHome
  if (-not (Test-XmaOpenTuiDependencies $openTuiHome)) {
    throw "[4/9] 已确认 Bun/OpenTUI，但 [7/9] 复检发现 OpenTUI 依赖丢失：$openTuiHome。请重新运行 [1] 或主菜单 [8]。"
  }
  if (-not (Connect-XmaOpenTuiNodeModules -ProjectRoot $Root -BunHome $bunHome)) {
    throw "OpenTUI 依赖存在，但源码 Runtime 链接已失效：$openTuiHome。请重新运行 [1] 或主菜单 [8]。"
  }
  Write-Host '[缓存] Bun/OpenTUI 已由 [4/9] 完整准备，本步骤只做复检，不重复安装。' -ForegroundColor DarkCyan
} else {
  Write-Host '[跳过] Bun/OpenTUI 本轮未准备；主菜单 [8] 可单独补齐。' -ForegroundColor Yellow
}
Write-Host '[验证] 正在验证 TypeScript / Vite / tsx / tsup 工具链...' -ForegroundColor DarkCyan
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsc','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','vite','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsup','--version')
Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','-e','const value: number = 1; if (value !== 1) process.exit(1)') -QuietCommand
if (-not (Test-Path $desktopElectronPackage)) { throw 'Desktop Electron package 元数据缺失。' }
$installedElectron = (Get-Content $desktopElectronPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($installedElectron -ne $ElectronVersion) { throw "Electron package 版本不一致：期望 $ElectronVersion，实际 $installedElectron。" }
if (-not (Test-Path $desktopTauriCmd)) { throw 'Tauri 2 CLI package 未安装完整。' }
Write-Host '[通过] Workspace JavaScript 依赖已准备完成。' -ForegroundColor Green

Write-Host ''
Write-Host '[8/9] XMA Native Rust crates' -ForegroundColor Cyan
if ($rustRuntime) { Ensure-XmaCargoCrates -RustRuntime $rustRuntime }
else { Write-Host '[跳过] Rust/Cargo 未安装，因此不预取 Native crates；主菜单 [9] 会一次补齐 Rust/Cargo + crates。' -ForegroundColor Yellow }

Write-Host ''
Write-Host '[9/9] 开发态 Xiaoyu 命令' -ForegroundColor Cyan
Write-Host '[PATH] 正在校验当前源码 checkout 的 xiaoyu/xma shim 与当前用户 PATH...' -ForegroundColor DarkCyan
Install-XmaDevelopmentCommands
Remove-XmaLegacyLocalDirectory
Remove-XmaLegacyProjectControlState
Remove-XmaPackageMetadataFromGitWorktree

Write-Host ''
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '[完成] XMA 一键准备流程结束。' -ForegroundColor Green
if ($bunExe) {
  $bunVersionDir = Split-Path -Parent ([IO.Path]::GetFullPath($bunExe))
  $bunHomeSummary = Split-Path -Parent $bunVersionDir
  $bunDependencyRootSummary = Split-Path -Parent $bunHomeSummary
  Write-Host "[Bun/OpenTUI] 依赖根：$bunDependencyRootSummary" -ForegroundColor Cyan
  Write-Host '[Bun/OpenTUI] 整组件已准备；[4]/[7]/build:cli 将复用同一真实位置。' -ForegroundColor Cyan
} else { Write-Host '[Bun/OpenTUI] 本轮跳过或未完整；需要 Xiaoyu Terminal 时使用主菜单 [8]。' -ForegroundColor Yellow }
if ($rustRuntime) {
  $rustInstallRootSummary = Split-Path -Parent ([IO.Path]::GetFullPath($rustRuntime.CargoHome))
  $rustDependencyRootSummary = Split-Path -Parent $rustInstallRootSummary
  Write-Host "[Rust/Cargo] 依赖根：$rustDependencyRootSummary" -ForegroundColor Cyan
  Write-Host '[Rust] 已准备；[4]/[7] 将复用同一 Cargo/Rustup Home。' -ForegroundColor Cyan
} else { Write-Host '[Rust] 本轮跳过；需要 Native Runtime 时使用主菜单 [9]。' -ForegroundColor Yellow }
Write-Host "[控制状态] $(Get-XmaStateRoot -ProjectRoot $Root)" -ForegroundColor DarkGray
Write-Host '[开发命令] 新开终端后，可在任意 Workspace 输入 xiaoyu / xma 启动当前源码 CLI。' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
