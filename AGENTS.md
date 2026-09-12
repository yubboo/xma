# XMA 开发总规则（AI / 开发者第一阅读文件）

> 本文件是 Xiaoyu Management Agent（XMA / 小鱼管理智能体）的最高开发约束。任何 AI、脚本或开发者在修改项目之前，第一件事必须阅读本文件。

## 1. 项目身份

- 正式名称：**Xiaoyu Management Agent**
- 中文名称：**小鱼管理智能体**
- 简称：**XMA**
- GitHub：`https://github.com/yubboo/xma.git`
- CLI 命令：`xma`
- 核心理念：**Model is replaceable. Agent is ours. / 模型可以更换，小鱼始终属于用户。**

XMA 不是某一家大模型的外壳，也不是 Minecraft 专用工具。XMA 是用户拥有的 Agent 平台。GPT、Claude、Gemini、DeepSeek、MiMo 以及未来模型都只是可替换的外部 Brain Provider。

## 2. 语言所有权（锁死）

**TypeScript = 产品 / Agent / 业务主语言。**

TypeScript 负责：Agent Loop、Provider、Plugin Host、Workspace、Memory、Session、Context、Skills、Knowledge、Tool Registry、MCP、CLI/TUI、Desktop/Web、各专业 Agent 业务逻辑。

**Rust = Native / Security / Performance Kernel。**

Rust 负责：PTY/ConPTY、进程生命周期、文件系统限制、Sandbox、Capability、原生网络、Hash/Archive、系统集成和必要的高性能本地能力。

> TypeScript decides WHAT to do. Rust guarantees HOW native side effects are executed safely.

禁止：把 Agent 推理、Minecraft 决策、Writer 决策或模型路由下沉到 Rust。

## 3. 模型与 Agent 的关系（锁死）

- XMA 不训练、伪装或内置一个“低智商小鱼模型”。
- 用户配置哪个真实厂商模型，哪个模型就是当前 Run 的推理核心。
- 不得用关键词路由、固定决策树、隐藏 Planner 替代模型推理。
- Framework 可以限制权限、Schema、生命周期和副作用，但不能抢走正常任务的推理权。
- UI/TUI 必须展示真实 Provider、Model、Reasoning/能力、延迟和可获得的使用统计。

## 4. Agent / Workspace / Plugin / Skill 边界

- **Agent**：专业身份与能力组合，例如 Minecraft、Code、Writer。
- **Workspace**：Agent 的工作领地和持久状态边界。
- **Plugin**：可以注册/卸载的能力模块。
- **Skill**：给模型的专业决策指南，不是硬编码流水线。
- **Knowledge**：相对稳定的领域资料；实时事实必须优先通过 Tool/API 查询。

默认情况下，一个 Agent 不得修改其他 Agent 的 Workspace。

## 5. 插件规则：XMA 原生 + DeepSeek Harness 兼容

XMA Plugin Host 必须支持两条路径：

1. **XMA Native Plugin**：XMA 自己的插件 Contract。
2. **DeepSeek Harness / Cordis Compatibility**：以 DeepSeek Harness 当前 Cordis 插件约定为兼容目标，包括：
   - `inject` 服务依赖声明；
   - `apply(ctx)` 生命周期；
   - 稳定 `ctx.<service>` Service 容器；
   - 类型化事件/事件分发；
   - `effect()` / disposer 的可逆副作用；
   - plugin mount / unmount / reload 生命周期。

兼容层不得让 XMA Kernel 依赖 DeepSeek Harness 的内部源码。兼容适配放在 `plugins/compat/deepseek-harness/`。

**兼容性声明必须基于 Conformance Tests。没有测试通过的 DSH 专属 Service 不得宣称“完全兼容”。** 我们的目标是尽可能达到完整兼容，但文档必须区分“兼容目标”和“已验证能力”。

## 6. 目录规则：保持清楚，不要过度拆包

顶层核心区域只保留：

- `apps/`：CLI、Desktop、Web、Server 外壳；
- `core/`：XMA TypeScript 核心；
- `agents/`：专业 Agent；
- `plugins/`：跨 Agent 可复用插件与兼容层；
- `native/`：Rust Native Kernel；
- `scripts/`：开发、同步、构建、发布、Gate；
- `docs/`：架构、计划、规则、安全文档。

在模块真正长大前，不要把 `memory/context/session/tools/...` 每个都拆成独立 npm 包。

## 7. 中文注释与文件说明（强制）

所有核心 `.ts` / `.tsx` / `.rs` 文件顶部必须有中文文件说明，至少包含：

