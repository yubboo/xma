<#
文件作用：把解压后的 XMA 版本源码按 Source Manifest 安全同步到自动识别或用户指定的 Git 工作目录。
关联模块：XMA-Sync.bat、.xma-package/source-manifest.json、checkout 本地 xma-state/source-sync.json、XMA-GitHub.bat、GitHub yubboo/xma。
当前实现：优先按包内 Source Manifest 比较文件内容；默认识别同级已存在且 origin 正确的 XMA Git 工作目录，存在多个或未找到时由用户明确选择；绝不自动创建/占用标准 git clone 使用的 xma 目录。
职责边界：不得删除目标仓库 .git、xma-path、用户 runtime、依赖缓存与正式本机构建产物；不得按通用目录名误伤 scripts/release 等正式源码目录。
#>

$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'xma-common.ps1')
$RepoUrl = 'https://github.com/yubboo/xma.git'

function Test-XmaExpectedGitOrigin([string]$Path) {
  if (-not (Test-Path -LiteralPath (Join-Path $Path '.git') -PathType Container)) { return $false }
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { return $false }
  $origin = (& git.exe -C $Path remote get-url origin 2>$null)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($origin)) { return $false }
  $normalized = ([string]$origin).Trim().TrimEnd('/').ToLowerInvariant()
  return $normalized -in @(
    'https://github.com/yubboo/xma.git',
    'https://github.com/yubboo/xma',
    'git@github.com:yubboo/xma.git'
  )
}

function Read-XmaExistingWorktree([string]$Prompt, [string]$SourceRoot) {
  while ($true) {
    $raw = (Read-Host $Prompt).Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($raw)) {
      throw '未选择 XMA Git 工作目录；Source Sync 已取消。'
    }

    try {
      $candidate = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($raw))
    } catch {
      Write-Host '[无效] 路径格式无法解析，请重新输入。' -ForegroundColor Yellow
      continue
    }

    if ([IO.Path]::GetFullPath($SourceRoot).TrimEnd('\') -ieq $candidate.TrimEnd('\')) {
      Write-Host '[无效] 源码包目录不能同时作为长期 Git 工作目录。' -ForegroundColor Yellow
      continue
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
      Write-Host '[无效] 目录不存在。请先用标准命令 git clone https://github.com/yubboo/xma.git 建立仓库。' -ForegroundColor Yellow
      continue
    }
    if (-not (Test-XmaExpectedGitOrigin $candidate)) {
      Write-Host '[无效] 该目录不是 origin 指向 yubboo/xma 的 Git 仓库，XMA 不会覆盖或改写其他目录。' -ForegroundColor Yellow
      continue
    }
    return $candidate
  }
}

function Resolve-XmaSyncTarget([string]$SourceRoot) {
  if (-not [string]::IsNullOrWhiteSpace($env:XMA_TARGET_ROOT)) {
    $explicit = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($env:XMA_TARGET_ROOT.Trim().Trim('"')))
    if (-not (Test-Path -LiteralPath $explicit -PathType Container)) {
      throw "XMA_TARGET_ROOT 指向的目录不存在：$explicit。请先 git clone https://github.com/yubboo/xma.git，或修正 XMA_TARGET_ROOT。"
    }
    if (-not (Test-XmaExpectedGitOrigin $explicit)) {
      throw "XMA_TARGET_ROOT 不是 yubboo/xma Git 仓库：$explicit。XMA 不会初始化新仓库或改写其他仓库 origin。"
    }
    return $explicit
  }

  # 中文说明：公共源码开发的 canonical 路径始终是 `git clone https://github.com/yubboo/xma.git`，Git 默认创建 xma。
  # Source Sync 只复用已经存在且 origin 正确的长期仓库；绝不自动创建替代 worktree 目录、绝不绑定盘符、绝不占用标准 clone 目录。
  $parent = Split-Path -Parent $SourceRoot
  $sourceFull = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
  $matches = @()
  foreach ($directory in @(Get-ChildItem -LiteralPath $parent -Directory -Force -ErrorAction SilentlyContinue)) {
    $candidateFull = [IO.Path]::GetFullPath($directory.FullName).TrimEnd('\')
    if ($candidateFull -ieq $sourceFull) { continue }
    if (Test-XmaExpectedGitOrigin $directory.FullName) { $matches += $directory.FullName }
  }

  if ($matches.Count -eq 1) {
    Write-Host "[识别] 找到同级 XMA Git 工作目录：$($matches[0])" -ForegroundColor Green
    return $matches[0]
  }

  if ($matches.Count -gt 1) {
    Write-Host '[选择] 检测到多个 origin 正确的 XMA Git 工作目录：' -ForegroundColor Cyan
    for ($i = 0; $i -lt $matches.Count; $i++) {
      Write-Host ("  [{0}] {1}" -f ($i + 1), $matches[$i]) -ForegroundColor Gray
    }
    Write-Host '  [M] 手动输入其他已 clone 的 XMA 仓库目录' -ForegroundColor Gray
    while ($true) {
      $choice = (Read-Host '请选择目标仓库').Trim()
      if ($choice -match '^\d+$') {
        $index = [int]$choice - 1
        if ($index -ge 0 -and $index -lt $matches.Count) { return $matches[$index] }
      }
      if ($choice -ieq 'm') {
        return Read-XmaExistingWorktree -Prompt '请输入已 clone 的 XMA Git 仓库目录' -SourceRoot $SourceRoot
      }
      Write-Host '[无效] 请选择列表编号或 M。' -ForegroundColor Yellow
    }
  }

  Write-Host '[未找到] 源码包同级目录没有可复用的 yubboo/xma Git 仓库。' -ForegroundColor Yellow
  Write-Host '[说明] XMA 不会自动创建替代 worktree 目录、不绑定 C:/D:/E:/H:，也不会占用标准 git clone 的 xma 目录。' -ForegroundColor DarkGray
  Write-Host '[标准] 先在你希望的位置执行：git clone https://github.com/yubboo/xma.git' -ForegroundColor Cyan
  return Read-XmaExistingWorktree -Prompt '请输入已经 clone 好的 XMA Git 仓库目录' -SourceRoot $SourceRoot
}

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'XMA Source Sync 需要 Git 来验证目标仓库 origin。请先安装 Git。' }

