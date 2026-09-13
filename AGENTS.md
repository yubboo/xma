# XMA 开发总规则（AI / 开发者第一阅读文件）

> 本文件是 Xiaoyu Management Agent（XMA / 小鱼管理智能体）的最高开发约束。任何 AI、脚本或开发者在修改项目之前，第一件事必须阅读本文件。

## 1. 项目身份

- 正式名称：**Xiaoyu Management Agent**
- 中文名称：**小鱼管理智能体**
- 简称：**XMA**
- GitHub：`https://github.com/yubboo/xma.git`
- CLI 主命令：`xiaoyu`（`xma` 只保留兼容别名）
- 核心理念：**Model is replaceable. Agent is ours. / 模型可以更换，小鱼始终属于用户。**
- 中文产品名与自称锁死为 **“小鱼 / 小鱼管理智能体”**；模型在中文回复中不得把 Xiaoyu 音译、误写或改名为“小禹 / 小宇 / 晓雨”等其他名称。Agent Context 必须显式注入这一 canonical identity，不能只依赖模型猜拼音。

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

### 3.1 Provider / Model Truth Contract（锁死）

- 用户当前选择的 `providerId + profileId + modelId` 必须就是每个真实模型请求的实际目标；禁止隐藏换模、降级到其他模型、用便宜模型代跑，除非用户明确选择并且该路由变化形成可见、可审计的 durable 事实。
- 同一 Turn 的 Agent Loop 默认持续把 Tool Result / Observation 返回给**同一个真实模型**继续推理；XMA Policy / Approval / Native Kernel 只约束副作用，不得替代模型做正常推理。
- **Provider 品牌身份 ≠ Protocol Adapter / Transport Family。** `DeepSeek`、`OpenAI`、`Claude` 等是用户看到并选择的真实服务身份；`OpenAI-compatible`、`Anthropic Messages`、`Gemini` 等是协议实现。品牌入口不得只是给通用 Base URL 表单换皮。
- 同一 Provider 品牌允许存在多个独立 Profile/账号；Secret、endpoint、model 与 capability 必须按 Profile 隔离。
- Provider 有真实模型目录 API 时，运行时可用 model ID 必须以真实目录为准；静态 bootstrap 只能用于首次配置，不能冒充实时可用模型列表。
- 一个品牌只有在真实 endpoint/auth/catalog/protocol 已实现后才允许进入“可配置/可使用”的 Provider Catalog；计划中的品牌不得用假卡片或假 Ready 冒充已经支持。
- `Brain Ready` 必须验证真实凭据、目标模型、最小文本请求；若声明 native tool calling，还必须完成最小真实 Tool Call → Tool Result → 同模型继续响应的 round trip。
- Provider-specific thinking/reasoning/tool/usage 能力必须按真实 API Contract 透传和验证；XMA 不伪造模型没有提供的能力，也不得为了统一接口主动把顶级模型能力裁成最低公分母。若 thinking+tools 协议强制要求隐藏续传状态，必须用 Adapter-owned opaque continuation 保持真实协议语义，不得因为 XMA 的统一消息格式把该能力静默关掉。
- **Canonical Tool Name ≠ Provider wire function name。** XMA Core/ToolPlan 可使用带 `.` / `:` / `/` 的稳定领域名；若目标 Provider 的 function/tool name 线协议更严格，必须只在 Provider Adapter 边界做稳定可逆映射，并在模型 Tool Call 回流时恢复 canonical 名。禁止为了迎合某一家 API 改坏 Core Tool identity，也禁止把不合法 canonical 名原样发送导致真实模型请求失败。
- Provider/Profile/Model 配置属于可恢复的产品交互：凭据写入、Profile 保存、模型发现、Probe 任一步失败都必须在当前 Host 内明确提示并保持进程可用；禁止未处理 Promise/异常因为“Brain 未配置/模型目录失败”直接终止 CLI/TUI。Profile 一旦持久化成功，后续模型目录或 Probe 失败不得反向伪装成“Provider 保存失败”或清除已保存 Profile。

## 4. Agent / Workspace / Plugin / Skill / Host 边界

