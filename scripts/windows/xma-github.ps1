<#
文件作用：XMA GitHub 纯 Git 推送助手，只负责仓库安全检查、远端同步、提交和 Push。
关联模块：XMA-GitHub.bat、.gitignore、yubboo/xma、GitHub Actions。
当前实现：初始化/校正远端、Git 可提交文件安全扫描、禁止文件二次拦截、fetch/pull、commit、push。
职责边界：本脚本严禁安装依赖、下载运行时、执行 pnpm install/cargo fetch 或修改开发环境；代码编译测试由开发控制台和 GitHub Actions 负责。
#>

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RepoUrl = 'https://github.com/yubboo/xma.git'
Set-Location $Root
. (Join-Path $PSScriptRoot 'xma-common.ps1')
$ProjectVersion = Get-XmaProjectVersion -ProjectRoot $Root
$Host.UI.RawUI.WindowTitle = 'XMA GitHub Helper'

function Header {
  Clear-Host
  Write-Host '====================================================================' -ForegroundColor DarkCyan
  Write-Host "  XMA $ProjectVersion GitHub 一键推送助手" -ForegroundColor Cyan
  Write-Host '  Repo: https://github.com/yubboo/xma.git' -ForegroundColor DarkGray
  Write-Host '====================================================================' -ForegroundColor DarkCyan
}

function Assert-GitAvailable {
  Write-Host '[检查] 正在检查 Git 是否可用...' -ForegroundColor DarkCyan
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    throw '未检测到 Git。GitHub 推送助手不会自动安装环境，请先运行 XMA.bat → [1] 一键准备环境。'
  }
  Write-Host "[通过] $(& git.exe --version)" -ForegroundColor Green
}

function Ensure-GitRepo {
  Assert-GitAvailable
  if (-not (Test-Path '.git')) {
    Write-Host '[首次] 正在初始化 XMA Git 仓库...' -ForegroundColor Yellow
    Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('init')
    Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('branch','-M','main')
    Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('remote','add','origin',$RepoUrl)
    return
  }
  $origin = (& git.exe remote get-url origin 2>$null)
  if (-not $origin) {
    Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('remote','add','origin',$RepoUrl)
    return
  }
  if ($origin -ne $RepoUrl) {
    Write-Host "[修正] origin 当前为 $origin，将切换到 XMA 正式仓库。" -ForegroundColor Yellow
    Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('remote','set-url','origin',$RepoUrl)
  }
}

