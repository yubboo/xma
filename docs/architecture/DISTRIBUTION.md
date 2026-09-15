# XMA Distribution / Launcher 架构

## 1. 目标

XMA 不是“只有 Desktop 安装包”的应用。正式产品必须保持**一套 Core / Agent Runtime，多种入口与部署方式**：

- `xiaoyu`：Windows / Linux / macOS Terminal CLI/TUI 主入口；
- `xma`：兼容别名，不作为对外主品牌命令；
- Desktop：Windows/macOS/Linux 图形壳，Electron 主、Tauri 备用；
- Server：本地或云服务器 Headless 入口；
- Web：浏览器 Shell，连接本地/远程 Server；
- 所有入口都复用 Core/App Protocol，不得各自复制 Agent Loop。

## 2. 源码体验/开发环境与普通用户安装必须分开

源码体验者、贡献者和开发者可以使用干净 Git clone。源码开发入口固定使用 `xma-dev` 命名：Windows 为根 `xma-dev.bat`，Linux/macOS 为根 `./xma-dev`。两者都必须从自身位置解析仓库根，允许任意本地目录/盘符，不依赖维护者机器路径；`xma-dev` 只属于源码开发，不得与安装后的正式 `xma` 产品命令混用。

普通用户的**正式产品安装合同**仍然不能要求 clone 源码或安装 pnpm、Rust、Cargo、MSVC；源码 Quick Start 是可选的开发/体验路径，不得替代预构建 portable 发行。

普通用户收到的是预构建 portable runtime：

```text
xiaoyu-<os>-<arch>/
├─ bin/            xiaoyu + xma launcher
├─ runtime/        XMA 自带 Node Runtime（仅 Server/Web）
├─ app/            Bun/OpenTUI 编译的 Xiaoyu CLI + bundled Server JavaScript
├─ web/            已构建 Web Shell
├─ native/         Rust Native Kernel
├─ skills/         XMA 产品级 canonical Skills
├─ VERSION
└─ bundle.json
```

0.1.x portable 仍携带私有 Node Runtime，但只服务 Server/Web；交互式 `xiaoyu` CLI 由 pnpm Workspace 当前已安装并经 Gate 验证的 Bun 编译为当前平台可执行文件。不得为了“单文件”牺牲可验证升级、Native 边界或调试证据。

## 3. Windows 安装合同

默认采用**每用户安装**，不要求管理员权限：

```text
%LOCALAPPDATA%\Programs\Xiaoyu\
├─ bin\
├─ runtime\
├─ app\
├─ web\
├─ native\
└─ skills\
```

只把 `%LOCALAPPDATA%\Programs\Xiaoyu\bin` 加入 **User PATH**。程序文件和用户数据必须分开；Session/状态默认进入 `%LOCALAPPDATA%\Xiaoyu\state`，配置/凭据后续由专门 Config/Credentials Service 管理。

Bootstrap `scripts/install/xma-install.ps1` 必须执行：Release Manifest → 选择 OS/arch → HTTPS 下载 → SHA-256 校验 → staging 文件验证 → 原子替换 → User PATH。禁止在普通用户安装器里执行 `pnpm install`、`cargo build`、`winget` 开发环境安装。

最终网站可暴露类似：

```powershell
powershell -ep Bypass -c "irm https://<xiaoyu-domain>/xma-install.ps1 | iex"
```

在正式域名/Release 资产部署前，文档不得宣称该公网命令已经可用。仓库已经提供 tag-triggered `.github/workflows/release.yml`，冻结版本打 `v<version>` tag 后会在 Windows/Linux/macOS 原生 Runner 构建 portable 资产并发布统一 Manifest。

在正式 Release 存在后，可先使用 GitHub Release bootstrap 做 E2E：

```powershell
powershell -ep Bypass -c "irm https://github.com/yubboo/xma/releases/latest/download/xma-install.ps1 | iex"
```

```bash
curl -fsSL https://github.com/yubboo/xma/releases/latest/download/xma-install.sh | sh
```

后续官方网站只托管/转发同一 bootstrap 合同，不另造安装逻辑。

## 4. Linux / macOS 安装合同

普通用户目录遵循每用户安装，不默认写 `/usr/local`：

