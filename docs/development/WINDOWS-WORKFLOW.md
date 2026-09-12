# Windows 固定开发工作流

## 目录

源码包示例：

`H:\一键部署\xma-0.1.0`

Git 工作目录固定：

`H:\一键部署\xma`

GitHub：

`https://github.com/yubboo/xma.git`

## 固定流程

```text
解压 xma-0.1.0.zip
        ↓
运行 XMA-Sync.bat
        ↓
同步到 H:\一键部署\xma
        ↓
运行 XMA-GitHub.bat
        ↓
选择 1. 一键推送（纯 Git，不安装/下载任何依赖）
```


## GitHub 推送助手边界

`XMA-GitHub.bat` 是纯 Git 工作流：安全检查 → fetch/pull → git add → staged 二次检查 → commit → push。

它**不得**调用环境准备，不得执行 pnpm/cargo 依赖下载，不得下载 Electron。项目运行依赖只在 `XMA.bat` 的环境准备、开发运行和构建发布流程中处理。

## 开发控制台

运行 `XMA.bat`：

```text
[1] 一键准备环境        ← 推荐首次运行
[2] 开发运行 · Web
[3] 开发运行 · Desktop
[4] 运行 · XiaoYu CLI
[5] 一键构建发布 · 当前平台
[6] 一键构建发布 · Windows Setup + Portable
[7] 全量检查
[0] 退出
```

“一键准备环境”负责检查并在用户确认后安装 Node.js、pnpm、Git、Rust 等必要工具，然后安装项目依赖。系统级安装只允许通过 Yes/No 明确确认。

## PowerShell 5.1 编码规则

Windows PowerShell 5.1 的默认文本编码受系统代码页影响。所有脚本读取 `package.json`、JSON 配置或 UTF-8 中文文本时必须显式使用 `-Encoding UTF8`。PS1 自身继续保持 UTF-8 BOM + CRLF，避免中文界面和 JSON 在 Windows 终端中被错误解码。

- Windows PowerShell 外部命令包装函数禁止使用 `$args` / `$Args` 作为自定义参数名；统一使用 `ArgumentList` 并通过命名参数转发，避免 PowerShell 5.1 自动变量吞掉命令参数。
## 环境准备提示规范

`XMA.bat` 的环境准备、开发运行或构建发布流程触发依赖准备时必须显示可读的中文状态，例如：

```text
[检查] 正在检查 Git 是否可用...
[通过] 已检测到 git version ...
[缺少] 当前没有检测到 Node.js。
[安装] 正在通过 winget 下载并安装 Node.js LTS...
[验证] 正在验证 Electron Runtime...
[完成] XMA 开发环境准备完成。
```

长时间下载或构建前必须先说明当前正在做什么，不能让用户只看到依赖管理器原生日志而不知道阶段。

## pnpm 11 Build Script 安全白名单

pnpm 11 默认会阻止未知依赖执行 `install/postinstall`。XMA 不使用交互式 `pnpm approve-builds`，也不允许全局放行。固定批准列表写入根 `pnpm-workspace.yaml` 的 `allowBuilds`。0.1.0 当前批准：

- `electron`：安装 Electron Runtime；
- `esbuild`：安装对应平台 Native Binary；
- `electron-winstaller`：Electron Windows 打包依赖。

新增白名单必须说明用途；未批准依赖继续保持阻止状态。

### Windows 外部命令统一执行规则

- `scripts/windows/xma-common.ps1` 是 Windows 外部命令执行的唯一公共入口。
- `xma-prepare.ps1`、`xma-github.ps1`、`xma-console.ps1`、`xma-build-release.ps1` 必须复用 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`。
- 禁止自行定义 `Run(..., $Args)`、`Invoke-External(..., $Args)` 或任何 `$Args/@Args` 参数转发。PowerShell 的 `$args` 是自动变量且大小写不敏感，曾导致 `pnpm check` 和 `rustup` 参数丢失。
- 新增 Git、pnpm、cargo、rustup、winget 等外部命令时，必须使用命名参数 `-FilePath` 与 `-ArgumentList`。


- Windows PowerShell 所有外部命令必须统一复用 `scripts/windows/xma-common.ps1` 的 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`；禁止私自实现 `Run(..., $Args)`、`Invoke-External(..., $Args)` 等包装器。