$Target = Resolve-XmaSyncTarget -SourceRoot $Source
$ProjectVersion = (Get-Content (Join-Path $Source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$PackageManifest = Join-Path $Source '.xma-package\source-manifest.json'
$CheckoutStateRoot = Get-XmaStateRoot -ProjectRoot $Target
$SyncState = Join-Path $CheckoutStateRoot 'source-sync.json'
$SyncReport = Join-Path $CheckoutStateRoot 'source-sync-last.txt'
$ChangePreviewLimit = 20
$SyncSummaryText = $null

Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host "  XMA $ProjectVersion Source Sync" -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host "源目录：$Source"
Write-Host "目标目录：$Target"
if ($env:XMA_TARGET_ROOT) { Write-Host '[目标] 使用 XMA_TARGET_ROOT 显式指定。' -ForegroundColor DarkGray } else { Write-Host '[目标] 复用已存在且 origin 正确的 XMA Git 工作目录；找不到或存在多个时由用户选择。' -ForegroundColor DarkGray }

if ($Source.TrimEnd('\') -ieq $Target.TrimEnd('\')) { throw '源目录和目标目录不能相同。' }
if (-not (Test-XmaExpectedGitOrigin $Target)) { throw "目标目录不是正确的 yubboo/xma Git 仓库：$Target" }

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
  if ($parts[0] -in @('.git','.xma','.xma-package','xma-path','runtime','node_modules','.cache','dist','build','target','release')) { return $true }
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
  $legacySyncState = Join-Path $Target '.xma\source-sync.json'
  $legacyProjectSyncState = Join-Path $Target 'xma-path\state\source-sync.json'
  if (-not (Test-Path -LiteralPath $SyncState -PathType Leaf)) {
    foreach ($legacyCandidate in @($legacyProjectSyncState, $legacySyncState)) {
      if (-not (Test-Path -LiteralPath $legacyCandidate -PathType Leaf)) { continue }
      try {
        $stateDir = Split-Path -Parent $SyncState
        New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
        Copy-Item -LiteralPath $legacyCandidate -Destination $SyncState -Force
        Write-Host '[迁移] 旧 Source Sync 状态已迁移到 checkout 本地 xma-state。' -ForegroundColor DarkCyan
        break
      } catch {}
    }
  }
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
  $excludeDirs = @('.git','node_modules','.cache','.xma','xma-path','target')
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

# 中文说明：.xma-package 只属于正式源码包，长期 Git 工作目录不需要这份包级元数据。
# 旧版 Sync 若曾留下该目录，在确认目标是正确 XMA 仓库后安全清理；当前本地状态统一进入 xma-path/.cache。
$legacyPackageMetadata = Join-Path $Target '.xma-package'
if (Test-Path -LiteralPath $legacyPackageMetadata -PathType Container) {
  Write-Host "[清理] 删除 Git 工作目录中无用的源码包元数据：$legacyPackageMetadata" -ForegroundColor DarkYellow
  Remove-Item -LiteralPath $legacyPackageMetadata -Recurse -Force -ErrorAction Stop
}


# 0.1.0 早期 Source Sync/开发环境使用 `.xma`。状态迁移到 xma-path 后清理旧目录，避免根目录继续出现重复本地状态容器。
$legacyXmaRoot = Join-Path $Target '.xma'
if (Test-Path -LiteralPath $legacyXmaRoot -PathType Container) {
  Remove-Item -LiteralPath (Join-Path $legacyXmaRoot 'source-sync.json') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $legacyXmaRoot 'source-sync-last.txt') -Force -ErrorAction SilentlyContinue
  try {
    $children = @(Get-ChildItem -LiteralPath $legacyXmaRoot -Force -ErrorAction SilentlyContinue)
    if ($children.Count -eq 0) {
      Remove-Item -LiteralPath $legacyXmaRoot -Force -ErrorAction SilentlyContinue
      Write-Host '[清理] 已移除旧版 .xma 本地状态目录。' -ForegroundColor DarkYellow
    }
  } catch {}
}

Set-Location $Target
if (-not (Test-XmaExpectedGitOrigin $Target)) {
  throw "同步完成后的目标仓库 origin 校验失败：$Target。XMA 不会初始化仓库或改写 origin。"
}
Write-Host '[验证] Git 工作目录与 origin 仍指向 yubboo/xma。' -ForegroundColor Green

Write-Host '[完成] XMA 新源码已同步；.git checkout 状态 / 外部或项目 xma-path 依赖 / runtime / node_modules / .cache / dist 等本地状态均保留。' -ForegroundColor Green
if ($SyncSummaryText) {
  Write-Host "[本次同步] $SyncSummaryText" -ForegroundColor Cyan
  Write-Host "[完整清单] $SyncReport" -ForegroundColor DarkGray
}
Write-Host '[自动同步] 新增目录无需配置；删除/重命名源码由 Source Manifest + 上一版同步状态自动识别。' -ForegroundColor DarkGray
Write-Host '下一步：运行目标目录中的 XMA-GitHub.bat → 1. 一键推送。' -ForegroundColor Cyan
