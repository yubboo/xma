<#
文件作用：XMA Windows 脚本公共基础函数，统一版本读取与外部命令执行，避免不同入口重复实现造成参数丢失。
关联模块：xma-prepare.ps1、xma-github.ps1、xma-console.ps1、xma-build-release.ps1；所有外部命令包装必须复用本文件。
当前实现：UTF-8 读取 package.json；使用 FilePath + ArgumentList 安全转发 git/pnpm/cargo/rustup/winget 等外部命令参数。
职责边界：这里只提供无业务状态的公共函数，不负责环境安装、Git 流程或构建策略。
#>

function Get-XmaProjectVersion {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)
  $packageFile = Join-Path $ProjectRoot 'package.json'
  return (Get-Content $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json).version
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