```text
~/.local/bin/xiaoyu
~/.local/bin/xma
~/.local/share/xiaoyu/
```

Linux 状态目录优先使用 `$XDG_STATE_HOME/xiaoyu`，否则 `~/.local/state/xiaoyu`。macOS 产品状态使用 `~/Library/Application Support/Xiaoyu/state`。

Bootstrap `scripts/install/xma-install.sh` 下载当前 OS/arch 的 `tar.gz` 和 `checksums.txt`，必须在解压/替换前完成 SHA-256 校验。若 `~/.local/bin` 不在 PATH，只提示用户加入 shell profile；安装脚本不擅自修改任意 shell 配置文件。

## 5. Terminal Runtime

`xiaoyu [workspace]` 是正式 Terminal Workbench。第一批必须具备：

- 持续 TUI 输入循环，而不是打印欢迎页后退出；
- Terminal 对真实 Provider 的 text/reasoning SSE 必须按 Runtime live event 实时绘制，Tool Call/Result 同步可见；禁止“用户提交后静默等待，最终整段一次性出现”。
- Active Terminal UI 的 Bun/OpenTUI/Solid 统一声明在根 `package.json`，由根 pnpm Workspace `node_modules` 提供；`[8]` 才显式刷新 latest 并由 lockfile 固化本次解析版本。`apps/cli/opentui-runtime/` 只保留第一方 Renderer/Build 源码，不拥有嵌套 `node_modules`。版本升级必须经过 XMA TypeScript/Test/Gate 验证；OpenTUI 只接管 Terminal 表现/输入/焦点/布局，不接管 XMA Agent Runtime、Provider、Session、Workspace Policy、Tool Approval 或 Rust Native Kernel。
- 主 Prompt 使用 OpenTUI 原生 `TextareaRenderable` / `<textarea>` 管理 caret、IME、选择、粘贴与多行输入；Active Renderer 禁止再次输出 `CURSOR_MARKER`、手写 DECTCEM/mouse-reporting 或 Pi TUI reverse-video 光标补丁。Tab 模式切换、Ctrl+P/Ctrl+K、Esc 返回和 Dialog focus 必须统一走 OpenTUI 键盘/焦点体系。
- Home / Transcript / Prompt / Shortcut / Notice 使用 OpenTUI Flexbox 响应式布局，左右边距必须对称；Prompt 的真实输入光标必须位于输入组件内部，禁止退回“静态卡片 + 底部 readline”伪 TUI；
- `/` 使用 Safe Prompt 内建命令补全，只展示已经实现的 Terminal 命令；`Ctrl+P` 打开真正的命令面板，Enter 执行、Esc 返回，Terminal Settings 只管理终端视觉/提示/Logo 等 Shell 层设置，并写入用户级 `tui.json`（Windows `%APPDATA%\\Xiaoyu`、Linux `$XDG_CONFIG_HOME/xiaoyu`、macOS `Application Support/Xiaoyu`）；快捷提示只能显示当前确实可用的按键/能力，禁止为了接近参考图伪造 `@/$` 或尚未接线的业务入口；
- Home/Prompt Dock 必须固定锚点；自动补全、命令面板、提示和动态装饰不能推动 Logo/Prompt 主布局。纵向布局必须按终端高度保留明确呼吸区，对话区、输入 Dock、快捷键与提示区之间至少保留稳定空行；Overlay 打开时进入 modal focus，背景 Prompt 只保留紧凑状态 Dock，并隐藏全局快捷键/提示，禁止操作面板与输入区视觉叠压。Prompt Dock 持续显示 Mode + Provider/Model + Reasoning，模式和推理强度使用稳定颜色；Tab/Shift+Tab 循环 Build/Plan/Compose(legacy)，Build 暴露完整 ToolPlan，Plan 只暴露只读工具，Compose 不暴露 Workspace 工具。丰富显示只允许更新装饰层，简洁显示必须关闭装饰刷新；
- Active TUI 不得再混用 Pi TUI 光标反色、手写 ANSI 光标或第二套 mouse-reporting 状态机；鼠标、selection、focus 与 terminal lifecycle 交给 OpenTUI Renderer，避免 Windows Terminal 文本选择白块和 Text Cursor Indicator 锚点漂移。旧 `tui.ts` 在迁移期只保留 Workspace Trust / 纯合同 / 回归兼容，不能重新成为主工作台 Renderer；
- Home/root 风险确认发生在进入 alternate-screen 工作台之前，默认选择“退出”，支持 ↑↓/Tab 切换与 Enter 确认；普通项目 Workspace 不重复弹风险提示；
- 工作区信任界面选择“否，退出”属于正常用户取消，CLI 必须以成功退出语义返回，不得让 `xma-dev` / pnpm 包装层打印失败堆栈；
- `xiaoyu --help / --version / doctor`；
- `xiaoyu server / web` 发行入口；
- **每次启动 Workspace Trust**：`xiaoyu / xma` 每次交互式启动都先以调用者当前目录作为 Workspace 并显示信任确认；普通项目也不跳过，授权只对本次启动有效。Home / 文件系统根目录 / Windows 系统目录（例如 `C:\Windows\System32`）追加高风险提示并默认选择退出；
- **首次模型配置**：工作区信任通过后，如果当前没有已配置 Brain/Profile，必须在**同一 Xiaoyu TUI 的居中 modal**自动打开“模型 / 提供方”配置；一旦 Profile 已配置，后续启动跳过此第二步。`Ctrl+P → 模型 / 提供方` 永久保留，并与首次 Setup 复用同一 Provider/API Key/Model/Reasoning/Brain Ready 实现；
- Workspace Session 绑定到正式 Agent Runtime；
- `Xiaoyu Code` 当前会加载根 `skills/` 的 canonical Skills，并通过 `agent/skills` Context Source 进入正式 Context Assembly；portable launcher 使用 `XIAOYU_SKILLS_HOME` 指向随包分发的 `skills/`，普通用户不依赖源码仓库读取 Skill；
- Terminal 已提供用户级 `brain.json` Provider Profile：可通过 `Ctrl+P → Brain / Provider` 从真实 Provider Catalog 添加 DeepSeek Official 或自定义 OpenAI-compatible Profile；同一品牌可保存多个账号/Profile。品牌 Provider 首次配置主路径固定为 API Key → 真实远程模型选择 → 推理强度 → Brain Ready；API Key 默认写入 OS Credentials，环境变量引用继续作为兼容路径，`/model` 可再次切换真实模型，Reasoning effort 作为非 Secret Profile option 持久化。`brain.json` v3 保存真实 Provider/Profile/Adapter/Model 与 Credential Reference，永远不保存 Secret 值，也不写入 Session；v1 `credentialEnv`、v2 generic Profile 与 `XIAOYU_BASE_URL / XIAOYU_MODEL / XIAOYU_API_KEY` 继续兼容迁移读取；
- 未配置 Provider 时明确显示未就绪，禁止伪造模型回复；
- 如果 bundled/development Native Kernel 可用，Terminal 注册 `native.fs.read_text` / `native.fs.write_text`：读取按 standard policy 直接允许，写入必须在 TUI 显示 Tool Approval，并支持 deny / allow-once / allow-session；
- Terminal 第一批 **不注册 `native.process.run`**。只有 Host 明确给出 absolute executable allowlist 后才允许把进程工具加入 ToolPlan，不能为了终端方便退回 PATH/shell 执行。