function Test-ForbiddenGitPath([string]$Path) {
  $normalized = $Path.Replace('\','/').TrimStart('./')
  $directoryRules = @(
    'node_modules/', '.pnpm-store/', '.cache/', '.turbo/',
    'dist/', 'build/', 'coverage/', '.xma/', '.xma-package/',
    'native/target/', 'target/', 'apps/desktop/release/',
    'apps/desktop/dist/', 'apps/desktop/web/', 'apps/desktop/native/',
    'tmp/', 'temp/', '.idea/'
  )
  # 中文说明：只禁止仓库根目录的用户运行数据 runtime/；native/runtime/ 是 Rust 源码，必须允许提交。
  if ($normalized.StartsWith('runtime/', [StringComparison]::OrdinalIgnoreCase)) { return $true }
  foreach ($rule in $directoryRules) {
    if ($normalized.StartsWith($rule, [StringComparison]::OrdinalIgnoreCase) -or $normalized.ToLowerInvariant().Contains('/' + $rule.ToLowerInvariant())) { return $true }
  }

  $name = [IO.Path]::GetFileName($normalized)
  if ($name -ieq '.env' -or ($name -like '.env.*' -and $name -ine '.env.example')) { return $true }
  if ($name -in @('.DS_Store','Thumbs.db','secrets.json','credentials.json')) { return $true }

  $extensions = @('.log','.tmp','.bak','.swp','.swo','.exe','.msi','.msix','.dmg','.pkg','.appimage','.deb','.rpm','.zip','.7z','.rar','.tar','.gz','.pfx','.p12','.pem','.key','.keystore')
  $lower = $name.ToLowerInvariant()
  foreach ($ext in $extensions) { if ($lower.EndsWith($ext)) { return $true } }
  return $false
}

function Safety-Check {
  Ensure-GitRepo
  Write-Host '[检查] 正在检查 Git 真正可能提交的源码文件...' -ForegroundColor Cyan
  Write-Host '[规则] 不安装依赖、不下载运行时、不构建项目；这里只做 Git 提交安全检查。' -ForegroundColor DarkGray

  $files = @(& git.exe ls-files --cached --others --exclude-standard)
  $forbidden = @()
  foreach ($file in $files) {
    if ([string]::IsNullOrWhiteSpace($file)) { continue }
    if (Test-ForbiddenGitPath $file) { $forbidden += $file; continue }
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    $item = Get-Item -LiteralPath $file
    if ($item.Length -gt 20MB) { throw "发现超过 20MB 的可提交文件：$file ($($item.Length) bytes)" }
    if ($item.Length -gt 2MB) { continue }
    $bytes = [IO.File]::ReadAllBytes($item.FullName)
    if ($bytes -contains 0) { continue }
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    if ($text -match '(?i)(sk-[a-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)') {
      throw "可能存在 Secret：$file"
    }
  }
  if ($forbidden.Count -gt 0) {
    $detail = ($forbidden | Sort-Object -Unique | ForEach-Object { " - $_" }) -join [Environment]::NewLine
    throw "发现禁止进入 Git 的文件，请检查 .gitignore 或取消跟踪：$([Environment]::NewLine)$detail"
  }
  Write-Host '[通过] Git 可提交文件安全检查通过。' -ForegroundColor Green
}

function Assert-StagedFilesSafe {
  $staged = @(& git.exe diff --cached --name-only --diff-filter=ACMR)
  $bad = @($staged | Where-Object { $_ -and (Test-ForbiddenGitPath $_) })
  if ($bad.Count -gt 0) {
    $detail = ($bad | Sort-Object -Unique | ForEach-Object { " - $_" }) -join [Environment]::NewLine
    throw "暂存区包含禁止提交的构建产物/运行数据/Secret 文件：$([Environment]::NewLine)$detail"
  }
}

function Sync-Remote {
  Ensure-GitRepo
  Write-Host '[同步] 正在获取 GitHub 远端状态...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('fetch','origin')
  $remoteMain = & git.exe ls-remote --heads origin main
  if ($remoteMain) {
    Write-Host '[同步] 检测到远端 main，正在 pull --rebase --autostash...' -ForegroundColor Cyan
    Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('pull','--rebase','--autostash','origin','main')
  } else {
    Write-Host '[提示] 远端 main 尚不存在，这是新仓库首次推送。' -ForegroundColor Yellow
  }
}

function Push-All {
  Ensure-GitRepo
  Safety-Check
  Sync-Remote

  Write-Host '[暂存] 正在根据 .gitignore 规则暂存源码变更...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('add','-A')
  Assert-StagedFilesSafe

  $staged = & git.exe diff --cached --name-only
  if ($staged) {
    Write-Host '[检查] 暂存区文件：' -ForegroundColor DarkCyan
    $staged | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    $gitName = (& git.exe config user.name 2>$null)
    $gitEmail = (& git.exe config user.email 2>$null)
    if (-not $gitName) {
      $gitName = (Read-Host '首次提交：请输入 Git user.name').Trim()
      if (-not $gitName) { throw 'Git user.name 不能为空。' }
      Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('config','user.name',$gitName)
    }
    if (-not $gitEmail) {
      $gitEmail = (Read-Host '首次提交：请输入 Git user.email').Trim()
      if (-not $gitEmail) { throw 'Git user.email 不能为空。' }
      Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('config','user.email',$gitEmail)
    }

    $defaultMessage = "XMA $ProjectVersion update"
    $message = Read-Host "提交说明（直接 Enter 使用：$defaultMessage）"
    if ([string]::IsNullOrWhiteSpace($message)) { $message = $defaultMessage }
    Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('commit','-m',$message)
  } else {
    Write-Host '[提示] 没有新的源码变更需要提交，将直接检查 Push。' -ForegroundColor Yellow
  }

  Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('branch','-M','main')
  Write-Host '[推送] 正在推送到 GitHub...' -ForegroundColor Cyan
  Invoke-XmaExternal -FilePath 'git.exe' -ArgumentList @('push','-u','origin','main')
  Write-Host '[成功] XMA 源码已推送到 GitHub。依赖安装与项目运行不属于此流程。' -ForegroundColor Green
}

while ($true) {
  Header
  Write-Host '  [1] 一键推送 · Git 安全检查 → 同步 → 提交 → Push  ← 推荐' -ForegroundColor Green
  Write-Host '  [2] 查看状态 · git status / 最近提交'
  Write-Host '  [3] 仅 Git 安全检查 · 不安装依赖'
  Write-Host '  [4] 仅同步远端 · fetch + pull --rebase --autostash'
  Write-Host '  [0] 退出'
  Write-Host ''
  $choice = (Read-Host '请选择').Trim()
  try {
    switch ($choice) {
      '1' { Push-All }
      '2' { Ensure-GitRepo; & git.exe status; Write-Host ''; & git.exe log -5 --oneline }
      '3' { Safety-Check }
      '4' { Sync-Remote; Write-Host '[完成] 远端同步完成。' -ForegroundColor Green }
      '0' { exit 0 }
      default { Write-Host '无效选项。' -ForegroundColor Yellow }
    }
  } catch {
    Write-Host ''
    Write-Host "[失败] $($_.Exception.Message)" -ForegroundColor Red
  }
  Write-Host ''
  Read-Host '按 Enter 返回菜单' | Out-Null
}
