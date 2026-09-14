# XMA 上游参考基线与吸收规则

## 1. 目的

XMA 会长期参考成熟 Agent 项目的真实实现。本文固定五个主要上游的职责定位、审阅范围、参考 commit、吸收方式和禁止事项，避免后续开发者无方向盲写，或只看一个项目就把 XMA 的边界带偏。

这里的“参考/复用”首先指：**读真实源码、测试、协议、失败处理，再把成熟设计和必要实现掌握在 XMA 自己的代码里**。XMA 核心运行不能依赖某个远程仓库或第三方包永远存在；上游停止维护后，已经落地的 XMA 源码仍必须可独立构建。

XMA 的最高约束仍是根目录 `AGENTS.md`：**TypeScript 决定产品与 Agent 做什么；Rust 只保证 Native / Security / Performance 副作用如何安全执行。**任何上游设计与此冲突时，以 XMA 规则为准。

## 2. 参考基线

本轮架构整理使用以下提交作为可复现参考点。后续实现若要跟进上游新设计，必须先更新本表，并记录为什么需要升级参考基线。

| 项目 / 仓库 | 参考提交 | 许可证 | XMA 主要参考面 |
| --- | --- | --- | --- |
| Pi · `earendil-works/pi` | `71dca871bc80b6bc97be37f0ca3189399d651fff` | MIT | Agent Loop、streaming、Tool execution、steering/follow-up、multi-provider AI、coding-agent harness |
| DeepSeek Harness · `deepseek-ai/deepseek-harness` | `c291e7961a515f6d7af9304e7fd1d257929aef26` | MIT | Everything is a Plugin、Cordis Service/Event/Effect、Session/Agent/Tool capability seam、Subagent/Workflow |
| OpenAI Codex · `openai/codex` | `7efa9d96fb34c3cafe108a3c870bfc33e5635772` | Apache-2.0 | Approval、Sandbox、Process/Tool execution、Thread/Turn/Session、multi-agent、App Protocol |
| MiMo Code · `XiaomiMiMo/MiMo-Code` | `6fbb1732232c9d0ecefee209798a8586d78cb70d` | MIT | Context compaction/reconstruction、Memory、Checkpoint、Task Tree、Subagent、Workflow、Skill discovery、长期任务成本 |
| Minecraft Host Agent · `AndrewNog0724/minecraft-host-agent` | `82cb581ef433c0c6da5e9587950c7dfb528b7c27` | MIT | Minecraft 专业 Agent、Agent-First、Skills/Knowledge/Tools、mod、服务器生命周期、樱花frp 穿透、真实场景 E2E |

许可证只说明在对应条件下可以研究、使用和修改代码。XMA 产品层、公共包名、UI 和主叙事统一保持 XMA；法律要求的许可证/NOTICE/版权信息集中合规保留。实现策略不是“为了原创重写一切”，而是先研究成熟代码，再选择 **XMA 化重构 / 选择性移植 / 规范驱动独立实现**。任何实质复制或改编都必须遵守对应许可证。

## 3. “全文件级参考”如何执行

五个上游都在持续变化，而且 Pi / Codex / DeepSeek Harness / MiMo Code 的仓库规模远大于 XMA。XMA 不采用“开发前一次性把几万文件读完，然后永远按记忆开发”的方式，而采用**固定提交 + 全树清单 + 子系统全文件审阅**：

1. 先锁定上游 commit，保存完整目录树和子系统映射；
2. 开发某个 XMA 子系统前，必须把映射表中对应上游目录在该 commit 下的**全部源码、README、协议、测试与相关架构说明**过一遍，而不是只读一个入口文件；
3. 在实现 PR / Agent Note / 任务记录中列出实际参考路径、吸收的 Contract、明确拒绝的设计；
4. 只把经过 XMA 语言所有权、Workspace、Permission、Plugin 和安全边界重新验证后的设计写入 XMA；
5. 上游更新不会自动改变 XMA。只有显式研究任务才能升级参考 commit。

因此，“严格参考全部文件”在 XMA 中是一个**可审计的开发流程**，不是一句“照着 Codex 做”的口号。

## 4. Pi 参考图谱

Pi 是 `xma-agent-loop` 与 `xma-ai` 的第一参考，不只是 TUI 依赖来源。

### 4.1 必看区域