- **Agent**：专业身份与能力组合；主 `Xiaoyu` 是 Manager Agent，Code/Minecraft/Writer/GameDev 等是可组合的专业 Agent。
- **Workspace**：Agent 的工作领地和持久状态边界。
- **Plugin**：可以注册/卸载的程序能力模块。
- **Skill**：给运行中模型读取的专业工作方法、约束、流程和交付标准，不是硬编码流水线。产品级 Skill canonical source 位于根 `skills/`。
- **Knowledge**：相对稳定的领域资料；实时事实必须优先通过 Tool/API 查询。
- **Host**：承载 XMA Agent/Skill 的第三方 Agent Runtime，例如未来 Codex、Claude Code、DeepSeek Harness、Zcode；Host 不是 Provider。

`Agent ≠ Model ≠ Skill ≠ Plugin ≠ Workspace ≠ Host`。AgentDefinition 不绑定具体模型厂商；同一个 Agent/Skill 应能在不同 Provider、不同 Host 上复用。默认情况下，一个 Agent 不得修改其他 Agent 的 Workspace。

根 `skills/` 与 `.agents/skills/` 必须严格区分：前者是 XMA 产品 Runtime Skill，后者是开发 XMA 的 AI 编程工具指南。

### 4.1 Agent / Skill Platform 硬规则（锁死）

- 主 Xiaoyu 是 Manager Agent，长期负责计划、委派、跟踪和验收；专业 Agent 复用同一 AgentRuntime，不得复制平行内核。
- AgentDefinition / Agent Registry / Delegation canonical Contract 位于 `packages/xma-agent-loop/`；产品 Skill 内容位于根 `skills/`，迁移期 Skill Loader/Registry 仍由 `core/` Compatibility Facade 承载，后续只允许继续迁出。
- Skill 必须通过 Context Assembly 进入模型；动态 model-visible Skill/Agent 文本必须形成 durable Context Snapshot，禁止 UI 临时 state 偷偷注入。
- Skill metadata 声明需要的 Tool/Brain capability；Agent 绑定不满足要求时必须 fail loud。
- Multi-Agent 任务必须使用稳定 Task/Delegation Contract；禁止多个 Agent 依赖无法审计的随意字符串互聊。
- 当前没有真实实现的 Writer/Minecraft/GameDev/Art 等 Agent 不创建空目录或“ready”假状态。
- 外部 Host Adapter 只能位于 Integration/Compatibility 层；Core 禁止出现 `codex-agent.ts`、`claude-agent.ts` 等宿主专属平行 Agent。

## 5. 插件规则：Everything is a Plugin + DeepSeek Harness 兼容

XMA 正式采用 **Everything is a Plugin** 方向。Provider、Tool、Context Source、Memory、Session Projection、Approval Policy、Sandbox Provider、Subagent、Workflow、Browser、Computer、Artifact、Search/MCP/Git、UI Extension 与 Telemetry 等能力，默认通过稳定 Plugin / Capability seam 接入；Agent Loop 只保留最小且稳定的 Turn/Step 生命周期，不成为功能垃圾场。

`xma-plugin` 至少提供：稳定 `ctx.<service>` Service 容器、显式 `inject`、`apply(ctx)` mount 生命周期、`effect()` / disposer 可逆副作用、类型化事件、Agent/Session/Workspace scope，以及 mount/unmount/reload。任何注册都必须可撤销，卸载后不能遗留 listener、timer、tool、provider 或幽灵状态。

XMA Plugin Runtime 同时支持两条路径：

1. **XMA Native Plugin**：XMA 自己的稳定 Plugin Contract；
2. **DeepSeek Harness / Cordis Compatibility**：以真实 DSH/Cordis 行为为兼容目标，不只模仿 API 外形。兼容分 Contract / Service / Package / Behavior 四级，并由 Conformance Tests 证明。

兼容层不得让 Rust Kernel 依赖 DSH 内部源码。当前兼容插件位于 `plugins/dsh-compat/`，对外 package 名为 `xma-plugin-dsh`；兼容必须由 Contract / Service / Package / Behavior 分级和 Conformance Test 证明。