- 这个文件的作用；
- 与哪些模块关联；
- 当前实现的主要功能；
- 明确的职责边界或禁止事项（适用时）。

复杂逻辑、权限判断、协议边界和容易误解的设计必须有中文行内注释。不要给显而易见的赋值写无意义注释。

## 8. 文档要求（强制）

开发前必须优先阅读：

1. `AGENTS.md`
2. `docs/architecture/PROJECT-ARCHITECTURE.md`
3. `docs/architecture/DIRECTORY-STRUCTURE.md`
4. `docs/architecture/LANGUAGE-OWNERSHIP.md`
5. `docs/architecture/PLUGIN-SYSTEM.md`
6. `docs/development/DEVELOPMENT-RULES.md`
7. `docs/development/DEVELOPMENT-PLAN.md`
8. `docs/development/PROJECT-STATUS.md`
9. `docs/development/VERSIONING-AND-RELEASES.md`
10. `docs/development/WINDOWS-WORKFLOW.md`

文档专业命名，但正文必须有中文说明，避免只有术语没有解释。

## 9. 版本规则（锁死）

采用百补丁进位：

`0.1.0 → 0.1.1 → ... → 0.1.100 → 0.2.0`

- 同一个未冻结版本内修复：仍然使用同一版本号重新打包。
- 已冻结版本后的下一次改动：按计划递增 patch。
- patch 到 `100` 后，下一个大阶段升级 minor，例如 `0.1.100` 后进入 `0.2.0`。
- 禁止包名：`hotfix`、`fixed`、`final`、`v2`、`new` 等临时后缀。
- 交付文件固定：`xma-<version>.zip` 与 `xma-<version>.sha256.txt`。

## 10. Windows 固定开发流程（锁死）

源码包解压示例：

`H:\一键部署\xma-0.1.0`

固定流程：

`XMA-Sync.bat` → 同步到 `H:\一键部署\xma` → `XMA-GitHub.bat` → `1. 一键推送`

开发/构建使用 `XMA.bat`。

所有 BAT 只负责稳定启动；复杂逻辑必须放到配套 PowerShell：

- `XMA.bat` → `scripts/windows/xma-console.ps1`
- `XMA-GitHub.bat` → `scripts/windows/xma-github.ps1`
- `XMA-Sync.bat` → `scripts/windows/xma-sync.ps1`

BAT/PS1 必须在成功和失败后保留窗口，并有明显颜色状态提示。

Windows PowerShell 5.1 读取 `package.json`、JSON 配置或任何 UTF-8 中文文本时必须显式指定 `-Encoding UTF8`。不得依赖系统默认代码页；这是固定兼容规则，并由 Windows Helper Gate 检查。

Windows 一键环境准备必须提供清晰中文阶段提示：至少包含“正在检查 / 已通过 / 缺少 / 正在安装或升级 / 正在验证 / 完成”。不得只输出机械步骤编号后直接执行长耗时命令。

pnpm 11 的依赖安装脚本采用**显式白名单**。允许执行 install/postinstall 的依赖必须写入根 `pnpm-workspace.yaml` 的 `allowBuilds`，禁止使用 `dangerouslyAllowAllBuilds` 或交互式 `pnpm approve-builds` 作为固定工作流。新增白名单项必须有项目构建需求和代码审查依据。

### GitHub 推送职责边界（锁死）

- `XMA-GitHub.bat` / `xma-github.ps1` 是**纯 Git 工具**，只允许执行 Git 仓库初始化/状态、安全扫描、远端同步、暂存、提交、Push。
- GitHub 推送流程严禁调用 `xma-prepare.ps1`，严禁执行 `pnpm install`、`pnpm rebuild`、`cargo fetch`、Electron/Tauri 依赖准备、winget 安装或任何环境准备。
- 依赖下载和环境安装只允许由 `XMA.bat` 的“一键准备环境”、开发运行或构建发布流程触发。
- GitHub Helper 若发现 Git 本身不存在，只能提示用户先运行 `XMA.bat → [1] 一键准备开发环境`，不得擅自安装。
- Git 提交必须同时受 `.gitignore` 与 GitHub Safety 二次校验保护；即使文件被误暂存，禁止路径也必须拒绝提交。
- 必须提交用于可复现构建的源码锁文件，例如 `pnpm-lock.yaml`、`Cargo.lock`；不得提交依赖目录、构建产物、运行数据、用户工作区、Secret、安装包和本地缓存。

## 11. 安全与发布底线