| 上游路径 | 重点 | XMA 对应落点 |
| --- | --- | --- |
| `packages/agent/src/agent-loop.ts` | streaming assistant、tool loop、parallel/sequential execution、steering/follow-up、next-turn preparation | `xma-agent-loop` |
| `packages/agent/src/agent.ts`、`types.ts` | Agent state / events / tool contracts | Agent Runtime contracts |
| `packages/agent/src/harness/` | harness extension points | Plugin/Agent integration |
| `packages/ai/` | 多 Provider Model、streaming、tool/thinking event vocabulary | `xma-ai` |
| `packages/coding-agent/` | coding tool surface、session/customization、真实 CLI Agent 产品经验 | Xiaoyu Code |
| `packages/tui/` | Terminal rendering 基础 | Terminal Shell；不是 Agent Engine |

### 4.2 XMA 要吸收的核心原则

- Agent Loop 原生消费流式 text/thinking/tool-call event，而不是最终字符串拼接；
- Tool Result 回到同一模型继续下一 Step；
- parallel/sequential execution 是 Loop 的正式语义；
- steering/follow-up/prepare-next-turn 是长期任务的重要扩展点；
- provider-specific 复杂性由 AI 层吸收，Agent Loop 不散落厂商 JSON；
- 错误/截断/取消必须结算成合法 Agent state。

### 4.3 XMA 必要差异

Pi 默认不提供 XMA 所需的 Rust Security Kernel、Workspace durable ownership、OS Credential 与 Approval enforcement。XMA 吸收成熟 Loop/AI 语义后，必须通过自己的 capability seam 接入这些安全能力。

## 5. OpenAI Codex 参考图谱

### 5.1 必看区域

| 上游路径 | 重点 | XMA 对应落点 |
| --- | --- | --- |
| `AGENTS.md`、`docs/agents_md.md`、`codex-rs/core/src/agents_md.rs` | 分层开发指令、项目级上下文发现 | 根 `AGENTS.md`、`.agents/`、`.codex/`、未来 Workspace instructions |
| `.codex/` | Codex 专用环境与 Skills | `.codex/environments/`、`.codex/skills/` |
| `codex-rs/core/` | Agent/Coding 业务核心、Session/Turn、Context、Tool dispatch | `core/` TypeScript 重实现，不复制 Rust 语言所有权 |
| `codex-rs/protocol/`、`app-server-protocol/` | UI/Host 与 Runtime 的稳定协议、Thread/Turn API | `core` 的 App Protocol / Event Contract，供 CLI/Desktop/Web 共用 |
| `codex-rs/thread-store/`、`rollout/`、`state/` | 持久 Thread、历史、恢复、索引 | XMA Session Store / Run Log / Resume |
| `codex-rs/tools/`、`core/src/tools/` | Tool Registry、可见 Schema、Router、并发、执行结果 | XMA Tool Definition / ToolPlan / ToolRouter / Policy Pipeline |
| `codex-rs/model-provider/`、`models-manager/` | Provider auth、capability、model catalog | XMA Provider Registry / Auth / Capability / Model Catalog |
| `codex-rs/mcp/`、`rmcp-client/`、`connectors/` | MCP 与外部能力接入 | XMA MCP / Integration plugins |
| `codex-rs/exec/`、`file-system/`、`sandboxing/`、`linux-sandbox/`、`windows-sandbox-service/` | 命令、文件和沙箱安全 | `native/` Rust Kernel + TypeScript Tool Policy |
| `codex-rs/tui/`、`app-server/` | UI 作为 Runtime 客户端、事件驱动展示 | CLI / Desktop 后期 Workbench；不让 UI 拥有 Agent 状态 |
| `codex-rs/skills/`、`prompts/`、`context-fragments/` | Skill、Prompt、Context 注入 | XMA Skills / Context Assembly |
| `codex-rs/core/tests/suite/` | Agent 行为集成测试 | XMA Core integration tests |

### 5.2 XMA 要吸收的核心原则

