# Windows 固定开发工作流

## 目录

源码包示例：`H:\一键部署\xma-0.1.0`

Git 工作目录固定：`H:\一键部署\xma`

GitHub：`https://github.com/yubboo/xma.git`

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

## 三个 Windows 入口的职责边界

- `XMA-Sync.bat`：只负责源码包同步到固定 Git 工作目录。
- `XMA-GitHub.bat`：只负责 Git 安全检查、fetch/pull、commit、push；绝不安装依赖。
- `XMA.bat`：负责本地基础环境、项目运行、检查和构建。

## XMA.bat 的依赖下载规则

`[1] 一键准备基础环境` **只检查/安装系统工具**：Git、Node.js、pnpm、Rust/Cargo、MSVC。它不得执行 `pnpm install`、`cargo fetch`，也不得下载 Electron/Tauri 等任何项目依赖。

项目依赖必须按用户动作惰性安装：

- `[2] Web`：只安装 Root/Core/Web 所需依赖。
- `[4] XiaoYu CLI`：只安装 Root/Core/CLI 所需依赖。
- `[3] Desktop`：进入二级菜单后再选择运行时。
  - `[1] Electron 41.2.0`：主/推荐；首次运行才下载 Electron Chromium Runtime。
  - `[2] Tauri 2`：副/备用；只在明确选择时预取 Tauri Rust crates。
- `[5]/[6] 构建发布`：默认构建 Electron 主桌面端；备用 Tauri 2 可通过 `xma-build-release.ps1 -DesktopRuntime tauri` 构建。
- `[7] 全量检查`：不自动下载依赖；缺依赖时给出明确提示，Rust check/test 使用 `--offline`。

## Electron 41.2.0 主桌面端

Electron 版本固定为 `41.2.0`，只存在于 `apps/desktop/package.json`，禁止放进根 `package.json`。

为了避免“一键准备环境”卡在 Electron postinstall：

1. Desktop JavaScript package 先使用 `--ignore-scripts` 安装；
2. 只有用户明确选择 Electron Desktop 时，才单独 `pnpm --dir apps/desktop rebuild electron`；
3. 开启 `@electron/get` 下载诊断；官方下载超过约 30 秒会显示进度；
4. Electron 二进制使用官方缓存，后续运行不重复下载；
5. 如果 Electron 下载失败，用户可以直接返回菜单选择 Tauri 2。

## Tauri 2 备用桌面端

Tauri 2 继续复用同一套 `apps/web/` UI。Windows 使用系统 WebView2，不额外捆绑 Chromium。它是 Electron 的备用运行时，而不是另一套 Agent 产品。

## PowerShell 5.1 编码规则

Windows PowerShell 5.1 的默认文本编码受系统代码页影响。所有脚本读取 `package.json`、JSON 配置或 UTF-8 中文文本时必须显式使用 `-Encoding UTF8`。PS1 自身保持 UTF-8 BOM + CRLF。

Windows PowerShell 外部命令统一复用 `scripts/windows/xma-common.ps1` 的 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`；禁止使用 `$args/$Args` 作为自定义参数名。

## pnpm 11 Build Script 安全白名单

XMA 使用 `pnpm-workspace.yaml -> allowBuilds` 显式批准确实需要 install/postinstall 的包。当前允许 `esbuild` 与 `electron`。

- `electron` 虽在白名单中，但固定脚本仍先 `--ignore-scripts`，只在用户明确选择 Electron 时单独执行 rebuild；
- 禁止 `dangerouslyAllowAllBuilds`；
- 禁止把 `pnpm approve-builds` 变成人工固定步骤。

> **重要：** 仓库根 `/runtime/` 是用户运行数据，禁止提交；`native/runtime/` 是 XMA Rust Native Runtime 源码，必须同步、提交并进入 CI。任何 ignore/sync/safety 规则都不得把两者混为一谈。