后续把 OS Keychain（允许在 UI 中安全录入 Secret）、process allowlist 管理、PTY/ConPTY 接入同一个 Terminal Host；不能重新实现一套 CLI Agent。

## 6. Release 输出

XMA 自己控制的中间 staging 继续只进入 `.cache/`：

```text
.cache/release/cli/
```

用户真正可下载的资产只进入：

```text
dist/release/
├─ xiaoyu-windows-x64.zip
├─ xiaoyu-linux-x64.tar.gz
├─ xiaoyu-macos-*.tar.gz
├─ release-manifest.json
├─ checksums.txt
├─ xma-install.ps1
├─ xma-install.sh
├─ electron/
└─ tauri/
```

源码仓库继续不提交 `dist/`、安装包、Node Runtime、Native build output 或缓存。GitHub Release/官方网站负责分发构建资产。

## 7. 跨平台发布原则

Windows 资产在 Windows 构建，Linux 资产在 Linux 构建，macOS 资产在 macOS 构建。禁止在一个 OS 上伪造另一个 OS 的已验证发行包。

每个平台最低 E2E：安装 → 新终端解析 `xiaoyu` → `xiaoyu --version` → `xiaoyu doctor` → 打开安全 Workspace → 升级覆盖 → 卸载/PATH 清理。Desktop 安装验证是另一条独立 E2E，不能替代 Terminal 安装验证。