- **Thread/Session、Turn、Step 分层**：用户会话不是一次 `runAgent()` 的临时数组；Turn 可包含多个模型 Step，每个 Step 可包含 Tool Call。
- **Provider 是运行时能力对象，不只是 `stream()` 函数**：Provider 还拥有 capabilities、auth、model catalog、错误映射和运行时 URL/transport 选择。
- **ToolPlan 与 Tool execution 配对**：模型看到的 Tool Schema 必须和实际可执行 Runtime 来自同一个已冻结计划，避免“模型看得到但执行不到”或“可执行却未授权”。
- **权限策略与 Agent 推理解耦**：模型可以请求副作用，但最终 approval / permission / sandbox 由框架与 Native Kernel 强制。
- **稳定 App Protocol**：Desktop/Web/CLI 不直接摸 Agent 内部对象，而是订阅 Session/Run 事件并通过稳定命令接口发起动作。
- **开发者指令有层级和大小上限**：进入模型的开发上下文必须有来源、边界和硬上限；不能无限把仓库文档塞进 Prompt。

### 5.3 XMA 明确不照搬的部分

Codex 的主要产品逻辑大量在 Rust workspace 内，这是 Codex 自身架构，不是 XMA 的语言方案。XMA 只参考其安全、协议和运行语义：Agent Loop、Provider 路由、Session/Context、Tool Registry 等仍然由 TypeScript Core 实现；真正的 PTY、process tree、filesystem confinement、sandbox、native networking 才下沉 Rust。

Codex 当前大量细粒度 crate 不作为 XMA 的机械目录模板。XMA 已批准稳定 `xma-*` package family；拆包依据是稳定 capability seam、独立生命周期、多消费者与独立替换/测试价值，而不是照抄 Codex crate 数量。0.1.x 现有 `core/` 作为迁移期 compatibility facade，能力逐步迁入 `packages/xma-*`。

## 6. DeepSeek Harness 参考图谱

### 6.1 必看区域

| 上游路径 | 重点 | XMA 对应落点 |
| --- | --- | --- |
| `AGENTS.md`、`.agents/`、`.claude/` | Agent 开发规则、Agent Notes、共享 Skills | XMA `.agents` 单一事实源 + `.claude/.codex` 适配入口 |
| `docs/architecture.md`、`docs/cordis-primer.md` | Cordis、Profile/Bundle、Service、Event、Effect、Turn flow | `PLUGIN-SYSTEM.md`、`AGENT-RUNTIME.md` |
| `packages/core/session/` | Durable Session event log | XMA Session Store / durable events |
| `packages/core/system-prompt/` | Prompt sections / tool schema assembly | XMA Context Assembly |
| `packages/core/tools/` | Typed tool、policy pipeline、scoped restriction、result finalization | XMA Tool Pipeline |
| `packages/core/agent/`、`agent-loop/` | Agent Contract、create/resume、turn/step、cancellation | XMA Agent Runtime |
| `packages/llm/` | LLM service/adapters | XMA Provider plugins |
| `packages/skill/` | Skill registry/provider/catalog | XMA Skill Registry |
| `packages/fs/`、`shell/`、`subprocess/`、`terminal/` | Capability Service/Provider/Consumer 分层 | TypeScript capability facade + Rust Native providers |
| `packages/context/`、`compaction/` | Context 与压缩扩展点 | XMA Context/Compaction plugins |
| `packages/interaction/`、`guard/` | Approval/interaction、loop hygiene、timeout | XMA Permission/Approval/Policy |
| `packages/subagent/`、`workflow/` | 子 Agent / background orchestration seam | 0.1.x 后段设计，不能提前硬编码进主循环 |
| `packages/preset/`、`bundle/` | 可组合能力集合 | XMA Agent Profile / Plugin presets 的后续参考 |
| `packages/hooks/`、`sdk/` | 外部宿主接入 | XMA App Protocol / SDK 后续参考 |

### 6.2 XMA 要吸收的核心原则

- **Context 是稳定 Service 容器**：插件依赖 `ctx.<service>`，而不是直接 import 某个具体实现。
- **Capability seam 必须完整**：Definition / Provider / Consumer 三个角色一起设计；只有接口没有 Provider、或只有 Provider 没有消费者，都不算能力完成。
- **Registrations are effects**：工具、监听器、Provider、定时器等注册必须可 dispose，mount/unmount/reload 不留下幽灵副作用。
- **插件优先，不随意改 Agent Loop**：能通过已定义 extension point 完成的行为，不给主循环塞特例。
- **Model-visible ⇔ logged**：任何真正进入模型请求的动态事实，都必须能从 Session durable state 重建；UI 临时状态不能偷偷影响模型。
- **Durable event 与 live event 分开**：会话事实进入持久日志；流式 chunk、进度等只作为 live 事件，不把 UI 噪音当历史事实。
- **Tool 普通失败不应炸毁 Turn**：校验失败、拒绝、超时、执行错误形成结构化 Tool Result 回给模型，由模型决定恢复路径。

