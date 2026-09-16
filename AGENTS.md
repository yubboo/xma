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
- **产品模型就绪**与**连接验证**分层：活动 `Provider/Profile/Model` 已真实保存且所引用凭据当前可读取时，产品状态必须表达“已就绪”；用户不需要额外执行连接测试。Terminal Prompt 主状态允许用绿色 `● + canonical model id` 表达正常 Ready，不要求长期重复“模型已就绪”文字；未配置/凭据不可读/真实发送失败仍必须明确显示异常，禁止用绿色 Ready dot 掩盖。`Brain Ready Probe / 连接测试` 保留为可选诊断与外部 Provider 验收证据：它仍必须验证真实凭据、目标模型、最小文本请求；若声明 native tool calling，还必须完成最小真实 Tool Call → Tool Result → 同模型继续响应的 round trip，但 Probe 结果不得反向把已配置且凭据可用的模型 UI 标成“尚未就绪”。
- Provider-specific thinking/reasoning/tool/usage 能力必须按真实 API Contract 透传和验证；XMA 不伪造模型没有提供的能力，也不得为了统一接口主动把顶级模型能力裁成最低公分母。若 thinking+tools 协议强制要求隐藏续传状态，必须用 Adapter-owned opaque continuation 保持真实协议语义，不得因为 XMA 的统一消息格式把该能力静默关掉。
- **Provider Error Normalization。** Provider wire/status/body 必须先在 `xma-ai` Adapter 边界归一为 canonical error code；余额不足、认证、权限、模型不存在、限流、超时、网络、上下文、服务端、协议错误等主 UX 必须使用 Host-neutral 友好文案。已脱敏的原始 wire detail 只能留作诊断，不得把 JSON dump 当成 Xiaoyu 正常回答；失败 Turn 必须保持 failed/cancelled 事实，不能伪装成功。
- **Canonical Tool Name ≠ Provider wire function name。** XMA Core/ToolPlan 可使用带 `.` / `:` / `/` 的稳定领域名；若目标 Provider 的 function/tool name 线协议更严格，必须只在 Provider Adapter 边界做稳定可逆映射，并在模型 Tool Call 回流时恢复 canonical 名。禁止为了迎合某一家 API 改坏 Core Tool identity，也禁止把不合法 canonical 名原样发送导致真实模型请求失败。
- 拆分后的 Dialog/Prompt 子模块必须自己 import 自己使用的 OpenTUI hook/helper；ES module 不会继承父文件 import。Provider Setup / Approval 等 modal 必须有局部错误隔离：某个 Dialog hook/render 失败只能结束当前交互并恢复主 Prompt，禁止让整个 TUI root、动画、键盘或命令面板一起失活。
- Provider/Profile/Model 配置属于可恢复的产品交互：凭据写入、Profile 保存、模型发现、Probe 任一步失败都必须在当前 Host 内明确提示并保持进程可用；禁止未处理 Promise/异常因为“Brain 未配置/模型目录失败”直接终止 CLI/TUI。Profile 一旦持久化成功，后续模型目录或 Probe 失败不得反向伪装成“Provider 保存失败”或清除已保存 Profile。
- `xiaoyu / xma` 每次交互式启动都必须先解析调用者当前目录并显示 Workspace Trust；授权只对本次启动有效，不得因为普通项目、历史信任或已有 Brain 而静默跳过。Home/文件系统根/Windows 系统目录继续作为高风险 Workspace，默认选择退出。
- Workspace Trust 通过后，只有当前没有已配置 Brain/Profile 时才自动进入**同一 Xiaoyu TUI 内的居中 Brain Setup**；Profile 已存在的后续启动不得重复强制弹出。`Ctrl+P → 模型 / 提供方` 是长期管理入口，始终保留，并与首次 Setup 复用同一 Provider/Model/Credential/Probe 能力。工作区信任选择“否，退出”是正常用户取消，必须干净退出，不能冒充运行失败。

### 3.2 Model Autonomy / User Permission Contract（锁死）

