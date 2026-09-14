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

维护者源码包可以解压到任意目录，例如：`D:\Downloads\xma-0.1.0`、`E:\Dev\xma-0.1.0`。

GitHub：`https://github.com/yubboo/xma.git`

`XMA-Sync.bat` **不再绑定任何固定盘符**。未设置 `XMA_TARGET_ROOT` 时，它会根据源码包所在位置自动识别/创建同级长期 Git 工作目录：优先复用同级已有 XMA worktree；默认建议名为 `xma`，若与源码包自身或非 XMA 目录冲突则使用 `xma-worktree`。只有你明确希望固定到某个目录时才设置：

```powershell
$env:XMA_TARGET_ROOT = 'E:\Dev\xma-worktree'
```

`XMA-GitHub.bat` 始终以**脚本实际所在仓库根**为准，不再假定 `H:\一键部署\xma`。公共源码开发入口 `xma-dev.bat` 同样从自身位置解析仓库根。

### 固定同步流程

```text
解压 xma-0.1.0.zip
        ↓
运行 XMA-Sync.bat
        ↓
自动识别/创建同级 XMA Git 工作目录（任意盘符）
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

- Git、Node.js、pnpm、Rust/Cargo、MSVC 系统工具检查/安装；Rust 必须执行真实 `rustc --version` / `cargo --version` 探针，不能因为 rustup shim 文件存在就误判为可用。缺少 stable toolchain 时由用户选择安装根目录：系统盘用户默认位置（推荐）、`D:\XMA\Rust`、或自定义目录；XMA 使用 `RUSTUP_HOME/CARGO_HOME` 保存选择并把对应 `cargo\bin` 写入 User PATH，已有可用 Rust 时不重复下载；
- 首次或依赖声明变化时执行 `pnpm install --ignore-scripts`：准备全部 Workspace JavaScript package，但不执行 Electron postinstall；后续 `[1]` 会按 package/lockfile/平台指纹复用现有 `node_modules`，新准备器首次接管旧缓存时也先用 `--offline --frozen-lockfile` + 最小 tsx 探针验证，验证通过直接认领缓存，不重复下载/install/rebuild；
- 仅在 Workspace 依赖指纹变化时执行 `pnpm rebuild esbuild`，已准备且指纹一致时直接复用当前平台 Native Binary；
- Rust 依赖按 `Cargo.toml/Cargo.lock + Cargo 版本 + 实际 CARGO_HOME/RUSTUP_HOME` 形成准备指纹，但 **stamp 只用于提示，不能替代真实缓存校验**。每次 `[1]` 都先执行 `cargo fetch --locked --offline` 验证当前 Cargo Home 的 crates/index；即使指纹未变化，只要用户移动了 Rust、清理了 Cargo registry 或切换到 D:/E:/自定义目录，就会识别到缓存缺失并仅在 `[1]` 中联网 `cargo fetch --locked`，完成后再次 offline 复检。
- XMA 构建目录统一为两层：`.cache/` 保存所有可删除的下载/编译/staging（包括 `.cache/cargo-target/`、`.cache/tauri-target/`、`.cache/desktop/`），`dist/` 保存唯一正式产品/发布产物。旧版根 `build/` / `target/`、`apps/desktop/dist|web|release|native` 与 `apps/desktop/src-tauri/target/` 会在 `XMA-Sync.bat` 同步新源码时清理。

完成 `[1]` 后：

- `[2] Web`：直接启动，不再次安装依赖；
- `[4] Xiaoyu CLI`：不再次安装依赖；启动时先恢复 `[1]` 已确认并写入项目本地 `.xma/state/rust-environment.json` 的 `CARGO_HOME/RUSTUP_HOME`（例如 `D:\XMA\Rust\cargo` / `D:\XMA\Rust\rustup`），再执行 `cargo fetch --locked --offline` preflight。只有 offline preflight 通过才执行 `cargo build --package xma-native-runtime --offline` 的增量校验构建；缺 crate 时明确提示回 `[1]`，不得直接暴露 `serde not found` 后静默联网。Windows 复用统一 `.cache/cargo-target/` 增量缓存，再复制到 `.cache/native-runtime/runs/` 唯一 staging exe 运行。
- `[7] 全量检查`：先恢复 `[1]` 记录的 Rust Home，并在 TypeScript/CLI 测试之前做 Cargo offline preflight + rustfmt preflight；缺失立即提示回 `[1]`。随后 Rust check/test 使用 `--offline`；
- `[3] Desktop`：只补齐用户明确选择的桌面运行时。
  - `[1] Electron 41.2.0`：主/推荐；Electron package 元数据已由 `[1]` 准备，首次明确选择时才下载 Chromium Runtime；
  - `[2] Tauri 2`：副/备用；Tauri JavaScript package 已由 `[1]` 准备，只在明确选择时预取 Tauri Rust crates。
- `[5]/[6] Desktop 构建发布`：复用 `[1]` 的通用依赖，只补齐所选 Desktop Runtime 并执行桌面端专用测试/构建；Electron 只构建 Web + Electron Main + Setup/Portable，Tauri 只构建自身 Web/Rust bundle。**禁止顺带执行 `build:cli`、`build:server`、`scripts/release/cli.ts` 或 `cargo build --workspace`**；Xiaoyu Terminal portable 发行继续由 `scripts/release/` 与 Release Workflow 独立负责，因此 CLI 构建错误不能阻塞 Desktop 安装包。

`[1]` 注册的开发命令只服务当前源码 checkout。新开 PowerShell / Windows Terminal 后，在任意目录输入 `xiaoyu` 或 `xma` 时使用**调用命令时的当前目录**作为 Workspace，再委托 `xma-dev.bat cli` 启动；不会因为 `xma-console.ps1` 自己切回仓库根而丢失用户 Workspace。一个用户只保留一个激活的 `.xma\dev-bin` PATH entry；shim 内容与 User PATH 已匹配时后续 `[1]` 只校验、不重复写入环境变量。切换 checkout 后重新运行 `[1]` 才会更新指向。

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
6. 如果 Electron 下载失败，用户可以直接返回菜单选择 Tauri 2；
7. Electron Runtime 一旦准备完成，`apps/desktop/scripts/electron/build.ts` 必须验证 `electron/package.json`、`dist/version`、`path.txt` 与平台可执行文件，并通过 electron-builder `electronDist` 直接复用 `apps/desktop/node_modules/electron/dist`。禁止 electron-builder 在同一次 `[5]/[6]` 构建里再次下载 `electron-v41.2.0-*`；本地 Runtime 不完整时直接 fail loud，并提示重新进入 Desktop 显式准备。

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

- Electron 发布包通过 `file://` 加载 `.cache/desktop/electron/app/web/` staging 打入应用的 `web/`，因此 Desktop 专用 Vite 构建必须使用相对资源基址 `--base ./`。最终 Setup/Portable 由 electron-builder 直接写到 `dist/release/electron/`；禁止恢复 `apps/desktop/web|release` 中转目录。electron-builder 自身的 NSIS / winCodeSign 等打包工具可在用户明确选择 Desktop 构建时进入 `.cache/electron-builder/`，但不得借此重新下载已经由 XMA Runtime 安装器验证过的 Electron Chromium Runtime。