### 6.3 XMA 不照搬的部分

XMA 已批准稳定 `xma-*` package family，因此不再把“DSH 包很多”本身当成拒绝理由；但仍只按 XMA 的稳定 capability seam 建包，不机械复制每个 workspace package。

DSH compatibility 固定从自包含的 `plugins/dsh-compat/` 继续演进，其 workspace package 名为 `xma-plugin-dsh`。它是兼容插件而不是新的 Platform Core 目录；兼容必须按 Contract / Service / Package / Behavior 分级，并由 Conformance Tests 证明；真实副作用仍受 XMA Rust Kernel 强制。

## 7. MiMo Code 参考图谱

MiMo Code 是长期任务智能增强的第一参考。重点不是复制 UI，而是研究“同一个强模型为什么能持续工作很久”。

### 7.1 必看能力

- persistent project memory / session checkpoint / scratch notes / task progress；
- context compaction 与 reconstruction、budgeted injection；
- Task Tree；
- Subagent lifecycle、并行工作、取消/等待/结果收敛；
- Goal / stop condition；
- deterministic Workflow 与 interactive Agent path 的分离；
- Skill discovery / on-demand loading；
- 模型路由、cache/cost awareness。

### 7.2 XMA 吸收方式

这些能力分别进入 `xma-context`、`xma-memory`、`xma-task`、`xma-subagent`、`xma-workflow`。Skill 用于增强模型，不把 legacy curriculum 强制施加给旗舰模型。MiMo 的 Agent/Server/OpenCode 产品结构不是 XMA 的业务 Runtime 依赖；Terminal 表现层例外地采用其已验证的 Bun/OpenTUI 组合，但仅限 `apps/cli` Host。

## 8. Minecraft Host Agent 参考图谱

当前固定参考 commit `82cb581ef433c0c6da5e9587950c7dfb528b7c27`。GitHub 仓库与用户提供的 `project-design.md` / `decisions.md` 共同展示了一个经过多轮真实 Windows/网络/MC 实测迭代的专用 Agent。主要实现面可归纳为：

```text
src/agent/                 Agent Loop、消息、上下文裁剪
src/llm/                   OpenAI-compatible client + fake client
src/tools/                 Tool Contract、权限、路径收敛、通用工具、Minecraft 工具
src/store/                 Session JSONL、Usage、Profile、Secret masking
src/config/                模型/预算/安全/网络配置
src/events.rs              UI/Store 共用事件
src/cancel.rs              协作式取消
src/knowledge/             版本规则与真实上游 API 客户端
src/assets/prompts/        基础 Prompt + 场景 Prompt
src/assets/skills/         server-setup Skill
src/assets/knowledge/      Java/服务端/mod 静态知识
src/cli/                   REPL、setup、render、interaction、uninstall
```

### 8.1 XMA 要吸收的核心原则

- **Agent-First**：模型提出下一步，工具执行，Observation 回给同一模型；不把业务流程藏在确定性决策树里。
- **先框架、后场景**：先完成通用 Agent Runtime，再实现 Minecraft 垂直链。
- **Skill 是操作规程，不是脚本化思考**；易变版本事实走查询工具 / API，而不是写死 Prompt。
- **工具权限分级**：ReadOnly / Write / Execute / Network 是很好的交互语义参考，但 XMA 最终权限由自己的 Capability/Approval 模型定义。
- **会话结构合法性**：取消、超时和中断后仍要保持 assistant tool call 与 tool result 的结构可恢复。
- **Session/Usage/Profile 可追踪**：真实调用的 token、费用、工具轨迹和产物要可回放。
- **Minecraft 上游事实工程**：Mojang/Paper/Fabric/Modrinth/Adoptium 等真实 API、哈希校验、版本兼容、先看现状再动作，是 XMA Minecraft Agent 很有价值的验收基线。

### 8.2 已核实的关键实现模式

