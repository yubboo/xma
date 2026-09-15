<#
文件作用：XMA Windows 一键开发环境准备器，一次完成系统工具与通用项目依赖准备。
关联模块：xma-console.ps1、package.json、pnpm-workspace.yaml、Cargo.toml、apps/desktop。
当前实现：[1] 自动确保 Git、Node.js、兼容 pnpm、Workspace JavaScript 依赖、Rust/Cargo、MSVC 与 Native crates 全部就绪；JavaScript 每次运行 [1] 都在项目根无条件执行一次原生 pnpm install，native stdout 通过 Host 实时显示，安装动作与 Runtime 对象读取严格分离；node_modules 缺失时重新创建、存在时由 pnpm 自行校验/复用/补齐；已满足项目版本要求的工具直接复用，不为追新强制升级；[8] 仅用于用户明确要求的 Bun/OpenTUI/Solid latest 刷新；生成开发态 xiaoyu/xma 命令并自动注册到当前用户 PATH。
职责边界：Electron Chromium Runtime 只在用户明确选择 Electron Desktop/构建时下载；Tauri 2 Rust crates 只在用户明确选择 Tauri/构建时下载；开发命令只写 User PATH，不修改 Machine PATH，也不冒充正式 Release 安装。
#>

param(
  [ValidateSet('all','js','bun','rust')]
  [string]$Component = 'all'
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
[void](Import-XmaRustEnvironment -ProjectRoot $Root)
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
  $seen = @{}
  foreach ($source in $sources) {
    if ($null -eq $source) { continue }
    foreach ($value in @($source)) {
      if ([string]::IsNullOrWhiteSpace([string]$value)) { continue }
      foreach ($entry in ([string]$value -split ';')) {
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
  }
  $env:Path = ($entries -join ';')
}

function Ensure-XmaWinget {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw '未检测到 winget。请先安装或更新 Microsoft App Installer，再重新运行 XMA。'
  }
}

function Invoke-XmaPrepareExternal {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [switch]$QuietCommand
  )

  # 仅供行式输出的 Bootstrap 动作使用：Out-Host 消费 success stream，避免这些命令的 stdout 污染业务返回对象。
  # 禁止用本包装器执行 pnpm install 等终端进度型命令；PowerShell pipeline 会破坏 carriage-return 同行刷新并可能触发转码乱码。
  Invoke-XmaExternal -FilePath $FilePath -ArgumentList $ArgumentList -QuietCommand:$QuietCommand | Out-Host
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
    & $curl.Source @curlTlsArgs '--fail' '--location' '--silent' '--show-error' '--connect-timeout' '2' '--max-time' '3' '--range' '0-0' '--output' 'NUL' $Url *> $null
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

  # Windows PowerShell 5.1 会把单元素属性枚举（例如 `$ready.Source`）退化成单个 PSObject；
  # 对该对象直接使用 `+` 会触发 `PSObject.op_Addition`。所有源顺序都通过显式 foreach 组装为真正的 Object[]。
  $composeSources = {
    param([object[]]$First, [object[]]$Second)
    $ordered = @()
    foreach ($entry in @($First)) { $ordered += $entry }
    foreach ($entry in @($Second)) { $ordered += $entry }
    return $ordered
  }

  if ($mode -eq 'official') {
    Write-Host '[下载源] official · 只使用官方源。' -ForegroundColor DarkCyan
    return @($official)
  }
  if ($mode -eq 'mirror') {
    Write-Host '[下载源] mirror · 加速镜像优先，失败后回退官方源。' -ForegroundColor DarkCyan
    return @(& $composeSources $mirrors $official)
  }

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl -or $Sources.Count -lt 2) {
    Write-Host '[下载源] auto · 无法执行快速测速，官方源优先，失败后自动切换镜像。' -ForegroundColor DarkCyan
    return @(& $composeSources $official $mirrors)
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
    Write-Host '[下载源] auto · 快速测速均失败，按该组件预设顺序尝试并启用停滞切换。' -ForegroundColor DarkCyan
    return @($Sources)
  }

  $summary = @($measured | ForEach-Object {
    $latencyText = if ([double]::IsPositiveInfinity($_.Latency)) { '不可达' } else { "$([int]$_.Latency)ms" }
    "$($_.Source.Name)=$latencyText"
  }) -join ' · '
  Write-Host "[下载源] auto · $summary · 优先 $($ready[0].Source.Name)" -ForegroundColor DarkCyan

  $readySources = @()
  foreach ($entry in @($ready)) { $readySources += $entry.Source }
  $failedSources = @()
  foreach ($entry in @($failed)) { $failedSources += $entry.Source }
  return @(& $composeSources $readySources $failedSources)
}