- **真实顶级模型拥有正常任务的行动决策权。** 当前 Provider Model 自己决定下一步、选哪个 Tool、是否重试、如何根据 Observation 改方案、何时验证、何时完成；Agent Loop/Skill/Plugin/Host 不得用固定业务流程、隐藏 Planner 或 UI 状态替模型做这些决定。
- **Skill / Specialist / Workflow 的默认职责是增强，不是降智。** Skill 提供领域知识、方法、边界和验收；专业 Agent 提供 loadout/context/tool capability；除用户显式选择只读/受限模式、Provider capability 不支持或安全 Policy 明确禁止外，不得因为“用了某个 Skill/专家”就缩小模型本来可用的 Tool Surface。
- **Tool Surface 是模型的行动能力。** 模型常用但当前缺失的文件、进程、Shell/PTY、Git、网络、Browser、MCP、Archive 等能力，应优先通过 `xma-tools` / Plugin / Native capability 补齐；不得把“Framework 没给手”包装成“模型不会做”，再把本可自动完成的步骤甩回用户手工执行。
- **Permission 决定副作用是否允许，不决定模型能不能思考。** 用户对文件/进程/网络/系统等真实副作用拥有最终控制权；Policy/Approval/Rust Kernel 只能 gate/约束执行，不能把已授权能力从模型面前隐藏成假不可用。
- XMA 产品权限模式统一为三档稳定语义：`ask`（**请求批准**）、`smart`（**替我审批**）、`full`（**完全权限**）。Host 可以有不同 UI，但必须映射到同一 Runtime Permission Profile，禁止 CLI/Desktop/Web 各写一套权限逻辑。
- **Work Mode 与 Permission Profile 是正交状态。** `Build / Plan / Compose` 决定当前模型可见 ToolPlan；`ask / smart / full` 决定已暴露 Tool 的 Approval 策略。Tab 只切 Work Mode，不得暗改用户权限；Plan 永远以只读 ToolPlan 作为能力上限，即使 `full` 也不能获得写入/执行 Tool。
- **Xiaoyu 不是第二模型。** Xiaoyu 是产品/Agent identity；每个 Step 的唯一推理模型必须是用户当前真实选择的 `providerId + profileId + modelId`。禁止隐藏换模、代理模型代跑或把 `Xiaoyu` 当 Model ID。
  - `ask`：需要副作用的调用按 Policy 请求用户批准；用户批准后必须在**同一 Turn / 同一任务**继续执行，不得要求用户重新发送“继续”。
  - `smart`：当前 Workspace/任务范围内的常规低风险动作可按统一 Policy 自动批准；跨 Workspace、系统级、敏感凭据或显著扩大影响面的动作仍请求用户确认。该模式是权限策略，不是隐藏 Planner。
  - `full`：对当前 Host/Workspace 已暴露且用户明确授予的能力自动批准，使模型可以连续完成长任务；仍受操作系统真实权限、Rust hard safety invariant、Secret 隔离和不可伪造的 capability 边界约束。
- **Approval Pending 不是 Turn 结束。** Runtime 必须挂起对应 Tool Call，Host 收集决定后继续同一执行链；`allow-once / allow-session / deny` 都形成 durable audit。
- **`ask` 产品交互只接受显式 Yes / No。** 对真实副作用 Tool Call，只有用户明确 `Yes` 才映射为 `allow-once` 并执行当前调用；`No` / Esc / Abort 一律 durable deny，当前调用不得执行。底层可为兼容保留 `allow-session` 类型，但 Terminal/Desktop/Web 的 `ask` 主路径不得用一次确认静默扩大为 Session 授权。
- **Work Mode 必须进入真实模型 Context，不得只画在 UI。** Plan 模式必须让当前真实 Provider/Model 明确知道自己处于只读规划模式；Build 必须知道自己处于执行模式。Plan 只有在模型显式调用 `xma.plan.ready` 声明计划已经足够完整时，Host 才能询问 `Yes / No` 是否进入 Build；普通 Plan 问答不得自动触发执行确认。
- **Plan → Build 必须双重 fail-safe。** `xma.plan.ready` 只表示“计划已就绪”，绝不代表用户批准。用户 `Yes` 后才 durable 记录决定、切换 Build 并按 retained Plan 继续；用户 `No` 后不得执行，但 Plan 必须作为 Session durable fact 保留，后续用户明确要求时可继续。
- **Permission denial 也是 Observation，不是默认任务失败。** 用户拒绝某个 Tool Call 后，结构化 deny result 必须返回同一个真实模型，让模型判断替代路径、缩小权限或解释确实无法完成；只有真实能力不存在、用户明确拒绝所有可行路径或外部条件不可满足时，才把剩余阻塞交还用户。

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
- Windows `xma-dev.bat → [1]` 可以注册开发态 `xiaoyu / xma`，但只允许把 checkout 本地控制状态 `.git/xma-state/dev-bin`（非 Git 树回退 `.cache/xma-state/dev-bin`）加到当前用户 User PATH；禁止把整个仓库或维护脚本目录加入 PATH，禁止写 Machine PATH。`xma-dev.bat → [10] 同步 GitHub 最新源码` 只允许在 origin 属于 `yubboo/xma` 的真实 Git clone 上原地执行：先 `fetch --prune` 并显示本地/远端 ahead/behind；明确 transport/network 错误允许有限重试，HTTPS 默认链路仍失败时只允许对**单次 fetch**用 `git -c http.version=HTTP/1.1 ...` 兼容回退，禁止改写用户 global/local Git 配置；成功 fetch 后安全同步基于刚更新的 `origin/main` 执行本地 `rebase --autostash origin/main`，不得无意义再 fetch 一次。强制恢复必须二次确认，先把已跟踪修改/本地提交恢复材料写入 `.git/xma-state/update-backups/`，再 `reset --hard origin/main`。最终网络失败必须明确提示网络/代理/VPN/TLS 诊断而不是把仓库写成损坏；禁止删除整个 clone 重新拉取，禁止自动 `git clean` 删除未跟踪文件或本地依赖/缓存。
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