- `src/agent/mod.rs`：单 Turn 内持续 `LLM → tool_calls → dispatch → tool result → 同模型下一轮`；预算、Tool Call fuse、取消和未完成 Tool Result 回填都在 Loop 层结算；
- `src/tools/mc/mod.rs`：Minecraft 领域 Tool 统一注册，覆盖兼容性、系统信息、Java、server jar、配置、启动/状态、端口/SLP、check_plan、Wiki、mod、Profile、tunnel；
- `src/assets/skills/server-setup/SKILL.md`：把“必须问什么、什么事实必须查工具、EULA/离线模式红线、部署前 check_plan、失败处理、mod/穿透策略”写成操作规程，而不是硬编码决策树；
- `src/knowledge/upstream/*`：Mojang、Paper、Fabric、Modrinth、Adoptium、CurseForge/镜像、SakuraFrp 等 API 客户端，把易变事实从 Prompt 移出；
- `src/tools/mc/tunnel.rs` + `knowledge/upstream/natfrp.rs`：内网穿透不是一条 shell 脚本，而是七个 Tool + API v4 client。节点先按 creatable/mainland/private/auth/offline/VIP/load/uptime 硬过滤与排序，再经用户确认；frpc 从官方元数据选 OS/ARCH 包并校验 MD5；隧道确定性命名、查重复用；frpc 独立窗口启动，API `online=true` 轮询后做 TCP/MC 验证；token 不进入模型文本和确认展示；
- `demos/demo.json`：保存真实 Agent 会话轨迹，可用于未来 XMA Minecraft Agent 的行为回归和 E2E 对照。

### 8.3 XMA Minecraft 专业 Agent 落点

未来不复制第二套 Agent Loop。建议由专业 Agent identity + Minecraft Skill/Knowledge + Minecraft Tool Plugin 组成；领域模型仍是用户当前选择的真实顶级模型。Process/FS/Network/Hash/Archive 通过 `xma-native` / Rust Kernel；MC 领域决策、Skill、Knowledge、Tool orchestration 在 TypeScript。支持范围内目标是“自然语言 → 查证 → 部署 → 验证 → 必要时穿透 → 交付证据”闭环。

### 8.4 XMA 明确不照搬的部分

MCHA 是 Rust 单体 Agent 项目，所以 Agent Loop、LLM、Tool 编排、Store 也在 Rust。这与 XMA 的语言所有权冲突。XMA 只参考它的 **Agent 行为 Contract、工具语义、知识资产组织方式和真实场景测试**；这些业务层在 XMA 中必须 TypeScript 化。需要进程、PTY、受限文件写入、原生网络、Hash/Archive 等能力时，再通过 XMA Native Protocol 调 Rust。

## 9. XMA 汇总后的目标架构

三者不会形成三个内核，而会收敛成一个 XMA Runtime：

```text
用户 / UI Shell
      │
      ▼
XMA App Protocol / Event Stream
      │
      ▼
TypeScript Core
  Agent Registry / Session / Turn / Step
  Context Assembly / Skills / Knowledge
  Provider Registry / Model Catalog
  Tool Definition / ToolPlan / ToolRouter
  Policy / Approval / Plugin Host
      │
      ├── Provider Plugins (OpenAI / Claude / Gemini / DeepSeek / MiMo / Compatible)
      ├── Capability Plugins (MCP / Git / Browser / Minecraft / Code / Writer)
      │
      ▼
Native Capability Bridge
      │
      ▼
Rust Native/Security Kernel
  PTY / Process / FS Confinement / Sandbox / Network / Hash / Archive / OS
```

只有这一条 Runtime。Desktop、Web、CLI、Server 都是它的客户端/宿主，不复制 Agent Loop。

## 10. 上游研究的开发准入规则

开始一个重要子系统前，开发者或 AI 必须在任务记录中回答：

- 本任务对应 Pi / DSH / Codex / MiMo / MCHA 哪些目录？
- 对应目录在固定 commit 下是否已经全文件审阅？
- XMA 吸收哪些 Contract？哪些设计因语言所有权、产品范围或安全边界被拒绝？
- 是否需要修改 `AGENT-RUNTIME.md`、`MODEL-PROVIDER.md`、`PLUGIN-SYSTEM.md` 或安全文档？
- 是否有真实 Provider / Tool / Native / E2E 证据，而不只是单元测试？

没有这些答案的“大重构”不得直接进入 Core。


## 11. 0.1.0 Context / Provider 本批研究记录

本批实现 Context Assembly 与 Provider Contract 时继续固定使用第 2 节的 upstream commit，没有追随 `main/master` 漂移。

### DeepSeek Harness · system-prompt

