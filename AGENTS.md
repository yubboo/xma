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
5. `docs/architecture/AGENT-RUNTIME.md`
6. `docs/architecture/MODEL-PROVIDER.md`
7. `docs/architecture/PLUGIN-SYSTEM.md`
8. `docs/architecture/DESKTOP-RUNTIME.md`
9. `docs/architecture/DESKTOP-WORKBENCH.md`
10. `docs/development/DEVELOPMENT-RULES.md`
11. `docs/development/DEVELOPMENT-PLAN.md`
12. `docs/development/PROJECT-STATUS.md`
13. `docs/development/UPSTREAM-REFERENCE.md`
14. `docs/development/VERSIONING-AND-RELEASES.md`
15. `docs/development/WINDOWS-WORKFLOW.md`

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
- Desktop 采用 **Electron 41.2.0 主运行时 + Tauri 2 备用运行时**：Electron Chromium Runtime 只允许在明确选择 Electron 后由 `apps/desktop/scripts/install-electron-runtime.ts` 按需下载；Tauri 2 Rust crates 只允许在明确选择 Tauri 2 或对应构建时预取。
- `esbuild` 是 Vite/tsx/tsup 的内部依赖，不要求根目录存在 `node_modules/.bin/esbuild`；禁止用 `pnpm exec esbuild` 作为通用环境验证。应通过 `tsx`/Vite/tsup 的真实调用验证其 Native Binary。
- 构建发布可以补齐用户明确选择的 Desktop Runtime，但应复用 `[1]` 已准备的通用依赖，不重复安装 Workspace。
- Cargo/Rust 编译缓存固定到项目 `.cache/cargo-target/`；Tauri 2 脚本使用 `.cache/tauri-target/`。仓库根 `target/` 只视为旧版遗留缓存并应清理；`dist/` 才是 XMA 产品构建/发布产物入口。
- `[7] 全量检查` 不自动下载依赖；缺失时提示先运行 `[1]`，Rust 使用 offline 检查。


## Desktop 技术栈硬规则

- XMA Desktop 固定采用 **Electron 41.2.0 主运行时 + Tauri 2 备用运行时**。
- Electron 必须精确锁定 `41.2.0`，不得用 `^` 自动漂移；升级必须经过显式任务和验证。
- Electron / electron-builder 只能存在于 `apps/desktop/`，禁止放到根 `package.json` 让 Web/CLI/Core 被迫下载桌面运行时。
- `XMA.bat -> [1] 一键准备开发环境` 可以安装 Electron package 元数据但严禁执行 Electron postinstall；只有 Desktop -> Electron 或 Electron 构建才下载 Chromium Runtime；`electron` 不进入 pnpm `allowBuilds`，并禁止用 `pnpm rebuild electron` 触发隐式下载。
- Electron 发布包通过 `file://` 加载 `apps/desktop/web/`，因此 Desktop 专用 Vite 构建必须使用相对资源基址 `--base ./`；禁止生成 `/assets/...` 绝对路径，否则安装后会出现只有原生窗口、Web UI 空白的故障。
- Electron Runtime 安装采用确定性链路：`@electron/get` 返回已校验 ZIP 路径后，Windows 必须使用系统 PowerShell `Expand-Archive` 解压到 staging，经版本/可执行文件校验后再原子替换 `dist` 并写 `path.txt`。Windows 固定使用系统解压链，避免把 Runtime 安装成功与 Node ZIP 流实现绑定；项目同时固定 `pnpm-workspace.yaml -> overrides.yauzl >= 3.3.1` 保护 Electron Builder 与非 Windows 构建链。
- Electron 下载 ZIP 默认缓存到 XMA 项目根 `.cache/electron/`，不得默认写入 Windows 用户 `%LOCALAPPDATA%`；`.cache/` 属于本地缓存，不进入源码包/Git，同步新版本源码时必须保留。用户显式设置 `electron_config_cache` 时允许覆盖。
- Tauri 2 只作为备用桌面运行时，Windows 使用系统 WebView2。
- 两种 Desktop Runtime 必须复用 `apps/web/` UI 与 `core/` Agent Runtime，不得复制业务内核。
- Electron/Tauri Shell 只负责窗口、系统桥接和桌面打包，不承担 Agent 推理。
- 详细策略见 `docs/architecture/DESKTOP-RUNTIME.md`.

> **重要：** 仓库根 `/runtime/` 是用户运行数据，禁止提交；`native/runtime/` 是 XMA Rust Native Runtime 源码，必须同步、提交并进入 CI。任何 ignore/sync/safety 规则都不得把两者混为一谈。

- Windows Electron Runtime 验证禁止直接执行 GUI `electron.exe --version` 并依赖 `$LASTEXITCODE`；使用 `dist/version + path.txt + executable` 三项状态校验，实际桌面进程由 Desktop 启动器负责。
- pnpm 11 的 dependency overrides 写入根 `pnpm-workspace.yaml -> overrides`；不要再使用会被 pnpm 11 忽略的 `package.json -> pnpm.overrides`。
- Electron 下载器中 `@electron/get.downloadArtifact` 必须先收窄成确定函数类型，strict TypeScript 下不得把可选函数跨异步闭包调用。