### 6.4 Bug 修复 Prompt / 留痕工作流（锁死）

- 非纯文案 Bug/回归在主要代码修改前，必须先在 `docs/development/REPAIR-PROMPTS.md` 新增连续编号条目（`# 01`、`# 02`、`# 03`……），记录用户可见症状、已确认事实、被证伪方案、修复 Prompt、不允许回归的行为和验收条件；禁止修完后倒填一段“看起来合理”的 Prompt 冒充过程。
- 修复过程统一遵守 `docs/development/REPAIR-WORKFLOW.md`。状态至少使用 `调查中 / 实施中 / 验证中 / 已完成 / 阻塞`；当前环境无法完成的 Windows Terminal、真实 Provider、Desktop GUI 等 E2E 必须显式保留为待实机验收，禁止把自动 Gate PASS 写成“实机已修复”。
- 修复完成/进入验证阶段后必须回填最终根因、实际修改、测试/Gate 证据、残留风险和待优化项；同时追加 `UPDATE-LOG.md`。若当前开发状态改变，同步 `PROJECT-STATUS.md`；若长期路线改变，才更新 `DEVELOPMENT-PLAN.md`。
- 同一问题后续被证明根因不同或再次回归时，新增下一个修复编号并引用旧条目，禁止改写旧历史结论。Repair ID 永不复用；若用户/任务口头指定的编号已经存在，必须自动顺延到下一个未占用编号并在新条目解释映射，不能要求用户先记住历史编号。已有业务模块的后续 UI/Host 投影优化（例如 #05 Metrics）必须引用来源编号，但仍建立新的 Repair ID。
- 修复应优先缩小 ownership 和耦合。一个 Host 文件同时拥有滚动、输入 caret、动画、Dialog、Runtime 投影等多个生命周期时，不得继续堆补丁；应先拆成父级协调器 + 可独立回归的子模块。

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

公共 Git clone / 源码开发入口必须与机器路径无关：Windows 标准流程固定为 `git clone https://github.com/yubboo/xma.git` → `cd xma` → `.\xma-dev.bat`，Linux/macOS 使用同一 clone 后 `./xma-dev`；入口只能从自身位置解析仓库根，禁止硬编码 `H:`、用户目录或任意开发者机器绝对路径。仓库/维护脚本不得要求用户把 clone 目标改名成 `xma-work`/`xma-worktree`。源码开发入口必须带 `-dev`，不得占用安装后正式产品命令 `xma`。

维护者 Source Manifest 工作流也必须与盘符无关：`XMA-Sync.bat` 只能复用**已经存在且 origin 正确**的 XMA Git 工作目录。默认先扫描源码包同级目录：唯一匹配直接复用，多匹配必须让维护者选择，零匹配必须要求手动输入已 clone 仓库路径；禁止自动创建同级 `xma` / `xma-worktree-*`、禁止 `git init`、禁止改写其他仓库 origin。`XMA_TARGET_ROOT` 仅用于显式指定一个已存在的正确仓库。Git clone 用户不需要运行 `XMA-Sync.bat`。

源码包解压示例：

`D:\Downloads\xma-0.1.0`（任意盘符/目录均可）

固定流程：

`git clone https://github.com/yubboo/xma.git`（准备长期 Git 工作目录）→ `XMA-Sync.bat` → `XMA-GitHub.bat` → `1. 一键推送`

源码开发/构建：Windows 使用 `xma-dev.bat`；Linux/macOS 使用 `./xma-dev`。正式安装后的产品命令仍是 `xiaoyu` 主命令与 `xma` 兼容别名。

所有 BAT 只负责稳定启动；复杂逻辑必须放到配套 PowerShell：

- `xma-dev.bat` → `scripts/windows/xma-console.ps1`
- `xma-dev` → `scripts/unix/xma-console.sh`
- `XMA-GitHub.bat` → `scripts/windows/xma-github.ps1`
- `XMA-Sync.bat` → `scripts/windows/xma-sync.ps1`
- 正式源码包必须携带 `.xma-package/source-manifest.json`；Sync 按 Manifest 精确管理源码，新增目录自动同步，删除/重命名自动清理。同步结果必须区分本次“新增 / 更新 / 删除 / 未变化”，Manifest 总文件数不得冒充本次实际变更数；完整变更清单保存到目标 checkout 本地 `xma-state/source-sync-last.txt`（普通 clone 为 `.git/xma-state/source-sync-last.txt`）。禁止用全局目录名排除规则误伤 `scripts/release/` 等正式源码目录。 Source Sync 在复制/删除完成后必须对 Manifest 全部受管文件再次做 SHA-256 源/目标复核，复核失败不得显示“完成”。如果当前用户此前已经注册开发态 `xiaoyu/xma` shim，Sync 必须把这条 checkout 控制路由与 User PATH 自动切换到本次明确选择的目标仓库，并做 `source-root.txt` 自检；从未注册过开发 shim 时不得擅自新增 PATH。Sync 仍不得安装依赖或调用 `[1]`，已运行中的旧 TUI 进程必须提示退出后重启。

