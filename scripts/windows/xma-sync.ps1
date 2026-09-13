<#
文件作用：把解压后的 XMA 版本源码按 Source Manifest 安全同步到固定 Git 工作目录 H:\一键部署\xma。
关联模块：XMA-Sync.bat、.xma-package/source-manifest.json、XMA-GitHub.bat、GitHub yubboo/xma。
当前实现：优先按包内 Source Manifest 比较文件内容，只复制真实新增/更新源码，自动清理上一版已删除/重命名的受管文件，并输出新增/更新/删除/未变化摘要与完整报告；仅保留 .git、runtime、node_modules、.cache、dist 等本地状态。旧版本包没有 Manifest 时才回退 robocopy 兼容流程。
职责边界：不得删除目标仓库 .git、用户 runtime、依赖缓存与正式本机构建产物；不得按通用目录名误伤 scripts/release 等正式源码目录。
#>

$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Target = if ($env:XMA_TARGET_ROOT) { $env:XMA_TARGET_ROOT } else { 'H:\一键部署\xma' }
$RepoUrl = 'https://github.com/yubboo/xma.git'
$ProjectVersion = (Get-Content (Join-Path $Source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$PackageManifest = Join-Path $Source '.xma-package\source-manifest.json'
$SyncState = Join-Path $Target '.xma\source-sync.json'
$SyncReport = Join-Path $Target '.xma\source-sync-last.txt'
$ChangePreviewLimit = 20
$SyncSummaryText = $null

Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host "  XMA $ProjectVersion Source Sync" -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host "源目录：$Source"
Write-Host "目标目录：$Target"

if ($Source.TrimEnd('\') -ieq $Target.TrimEnd('\')) { throw '源目录和目标目录不能相同。' }
New-Item -ItemType Directory -Force -Path $Target | Out-Null

function Normalize-XmaRelativePath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $normalized = $Path.Replace('\', '/').TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($normalized)) { throw 'Source Manifest 包含空路径。' }
  if ([System.IO.Path]::IsPathRooted($Path) -or $normalized -match '(^|/)\.\.(/|$)') {
    throw "Source Manifest 包含不安全路径：$Path"
  }
  return $normalized
}

function Test-XmaProtectedRelativePath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  $normalized = (Normalize-XmaRelativePath $RelativePath).ToLowerInvariant()
  $parts = $normalized.Split('/')
  if ($parts[0] -in @('.git','.xma','.xma-package','runtime','node_modules','.cache','dist','build','target','release')) { return $true }
  foreach ($part in $parts) {
    if ($part -in @('.git','node_modules','.cache','target')) { return $true }
  }
  return $false
}

function Convert-XmaRelativeToNative {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  return (Normalize-XmaRelativePath $RelativePath).Replace('/', '\')
}

function Remove-XmaEmptyParents {
  param([Parameter(Mandatory = $true)][string]$Path)
  $current = Split-Path -Parent $Path
  while ($current -and $current.StartsWith($Target, [System.StringComparison]::OrdinalIgnoreCase) -and $current -ne $Target) {
    $relative = $current.Substring($Target.Length).TrimStart('\')
    if ($relative -and (Test-XmaProtectedRelativePath $relative)) { break }
    $children = @(Get-ChildItem -LiteralPath $current -Force -ErrorAction SilentlyContinue)
    if ($children.Count -ne 0) { break }
    Remove-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
    $current = Split-Path -Parent $current
  }
}

function Get-XmaPreviousManagedFiles {
  if (Test-Path $SyncState) {
    try {
      $state = Get-Content $SyncState -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($state.formatVersion -eq 1 -and $state.files) {
        return @($state.files | ForEach-Object { Normalize-XmaRelativePath ([string]$_) })
      }
    } catch {
      Write-Host '[警告] 旧同步状态无法读取，将尝试从 Git tracked files 恢复受管文件列表。' -ForegroundColor Yellow
    }
  }

  if ((Test-Path (Join-Path $Target '.git')) -and (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    $tracked = @(& git.exe -C $Target ls-files 2>$null)
    if ($LASTEXITCODE -eq 0) {
      return @($tracked | Where-Object { $_ } | ForEach-Object { Normalize-XmaRelativePath ([string]$_) })
    }
  }
  return @()
}

function Save-XmaSyncState {
  param([Parameter(Mandatory = $true)][string[]]$Files)
  $stateDir = Split-Path -Parent $SyncState
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $state = [ordered]@{
    formatVersion = 1
    project = 'xma'
    version = $ProjectVersion
    files = @($Files | Sort-Object -Unique)
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $SyncState -Encoding UTF8
}

function Test-XmaFileContentEqual {
  param(
    [Parameter(Mandatory = $true)][string]$SourceFile,
    [Parameter(Mandatory = $true)][string]$TargetFile
  )

  if (-not (Test-Path -LiteralPath $TargetFile -PathType Leaf)) { return $false }
  $sourceInfo = Get-Item -LiteralPath $SourceFile -ErrorAction Stop
  $targetInfo = Get-Item -LiteralPath $TargetFile -ErrorAction Stop
  if ($sourceInfo.Length -ne $targetInfo.Length) { return $false }

  # 中文说明：长度相同仍必须比较内容，避免“文件数相同/时间戳相近”造成假同步成功。
  $sourceHash = (Get-FileHash -LiteralPath $SourceFile -Algorithm SHA256 -ErrorAction Stop).Hash
  $targetHash = (Get-FileHash -LiteralPath $TargetFile -Algorithm SHA256 -ErrorAction Stop).Hash
  return $sourceHash -eq $targetHash
}

function Save-XmaSyncReport {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Added,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Updated,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Removed,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Unchanged
  )

  $reportDir = Split-Path -Parent $SyncReport
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
  $lines = New-Object 'System.Collections.Generic.List[string]'
  $lines.Add("XMA $ProjectVersion Source Sync")
  $lines.Add("源目录：$Source")
  $lines.Add("目标目录：$Target")
  $lines.Add("时间：$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))")
  $lines.Add('')
  $lines.Add("新增：$($Added.Count)")
  $lines.Add("更新：$($Updated.Count)")
  $lines.Add("删除：$($Removed.Count)")
  $lines.Add("未变化：$($Unchanged.Count)")
  $lines.Add('')

  foreach ($section in @(
    @{ Title = '新增'; Prefix = '+'; Files = $Added },
    @{ Title = '更新'; Prefix = '~'; Files = $Updated },
    @{ Title = '删除'; Prefix = '-'; Files = $Removed },
    @{ Title = '未变化'; Prefix = '='; Files = $Unchanged }
  )) {
    $lines.Add("[$($section.Title)]")
    foreach ($relative in @($section.Files)) { $lines.Add("$($section.Prefix) $relative") }
    $lines.Add('')
  }

  $lines | Set-Content -LiteralPath $SyncReport -Encoding UTF8
}

function Write-XmaChangePreview {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Prefix,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Files,
    [Parameter(Mandatory = $true)][System.ConsoleColor]$Color
  )

  if ($Files.Count -eq 0) { return }
  Write-Host "  $Title ($($Files.Count))" -ForegroundColor $Color
  $preview = @($Files | Select-Object -First $ChangePreviewLimit)
  foreach ($relative in $preview) { Write-Host "    $Prefix $relative" -ForegroundColor $Color }
  if ($Files.Count -gt $preview.Count) {
    Write-Host "    ... 其余 $($Files.Count - $preview.Count) 项请查看完整同步报告。" -ForegroundColor DarkGray
  }
}

if (Test-Path $PackageManifest) {
  $manifest = Get-Content $PackageManifest -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.formatVersion -ne 1 -or $manifest.project -ne 'xma') { throw 'Source Manifest 格式或项目标识不受支持。' }
  if ($manifest.version -ne $ProjectVersion) { throw "Source Manifest 版本 $($manifest.version) 与 package.json $ProjectVersion 不一致。" }

  $newFiles = @()
  $seen = @{}
  foreach ($entry in @($manifest.files)) {
    $relative = Normalize-XmaRelativePath ([string]$entry)
    if (Test-XmaProtectedRelativePath $relative) { throw "Source Manifest 不得管理本地状态路径：$relative" }
    if ($seen.ContainsKey($relative)) { throw "Source Manifest 包含重复路径：$relative" }
    $seen[$relative] = $true
    $sourceFile = Join-Path $Source (Convert-XmaRelativeToNative $relative)
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Source Manifest 声明的文件不存在：$relative" }
    $newFiles += $relative
  }

  $previousFiles = @(Get-XmaPreviousManagedFiles)
  $newSet = @{}
  foreach ($relative in $newFiles) { $newSet[$relative] = $true }

  $addedFiles = @()
  $updatedFiles = @()
  $removedFiles = @()
  $unchangedFiles = @()

  foreach ($relative in $previousFiles) {
    if (Test-XmaProtectedRelativePath $relative) { continue }
    if (-not $newSet.ContainsKey($relative)) {
      $targetFile = Join-Path $Target (Convert-XmaRelativeToNative $relative)
      if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
        Write-Host "[同步] 删除上一版已移除/重命名源码：$relative" -ForegroundColor DarkYellow
        Remove-Item -LiteralPath $targetFile -Force -ErrorAction Stop
        Remove-XmaEmptyParents $targetFile
        $removedFiles += $relative
      }
    }
  }

  foreach ($relative in $newFiles) {
    $sourceFile = Join-Path $Source (Convert-XmaRelativeToNative $relative)
    $targetFile = Join-Path $Target (Convert-XmaRelativeToNative $relative)

    if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) {
      $parent = Split-Path -Parent $targetFile
      if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
      Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
      $addedFiles += $relative
      continue
    }

    if (Test-XmaFileContentEqual -SourceFile $sourceFile -TargetFile $targetFile) {
      $unchangedFiles += $relative
      continue
    }

    Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
    $updatedFiles += $relative
  }

  Save-XmaSyncState -Files $newFiles
  Save-XmaSyncReport -Added $addedFiles -Updated $updatedFiles -Removed $removedFiles -Unchanged $unchangedFiles

  $changedCount = $addedFiles.Count + $updatedFiles.Count + $removedFiles.Count
  $SyncSummaryText = "新增 $($addedFiles.Count) | 更新 $($updatedFiles.Count) | 删除 $($removedFiles.Count) | 未变化 $($unchangedFiles.Count)"
  Write-Host ''
  Write-Host '-------------------- 本次源码变更 --------------------' -ForegroundColor DarkCyan
  Write-Host ("[变更摘要] 新增 {0} | 更新 {1} | 删除 {2} | 未变化 {3} | Manifest {4}" -f $addedFiles.Count, $updatedFiles.Count, $removedFiles.Count, $unchangedFiles.Count, $newFiles.Count) -ForegroundColor Cyan
  if ($changedCount -eq 0) {
    Write-Host '[同步] Source Manifest 模式：目标目录已经是本包源码，无需复制或删除文件。' -ForegroundColor Green
  } else {
    Write-XmaChangePreview -Title '新增文件' -Prefix '+' -Files $addedFiles -Color Green
    Write-XmaChangePreview -Title '更新文件' -Prefix '~' -Files $updatedFiles -Color Yellow
    Write-XmaChangePreview -Title '删除文件' -Prefix '-' -Files $removedFiles -Color DarkYellow
    Write-Host "[同步] Source Manifest 模式：本次实际变更 $changedCount 个源码文件。" -ForegroundColor Green
  }
  Write-Host "[完整清单] $SyncReport" -ForegroundColor DarkGray
} else {
  Write-Host '[兼容] 当前源码包没有 Source Manifest，使用旧版 robocopy 同步；建议使用新的正式源码包。' -ForegroundColor Yellow

  # 中文说明：旧包回退模式仍允许按名字排除真正不会成为源码的依赖/缓存目录；
  # release 不再做全局名字排除，避免误伤 scripts/release 正式源码。
  $excludeDirs = @('.git','node_modules','.cache','.xma','target')
  $excludeDirs += @(
    (Join-Path $Source 'runtime'),
    (Join-Path $Source 'dist'),
    (Join-Path $Source 'build'),
    (Join-Path $Source 'release'),
    (Join-Path $Source 'apps\desktop\release'),
    (Join-Path $Source 'apps\desktop\src-tauri\gen')
  )
  $robocopyArgs = @($Source,$Target,'/MIR','/R:2','/W:1','/NFL','/NDL','/NJH','/NJS','/NP','/XD') + $excludeDirs
  & robocopy.exe @robocopyArgs
  $rc = $LASTEXITCODE
  if ($rc -ge 8) { throw "robocopy failed with exit code $rc" }
}

# 中文说明：0.1.0 早期曾把 Cargo/Desktop 中间产物散落在 target/build/apps/desktop 下。
# 新版只做一次兼容清理；正常构建不会再生成这些路径。
$legacyBuildDirs = @(
  (Join-Path $Target 'target'),
  (Join-Path $Target 'build'),
  (Join-Path $Target 'apps\desktop\dist'),
  (Join-Path $Target 'apps\desktop\web'),
  (Join-Path $Target 'apps\desktop\release'),
  (Join-Path $Target 'apps\desktop\native'),
  (Join-Path $Target 'apps\desktop\src-tauri\target')
)
foreach ($legacyBuildDir in $legacyBuildDirs) {
  if (Test-Path $legacyBuildDir) {
    Write-Host "[清理] 删除旧版构建/编译目录：$legacyBuildDir" -ForegroundColor DarkYellow
    try {
      Remove-Item $legacyBuildDir -Recurse -Force -ErrorAction Stop
    } catch {
      Write-Host "[警告] 旧目录可能被进程占用，暂未删除：$legacyBuildDir。" -ForegroundColor Yellow
    }
  }
}

Set-Location $Target
if (Get-Command git.exe -ErrorAction SilentlyContinue) {
  if (-not (Test-Path '.git')) {
    Write-Host '[首次] 初始化 XMA Git 工作目录...' -ForegroundColor Yellow
    & git.exe init
    if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
    & git.exe branch -M main
    & git.exe remote add origin $RepoUrl
  } else {
    $origin = (& git.exe remote get-url origin 2>$null)
    if ($origin -ne $RepoUrl) {
      Write-Host "[修正] origin → $RepoUrl" -ForegroundColor Yellow
      & git.exe remote set-url origin $RepoUrl
    }
  }
} else {
  Write-Host '[提示] 当前系统还没有 Git；源码已同步，请先通过 xma-dev.bat → [1] 一键准备环境安装 Git。' -ForegroundColor Yellow
}

Write-Host '[完成] XMA 新源码已同步；.git / runtime / node_modules / .cache / dist 等本地状态均保留。' -ForegroundColor Green
if ($SyncSummaryText) {
  Write-Host "[本次同步] $SyncSummaryText" -ForegroundColor Cyan
  Write-Host "[完整清单] $SyncReport" -ForegroundColor DarkGray
}
Write-Host '[自动同步] 新增目录无需配置；删除/重命名源码由 Source Manifest + 上一版同步状态自动识别。' -ForegroundColor DarkGray
Write-Host '下一步：运行目标目录中的 XMA-GitHub.bat → 1. 一键推送。' -ForegroundColor Cyan
