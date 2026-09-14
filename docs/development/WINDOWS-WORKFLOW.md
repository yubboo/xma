# Windows 开发与源码快速开始工作流

## 公共源码快速开始：任意目录 / 任意盘符

公共 GitHub 用户、贡献者或维护者换新电脑后，可以把仓库 clone 到任意本地目录；源码开发**不依赖 `H:` 盘或固定目录**：

```powershell
git clone https://github.com/yubboo/xma.git
cd xma
.\xma-dev.bat
```

`xma-dev.bat` 是 **Windows 源码开发控制台**，不是安装后的正式 `xma` 产品命令。它使用 `%~dp0` 定位当前仓库，然后委托 `scripts/windows/xma-console.ps1`；首次机器在菜单选择 `[1] 一键准备开发环境`，之后可选择 Web / Desktop / Xiaoyu CLI / 全量检查。

正式产品安装后的命令是 `xiaoyu`（主）与 `xma`（兼容别名）；Windows portable 内部文件为 `xiaoyu.cmd / xma.cmd`。源码开发入口固定叫 `xma-dev.bat`，两者不得混用。

Git clone 工作区**不需要** `XMA-Sync.bat`。如需提交自己的改动，使用常规 Git 流程；`XMA-GitHub.bat` 是维护者辅助工具，不是运行项目的前置条件。

## 维护者 Source Manifest 同步工作流

当前维护者源码包示例：`H:\一键部署\xma-0.1.0`

当前维护者默认 Git 工作目录：`H:\一键部署\xma`

GitHub：`https://github.com/yubboo/xma.git`

`H:\一键部署\xma` 只是维护者默认值，不是产品路径合同。换电脑或目录时先设置：

```powershell
$env:XMA_TARGET_ROOT = 'D:\Dev\xma'
```

`XMA-Sync.bat` 与 `XMA-GitHub.bat` 已读取 `XMA_TARGET_ROOT`；公共源码开发入口 `xma-dev.bat` 完全不需要这个变量。

### 固定同步流程

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

## Windows 入口的职责边界

- `XMA-Sync.bat`：只负责源码包同步到固定 Git 工作目录；正式源码包使用 `.xma-package/source-manifest.json` 精确描述受管源码，新文件/新目录自动同步，删除/重命名自动清理。同步时必须按文件内容区分“新增 / 更新 / 删除 / 未变化”，只复制真实变化文件，并把完整清单写入目标目录 `.xma/source-sync-last.txt`，避免只显示 Manifest 总文件数造成“是否真的同步成功”不明确。
- `XMA-GitHub.bat`：只负责长期 Git 工作目录的 Git 安全检查、fetch/pull、commit、push；绝不安装依赖。源码包目录包含 `.xma-package/source-manifest.json` 时必须直接拒绝 Git 初始化/推送，避免制造第二个仓库。由于 Windows 文件系统没有 Unix executable bit，暂存后必须用纯 Git `update-index --chmod=+x` 保证 `xma-dev`、`scripts/unix/xma-console.sh`、`scripts/install/xma-install.sh` 在 Linux/macOS clone 后可执行。
- `xma-dev.bat`：负责本地基础环境、项目运行、检查和构建。

## xma-dev.bat 的依赖准备规则

`[1] 一键准备开发环境` 是首次运行的推荐入口，必须一次完成：

- Git、Node.js、pnpm、Rust/Cargo、MSVC 系统工具检查/安装；
- `pnpm install --ignore-scripts`：准备全部 Workspace JavaScript package，但不执行 Electron postinstall；
- `pnpm rebuild esbuild`：只准备 TypeScript/Web 工具链必须的 esbuild Native Binary；
- `cargo fetch`：预取 XMA 根 Rust Workspace（`native/protocol`、`native/runtime`）依赖。
- XMA 构建目录统一为两层：`.cache/` 保存所有可删除的下载/编译/staging（包括 `.cache/cargo-target/`、`.cache/tauri-target/`、`.cache/desktop/`），`dist/` 保存唯一正式产品/发布产物。旧版根 `build/` / `target/`、`apps/desktop/dist|web|release|native` 与 `apps/desktop/src-tauri/target/` 会在 `XMA-Sync.bat` 同步新源码时清理。

完成 `[1]` 后：

- `[2] Web`：直接启动，不再次安装依赖；
- `[4] Xiaoyu CLI`：不再次安装依赖；启动前固定执行 `cargo build --package xma-native-runtime --offline` 的增量校验构建。Windows 使用 `.cache/cargo-target/cli/` 作为独立 CLI build target，再复制到 `.cache/native-runtime/runs/` 唯一 staging exe 运行；旧 Xiaoyu 即使仍占用上一份 exe，也不能阻断新源码构建。严禁因为 Sync 保留 `.cache/` 就直接运行上一版 Native 二进制。
- `[7] 全量检查`：直接使用已经准备好的依赖，Rust check/test 使用 `--offline`；
- `[3] Desktop`：只补齐用户明确选择的桌面运行时。
  - `[1] Electron 41.2.0`：主/推荐；Electron package 元数据已由 `[1]` 准备，首次明确选择时才下载 Chromium Runtime；
  - `[2] Tauri 2`：副/备用；Tauri JavaScript package 已由 `[1]` 准备，只在明确选择时预取 Tauri Rust crates。
- `[5]/[6] 构建发布`：复用 `[1]` 的通用依赖，只补齐所选 Desktop Runtime 并执行构建；不得再次执行 `pnpm install`。