BAT/PS1 必须在成功和失败后保留窗口，并有明显颜色状态提示。

Windows PowerShell 5.1 读取 `package.json`、JSON 配置或任何 UTF-8 中文文本时必须显式指定 `-Encoding UTF8`。不得依赖系统默认代码页；这是固定兼容规则，并由 Windows Helper Gate 检查。

Windows 一键环境准备必须提供清晰中文阶段提示：至少包含“正在检查 / 已通过 / 缺少 / 正在安装或升级 / 正在验证 / 完成”。不得只输出机械步骤编号后直接执行长耗时命令。

pnpm 11 的依赖安装脚本采用**显式白名单**。允许执行 install/postinstall 的依赖必须写入根 `pnpm-workspace.yaml` 的 `allowBuilds`，禁止使用 `dangerouslyAllowAllBuilds` 或交互式 `pnpm approve-builds` 作为固定工作流。新增白名单项必须有项目构建需求和代码审查依据。

### GitHub 推送职责边界（锁死）

- `XMA-GitHub.bat` / `xma-github.ps1` 是**纯 Git 工具**，只允许执行 Git 仓库初始化/状态、安全扫描、远端同步、暂存、提交、Push。
- `XMA-GitHub.bat` / `xma-github.ps1` 必须拒绝包含 `.xma-package/source-manifest.json` 的正式源码包/解压目录；GitHub Helper 只允许在已经存在 `.git` 且 origin 正确的长期 `yubboo/xma` 仓库运行，禁止 `git init`、禁止新增/改写 origin、禁止在 `xma-<version>` 源码包目录创建第二个仓库。Source Sync 状态统一放在 checkout 本地 `xma-state/source-sync.json`（普通 clone 为 `.git/xma-state/source-sync.json`），禁止为了同步状态生成项目根 `xma-path`。
- GitHub 推送流程严禁调用 `xma-prepare.ps1`，严禁执行 `pnpm install`、`pnpm rebuild`、`cargo fetch`、Electron/Tauri 依赖准备、winget 安装或任何环境准备。
- 依赖下载和环境安装只允许由显式源码开发准备入口（Windows `xma-dev.bat → [1]`、Linux/macOS `./xma-dev prepare`）、开发运行或构建发布流程触发；普通用户 `xma-install.*` 只允许安装预构建发行资产，不得转成源码构建。
- GitHub Helper 若发现 Git 本身不存在，只能提示用户先运行 `xma-dev.bat → [1] 一键准备开发环境`，不得擅自安装。
- Git 提交必须同时受 `.gitignore` 与 GitHub Safety 二次校验保护；即使文件被误暂存，禁止路径也必须拒绝提交。Windows Git Helper 暂存 Unix 公共入口时必须通过 `git update-index --chmod=+x` 保留 `xma-dev` / Unix shell 脚本 executable bit。
- 必须提交用于可复现构建的源码锁文件，例如 `pnpm-lock.yaml`、`Cargo.lock`；不得提交依赖目录、构建产物、运行数据、用户工作区、Secret、安装包和本地缓存。

## 10.1 Distribution / Terminal 产品入口（锁死）