已核对子系统文件树 `packages/core/system-prompt/`，重点审阅 `README.md`、`src/index.ts`、`src/invariant.ts`，并核对 `tests/invariant.spec.ts`、`tests/scoped.spec.ts`、`tests/system-prompt.spec.ts`、`tests/tool-order.spec.ts` 的测试面。XMA 吸收的是：来源有名、稳定排序、动态 context 与 prompt 指令职责分开、组装 fail-loud、模型可见动态事实需要 durable source。XMA 不复制 Cordis package 粒度，也没有在本批引入 DSH 代码依赖。

### OpenAI Codex · model-provider

已核对 `codex-rs/model-provider/` package tree，并重点审阅 `src/lib.rs`、`src/provider.rs` 对 capability、auth、account/model catalog、runtime provider 与错误恢复职责的切分；同时把 `auth.rs`、`models_endpoint.rs`、`models_identity.rs`、`shared_state.rs` 等列为 Provider 后续深化的同一参考域。XMA 本批吸收的是“Provider 不只是 stream()”和 Secret/Profile/Capability/Catalog 分离；**没有宣称已经逐行复刻整个 Codex provider package**，也不会把 Codex 的 Rust 产品层语言所有权搬入 XMA。

### Provider Catalog / DeepSeek Official 产品化补充

本批继续使用同一个 Codex 固定 commit，重新核对 `codex-rs/model-provider/src/` 全树清单，确认 `provider.rs`、`models_endpoint.rs`、`models_identity.rs`、auth/shared-state 与测试仍是同一参考域；这次没有声称逐文件重新精读整个 package。XMA 吸收的是“真实服务身份、模型目录与 transport/auth 分层”，并把它落实为 `providerId`（用户选择的品牌/服务）与 `adapterId`（协议实现）分离。

DeepSeek 产品入口以目标厂商**当前官方 API 文档**为实时 Contract 来源：官方 endpoint、`/models`、Chat Completions、Tool Calls/Thinking 等能力必须以真实文档与实测为准，不能由品牌名或旧教程猜测。静态默认 model 只用于首次 bootstrap；运行时 model list 以真实 API 返回为准。外部真实凭据 E2E 未通过前，代码接入只能标记“待验收”，不能写成 Product Ready。

### 本批拒绝项

- 不把 Provider HTTP JSON 放进 `packages/xma-agent-loop/src/runtime.ts`；
- 不依据模型名/品牌猜 capability；
- 不把 API Key 写入 Provider Profile、Session 或测试 fixture；
- 不把本地 mock server 测试写成“外部厂商已 Ready”；
- 不机械复制上游 workspace 粒度；稳定能力按 `xma-*` package seam 建包。


## 12. 0.1.0 Tool / Approval / Native Stage C 研究记录

本批继续使用第 2 节锁定 commit，不跟随上游默认分支漂移。

### OpenAI Codex · tools / approvals

已核对固定 commit 下 `codex-rs/core/src/tools/` 文件树，并重点审阅 `router.rs`、`registry.rs`、`spec_plan.rs`、`approvals.rs`；同时核对同目录 `router_tests.rs`、`spec_plan_tests.rs`、`approvals_tests.rs` 等测试入口在参考域内。XMA 吸收的是：**一个 finalized tool plan 同时拥有模型可见 ToolSpec 与匹配的 Runtime**、Registry/Router 分层、Approval 是独立 policy stage 而非 Tool 自己偷偷弹确认、执行结果统一回到模型。Codex 的 Agent/Core 仍是 Rust 实现，XMA 不复制它的语言所有权。

### DeepSeek Harness · core/tools

已核对固定 commit 下 `packages/core/tools/src/` 与 `packages/core/tools/tests/` 全文件清单，重点把 `index.ts`、`invariant.ts`、`json-schema.ts`、`schema.ts`、`types.ts` 以及 execution/scoped/invariant/schema 测试纳入本批设计核对。XMA 吸收 typed schema、普通失败结构化、policy/guard pipeline、取消 signal、parallel-safe/exclusive 语义；PTC/code runtime 仍不是本批目标，不为“对标”而提前引入。

### Minecraft Host Agent · Tool gate / confinement

已审阅固定 commit 下 `src/tools/mod.rs`、`src/tools/confinement.rs` 和 `src/agent/mod.rs` 的 Tool dispatch/gate 段。XMA 吸收 Read/Write/Execute/Network 的用户交互分级、allow-once/allow-session/deny、参数失败回模型和取消后补齐结果的经验；但**拒绝仅靠词法路径收敛作为最终安全边界**。XMA 的真实文件 side effect 在 Rust Kernel 里做 `Host Policy subset + canonicalize + root containment`，Capability 还是一次性 lease。

