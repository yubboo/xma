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

$excludeDirs = @('.git','node_modules','dist','build','.xma','target','release',(Join-Path $Source 'runtime'))
$robocopyArgs = @($Source,$Target,'/MIR','/R:2','/W:1','/NFL','/NDL','/NJH','/NJS','/NP','/XD') + $excludeDirs
& robocopy.exe @robocopyArgs
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy failed with exit code $rc" }

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

Write-Host '[完成] XMA 新源码已同步，同时保留 .git / runtime / 本地依赖缓存。' -ForegroundColor Green
Write-Host '[锁文件] 若版本包暂未携带 lockfile，旧 lockfile 会随 /MIR 删除，避免新 package/Cargo 定义继续使用陈旧依赖图；下次 [1] 会重新生成。' -ForegroundColor DarkGray
Write-Host '下一步：运行目标目录中的 XMA-GitHub.bat → 1. 一键推送。' -ForegroundColor Cyan