**Everything is a Plugin 不等于 Everything can bypass security。** 任何真实文件、进程、网络、系统副作用都必须走 `xma-tools / capability → Policy / Approval → xma-native → Rust Security Kernel`。插件不得用 Node `child_process`、无约束 `fs` 等方式绕过 Native policy。

## 6. 目录规则：`xma-*` 稳定能力包 + 兼容迁移

长期顶层结构固定为：

- `apps/`：CLI、Desktop、Web、Server 外壳；
- `packages/`：稳定 XMA Agent Platform 能力包，统一 `xma-<capability>` 命名；
- `core/`：0.1.x 迁移期 compatibility facade / 尚未迁出的 TypeScript Core；
- `agents/`：Xiaoyu Manager 与已实际开发的专业 Agent；
- `skills/`：XMA 产品级专业 Skill；
- `plugins/`：迁移期 Provider/Tool/Integration/Compatibility 与产品插件；
- `native/`：Rust Native/Security/Performance Kernel；
- `scripts/`：开发、同步、构建、发布、Gate；
- `docs/`：架构、计划、规则、安全文档。

Platform Skeleton v1 已建立：`xma-agent-loop`、`xma-ai`、`xma-plugin`、`xma-session`、`xma-tools`、`xma-context`、`xma-native`。`xma-memory`、`xma-task`、`xma-subagent`、`xma-workflow`、`xma-browser`、`xma-computer`、`xma-artifact` 只有进入真实开发阶段才允许创建，禁止空 package 占位。

`xma-*` 表示 **XMA ownership of interface / source / test / release**，不表示必须从零发明内部实现。成熟上游已经解决的问题必须先研究再实现。普通 helper 仍留在所属 package 内，禁止把 Everything is a Plugin 误解成微包地狱。

### 6.1 命名与模块粒度（锁死）

XMA 文件/目录命名必须让开发者只看路径就能判断领域和职责。固定规则：

- 产品目录与 TypeScript / TSX / PowerShell 文件使用**小写 kebab-case**，例如 `model-provider/`、`agent/registry.ts`、`xma-build-release.ps1`；
- `packages/` 下稳定平台包统一命名为 **`xma-<capability>`**，例如 `xma-agent-loop`、`xma-ai`、`xma-plugin`；禁止使用上游品牌名作为 XMA 主包名；
- Rust 模块文件遵循 Rust 生态使用 **snake_case**，例如 `host_policy.rs`；`main.rs` / `lib.rs` / `build.rs` 等官方约定名保持不变；
- `.` 只表达文件角色/工具约定，不用于普通单词分隔：统一使用 `*.test.ts`、`*.config.ts`、`*.d.ts`；`package.json`、`Cargo.toml`、`tauri.conf.json` 等生态固定名保持官方名称；
- `docs/` 的正式架构/开发/安全文档使用 `UPPER-KEBAB.md`；`README.md`、`AGENTS.md`、`CLAUDE.md` 等固定入口例外；
- 普通文件名/目录名优先 **1～3 个核心词**，不得靠堆词描述整句职责；路径已经表达领域时，文件名禁止重复父目录，例如 `session/store.ts`，不要 `session/session-store.ts`；
- **同逻辑优先聚合，不按 class/interface/helper 碎拆文件。** 只有职责、生命周期或安全边界确实不同才拆，例如 `tool/router.ts`、`tool/policy.ts`、`tool/schema.ts`；
- 一个领域通常达到 3 个左右稳定文件、或已经有独立生命周期时才建立子目录；只有 1～2 个小文件时保持扁平，禁止为了“架构感”制造单文件目录；
- 顶层源码开发入口 `xma-dev.bat`（Windows）/ `xma-dev`（Linux/macOS）、维护者入口 `XMA-GitHub.bat` / `XMA-Sync.bat` 以及平台脚本属于稳定外部入口；命名必须明确区分源码开发与正式产品命令。
- 新增/改名文件必须通过 `pnpm gate:naming`。Naming Gate 负责可机械判断的大小写、分隔符、长度和已锁定分组；“是否应该拆文件”仍需按本节架构语义人工判断。 Naming Gate 只治理 XMA 自己维护的源码/配置，必须递归忽略 `node_modules/.cache/dist/build/target/release` 等第三方依赖、缓存与生成目录。