## 12. Agent Runtime / Provider / Tool 新硬规则（锁死）

- XMA 正式 Runtime 采用 **Session → Turn → Step** 语义：Session 是持久事实源；Turn 是一次用户驱动工作；Step 是一次模型请求及其 Tool Call 处理。
- **Model-visible ⇔ reconstructable**：任何进入模型请求的动态内容都必须能从 Session durable state 或有明确来源的 Context source 重建；UI 临时 state 不得偷偷影响模型。
- 模型流式 chunk / progress 属于 live event；最终 assistant/tool/approval/usage 等需要恢复或审计的事实必须 durable。
- Tool 必须通过 Schema → Policy/Plugin → Security Guard → Approval → Execute → Post-process/Redact → Durable Result 流水线；普通 Tool 失败结构化回模型，不得无故炸毁 Session。
- 需要 Approval 的副作用必须先把最终 Approval 决策 durable append，再执行真实副作用；`allow-session` 只有 Tool 提供稳定 scope key 才允许复用，禁止把一次参数批准无意扩成整个 Tool 授权。
- 每个 Step 的模型可见 Tool Schema 与实际可执行 Runtime 必须来自同一个冻结 ToolPlan。
- Native Capability 必须最小化并由 Rust 二次 enforcement；Native Runtime 先锁定 Host Policy，Tool lease 只能申请其子集；文件真实路径要 canonical confinement，进程不得用 `shell:true` 绕过 argv/allowlist。
- 新产品行为优先走 Provider/Tool/Context/Session/Plugin extension point；能通过扩展点完成时禁止修改 Agent Loop 塞特例。
- 完整 Capability 至少考虑 Definition / Provider / Consumer；只有接口或只有实现不算完成。
- Provider 不只是 `stream()`：必须逐步包含 capability、auth、model catalog、usage/error normalization、Brain Ready Probe；Provider-specific JSON/headers 不得散落 Core Loop。
- “Brain Ready / Provider supported”必须有真实 API 请求或目标 Runner E2E 证据；fixture/mock 不能改变产品支持状态。

## 13. 上游参考纪律（锁死）

XMA 长期参考三个上游，但**只吸收适合 XMA 的 Contract 和工程经验**：

- OpenAI Codex：Coding Agent Runtime、Thread/Turn、Tool Router、Provider、Permission/Sandbox、App Protocol；
- DeepSeek Harness：TypeScript Plugin Harness、Cordis Service/Event/Effect、Session、Tool Pipeline、Agent Loop extension；
- Minecraft Host Agent：Agent-First、Minecraft Skills/Knowledge/Tools、会话/用量/确认门、真实上游验证。

固定提交、许可证、路径级映射和吸收/拒绝项见 `docs/development/UPSTREAM-REFERENCE.md`。重要子系统开工前必须审阅对应上游固定 commit 下的相关目录全文件（源码 + README + 测试 + 协议），并记录吸收/拒绝理由。

任何上游若与 XMA 语言所有权冲突，以 XMA 为准：**禁止把 Codex/MCHA 的 Rust Agent/业务架构搬进 XMA Rust Kernel；禁止因 DSH 大量拆包而过度拆 XMA。** 实质复制/改编上游代码必须单独完成许可证/NOTICE/版权标注审查。

## 14. AI 开发上下文目录（锁死）

- 根 `AGENTS.md` 是所有 AI / 开发者最高规则和单一架构权威入口。
- `.agents/skills/` 是 XMA 公共 AI 开发 Skill 的单一事实源。
- `.codex/` 是 Codex 专用环境/Skills 入口；`.claude/` 与根 `CLAUDE.md` 是 Claude Code 入口。
- `.codex/.claude` 不得建立与 `AGENTS.md` 冲突的规则；公共 Skill 镜像必须由 Gate 校验与 `.agents/skills` 一致。
- XMA Windows-first，不依赖 Git symlink；AI 工具入口用普通文件/受检查镜像。
- AI 目录只保存开发规则、环境 action、Skill/命令说明；禁止保存 Secret、个人绝对路径、用户 Workspace、Session、私有 Prompt 或运行数据。

## 15. Backend First / Desktop Workbench 顺序（锁死）

当前 0.1.x **先做 Agent Runtime 与真实模型能力，不继续大规模堆 UI**。完整 Desktop UI 目标固定为现代三栏 Workbench：左栏默认展开，中间大 Workspace（Chat/Work），右栏 Inspector 默认收起，左右支持吸附拉伸，中央底部 Terminal 可展开，左下为用户/设置；详见 `docs/architecture/DESKTOP-WORKBENCH.md`。

完整 Workbench 开工前至少应具备：Session/Turn/Step durable Runtime、两个不同协议族真实 Provider、ToolPlan/Approval/Native Capability、Workspace persistence、App Protocol/Event Stream、PTY/Process Native 能力和 Xiaoyu Code 最小真实闭环。UI 不得反向成为 Agent 状态源。