`[1]` 注册的开发命令只服务当前源码 checkout。新开 PowerShell / Windows Terminal 后，在任意目录输入 `xiaoyu` 或 `xma` 时使用**调用命令时的当前目录**作为 Workspace，再委托 `xma-dev.bat cli` 启动；不会因为 `xma-console.ps1` 自己切回仓库根而丢失用户 Workspace。一个用户只保留一个激活的 `.xma\dev-bin` PATH entry；切换 checkout 后重新运行 `[1]`。

`esbuild` 是 Vite/tsx/tsup 的内部依赖。在 pnpm strict linker 下根目录不一定暴露 `esbuild` 命令，因此**禁止使用 `pnpm exec esbuild --version` 作为环境验证**；使用 `tsx` 最小 TypeScript 执行和 Vite/tsup/tsc 真实命令验证。

## Source Sync 后的 Native 一致性

`XMA-Sync.bat` 按设计保留 `.cache/`，因此源码升级后 `.cache\cargo-target\debug\xma-native-runtime.exe` 可能仍是上一版构建。Xiaoyu Terminal 依赖 Native Credentials / Filesystem / 后续 Process capabilities，**存在旧 exe 不代表它与当前 TypeScript 源码兼容**。

固定要求：

- `xma-dev.bat -> [4]` 每次启动前运行 Cargo `--offline` 增量构建当前 `xma-native-runtime`；
- 不下载 crates；缺依赖时明确要求先运行 `[1]`，不得静默联网；
- CLI 建立 stdio Native Client 后继续校验必需 capability；缺能力时 fail loud，禁止进入“能打开 TUI、但 API Key 永远保存不了”的半工作状态；
- Provider/Model 配置异常只在 TUI 内提示，不得因为未配置 Brain、模型发现失败或 Probe 失败把整个 Xiaoyu 进程退出。

## Electron 41.2.0 主桌面端

Electron 版本固定为 `41.2.0`，只存在于 `apps/desktop/package.json`，禁止放进根 `package.json`。

为了避免“一键准备环境”卡在 Electron postinstall：

1. Desktop JavaScript package 先使用 `--ignore-scripts` 安装；
2. 只有用户明确选择 Electron Desktop 时，才调用 `apps/desktop/scripts/electron/install-runtime.ts`；禁止把下载藏进 `pnpm rebuild electron` lifecycle；
3. XMA 直接通过 `@electron/get` API 输出实时百分比与 MB；下载连接连续 45 秒没有新数据就主动中止，避免界面无限停在 postinstall；
4. `@electron/get` 返回已校验 ZIP 后，Windows 安装器调用系统 PowerShell `Expand-Archive` 解压到 staging，先验证版本和 `electron.exe`，再原子替换正式 `dist` 并写 `path.txt`；Windows 固定使用系统解压链，不把安装成功依赖于 Node `extract-zip/yauzl` 流；
5. 默认使用官方 GitHub Releases；连接停滞时切换 Electron 官方文档示例镜像 `npmmirror`，并继续使用包内 `checksums.json` 校验；下载 ZIP 默认缓存到 XMA 项目根 `.cache/electron/`，不写入 Windows 用户 `%LOCALAPPDATA%`，后续运行不重复下载；
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

- Electron 发布包通过 `file://` 加载 `.cache/desktop/electron/app/web/` staging 打入应用的 `web/`，因此 Desktop 专用 Vite 构建必须使用相对资源基址 `--base ./`。最终 Setup/Portable 由 electron-builder 直接写到 `dist/release/electron/`；禁止恢复 `apps/desktop/web|release` 中转目录。

- `XMA-Sync.bat` 必须优先使用 Source Manifest，而不是按目录名字猜哪些是源码。即使用户把新 ZIP 覆盖解压到旧目录导致 Source 残留旧文件，Manifest 之外的残留也不得重新同步回 Git 工作目录；`scripts/release/` 等正式源码目录必须正常同步。
- Source Manifest 同步状态保存在目标工作目录 `.xma/source-sync.json`，只属于本地同步状态，不进入 Git。新增目录不需要修改 Sync 白名单；上一版受管文件若从新 Manifest 消失，则自动视为删除/重命名并清理。


## GitHub 助手目录保护

正式源码包目录（例如 `H:\一键部署\xma-0.1.0`）只负责 Source Sync。`XMA-GitHub.bat` 检测到 `.xma-package/source-manifest.json` 必须立即拒绝执行；即使该目录因为旧版脚本误操作已经出现 `.git/`，也不能继续 fetch/pull/push。正确推送位置始终是 Source Sync 的长期目标目录（默认 `H:\一键部署\xma`）。

如果旧版助手曾在源码包目录误执行 `git init`，只清理源码包目录自己的 `.git/`；长期工作目录 `H:\一键部署\xma\.git/` 必须保留。

## Xiaoyu Terminal · Bun / OpenTUI

`xma-dev.bat → [1]` 除 pnpm Workspace 依赖外，会准备固定 `Bun 1.3.14`，并在 `apps/cli/opentui-runtime/` 独立安装 `@opentui/core@0.1.101`、`@opentui/solid@0.1.101`、`solid-js@1.9.10`。这些依赖不进入 pnpm Workspace lock，避免把整个 XMA Runtime 改成 Bun；`[4]` 只把交互式 Terminal Host 交给 Bun/OpenTUI，Server/Web 仍使用 Node。

OpenTUI 的 Windows 实机验收至少覆盖：原生 Textarea caret/IME、Tab/Shift+Tab 模式切换后焦点不漂移、Ctrl+P/Ctrl+K Dialog、Esc 返回、鼠标选择/拖动、窗口 resize 与退出后终端状态恢复。