当前平台主要 ownership 已迁到：`packages/xma-agent-loop/`、`packages/xma-ai/`、`packages/xma-plugin/`、`packages/xma-tools/`、`packages/xma-session/`、`packages/xma-context/`、`packages/xma-native/`；插件按本体聚合在 `plugins/deepseek/`、`plugins/native-tools/`、`plugins/dsh-compat/`。`core/` 只允许 Compatibility Facade 与尚未迁出的薄层。

### 6.2 目录可发现性与稳定导入（锁死）

- **Predictable Location Rule**：看到能力名应能基本猜到主要目录；根 `CODEMAP.md` 必须实时维护“能力 → 目录”索引。
- **Feature Cluster Rule**：模块内部按真实功能簇分类，例如 `provider/`、`streaming/`、`process/`、`filesystem/`、`persistence/`；禁止主要按 `classes/interfaces/helpers/utils` 分类。
- **Shallow Structure Rule**：默认优先 `领域 / 功能簇 / 文件`；只有平台差异、独立生命周期或复杂子系统才允许继续加深，禁止无意义单文件目录链。
- **Plugin Cohesion Rule**：一个插件优先完整共置在 `plugins/<plugin>/`；不得把同一个插件按 Provider/Tool/Context/Session 类型拆散到多个顶层目录。
- 同一功能只有 1～3 个小文件时优先平铺；约 4～6 个稳定同类文件或出现真实子系统边界时再建功能目录。
- 跨 `apps/`、`agents/`、`packages/`、`plugins/`、`core/` 的代码只允许通过稳定公共 package 名导入；禁止 `../../`、`../../../`、`../../../../` 等路径穿越感知另一 ownership 的物理位置。
- package / plugin / agent 的公共入口必须由 `package.json -> exports` 暴露；依赖方必须用 `workspace:*` 声明依赖。禁止从 `xma-ai/src/...`、`xma-tools/src/...` 等内部路径偷穿 package 边界。
- 同一 package 内允许 `./` 和必要的 `../` 短相对引用；出现 `../../` 应优先重新检查目录或 ownership。
- `misc/`、`common/`、`helpers/`、`utils/` 不得成为大型垃圾桶目录。

### 6.3 实时工程更新记录（锁死）

- `docs/development/UPDATE-LOG.md` 是给后续 AI / 开发者恢复工程上下文的固定入口；每完成一批可独立说明的改动必须实时追加。
- 条目编号只增不改，固定使用 `##01`、`##02`、`##03`……；每条至少说明：目的、当前架构、锁定规范、主要变更、验证状态与下一步。
- UPDATE-LOG 不是 Git commit 或用户发行说明的替代品；它必须使用专业、直白、长期可理解的文件名和术语，禁止创建 AI 自己都难以解释的临时 Markdown 名称。
- 目录 ownership、公共 package、Stable Import 或核心开发规则变化时，必须同步更新 `CODEMAP.md`、相关架构文档和 UPDATE-LOG。

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
2. `CODEMAP.md`
3. `docs/development/UPDATE-LOG.md`
4. `docs/architecture/PROJECT-ARCHITECTURE.md`
5. `docs/architecture/AGENT-ENGINE-STRATEGY.md`
6. `docs/architecture/DIRECTORY-STRUCTURE.md`
7. `docs/architecture/LANGUAGE-OWNERSHIP.md`
8. `docs/architecture/AGENT-RUNTIME.md`
9. `docs/architecture/AGENT-PLATFORM.md`
10. `docs/architecture/WORKSPACE.md`
11. `docs/architecture/MODEL-PROVIDER.md`
12. `docs/architecture/PLUGIN-SYSTEM.md`
13. `docs/architecture/DESKTOP-RUNTIME.md`
14. `docs/architecture/DESKTOP-WORKBENCH.md`
15. `docs/architecture/DISTRIBUTION.md`
16. `docs/development/DEVELOPMENT-RULES.md`
17. `docs/development/DEVELOPMENT-PLAN.md`
18. `docs/development/PROJECT-STATUS.md`
19. `docs/development/UPSTREAM-REFERENCE.md`
20. `docs/development/VERSIONING-AND-RELEASES.md`
21. `docs/development/WINDOWS-WORKFLOW.md`