- XMA 对外 Terminal 主命令固定为 `xiaoyu`；`xma` 只作为兼容别名，不再作为品牌主入口。
- CLI/TUI、Desktop、Server、Web 都是同一 XMA Runtime/App Protocol 的 Host，禁止各自复制 Agent Loop、Session、Tool execution、Permission/Approval、Provider 或 Agent 业务逻辑。Host 只负责输入、展示、交互适配和当前部署环境的 capability bridge。
- **Feature parity 与 capability availability 分离。** 一个 Core Feature 只能实现一次；某 Host/部署环境暂时没有对应 Native capability 时，应由 Runtime 返回统一 unavailable/capability reason，UI 做禁用/说明，而不是删除该 Feature、复制另一套逻辑或让 Host 自己实现替代 Agent。
- Terminal/Desktop 本地运行时操作当前本机；Web 连接云端 Server Runtime 时，filesystem/process 等能力默认作用于服务器 Host，而不是浏览器用户电脑。未来若需要 Web 控制用户本机，必须通过明确的 Remote Node/Device capability + 用户授权接入，浏览器不得绕过安全边界直接获得本机 OS 权限。
- 普通用户安装必须使用**预构建发行资产**；禁止要求用户 clone 源码、执行 `pnpm install`、`cargo build`、安装 MSVC 或把 `node_modules/.cache/target` 打进安装包。
- Windows 默认每用户安装到 `%LOCALAPPDATA%\Programs\Xiaoyu`，只修改 User PATH；Linux/macOS 默认使用 `~/.local/bin` + `~/.local/share/xiaoyu`，不默认要求 root。
- `scripts/install/xma-install.ps1` 与 `scripts/install/xma-install.sh` 是独立 bootstrap，必须先做 SHA-256 校验和 staging 验证再替换正式安装；公网一行安装命令只有在域名/Release 资产真实部署后才允许宣称可用。
- portable Terminal bundle 第一批内置 Node Runtime、bundled CLI/Server/Web 与 Rust Native Kernel；未来可评估 Node SEA，但不能因此破坏可验证升级和安全边界。
- Terminal 每次交互式启动都必须先显示当前目录的 Workspace Trust；普通项目也不得跳过。Home/文件系统根目录/Windows 系统目录必须追加高风险警告并默认退出；授权只对本次启动有效，不得因为 CLI 方便绕过 Workspace/Tool/Native 权限。
- Terminal Home/Prompt Dock 必须按终端高度保留可操作留白；命令/设置/Provider/模型等 Overlay 打开时必须进入 modal focus，背景输入区只保留紧凑状态 Dock，并隐藏无关快捷键/提示，禁止 Overlay 与 Prompt 在常见 Windows Terminal 高度下视觉挤压。对话区、输入 Dock、快捷键与提示区之间必须保留稳定空行，不能把所有组件堆在底部。Terminal 模式固定支持 `Build → Plan → Compose (legacy)`，Tab / Shift+Tab 循环切换：Build 使用完整 ToolPlan，Plan 只暴露只读工具，Compose 不暴露 Workspace 工具；三者继续使用用户当前选择的同一个真实 Provider/Model，禁止把 Plan 实现成隐藏 Planner。Prompt Dock 必须持续显示 Mode + Provider/Model + Reasoning，并用稳定颜色区分状态。品牌 Provider 首次配置流程优先固定为 API Key → 真实模型 → 推理强度 → 已就绪；连接测试只作为可选诊断，避免无关表单阻塞主路径。Windows “文本光标指示器”属于 OS 辅助功能：若其蓝色上下标记稳定跟随真实 caret，不得把它误判为 XMA 第二套 cursor，也不得通过隐藏原生 caret 或修改系统设置来“修复”；只有指示器漂移到非 caret 位置时才按 cursor ownership 回归调查。Active OpenTUI 工作台的 terminal cursor 必须由当前 focused Textarea 原生拥有；禁止父级工作台用 `showCursor` 定时器模拟闪烁，禁止星星/流星/Logo 装饰帧调用 Prompt `requestRender()` 或应用层定时 `setCursorPosition(0,0,false)` 抢占 cursor/IME。Workspace Trust raw 选择结束后必须恢复 cursor 再交给 OpenTUI。OpenTUI Host 必须保持父子 ownership：`app.tsx` 只协调状态/Runtime 投影，Transcript viewport、Prompt Dock、背景动画、Home Logo、Dialog 等拥有各自 UI 生命周期；修一个子模块不得要求重新实现其它子模块行为。 Prompt Dock 在会话父布局中必须作为**单一 `flexShrink=0` 原子节点**存在，内部输入框/状态栏/快捷键/提示不得以 Fragment 形式散落为父级兄弟；Transcript 只消费剩余可缩高度，任何修复都不得让 Transcript 把 Prompt Dock 挤出 viewport。会话 Transcript 还必须先进入独立 bounded slot：父 slot 使用 `height=0 + flexBasis=0 + flexGrow=1 + flexShrink=1 + minHeight=0 + overflow=hidden` 固定“剩余高度”，ScrollBox 只能 `height=100%` 填满该 slot，禁止让 ScrollBox 的 intrinsic `content.height` 直接参与 Workbench 与固定 Dock 的主轴竞争。
- **Terminal 历史滚动锁死：** Active OpenTUI 的 Transcript 必须支持鼠标滚轮与 `PageUp/PageDown/Ctrl+Home/Ctrl+End` 查看完整历史；用户向上离开底部后必须暂停 sticky-bottom 自动跟随，滚回底部后才能重新跟随新输出。Transcript 必须是真正受限高度的 ScrollBox viewport（flex 链显式 `minHeight=0`，输入 Dock 不参与压缩），短内容贴底必须使用 auto margin / spacer，禁止在 ScrollBox content 上用 `justifyContent=flex-end` 把长内容推成不可滚动的负向溢出。星空/流星/透明装饰层不得吞掉 Transcript wheel event；Windows Terminal 实机必须覆盖鼠标滚轮 E2E。
- **Terminal Ctrl+C 选择复制优先。** 有真实 OpenTUI 文本选区时 `Ctrl+C` 必须复制选中文字且进程保持；无选区 + Agent busy 才中止当前 Turn；无选区 + modal 只取消/deny 当前 modal；idle 无选区的单次误触不得立即退出，退出必须二次确认或 `/exit`。Esc 有选区时优先清 Selection。禁止为了复制回归破坏 Textarea caret、IME、Transcript scroll/sticky。
- **Terminal 快捷提示按需化。** `Ctrl+C` 属于上下文动作，不得长期占用 PromptDock 固定快捷栏；只有用户实际按下时才通过 transient notice 显示“已复制 / 已请求中止 / 已取消或拒绝 / 再按一次退出”。固定快捷栏只保留长期可发现的模式、命令、搜索、快捷命令、返回等入口，并优先维持单行。Prompt 的 slash command 必须是真实 **inline prefix discovery + ghost completion**：单独输入 `/` 只进入 slash 输入态，不展开整张命令表；只有出现首个命令字母后才显示同前缀 canonical 候选，例如 `/h` 只显示 `/h...`，继续输入 `/he` 时已输入前缀使用强调色，当前候选未输入 suffix 以 dim ghost text 紧贴 caret 后投影。不得自动打开 Ctrl+P/Ctrl+K modal。候选使用 `↑/↓` 选择、`Ctrl+Space` 补全，完整 `/command` + Enter 执行；Tab/Shift+Tab 永远保留给 Build/Plan/Compose 模式切换。Inline suggestions、ghost completion、`/help`、Ctrl+P/Ctrl+K 必须从同一个 canonical command catalog 派生并最终进入同一真实 `runCommand()`，禁止第二份 slash-only 假命令表、legacy-only suggestion 或只显示不能执行的项目。`/help` 必须持久说明全部命令及用途，而不是只抛一串名称。Prompt caret 必须继续由 OpenTUI Textarea 原生拥有；如果 Terminal/OpenTUI 不提供 per-app blink interval，只允许使用原生 cursor shape/blink on-off 做降噪，禁止恢复应用层定时 `showCursor` 模拟慢闪烁。
- **Terminal Session Metrics 分层投影。** #05 canonical `session/metrics` 是唯一数据源。Prompt 主状态行保持 Mode 左对齐，右侧把 `context + account/quota` 摘要与 `Ready dot + canonical Model + Reasoning` 两组相邻右对齐；正常 Ready 的常见宽度目标形如 `上下文 0.2% · 1,793/1.0m · 余额 ¥12.02   ● deepseek-v4-pro · high`，Provider 品牌与“模型已就绪”不再常驻重复，异常态仍必须明确提示。headline 在极窄宽度可以把 context/account 摘要让位给最右 Model truth。**空会话 `turnCount=0` 时 detail 只保留 canonical billing label 左对齐 + permission 右对齐**，不得用 cache/tokens/compaction/0轮等一排 `—` 占位制造噪声；从第 1 轮开始恢复完整 detail，且此后 **不得按宽度隐藏 canonical 字段**：不得重复 model/context/balance，必须直接投影 billing、cache hit、精确 session/turn tokens、真实 compaction threshold（unavailable 显示 `—`）、turn count、真实费用（可用时）与 permission。窄宽度只能在同一个 `PromptDock` 原子内部把完整 detail 稳定打包成多行，禁止 `height=1 + overflow=hidden` 裁内容、禁止写死 `80%` 或伪造任何指标；detail 与相邻区必须保留稳定上下留白。
- **Terminal 实时输出锁死：** Provider SSE 的 `reasoning/text delta` 必须先进入 Runtime live event；`text delta` 由 TUI 在生成过程中持续投影，Tool Call / Tool Result 必须在执行链推进时实时进入公开 activity log；默认 Transcript 可以折叠该 log，但不得丢失或等整轮完成后才补造。默认 Terminal 不把原始 `reasoning-delta` 正文直接铺进 Transcript，而是实时投影成“正在思考”状态；用户消息固定为 Transcript `contentWidth` 内容列内的 **full-width user band**，内容保持右对齐；深色主题只使用比页面背景亮一档的克制深灰高亮，并至少保留左右各 1 列、上下各 1 行 padding，长文本完整换行；禁止退回亮白矩形或右侧 maxWidth 小气泡。Assistant 工作槽位固定左对齐，thinking 必须显示为同一槽位内的 `Xiaoyu · 正在思考`，禁止居中或另起独立状态块。Active Transcript 若使用普通 Text Renderable，则必须在 Host 展示层把常见 Markdown 控制符投影成干净终端文本：例如 `- **代码开发**` 显示为 `• 代码开发`，标题 marker / 成对 bold / inline code marker 不得原样污染界面；fenced code 内文必须逐字保留，禁止破坏性全局删符号。首个正式 `text-delta` 到达时原位移除 thinking placeholder，并直接替换成左对齐的 Xiaoyu 正式回答流式输出。只有 Provider 明确提供面向用户的 reasoning summary 且 Contract 能区分其与原始思维正文时，才允许单独展示摘要。每轮从用户提交开始必须立即创建真实 Turn 计时活动项，`思考了 Nh Nm Ns ▸` 在运行期间按墙钟时间持续刷新，完成/中止/失败后才冻结最终耗时；活动项可在运行中或完成后展开，展开只能显示截至当前真实发生且允许公开的 Runtime 状态、Tool Call 参数摘要与 Tool Result 成败/摘要，不得显示原始 `reasoning-delta`、Secret 或完整敏感参数。活动摘要与最终回答属于同一 Turn，顺序固定为用户消息（整行 user band）→ 活动摘要（左）→ Xiaoyu 最终回答（左）。禁止把整轮文本缓存到 `sendMessage()` 完成后才一次性显示，也不得本地伪造思维链。当前固定 `@earendil-works/pi-tui@0.74.0` 存在差分聊天区域漏刷风险，Host 必须采用受控的强制 repaint/等价机制保证流式增量真实上屏，且要限制刷新频率避免每 token 全屏清屏。
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
- Windows PowerShell 5.1 中，单元素属性枚举（例如 `$items.Source`）可能退化为单个 `PSObject`；禁止对这类投影结果直接使用 `+` 拼接。需要稳定数组时必须通过 `@(...) + foreach`/显式 `foreach` 组装原始对象数组，并由 Windows Gate 锁定。