- Secret 不得提交 Git。
- 用户 Workspace、Runtime、Build cache 不得混入源码包。
- GitHub Safety Gate 只能扫描 Git 真正可能提交的文件，不能把 `.gitignore` 中的二进制缓存误判为 Secret。
- Desktop / CLI / Web 都复用同一 Core，不得各自复制 Agent Runtime。
- CI 绿不等于产品完成；产品能力必须有真实 Provider、Tool、Native、Workspace 或端到端证据。

- Windows PowerShell 外部命令包装函数禁止使用 `$args` / `$Args` 作为自定义参数名；统一使用 `ArgumentList` 并通过命名参数转发，避免 PowerShell 5.1 自动变量吞掉命令参数。

### Windows 外部命令统一执行规则

- `scripts/windows/xma-common.ps1` 是 Windows 外部命令执行的唯一公共入口。
- `xma-prepare.ps1`、`xma-github.ps1`、`xma-console.ps1`、`xma-build-release.ps1` 必须复用 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`。
- 禁止自行定义 `Run(..., $Args)`、`Invoke-External(..., $Args)` 或任何 `$Args/@Args` 参数转发。PowerShell 的 `$args` 是自动变量且大小写不敏感，曾导致 `pnpm check` 和 `rustup` 参数丢失。
- 新增 Git、pnpm、cargo、rustup、winget 等外部命令时，必须使用命名参数 `-FilePath` 与 `-ArgumentList`。


- Windows PowerShell 所有外部命令必须统一复用 `scripts/windows/xma-common.ps1` 的 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`；禁止私自实现 `Run(..., $Args)`、`Invoke-External(..., $Args)` 等包装器。

## Windows 依赖准备硬规则

- `XMA.bat -> [1] 一键准备开发环境` 是首次运行的唯一推荐入口：一次准备系统工具、全部 Workspace JavaScript 依赖元数据、esbuild Native Binary 与 XMA Native Rust crates。
- `[1]` 使用 `pnpm install --ignore-scripts`，因此可以准备 Electron/Tauri 的 JavaScript package，但**不得**触发 Electron Chromium Runtime 下载。
- Web / CLI 在 `[1]` 成功后只负责直接启动；不得再次执行 `pnpm install`、`pnpm rebuild esbuild` 或其他重复依赖安装。
- Desktop 采用 **Electron 41.2.0 主运行时 + Tauri 2 备用运行时**：Electron Chromium Runtime 只允许在明确选择 Electron 后单独 rebuild 下载；Tauri 2 Rust crates 只允许在明确选择 Tauri 2 或对应构建时预取。
- `esbuild` 是 Vite/tsx/tsup 的内部依赖，不要求根目录存在 `node_modules/.bin/esbuild`；禁止用 `pnpm exec esbuild` 作为通用环境验证。应通过 `tsx`/Vite/tsup 的真实调用验证其 Native Binary。
- 构建发布可以补齐用户明确选择的 Desktop Runtime，但应复用 `[1]` 已准备的通用依赖，不重复安装 Workspace。
- `[7] 全量检查` 不自动下载依赖；缺失时提示先运行 `[1]`，Rust 使用 offline 检查。


## Desktop 技术栈硬规则

- XMA Desktop 固定采用 **Electron 41.2.0 主运行时 + Tauri 2 备用运行时**。
- Electron 必须精确锁定 `41.2.0`，不得用 `^` 自动漂移；升级必须经过显式任务和验证。
- Electron / electron-builder 只能存在于 `apps/desktop/`，禁止放到根 `package.json` 让 Web/CLI/Core 被迫下载桌面运行时。
- `XMA.bat -> [1] 一键准备开发环境` 可以安装 Electron package 元数据但严禁执行 Electron postinstall；只有 Desktop -> Electron 或 Electron 构建才下载 Chromium Runtime。
- Tauri 2 只作为备用桌面运行时，Windows 使用系统 WebView2。
- 两种 Desktop Runtime 必须复用 `apps/web/` UI 与 `core/` Agent Runtime，不得复制业务内核。
- Electron/Tauri Shell 只负责窗口、系统桥接和桌面打包，不承担 Agent 推理。
- 详细策略见 `docs/architecture/DESKTOP-RUNTIME.md`.

> **重要：** 仓库根 `/runtime/` 是用户运行数据，禁止提交；`native/runtime/` 是 XMA Rust Native Runtime 源码，必须同步、提交并进入 CI。任何 ignore/sync/safety 规则都不得把两者混为一谈。