### 本批安全拒绝项

- 不让模型看到一套 Schema、执行时再从 live Registry 找另一套 Runtime；
- 不让 Tool 自己声明“已批准”或绕过 monotonic Guard；
- 没有 Approval Provider 时不默认执行 write/execute/network；
- 不从 TypeScript 直接 `fs`/`child_process` 实现真实 Native Tool；
- 不把当前 direct-child timeout/kill 写成“process tree sandbox 已完成”；
- 不把“canonical absolute path identity”夸大成完整 executable identity：当前已消除 PATH/当前目录同名程序解析，后续仍需文件内容/句柄级 TOCTOU hardening。


## 13. 0.1.0 Workspace / Context / Session Stage D 第一批研究记录

本批继续使用第 2 节锁定 commit，不追随上游默认分支漂移。

### OpenAI Codex · environment / capability roots

继续核对固定 commit 下 `codex-rs/core/src/environment_selection.rs` 等环境选择边界，重点吸收“Workspace roots/Capability roots 属于持久 Thread/Turn environment identity，不能只靠临时 cwd”“owner/thread 配置来源需要明确”“环境选择变化要显式比较 identity”的工程经验。XMA 没有复制 Codex Environment Manager，也不把 Workspace 产品逻辑下沉 Rust；XMA 用 TypeScript `WorkspaceBinding` 冻结 owner/root/allowed roots，并让 Rust 只 enforce Native roots/capability。

### DeepSeek Harness · context group

核对固定 commit 下 `packages/context/` group tree 与 `README.md`。其中 workspace instructions、file/session references 都是 request-context plugin；README 明确强调 model-visible context 需要 durable、可 replay/compact，session reference 是 bounded read-only snapshot。XMA 吸收“Context Source 有明确 scope、跨边界引用必须 bounded/read-only、模型可见引用可追溯”原则；没有复制 DSH package 粒度或把所有 Workspace 能力拆成插件 package。

### Minecraft Host Agent · workspace/data-dir confinement

继续沿用 Stage C 已审阅的 `src/tools/confinement.rs` / `src/tools/mod.rs` / `src/agent/mod.rs`：MCHA 把 workspace/data-dir 作为工具收敛基准，并把确认门与 Tool permission 分开。XMA 吸收“Workspace 是工具副作用边界”但拒绝把词法路径判断当最终安全层；XMA 仍由 Rust canonical confinement 二次强制。

### 本批吸收/拒绝

吸收：stable Workspace identity、Owner boundary、显式跨 Workspace grant、Session durable audit、Context read scope、Tool/Native 双层 enforcement。

拒绝：把 cwd 当 Workspace identity；允许 Agent 直接创建其他 Agent 的 Owner Session；把 UI Approval 当 Workspace ACL；Context Source 未授权先读后过滤；仅靠 TypeScript path string 判断替代 Rust canonical confinement。


## 14. Terminal TUI 视觉参考 · MiMo Code

本批只把 `XiaomiMiMo/MiMo-Code` 作为 **Terminal UI/UX 视觉参考**，固定参考 commit `6fbb1732232c9d0ecefee209798a8586d78cb70d`（MIT）。重点审阅 `packages/opencode/src/cli/cmd/tui/routes/home.tsx`、`component/prompt/index.tsx`、`component/logo.tsx` 与中文 i18n 提示：吸收居中 Home、约 75 列 Prompt、真实输入区、状态/快捷键弱化层级与适度背景装饰。

XMA 不复制 MiMo 品牌、Logo、文案、Agent/Provider/命令体系。经 Windows Terminal 实机验证，旧 Pi TUI + 手写 ANSI caret/mouse 补丁会与宿主 Text Cursor Indicator/focus 状态互相干扰，因此 Active Terminal Host 改为参考该 commit 已验证的 `Bun 1.3.14 + @opentui/core/@opentui/solid 0.1.101 + solid-js 1.9.10`。吸收范围严格限定为 Renderer、Textarea、Keyboard、Dialog/Flex layout 与构建方式；Core Agent Runtime、Workspace Policy、Tool Approval 语义、Provider、Session 和 Rust Native Kernel 继续由 XMA 自己控制。