文档专业命名，但正文必须有中文说明，避免只有术语没有解释。

## 9. 版本规则（锁死）

采用百补丁进位：

`0.1.0 → 0.1.1 → ... → 0.1.100 → 0.2.0`

- 同一个未冻结版本内修复：仍然使用同一版本号重新打包。
- 已冻结版本后的下一次改动：按计划递增 patch。
- patch 到 `100` 后，下一个大阶段升级 minor，例如 `0.1.100` 后进入 `0.2.0`。
- 禁止包名：`hotfix`、`fixed`、`final`、`v2`、`new` 等临时后缀。
- 交付文件固定：`xma-<version>.zip` 与 `xma-<version>.sha256.txt`。

## 10. Windows 开发与源码引导流程（锁死）

公共 Git clone / 源码开发入口必须与机器路径无关：Windows 使用根 `xma-dev.bat`，Linux/macOS 使用根 `xma-dev`；二者只能从自身位置解析仓库根，禁止硬编码 `H:`、用户目录或任意开发者机器绝对路径。源码开发入口必须带 `-dev`，不得占用安装后正式产品命令 `xma`。

`H:\一键部署\xma` 仅是当前维护者 Source Manifest 工作流默认目录；换机可通过 `XMA_TARGET_ROOT` 覆盖。Git clone 用户不需要运行 `XMA-Sync.bat`。

源码包解压示例：

`H:\一键部署\xma-0.1.0`

固定流程：

`XMA-Sync.bat` → 同步到 `H:\一键部署\xma` → `XMA-GitHub.bat` → `1. 一键推送`

源码开发/构建：Windows 使用 `xma-dev.bat`；Linux/macOS 使用 `./xma-dev`。正式安装后的产品命令仍是 `xiaoyu` 主命令与 `xma` 兼容别名。

所有 BAT 只负责稳定启动；复杂逻辑必须放到配套 PowerShell：

- `xma-dev.bat` → `scripts/windows/xma-console.ps1`
- `xma-dev` → `scripts/unix/xma-console.sh`
- `XMA-GitHub.bat` → `scripts/windows/xma-github.ps1`
- `XMA-Sync.bat` → `scripts/windows/xma-sync.ps1`
- 正式源码包必须携带 `.xma-package/source-manifest.json`；Sync 按 Manifest 精确管理源码，新增目录自动同步，删除/重命名自动清理。同步结果必须区分本次“新增 / 更新 / 删除 / 未变化”，Manifest 总文件数不得冒充本次实际变更数；完整变更清单保存到目标工作目录 `.xma/source-sync-last.txt`。禁止用全局目录名排除规则误伤 `scripts/release/` 等正式源码目录。

BAT/PS1 必须在成功和失败后保留窗口，并有明显颜色状态提示。

Windows PowerShell 5.1 读取 `package.json`、JSON 配置或任何 UTF-8 中文文本时必须显式指定 `-Encoding UTF8`。不得依赖系统默认代码页；这是固定兼容规则，并由 Windows Helper Gate 检查。

Windows 一键环境准备必须提供清晰中文阶段提示：至少包含“正在检查 / 已通过 / 缺少 / 正在安装或升级 / 正在验证 / 完成”。不得只输出机械步骤编号后直接执行长耗时命令。

pnpm 11 的依赖安装脚本采用**显式白名单**。允许执行 install/postinstall 的依赖必须写入根 `pnpm-workspace.yaml` 的 `allowBuilds`，禁止使用 `dangerouslyAllowAllBuilds` 或交互式 `pnpm approve-builds` 作为固定工作流。新增白名单项必须有项目构建需求和代码审查依据。

### GitHub 推送职责边界（锁死）