function Invoke-XmaCurlDownloadStable {
  param(
    [Parameter(Mandatory = $true)][string]$CurlPath,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$SourceName
  )

  $stderrFile = "$Destination.curl-error.txt"
  Remove-Item -LiteralPath $stderrFile -Force -ErrorAction SilentlyContinue
  $curlArgs = @('--fail','--location','--silent','--show-error','--connect-timeout','6','--speed-limit','16384','--speed-time','12','--output',('"' + $Destination + '"'),('"' + $Url + '"'))
  if ($env:OS -eq 'Windows_NT') { $curlArgs = @('--ssl-revoke-best-effort') + $curlArgs }

  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $process = Start-Process -FilePath $CurlPath -ArgumentList $curlArgs -NoNewWindow -PassThru -RedirectStandardError $stderrFile
    $nextReport = 3
    while (-not $process.HasExited) {
      Start-Sleep -Milliseconds 500
      if ($watch.Elapsed.TotalSeconds -ge $nextReport) {
        $downloaded = if (Test-Path -LiteralPath $Destination -PathType Leaf) { (Get-Item -LiteralPath $Destination).Length } else { 0 }
        Write-Host ("[下载中] {0} · {1:N1} MiB · {2:N0}s" -f $SourceName, ($downloaded / 1MB), $watch.Elapsed.TotalSeconds) -ForegroundColor DarkCyan
        $nextReport += 4
      }
    }
    $process.WaitForExit()
    $process.Refresh()
    $exitCode = $process.ExitCode
    if ($exitCode -ne 0) {
      $details = if (Test-Path -LiteralPath $stderrFile -PathType Leaf) { (Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue).Trim() } else { '' }
      if ([string]::IsNullOrWhiteSpace($details)) { throw "curl exit $exitCode" }
      throw "curl exit $exitCode · $details"
    }
  } finally {
    $watch.Stop()
    Remove-Item -LiteralPath $stderrFile -Force -ErrorAction SilentlyContinue
  }
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
        # 不使用 curl --progress-bar：它会在 Windows Terminal 同一行高频重绘，导致 Text Cursor Indicator/硬件光标左右闪烁。
        # curl 以 silent 模式下载，XMA 每约 4 秒输出一条稳定的 MiB/耗时里程碑；低速 12 秒即切换备用源。
        Invoke-XmaCurlDownloadStable -CurlPath $curl.Source -Url ([string]$source.Url) -Destination $Destination -SourceName ([string]$source.Name)
      } else {
        Write-Host '[提示] 当前没有 curl.exe，回退 PowerShell Invoke-WebRequest；该模式只显示阶段状态，不做动态光标重绘。' -ForegroundColor DarkYellow
        $previousProgress = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
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
  # 同时由 PowerShell 等待并回填稳定 ExitCode。文件下载使用稳定的阶段里程碑输出，不做同一行动态光标重绘。
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -NoNewWindow -Wait -PassThru
  $exitCode = $process.ExitCode
  if ($null -eq $exitCode) { throw "$FilePath 进程已结束，但 Windows PowerShell 未返回退出码。" }
  if ([int]$exitCode -ne 0) { throw "$FilePath failed with exit code $exitCode" }
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

function Install-XmaRustStable([switch]$UseDefaultLocation) {
  $dependencyRoot = if ($UseDefaultLocation) {
    $defaultRoot = Get-XmaLocalPathRoot -ProjectRoot $Root
    if (-not (Test-XmaWritableDirectory $defaultRoot)) { throw "XMA 默认依赖目录不可写：$defaultRoot" }
    Write-Host "[自动] [1] 使用项目默认依赖根：$defaultRoot" -ForegroundColor DarkCyan
    $defaultRoot
  } else {
    Select-XmaDependencyRoot -ComponentLabel 'Rust / Cargo'
  }
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

function Ensure-XmaRustToolchain([switch]$UseDefaultLocation) {
  $runtime = Import-XmaRustEnvironment -ProjectRoot $Root -DiscoverExternal
  $rustReady = $false
  if ($runtime) {
    $rustProbe = Invoke-XmaProbe -FilePath $runtime.RustcExe -ArgumentList @('--version')
    $cargoProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('--version')
    $rustReady = ($rustProbe.ExitCode -eq 0) -and ($cargoProbe.ExitCode -eq 0)
  }

  # 兼容用户电脑上已经存在但尚未写入 checkout 本地状态的 Rust。真实探针通过就直接复用，不为追新强制升级。
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
          Write-Host "[恢复] 检测到可实际运行的 Rust/Cargo；已接管并复用，不重复安装：$cargoHome" -ForegroundColor DarkCyan
        }
      }
    }
  }

  if (-not $rustReady) {
    Write-Host '[缺少] 当前没有可实际运行的 Rust stable / Cargo；这是 XMA Native Runtime 必需工具链，正在自动安装。' -ForegroundColor Yellow
    $runtime = Install-XmaRustStable -UseDefaultLocation:$UseDefaultLocation
    if (-not $runtime) { throw 'Rust 安装完成后仍无法恢复运行环境。' }
  }

  $rustProbe = Invoke-XmaProbe -FilePath $runtime.RustcExe -ArgumentList @('--version')
  $cargoProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('--version')
  if ($rustProbe.ExitCode -ne 0) { throw "rustc toolchain 仍不可用：$($rustProbe.Output -join ' ')" }
  if ($cargoProbe.ExitCode -ne 0) { throw "cargo toolchain 仍不可用：$($cargoProbe.Output -join ' ')" }
  Save-XmaRustEnvironmentState -ProjectRoot $Root -CargoHome $runtime.CargoHome -RustupHome $runtime.RustupHome
  Write-Host "[通过] $((($rustProbe.Output -join ' ').Trim()))" -ForegroundColor Green
  Write-Host "[通过] $((($cargoProbe.Output -join ' ').Trim()))" -ForegroundColor Green
  Write-Host '[版本策略] 当前 Rust/Cargo 可用即直接复用；XMA 推荐 stable，但不会仅为了追最新 stable 强制升级。' -ForegroundColor DarkGray

  $rustupExe = Join-Path (Join-Path $runtime.CargoHome 'bin') 'rustup.exe'
  $rustfmtProbe = Invoke-XmaProbe -FilePath $runtime.CargoExe -ArgumentList @('fmt','--version')
  if ($rustfmtProbe.ExitCode -ne 0) {
    if (-not (Test-Path -LiteralPath $rustupExe -PathType Leaf)) { throw 'Rust 已可用，但缺少 rustfmt/cargo-fmt，且当前 Rust Home 没有 rustup.exe。' }
    Write-Host '[缺少] 未检测到 rustfmt；这是 XMA 全量检查必需组件，正在自动安装...' -ForegroundColor Yellow
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

  Write-Host '[缺少] 未检测到 Visual Studio C++ Build Tools；这是 XMA Windows Native 构建必需工具，正在自动安装。' -ForegroundColor Yellow
  Ensure-XmaWinget
  Write-Host '[安装] 正在安装 Visual Studio 2022 Build Tools + C++ Toolchain，这一步可能需要几分钟...' -ForegroundColor Yellow
  Invoke-XmaPrepareExternal -FilePath 'winget.exe' -ArgumentList @(
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
  Invoke-XmaPrepareExternal -FilePath $RustRuntime.CargoExe -ArgumentList @('fetch','--locked')
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
  # Bun/OpenTUI 已进入 pnpm node_modules；项目内旧实体与旧控制目录都可在 JS Runtime 成功准备后清理。外部 xma-path 不在这里猜测/删除。
  foreach ($oldControl in @((Join-Path $legacyPathRoot 'state'), (Join-Path $legacyPathRoot 'dev-bin'), (Join-Path $legacyPathRoot 'bun'), (Join-Path $legacyPathRoot 'opentui'))) {
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
  $runtimeRoot = Join-Path $Root 'apps\cli\opentui-runtime'
  $corePackage = Join-Path $runtimeRoot 'node_modules\@opentui\core\package.json'
  $solidPackage = Join-Path $runtimeRoot 'node_modules\@opentui\solid\package.json'
  $solidJsPackage = Join-Path $runtimeRoot 'node_modules\solid-js\package.json'
  $bunTypesPackage = Join-Path $runtimeRoot 'node_modules\@types\bun\package.json'

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
  Invoke-XmaPrepareExternal -FilePath 'node.exe' -ArgumentList @('scripts/runtime/update.mjs')
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
  Invoke-XmaPrepareExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsc','--version')
  Invoke-XmaPrepareExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','vite','--version')
  Invoke-XmaPrepareExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','--version')
  Invoke-XmaPrepareExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsup','--version')
  Invoke-XmaPrepareExternal -FilePath 'pnpm.cmd' -ArgumentList @('exec','tsx','-e','const value: number = 1; if (value !== 1) process.exit(1)') -QuietCommand

  $desktopElectronPackage = Join-Path $Root 'apps\desktop\node_modules\electron\package.json'
  $desktopTauriCmd = Join-Path $Root 'apps\desktop\node_modules\.bin\tauri.cmd'
  if (-not (Test-Path -LiteralPath $desktopElectronPackage -PathType Leaf)) { throw 'Desktop Electron package 元数据缺失。' }
  $installedElectron = (Get-Content $desktopElectronPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($installedElectron -ne $ElectronVersion) { throw "Electron package 版本不一致：期望 $ElectronVersion，实际 $installedElectron。" }
  if (-not (Test-Path -LiteralPath $desktopTauriCmd -PathType Leaf)) { throw 'Tauri 2 CLI package 未安装完整。' }

  Write-Host "[通过] Workspace JS Runtime：Bun $($runtime.BunVersion) · OpenTUI core $($runtime.OpenTuiCoreVersion) / solid $($runtime.OpenTuiSolidVersion) · Solid $($runtime.SolidJsVersion)" -ForegroundColor Green
  Write-Host "[Bun] $($runtime.BunExe)" -ForegroundColor DarkGray
  Write-Host '[位置] Bun/OpenTUI/Solid 全部由 pnpm 管理并存放在 Workspace node_modules。' -ForegroundColor DarkGray
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
  Remove-XmaLegacyProjectControlState
  Remove-XmaPackageMetadataFromGitWorktree
  Write-Host '[完成] Workspace JS / Bun / OpenTUI 已刷新到 registry latest；可返回菜单运行 [4] 或 [7]。' -ForegroundColor Green
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
  Invoke-XmaPrepareExternal -FilePath 'winget.exe' -ArgumentList @('install','--id','Git.Git','--exact','--accept-source-agreements','--accept-package-agreements')
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
  Invoke-XmaPrepareExternal -FilePath 'winget.exe' -ArgumentList @('install','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
  Refresh-XmaPath
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 安装后仍未出现在 PATH，请重新打开终端后再运行。' }
$nodeVersion = (& node.exe --version).Trim()
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  Write-Host "[过旧] 当前 $nodeVersion，低于 XMA 硬要求 Node.js 22+；正在自动升级到受支持的 LTS。" -ForegroundColor Yellow
  Ensure-XmaWinget
  Invoke-XmaPrepareExternal -FilePath 'winget.exe' -ArgumentList @('upgrade','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
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
  Invoke-XmaPrepareExternal -FilePath 'npm.cmd' -ArgumentList @('install','--global','pnpm@11.17.0')
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
Write-Host '[检查] 正在恢复 Rust/Cargo；缺失时自动安装到项目默认依赖根。' -ForegroundColor DarkCyan
$rustRuntime = Ensure-XmaRustToolchain -UseDefaultLocation

Write-Host ''
Write-Host '[6/8] MSVC C++ Build Tools' -ForegroundColor Cyan
Ensure-XmaMsvc

Write-Host ''
Write-Host '[7/8] XMA Native Rust crates' -ForegroundColor Cyan
Ensure-XmaCargoCrates -RustRuntime $rustRuntime

Write-Host ''
Write-Host '[8/8] 开发态 Xiaoyu 命令' -ForegroundColor Cyan
Write-Host '[PATH] 正在校验当前源码 checkout 的 xiaoyu/xma shim 与当前用户 PATH...' -ForegroundColor DarkCyan
Install-XmaDevelopmentCommands
Remove-XmaLegacyLocalDirectory
Remove-XmaLegacyProjectControlState
Remove-XmaPackageMetadataFromGitWorktree

Write-Host ''
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host '[完成] XMA 一键准备流程结束。' -ForegroundColor Green
Write-Host "[JS Runtime] Bun $($jsRuntime.BunVersion) · OpenTUI $($jsRuntime.OpenTuiCoreVersion) · Solid $($jsRuntime.SolidJsVersion) · node_modules" -ForegroundColor Cyan
Write-Host '[依赖同步] 项目 package/workspace/Cargo 依赖以后有新增或调整，重新运行 [1] 即自动补齐；[4]/[7] 不偷偷联网。' -ForegroundColor DarkGray
$rustInstallRootSummary = Split-Path -Parent ([IO.Path]::GetFullPath($rustRuntime.CargoHome))
$rustDependencyRootSummary = Split-Path -Parent $rustInstallRootSummary
Write-Host "[Rust/Cargo] 依赖根：$rustDependencyRootSummary" -ForegroundColor Cyan
Write-Host '[Rust] 已准备；[4]/[7] 将复用同一 Cargo/Rustup Home。' -ForegroundColor Cyan
Write-Host "[控制状态] $(Get-XmaStateRoot -ProjectRoot $Root)" -ForegroundColor DarkGray
Write-Host '[开发命令] 新开终端后，可在任意 Workspace 输入 xiaoyu / xma 启动当前源码 CLI。' -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