- Windows PowerShell 所有外部命令必须统一复用 `scripts/windows/xma-common.ps1` 的 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`；禁止私自实现 `Run(..., $Args)`、`Invoke-External(..., $Args)` 等包装器。
- Windows Bootstrap 的 native 动作（pnpm/rustup/cargo/npm/winget）必须直接继承当前终端 stdout/stderr；禁止用 `Out-Host` / `ForEach-Object` 管道消费 native stdout。需要返回 Runtime/状态对象时，先执行 void 动作函数，再单独调用 `Get-*` / `Resolve-*` 读取，防止 Unicode 路径乱码和进度渲染破坏。

## Windows 依赖准备硬规则

- Windows 源码开发首次运行推荐 `xma-dev.bat -> [1] 一键准备开发环境`；Linux/macOS 使用 `./xma-dev prepare`。两者只服务源码开发，不能与正式 `xma` 产品命令混淆。
- `[1]` 的 JavaScript Runtime 统一由 pnpm Workspace 管理；Bun/OpenTUI/Solid 位于 `node_modules`。`[1]` 只允许一次 Workspace `pnpm install` 安装当前项目依赖；`scripts/runtime/update.mjs` 只服务用户明确选择的 `[8]` latest 刷新。`allowBuilds` 显式 `bun/esbuild=true`、`electron/electron-winstaller/koffi=false`，同时启用 `strictDepBuilds: true`，**不得**触发 Electron Chromium Runtime 下载或静默批准新增 lifecycle 包。
- Web / CLI 在 `[1]` 成功后不得再次执行 `pnpm install`、`pnpm rebuild esbuild` 或其他重复依赖安装。`[1]` 在 crates offline 校验完成后必须预构建并记录当前 Native Rust 源码、Cargo 配置/lockfile 与 rustc 版本指纹，使首次 `[4]` 也能直接进入 Trust/TUI；`[4] Xiaoyu Terminal` 只在指纹变化或 Native 可执行文件缺失时执行 `cargo build --package xma-native-runtime --offline`。每次启动仍把已验证构建结果复制到 `.cache/native-runtime/runs/` 的唯一 staging exe，禁止直接运行/覆盖 Cargo target 中可能被旧进程锁定的 exe。该流程只使用 `[1]` 已预取 crates，不允许偷偷联网下载。
- TypeScript Host 启动 Native Runtime 后必须核对当前产品依赖的 capability 集；缓存/portable Native 缺少 `credential.*` 等必需能力时必须 fail loud 并给出重建/升级提示，禁止降级成“OS Credentials 不可用”后让用户在配置流程里无提示失败。
- Desktop 采用 **Electron 41.2.0 主运行时 + Tauri 2 备用运行时**：Electron Chromium Runtime 只允许在明确选择 Electron 后由 `apps/desktop/scripts/electron/install-runtime.ts` 按需下载；Tauri 2 Rust crates 只允许在明确选择 Tauri 2 或对应构建时预取。
- `esbuild` 是 Vite/tsx/tsup 的内部依赖，不要求根目录存在 `node_modules/.bin/esbuild`；禁止用 `pnpm exec esbuild` 作为通用环境验证。应通过 `tsx`/Vite/tsup 的真实调用验证其 Native Binary。
- 构建发布可以补齐用户明确选择的 Desktop Runtime，但应复用 `[1]` 已准备的通用依赖，不重复安装 Workspace。
- XMA 自己控制的开发/编译中间产物统一进入 `.cache/`：根 Rust 使用 `.cache/cargo-target/`，Tauri Rust 使用 `.cache/tauri-target/`，Desktop staging 使用 `.cache/desktop/`。正式可交付产物统一进入根 `dist/`。仓库根 `build/` / `target/` 与 `apps/desktop/dist|web|release|native` 只视为旧版遗留目录并应清理，禁止重新成为正常输出。
- Bun/OpenTUI 单文件编译的**真实 staging 数据**必须位于项目 `.cache/bun-compile/`；禁止默认使用 `%LOCALAPPDATA%\Temp`、`%TEMP%`、`%TMP%` 或其他用户系统临时目录承载 XMA 自己控制的编译状态。Windows + 中文/特殊字符源码路径下，若 Bun 1.3.x 内部临时文件 API 无法处理 Unicode 路径，可以在单次 build 生命周期内用动态 `SUBST` 空闲盘符为该项目 `.cache` 建立 ASCII 路径别名；别名必须构建结束即解除、不得固定任何盘符、不得把真实文件复制到系统盘。`.cache/` 可以随时删除并由后续构建重建；正式 `dist/cli/xiaoyu[.exe]` 不得依赖 `.cache`、SUBST 或系统临时目录才能启动。
- Windows `[1]` 必须把 Bun/OpenTUI/Solid/@types-bun 作为**根 `package.json` 的 pnpm JavaScript Runtime 依赖**统一管理；`apps/cli/opentui-runtime/` 只允许保留 Renderer/Build 源码，禁止重新成为嵌套 Workspace 或拥有独立 `node_modules`。项目 manifest 固定声明当前已验收稳定版本，只有 `[8] 刷新 · JavaScript Runtime` 主动执行 `--latest` 并更新声明。`[1]` 在项目根只执行一次 `pnpm install`，不得借准备流程追 latest。`[1]` 同时必须确保 Git、Node.js、兼容 pnpm、Rust/Cargo、rustfmt、MSVC 与 Cargo crates 完整可用：缺失或不满足项目硬要求时自动安装/修正，已满足要求就复用，不为追新强制升级。Rust/Cargo 统一使用**项目本地** `runtime/rust/{cargo,rustup}`：`[1]`/`[9]` 在当前 checkout 内设置 `CARGO_HOME/RUSTUP_HOME`，缺失时下载 Rust 官方 `rustup-init.exe`（含官方 SHA-256 校验）并安装 stable/minimal + rustfmt；不写 `%USERPROFILE%\.cargo/.rustup`，不修改 User/Machine PATH，也不再创建 `xma-path/rust`、盘符选择、Rust checkout state 或磁盘扫描。`[4]`、`[7]`、`build:cli` 只能消费根 `node_modules` 与当前项目 `runtime/rust`，禁止隐式联网。
- Windows JavaScript Runtime 的依赖安装完全交给 pnpm。`xma-dev.bat → [1]` 每次运行都必须在项目根无条件执行一次原生 `pnpm install`，不得用 `node_modules` 存在性、prepare stamp/fingerprint、工具探针或 XMA 自定义 registry/reporter/timeout 参数跳过/替代；pnpm 自己负责复用 store、恢复被删除的 `node_modules`、补齐新增/变更依赖并显示原生进度。禁止恢复 Bun ZIP/tgz/SourceForge/独立 checksum 下载器；`[8]` 默认沿用当前 registry 并只负责显式 Runtime latest 刷新。Rustup 仍可在 Rust 官方与 RsProxy 间切换，并且 `RUSTUP_DIST_SERVER/RUSTUP_UPDATE_ROOT` 只在当前 XMA 进程内生效。
- `[1]` 的 Rust 准备必须包含 `[7]` 实际需要的 `rustfmt` 组件；`[7]` 必须在开始重型检查前离线预检 `cargo fmt --version`，缺失时立即提示重新运行 `[1]`，禁止在 `[7]` 临时联网安装组件。
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

- Windows `[4]/[7]` 的 JavaScript Runtime 只从 Workspace `node_modules` 读取；Rust/Cargo 只从当前 checkout 的 `runtime/rust/cargo/bin` 解析并真实探针，同时设置项目本地 `CARGO_HOME/RUSTUP_HOME`。任何 Windows 入口都不得回退 `%USERPROFILE%\.cargo`、扫描盘符或依赖 checkout Rust 状态文件。


## 13. Session Runtime Metrics Truth Contract（锁死）

- Session/Turn/Token/Cache/Latency/Context/Cost/Balance/Quota/Permission/Compaction 等运行指标属于 Runtime/App Protocol 业务事实，不属于 CLI/Desktop/Web Renderer 私有状态；Host 只能投影 canonical `SessionRuntimeMetrics`，禁止各自重新统计。
- Provider/Model 名称必须来自当前真实 Profile/ModelIdentity；状态栏/面板禁止写死 DeepSeek/OpenAI/Claude/Gemini/Astra 等品牌判断。品牌特有价格、余额、套餐/配额只能由 Provider Telemetry Plugin 提供。
- Billing 必须区分 `api | subscription | unknown`。API 费用只有真实 usage + 可验证 price source 时才允许 reported/estimated；subscription 不得拿 API 单价推算逐次费用；unknown 一律显示 unavailable/`—`，禁止假 0、假余额、假压缩阈值。
- Context 占用使用当前/最近真实请求 input tokens 与对应模型 context window；Session 累计 token 不能冒充上下文占用。Compaction 未有 durable fact 时必须显示 unavailable。
- Provider account/balance/quota 查询使用 TTL/显式 refresh，失败不能阻塞 Agent Turn；Secret 不得进入 metrics、日志、Transcript 或 App Protocol。
- Terminal `SessionStatusBar`、未来 Desktop/Web 面板必须消费同一 App Protocol `session/metrics` 形状；增加新指标时先扩 canonical Contract，再扩 Host UI。