- `XMA-GitHub.bat` / `xma-github.ps1` 是**纯 Git 工具**，只允许执行 Git 仓库初始化/状态、安全扫描、远端同步、暂存、提交、Push。
- `XMA-GitHub.bat` / `xma-github.ps1` 必须拒绝包含 `.xma-package/source-manifest.json` 的正式源码包/解压目录；首次 `git init` 只允许发生在已经由 `XMA-Sync.bat` 建立 `.xma/source-sync.json` 的长期工作目录。禁止在 `xma-<version>` 源码包目录静默创建第二个 Git 仓库。
- GitHub 推送流程严禁调用 `xma-prepare.ps1`，严禁执行 `pnpm install`、`pnpm rebuild`、`cargo fetch`、Electron/Tauri 依赖准备、winget 安装或任何环境准备。
- 依赖下载和环境安装只允许由显式源码开发准备入口（Windows `xma-dev.bat → [1]`、Linux/macOS `./xma-dev prepare`）、开发运行或构建发布流程触发；普通用户 `xma-install.*` 只允许安装预构建发行资产，不得转成源码构建。
- GitHub Helper 若发现 Git 本身不存在，只能提示用户先运行 `xma-dev.bat → [1] 一键准备开发环境`，不得擅自安装。
- Git 提交必须同时受 `.gitignore` 与 GitHub Safety 二次校验保护；即使文件被误暂存，禁止路径也必须拒绝提交。Windows Git Helper 暂存 Unix 公共入口时必须通过 `git update-index --chmod=+x` 保留 `xma-dev` / Unix shell 脚本 executable bit。
- 必须提交用于可复现构建的源码锁文件，例如 `pnpm-lock.yaml`、`Cargo.lock`；不得提交依赖目录、构建产物、运行数据、用户工作区、Secret、安装包和本地缓存。

## 10.1 Distribution / Terminal 产品入口（锁死）

- XMA 对外 Terminal 主命令固定为 `xiaoyu`；`xma` 只作为兼容别名，不再作为品牌主入口。
- CLI/TUI、Desktop、Server、Web 都是同一 Core/App Protocol 的 Host，禁止各自复制 Agent Loop。
- 普通用户安装必须使用**预构建发行资产**；禁止要求用户 clone 源码、执行 `pnpm install`、`cargo build`、安装 MSVC 或把 `node_modules/.cache/target` 打进安装包。
- Windows 默认每用户安装到 `%LOCALAPPDATA%\Programs\Xiaoyu`，只修改 User PATH；Linux/macOS 默认使用 `~/.local/bin` + `~/.local/share/xiaoyu`，不默认要求 root。
- `scripts/install/xma-install.ps1` 与 `scripts/install/xma-install.sh` 是独立 bootstrap，必须先做 SHA-256 校验和 staging 验证再替换正式安装；公网一行安装命令只有在域名/Release 资产真实部署后才允许宣称可用。
- portable Terminal bundle 第一批内置 Node Runtime、bundled CLI/Server/Web 与 Rust Native Kernel；未来可评估 Node SEA，但不能因此破坏可验证升级和安全边界。
- Terminal 打开 Home/文件系统根目录必须显式警告，默认退出，只允许用户“仅本次信任”；不得因为 CLI 方便绕过 Workspace/Tool/Native 权限。
- Terminal Home/Prompt Dock 必须按终端高度保留可操作留白；命令/设置/Provider/模型等 Overlay 打开时必须进入 modal focus，背景输入区只保留紧凑状态 Dock，并隐藏无关快捷键/提示，禁止 Overlay 与 Prompt 在常见 Windows Terminal 高度下视觉挤压。对话区、输入 Dock、快捷键与提示区之间必须保留稳定空行，不能把所有组件堆在底部。Terminal 模式固定支持 `Build → Plan → Compose (legacy)`，Tab / Shift+Tab 循环切换：Build 使用完整 ToolPlan，Plan 只暴露只读工具，Compose 不暴露 Workspace 工具；三者继续使用用户当前选择的同一个真实 Provider/Model，禁止把 Plan 实现成隐藏 Planner。Prompt Dock 必须持续显示 Mode + Provider/Model + Reasoning，并用稳定颜色区分状态。品牌 Provider 首次配置流程优先固定为 API Key → 真实模型 → 推理强度 → Brain Ready，避免无关表单打断主路径。
- **Terminal 实时输出锁死：** Provider SSE 的 `reasoning/text delta` 必须先进入 Runtime live event，再由 TUI 在生成过程中持续投影；Tool Call / Tool Result 也必须在执行链推进时可见。禁止把整轮文本缓存到 `sendMessage()` 完成后才一次性显示。UI 只展示 Provider 实际返回、允许展示的 reasoning；Provider 不返回时不得伪造思维链。当前固定 `@earendil-works/pi-tui@0.74.0` 存在差分聊天区域漏刷风险，Host 必须采用受控的强制 repaint/等价机制保证流式增量真实上屏，且要限制刷新频率避免每 token 全屏清屏。
- 发行 staging 属于 `.cache/release/`；正式下载资产属于 `dist/release/`；两者都不得提交 Git。

