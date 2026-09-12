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

## XMA.bat 的依赖准备规则

`[1] 一键准备开发环境` 是首次运行的推荐入口，必须一次完成：

- Git、Node.js、pnpm、Rust/Cargo、MSVC 系统工具检查/安装；
- `pnpm install --ignore-scripts`：准备全部 Workspace JavaScript package，但不执行 Electron postinstall；
- `pnpm rebuild esbuild`：只准备 TypeScript/Web 工具链必须的 esbuild Native Binary；
- `cargo fetch`：预取 XMA 根 Rust Workspace（`native/protocol`、`native/runtime`）依赖。

完成 `[1]` 后：

- `[2] Web`：直接启动，不再次安装依赖；
- `[4] XiaoYu CLI`：直接启动，不再次安装依赖；
- `[7] 全量检查`：直接使用已经准备好的依赖，Rust check/test 使用 `--offline`；
- `[3] Desktop`：只补齐用户明确选择的桌面运行时。
  - `[1] Electron 41.2.0`：主/推荐；Electron package 元数据已由 `[1]` 准备，首次明确选择时才下载 Chromium Runtime；
  - `[2] Tauri 2`：副/备用；Tauri JavaScript package 已由 `[1]` 准备，只在明确选择时预取 Tauri Rust crates。
- `[5]/[6] 构建发布`：复用 `[1]` 的通用依赖，只补齐所选 Desktop Runtime 并执行构建。

`esbuild` 是 Vite/tsx/tsup 的内部依赖。在 pnpm strict linker 下根目录不一定暴露 `esbuild` 命令，因此**禁止使用 `pnpm exec esbuild --version` 作为环境验证**；使用 `tsx` 最小 TypeScript 执行和 Vite/tsup/tsc 真实命令验证。

## Electron 41.2.0 主桌面端

Electron 版本固定为 `41.2.0`，只存在于 `apps/desktop/package.json`，禁止放进根 `package.json`。

为了避免“一键准备环境”卡在 Electron postinstall：

1. Desktop JavaScript package 先使用 `--ignore-scripts` 安装；
2. 只有用户明确选择 Electron Desktop 时，才调用 `apps/desktop/scripts/install-electron-runtime.ts`；禁止把下载藏进 `pnpm rebuild electron` lifecycle；
3. XMA 直接通过 `@electron/get` API 输出实时百分比与 MB；下载连接连续 45 秒没有新数据就主动中止，避免界面无限停在 postinstall；
4. `@electron/get` 返回已校验 ZIP 后，Windows 安装器调用系统 PowerShell `Expand-Archive` 解压到 staging，先验证版本和 `electron.exe`，再原子替换正式 `dist` 并写 `path.txt`；禁止再把 Windows 安装依赖于旧 `extract-zip/yauzl` 异步流；
5. 默认使用官方 GitHub Releases；连接停滞时切换 Electron 官方文档示例镜像 `npmmirror`，并继续使用包内 `checksums.json` 校验；Electron 二进制使用官方缓存，后续运行不重复下载；
6. 如果 Electron 下载失败，用户可以直接返回菜单选择 Tauri 2。

## Tauri 2 备用桌面端

Tauri 2 继续复用同一套 `apps/web/` UI。Windows 使用系统 WebView2，不额外捆绑 Chromium。它是 Electron 的备用运行时，而不是另一套 Agent 产品。

## PowerShell 5.1 编码规则

Windows PowerShell 5.1 的默认文本编码受系统代码页影响。所有脚本读取 `package.json`、JSON 配置或 UTF-8 中文文本时必须显式使用 `-Encoding UTF8`。PS1 自身保持 UTF-8 BOM + CRLF。

Windows PowerShell 外部命令统一复用 `scripts/windows/xma-common.ps1` 的 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`；禁止使用 `$args/$Args` 作为自定义参数名。

## pnpm 11 Build Script 安全白名单

XMA 使用 `pnpm-workspace.yaml -> allowBuilds` 显式批准确实需要 install/postinstall 的包。当前只允许 `esbuild`。

- `electron` **不得**进入 `allowBuilds`；Electron Chromium Runtime 只由 XMA Desktop 显式安装器按需处理；
- 禁止 `dangerouslyAllowAllBuilds`；
- 禁止把 `pnpm approve-builds` 变成人工固定步骤。

> **重要：** 仓库根 `/runtime/` 是用户运行数据，禁止提交；`native/runtime/` 是 XMA Rust Native Runtime 源码，必须同步、提交并进入 CI。任何 ignore/sync/safety 规则都不得把两者混为一谈。
