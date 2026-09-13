<#
文件作用：把解压后的版本源码安全同步到固定 Git 工作目录 H:\一键部署\xma。
关联模块：XMA-Sync.bat、XMA-GitHub.bat、GitHub yubboo/xma。
当前实现：robocopy 镜像源码但只保留根运行数据目录 runtime、.git、node_modules、构建缓存；native/runtime 属于源码，必须正常同步。
职责边界：不得删除目标仓库 .git，不得把用户运行时数据从版本包覆盖进去。
#>

$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Target = if ($env:XMA_TARGET_ROOT) { $env:XMA_TARGET_ROOT } else { 'H:\一键部署\xma' }
$RepoUrl = 'https://github.com/yubboo/xma.git'
$ProjectVersion = (Get-Content (Join-Path $Source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version

Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host "  XMA $ProjectVersion Source Sync" -ForegroundColor Cyan
Write-Host '====================================================================' -ForegroundColor DarkCyan
Write-Host "源目录：$Source"
Write-Host "目标目录：$Target"

if ($Source.TrimEnd('\') -ieq $Target.TrimEnd('\')) { throw '源目录和目标目录不能相同。' }
New-Item -ItemType Directory -Force -Path $Target | Out-Null

# 中文说明：早期版本包可能暂未携带 lockfile，但用户本机 [1] 会生成它们。
# /MIR 会删除源目录不存在的文件，因此先暂存“源缺失、目标已存在”的 lockfile；
# 如果未来版本包正式携带 lockfile，则直接以源码包版本为准，不恢复旧文件。
$lockBackupRoot = Join-Path $env:TEMP ("xma-lock-backup-" + [Guid]::NewGuid().ToString('N'))
$preservedLocks = @()
foreach ($lockName in @('pnpm-lock.yaml','Cargo.lock')) {
  $sourceLock = Join-Path $Source $lockName
  $targetLock = Join-Path $Target $lockName
  if (-not (Test-Path $sourceLock) -and (Test-Path $targetLock)) {
    New-Item -ItemType Directory -Force -Path $lockBackupRoot | Out-Null
    Copy-Item $targetLock (Join-Path $lockBackupRoot $lockName) -Force
    $preservedLocks += $lockName
  }
}

$excludeDirs = @('.git','node_modules','.cache','dist','build','.xma','target','release',(Join-Path $Source 'runtime'))
$robocopyArgs = @($Source,$Target,'/MIR','/R:2','/W:1','/NFL','/NDL','/NJH','/NJS','/NP','/XD') + $excludeDirs
& robocopy.exe @robocopyArgs
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy failed with exit code $rc" }

# 中文说明：0.1.0 早期曾把 Cargo/Desktop 中间产物散落在 target/build/apps/desktop 下。
# 现在统一约束为：Cargo 根缓存位于 .cache/cargo-target，其他中间状态只进 .cache，正式产品只进 dist；同步时清理旧目录，避免继续误用。
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
    Write-Host "[清理] 正在删除旧版构建/编译目录：$legacyBuildDir；新中间产物统一位于 .cache\，正式产物统一位于 dist\。" -ForegroundColor DarkYellow
    try {
      Remove-Item $legacyBuildDir -Recurse -Force -ErrorAction Stop
    } catch {
      Write-Host "[警告] 旧目录当前可能被进程占用，暂未删除：$legacyBuildDir。关闭相关进程后可手动删除；新构建不会继续使用它。" -ForegroundColor Yellow
    }
  }
}

foreach ($lockName in $preservedLocks) {
  Copy-Item (Join-Path $lockBackupRoot $lockName) (Join-Path $Target $lockName) -Force
}
if (Test-Path $lockBackupRoot) { Remove-Item $lockBackupRoot -Recurse -Force -ErrorAction SilentlyContinue }

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
  Write-Host '[提示] 当前系统还没有 Git；源码已同步，XMA-GitHub.bat 只负责 Git 推送且不会安装环境；请先通过 XMA.bat → [1] 一键准备环境安装 Git。' -ForegroundColor Yellow
}

Write-Host '[完成] XMA 新源码已同步，同时保留 .git / runtime / node_modules / .cache 本地依赖与缓存；dist 作为本机构建产物也不会从源码包覆盖。' -ForegroundColor Green
Write-Host '[锁文件] 若版本包暂未携带 lockfile，则保留本机已生成的 pnpm-lock.yaml / Cargo.lock；若源码包携带，则以源码包版本为准。' -ForegroundColor DarkGray
Write-Host '下一步：运行目标目录中的 XMA-GitHub.bat → 1. 一键推送。' -ForegroundColor Cyan