详细合同见 `docs/architecture/DISTRIBUTION.md`。

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

- Windows 源码开发首次运行推荐 `xma-dev.bat -> [1] 一键准备开发环境`；Linux/macOS 使用 `./xma-dev prepare`。两者只服务源码开发，不能与正式 `xma` 产品命令混淆。
- `[1]` 使用 `pnpm install --ignore-scripts`，因此可以准备 Electron/Tauri 的 JavaScript package，但**不得**触发 Electron Chromium Runtime 下载。
- Web / CLI 在 `[1]` 成功后不得再次执行 `pnpm install`、`pnpm rebuild esbuild` 或其他重复依赖安装。`[4] Xiaoyu Terminal` 例外必须在启动前执行 `cargo build --package xma-native-runtime --offline` 的增量校验构建：Source Sync 会保留 `.cache/`，因此严禁直接信任缓存中可能来自上一版源码的 Native 可执行文件。Windows CLI 构建必须使用 `.cache/cargo-target/cli/` 独立 target，并把构建结果复制到 `.cache/native-runtime/runs/` 的唯一 staging exe 后再启动，禁止直接运行/覆盖 Cargo target 中可能被旧进程锁定的 exe。该构建只使用 `[1]` 已预取 crates，不允许偷偷联网下载。
- TypeScript Host 启动 Native Runtime 后必须核对当前产品依赖的 capability 集；缓存/portable Native 缺少 `credential.*` 等必需能力时必须 fail loud 并给出重建/升级提示，禁止降级成“OS Credentials 不可用”后让用户在配置流程里无提示失败。
- Desktop 采用 **Electron 41.2.0 主运行时 + Tauri 2 备用运行时**：Electron Chromium Runtime 只允许在明确选择 Electron 后由 `apps/desktop/scripts/electron/install-runtime.ts` 按需下载；Tauri 2 Rust crates 只允许在明确选择 Tauri 2 或对应构建时预取。
- `esbuild` 是 Vite/tsx/tsup 的内部依赖，不要求根目录存在 `node_modules/.bin/esbuild`；禁止用 `pnpm exec esbuild` 作为通用环境验证。应通过 `tsx`/Vite/tsup 的真实调用验证其 Native Binary。
- 构建发布可以补齐用户明确选择的 Desktop Runtime，但应复用 `[1]` 已准备的通用依赖，不重复安装 Workspace。
- XMA 自己控制的开发/编译中间产物统一进入 `.cache/`：根 Rust 使用 `.cache/cargo-target/`，Tauri Rust 使用 `.cache/tauri-target/`，Desktop staging 使用 `.cache/desktop/`。正式可交付产物统一进入根 `dist/`。仓库根 `build/` / `target/` 与 `apps/desktop/dist|web|release|native` 只视为旧版遗留目录并应清理，禁止重新成为正常输出。
- `[7] 全量检查` 不自动下载依赖；缺失时提示先运行 `[1]`，Rust 使用 offline 检查。


## Desktop 技术栈硬规则