- `XMA-Sync.bat` 必须优先使用 Source Manifest，而不是按目录名字猜哪些是源码。即使用户把新 ZIP 覆盖解压到旧目录导致 Source 残留旧文件，Manifest 之外的残留也不得重新同步回 Git 工作目录；`scripts/release/` 等正式源码目录必须正常同步。
- Source Manifest 同步状态保存在目标工作目录 `.xma/source-sync.json`，只属于本地同步状态，不进入 Git。新增目录不需要修改 Sync 白名单；上一版受管文件若从新 Manifest 消失，则自动视为删除/重命名并清理。


## GitHub 助手目录保护

正式源码包目录（例如 `D:\Downloads\xma-0.1.0`，任意盘符）只负责 Source Sync。`XMA-GitHub.bat` 检测到 `.xma-package/source-manifest.json` 必须立即拒绝执行；即使该目录因为旧版脚本误操作已经出现 `.git/`，也不能继续 fetch/pull/push。正确推送位置始终是 `XMA-Sync.bat` 自动识别/创建或 `XMA_TARGET_ROOT` 显式指定的长期 Git 工作目录。

如果旧版助手曾在源码包目录误执行 `git init`，只清理源码包目录自己的 `.git/`；长期工作目录实际路径下的 `.git/` 必须保留。

## Xiaoyu Terminal · Bun / OpenTUI

`xma-dev.bat → [1]` 除 pnpm Workspace 依赖外，会准备固定 `Bun 1.3.14`，并在 `apps/cli/opentui-runtime/` 独立安装 `@opentui/core@0.1.101`、`@opentui/solid@0.1.101`、`solid-js@1.9.11`、`@types/bun@1.3.11`。这些依赖不进入 pnpm Workspace lock，避免把整个 XMA Runtime 改成 Bun；`[4]` 只把交互式 Terminal Host 交给 Bun/OpenTUI，Server/Web 仍使用 Node。Bun 只在 `.xma/tools/bun/1.3.14/bun.exe` 缺失或版本错误时下载；ZIP/临时解压目录完成校验后立即删除。OpenTUI 依赖放在 `apps/cli/opentui-runtime/node_modules`，四个固定版本完全匹配时后续 `[1]` 直接复用并跳过 `bun install`。`[4]`/`[7]` 通过 `scripts/cli/bun.ts` 从该 Runtime 目录启动，并强制 `--no-install`，运行和检查阶段不得偷偷联网补包。

OpenTUI 的 Windows 实机验收至少覆盖：原生 Textarea caret/IME、Tab/Shift+Tab 模式切换后焦点不漂移、Ctrl+P/Ctrl+K Dialog、Esc 返回、鼠标选择/拖动、窗口 resize 与退出后终端状态恢复。
