<#
文件作用：使用 Windows PowerShell 自带 Expand-Archive 解压已经校验过的 Electron ZIP。
关联模块：apps/desktop/scripts/install-electron-runtime.ts、electron-runtime-core.ts。
当前实现：接收 ZIP 与 staging 目录，执行系统级 ZIP 解压并把任何异常作为非零退出返回。
职责边界：不联网、不选择镜像、不安装依赖，只负责 Windows 本地归档解压。
#>
param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Archive)) { throw "Electron ZIP 不存在：$Archive" }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