- XMA Desktop 固定采用 **Electron 41.2.0 主运行时 + Tauri 2 备用运行时**。
- Electron 必须精确锁定 `41.2.0`，不得用 `^` 自动漂移；升级必须经过显式任务和验证。
- Electron / electron-builder 只能存在于 `apps/desktop/`，禁止放到根 `package.json` 让 Web/CLI/Core 被迫下载桌面运行时。
- `xma-dev.bat -> [1] 一键准备开发环境` 可以安装 Electron package 元数据但严禁执行 Electron postinstall；只有 Desktop -> Electron 或 Electron 构建才下载 Chromium Runtime；`electron` 不进入 pnpm `allowBuilds`，并禁止用 `pnpm rebuild electron` 触发隐式下载。
- Electron 发布包通过 `file://` 加载打包 staging 中的 `web/`；Desktop staging 固定在 `.cache/desktop/electron/app/`，其中 Web 构建必须使用相对资源基址 `--base ./`。禁止重新生成 `apps/desktop/web/` 或 `/assets/...` 绝对路径，否则安装后会出现只有原生窗口、Web UI 空白的故障。
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
- **Model Intelligence Preservation Contract**：旗舰模型负责理解任务、判断下一步、选工具、基于 Observation 修正方案、决定是否需要子 Agent 和何时完成；Framework 提供真实能力、状态、安全和审计，不得再用隐藏 Planner、固定决策树或缩水 Tool Surface 替模型思考。
- **Skill 是增强，不是限制**：Skill 提供专业知识、经验、边界和验收标准；不得把强模型强制塞进固定 A→B→C 流程，也不得因为绑定 Skill 就缩小本可用的工具面。
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
- Workspace 是 stable identity + roots + owner，不是裸 cwd；Stage D 新 Session 的 Workspace 安全身份必须冻结到 Session Header，并在 resume 时校验 descriptor digest。
- 新 Session 默认只能绑定 Owner Agent 自己的 Workspace；跨 Agent Workspace 访问必须使用用户显式 durable grant，默认 deny。
- Tool 声明的 Workspace access 必须在 Approval/execute 前经过单调 Workspace Security Guard；Approval 不能把 Workspace deny 变成 allow。
- 跨 Workspace Context Source 在 render 前必须通过 read authorization，且 durable context source 记录目标 workspaceId。
- Native Tool 必须绑定稳定 workspaceId；TypeScript Workspace policy 与 Rust roots/capability enforcement 必须同时存在，任一层都不能被当成另一层的替代。

## 13. 上游优先开发纪律（锁死）

XMA Agent Platform 采用 **Upstream-first Development Rule** 与 **No Blind Reinvention Rule**。基础能力开工前必须先研究成熟上游的真实源码、测试、协议和失败处理；“我们自己也能写”不构成重新实现的理由。只有上游方案明确不满足 XMA Contract / Security / Language Ownership 时，才允许设计不同方案，并记录差异。

当前五个主要上游角色固定为：

- **Pi**：Agent Loop、streaming、tool calling、parallel/sequential tool execution、steering/follow-up、multi-provider AI；
- **DeepSeek Harness**：Everything is a Plugin、Cordis Service/Event/Effect、Session/Tool/Agent capability seam、Subagent/Workflow extension；
- **OpenAI Codex**：Approval、Sandbox、Process/Tool execution、Thread/Turn/Session、multi-agent、App Protocol；
- **MiMo Code**：Context compaction/reconstruction、Memory、Checkpoint、Task Tree、Subagent、Workflow、Skill discovery、长期任务成本；
- **Minecraft Host Agent (MCHA)**：Minecraft 专业 Agent、Agent-First、领域 Skill/Knowledge/Tools、真实上游查证、mod、服务器生命周期、内网穿透和场景 E2E。

固定提交、许可证、路径级映射和吸收/拒绝项见 `docs/development/UPSTREAM-REFERENCE.md`。重要子系统开工前必须记录：对应上游目录、实际读过的源码/测试/协议、吸收的 invariant、拒绝理由、XMA 必要差异和真实 E2E 证据。

接口、产品身份和最终实现归 XMA。可以参考、选择性移植或按成熟实现重构，但不得把上游远程服务/包变成 XMA 核心运行的不可控黑盒。任何实质代码复制/改编仍需遵守对应许可证；产品 UI、公共 API、包名和主叙事统一使用 XMA 命名。

完整战略见 `docs/architecture/AGENT-ENGINE-STRATEGY.md`。

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