### Windows 开发态命令 PATH

`xma-dev.bat → [1]` 在准备完依赖后，会在当前 checkout 本地 `.git\xma-state\dev-bin\` 生成 `xiaoyu.cmd / xma.cmd` 开发 shim，并把**该 dev-bin**写入当前用户 `User PATH`。不把整个 Git 仓库加入 PATH，不修改 Machine PATH，也不需要管理员权限。这样开发者新开终端后可在任意 Workspace 直接输入 `xiaoyu` / `xma`，命令会回到当前源码 checkout 并以调用时目录作为 Workspace。

Windows 源码开发的 JavaScript Runtime 全部位于 pnpm Workspace `node_modules/`；XMA 自管 `xma-path/` 只用于 Rust/Cargo 等非 npm Native Toolchain，可默认跟随 checkout 或显式选择 `D:/xma-path` / 其他真实盘符。checkout 控制状态、prepare stamp、Source Sync 元数据与开发 shim 独立存放在 `.git/xma-state/`（无 Git 临时树回退 `.cache/xma-state/`），因此选择外部依赖盘符时不会在项目根生成第二个空壳 `xma-path`。这些都属于源码开发本地状态，必须被 Git/Source Package 排除，与普通用户正式安装目录 `%LOCALAPPDATA%\Programs\Xiaoyu` 完全分离。旧 `.xma/`、`xma-path/state|dev-bin` 只保留迁移兼容，不再产生新的当前状态。

同一 Windows 用户只激活一个 XMA 开发 checkout 的 dev-bin；再次在另一份 checkout 执行 `[1]` 会替换旧 dev-bin PATH entry。移动仓库后重新运行 `[1]` 即可刷新。该机制只是开发便利，不替代正式 Release 安装器 `%LOCALAPPDATA%\Programs\Xiaoyu\bin`。

### Windows 源码开发 Native staging

`xma-dev.bat → [4]` 在 Windows 源码开发态不得直接运行 Cargo target 中的 `xma-native-runtime.exe`。Linux/macOS 的 `./xma-dev cli` 可直接使用当前源码对应的 Unix Native build。Windows 会锁定正在运行的 exe，因此 CLI 必须在 `.cache/cargo-target/cli/` 离线增量构建，并复制到 `.cache/native-runtime/runs/` 的唯一运行副本；旧运行副本可延迟清理，不能阻断新版本启动。

## Source-development JavaScript Runtime Bootstrap（0.1.0）

源码开发首次准备与 CI/Release 都只执行一次 Workspace `pnpm install`，消费当前项目依赖；不会在准备/构建时顺便追 Runtime latest。`scripts/runtime/update.mjs` 只服务用户明确选择的 `[8]`，定向刷新 Bun 与 OpenTUI/Solid。普通用户安装仍只消费已构建 portable/release 资产，不需要 pnpm、Bun 或源码 Runtime updater。Electron Chromium Runtime 仍只能由 Desktop Electron 安装器在用户明确选择后下载。


### `[1]` Workspace JavaScript 依赖真值

Windows `xma-dev.bat → [1]` **每次运行都必须在仓库根目录无条件执行一次原生 `pnpm install`**。不得因为 `node_modules` 已存在、prepare stamp/fingerprint 命中、工具探针通过或缓存存在而跳过；也不得给该命令套 registry/reporter/timeout 等 XMA 私有安装策略。`node_modules` 被删除时，pnpm 必须像开发者手工运行 `pnpm install` 一样重新创建并从 store/registry 恢复依赖；项目新增或调整依赖时，同一命令负责自动同步。

Windows PowerShell Bootstrap 还锁定“动作与返回值分离”：执行 `pnpm/cargo/npm/winget` 的动作函数只负责真实执行与实时终端输出，不返回业务对象；native success stream 必须送入 Host，避免上层 `$value = Function` 把安装进度捕获进变量。版本/路径/Runtime 信息必须由独立探针读取。
