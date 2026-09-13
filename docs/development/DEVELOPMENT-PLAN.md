# XMA 开发计划

## 1. 总目标

0.1.x 的目标不是把界面做得像一个完成品，而是让 XMA 成为**真正可持续工作的多 Provider Agent Platform**：真实模型能够持续多轮推理、调用受控工具、恢复 Session、操作 Workspace，并通过 Rust Native Kernel 安全执行本地副作用。

2026-09-13 架构换轨后的主线固定为：**Docs/Gates → `xma-ai + xma-agent-loop` → `xma-plugin` + DSH compatibility → `xma-tools` + Process/Shell → `xma-session/xma-context/xma-memory` → `xma-task/xma-subagent/xma-workflow` → Browser/Computer/Artifact → 专业 Agent 扩展 → Desktop Workbench。**

现有 Stage A-D 代码与测试不是作废，而是迁移基线：逐步被新的 `xma-*` packages 吸收/桥接，直到 Host 全部切换后再收缩 legacy `core/`。

UI 当前只维持开发壳和 Host 通路验证，不提前投入复杂工作台细节。完整三栏布局目标见 `docs/architecture/DESKTOP-WORKBENCH.md`。

## 2. 上游参考方法

XMA 强制执行 Upstream-first / No Blind Reinvention：

- **Pi**：Agent Loop、streaming、tool calling、parallel/sequential execution、steering/follow-up、multi-provider AI；
- **DeepSeek Harness**：Everything is a Plugin、Cordis Service/Event/Effect、capability seam、Session/Tool/Agent extension；
- **OpenAI Codex**：Approval、Sandbox、Process/Tool execution、Thread/Turn/Session、multi-agent、App Protocol；
- **MiMo Code**：Context compaction/reconstruction、Memory、Checkpoint、Task Tree、Subagent、Workflow、Skill discovery；
- **Minecraft Host Agent**：Minecraft 专业 Agent、server-setup Skill、领域 Tools/Knowledge、mod/服务器生命周期/樱花frp 穿透与真实 E2E。

固定 commit、路径映射和许可证见 `UPSTREAM-REFERENCE.md`。实现重要子系统前必须读对应源码、tests、protocol 和 failure handling，并在任务记录中说明吸收/拒绝项。

## 2.1 2026-09-13 Agent Platform Architecture Pivot

第一批只做文档/Gate 换轨，不在同一批偷偷重写 Runtime。随后依次执行：

```text
Stage P1  xma-ai + xma-agent-loop
Stage P2  xma-plugin + xma-plugin-dsh conformance
Stage P3  xma-tools + Process/Shell/Git 完整工作面
Stage P4  xma-session + xma-context + xma-memory
Stage P5  xma-task + xma-subagent + xma-workflow
Stage P6  Browser + Computer + Artifact capabilities
```

每个新包都必须有 Contract Tests；涉及上游行为兼容时有 Conformance Tests；涉及 Agent 能力必须有 integration `model → tool → result → same model → final`；Product Ready 需要 Windows 实机真实 Provider/Tool E2E。

## 3. 0.1.x 阶段 A：Runtime Contract 重构

### 目标

把当前“最小 `runAgent()` + messages 数组”升级为可持久、可恢复、可扩展的 Agent Runtime 基础。

### 实现

- AgentDefinition / AgentRegistry；
- Session / Turn / Step IDs 与生命周期；
- Durable Session Event Contract；
- Live Runtime Event Contract；
- Session Store interface + JSONL baseline；
- Turn/Step driver；
- cancellation settlement；
- Context Assembly Contract；
- App Protocol 基础 command/event types。

### 当前落地（本批次）

- `AgentRuntime / AgentSession` 已实现正式 Session → Turn → Step driver；
- `MemorySessionStore / JsonlSessionStore` 已实现 create/open/append/flush/close/list/stat；
- JSONL 已有单写者锁、stale lock 回收和末尾截断半行恢复；
- Fake Provider 已覆盖两 Step Tool Loop；
- assistant Tool Call + Tool Result 可从 durable event 重建成下一 Step 的模型历史；
- 取消时对已发出的 Tool Call 写入 `TOOL_ABORTED` 结果；
- Step 记录 Provider identity + 冻结 Tool Schema 快照；
- 原始 reasoning 不作为普通 assistant durable 文本；Provider 协议若为 thinking+tools 强制要求隐藏续传状态，则由 Adapter 产生 opaque `providerContinuation`，Runtime 只做 durable round-trip，redacted export 移除该状态；
- `ContextRegistry` 已实现稳定 Source 注册、order+id 确定性排序、64 KiB 默认硬上限与 SHA-256 snapshot；
- Runtime 已在每个 Step 前组装 Context，并把变化后的 `context/snapshot + digest` 写入 durable Session；
- `requestMessagesForStep / requestToolsForStep / requestContextForStep` 可重建历史 Step 的模型可见输入；
- Session export/redaction Contract 已实现，redacted export 明确标识为不可假定 replay-safe 的安全投影；
- 相邻单向 `SessionMigrationRegistry` Contract 已实现，但尚未接入 JSONL Store generation 迁移；
- App Protocol 已建立第一批 command/result/event 类型。

仍未完成：system-message reconciliation/compaction、Session fork/正式 Store generation migration、CLI/Server 真正接 Runtime command bus。

### 出口标准

- Fake Provider 能完成 `user → model → tool → observation → same model → final` 多 Step； **已覆盖**
- 进程退出后 resume 同一 Session 继续； **已由 JSONL 恢复测试覆盖**
- 取消后历史结构合法； **已覆盖 Tool Call aborted settlement**
- Model-visible 动态内容可从 Session 重建； **user/assistant/tool/context + 每 Step Tool Schema 已覆盖第一版**
- CLI 和测试都走同一 Runtime API。 **测试已切正式 Runtime，CLI 待接 App Protocol**

## 4. 阶段 B：真实 Model Provider 平台

### 目标

先把“大脑”真正接起来，再谈专业 Agent 产品能力。

### 实现

- Provider Registry；
- Provider Profile；
- Credentials Service；
- Provider Capabilities；
- Model Catalog；
- ModelRequest/ModelEvent normalization；
- usage / latency / retry / error taxonomy；
- Brain Ready Probe；
- Provider Conformance Test harness。

### 当前落地（本批次）

- `ProviderRegistry` 已实现 Adapter/Profile 注册与非 Secret Profile 校验；Profile 已显式区分真实品牌 `providerId` 与协议 `adapterId`，`ModelIdentity` 记录品牌/Profile/model，禁止把协议名冒充真实 Provider；
- `EnvironmentCredentialResolver / MemoryCredentialResolver / CompositeCredentialResolver` 已实现请求时 Secret 解析；
- `CredentialStore` + `NativeCredentialStore` 已增加 `os` CredentialReference；Rust Native Runtime 已实现 Windows Credential Manager、macOS Keychain、Linux Secret Service（存在 `secret-tool` 时）读/写/删 bridge；
- Terminal Provider 默认使用掩码 API Key 输入 → OS Credentials → Profile 只存稳定别名；`brain.json` v3 保存真实 Provider/Profile/Adapter/Model 身份并可同时保存多个独立 Profile；v1/v2 只作为显式迁移输入兼容读取；
- `plugins/providers/catalog.ts` 已建立真实 Provider Catalog 第一版：只展示已实现产品路径的品牌，首个入口为 DeepSeek Official + 自定义 OpenAI-compatible；未实现品牌不画假卡片；
- DeepSeek Official 使用官方 endpoint preset，模型通过真实 `/models` 动态发现；`/model` 可切换当前 Profile 的真实 model ID，切换后重新 Probe；真实 Agent Turn 显式启用 thinking/high reasoning，并按协议要求 durable round-trip `reasoning_content` continuation，避免 Tool Result 回传后丢失模型推理上下文；当前 DeepSeek named/`required` tool choice 与 thinking 不兼容，因此确定性 Brain Ready Tool 子探针只在探针请求中关闭 thinking，实际 Agent Turn 不降级；
- Profile 静态拒绝 `Authorization` / `X-Api-Key` 等 Secret-bearing Header；
- `ProviderCapabilities / ModelDescriptor / ProviderRequestError / BrainReadyProbeResult` 已进入 Core；
- `xma.openai-compatible` 已实现真实 HTTP/SSE Chat Completions transport family；
- 已覆盖 `/models`、stream text、分片 Tool Call arguments、Usage、取消、错误分类；Brain Ready Probe 已升级为目标 model catalog 校验 + 最小 text request + 声明 native tool calling 时的 Tool Call/Observation round trip；
- 本地 HTTP 测试证明协议实现，但不构成任何外部厂商 Ready 证据。

仍未完成：DeepSeek Official Windows 真实 API/OS Credentials 重启 E2E 与由此产生的 Product Ready 证据、其他外部 Provider E2E、macOS/Linux OS Credentials 实机 E2E、通用 Retry driver、Anthropic/Gemini native、通用跨 Adapter Conformance Harness、Cost Catalog。

### 真实 Adapter 顺序

1. OpenAI-compatible transport family：先证明 streaming text、native tool call、usage、cancellation；
2. Anthropic Claude native：证明 Runtime 没绑死 OpenAI JSON；
3. Gemini native；
4. OpenAI/Responses 特有能力、DeepSeek/MiMo/其他 Provider 根据其真实 API Contract 接入；
5. 本地模型/自定义 endpoint 作为 Provider Plugin 扩展。

“某厂商提供 OpenAI-compatible endpoint”必须以真实 API 文档/实测为准，不能因为名字相似就复用。

### 出口标准

- 至少两个不同协议族真实 Provider 通过相同 Conformance Tests；
- text streaming + tool-call round trip；
- UI/CLI 展示真实 Provider/model/reasoning/latency/usage；
- Secret 不进入 Session/日志/导出；
- Brain Ready 只有真实请求成功才为 ready。

## 5. 阶段 C：ToolPlan / Permission / Native Capability

### 目标

让模型能做真实事情，同时保证副作用不能绕过用户与 Kernel。

### 实现

- typed Tool Definition；
- input Schema validation；
- Tool Registry；
- 每 Step 冻结 ToolPlan；
- ToolRouter；
- parallel-safe / exclusive scheduling；
- structured ToolResult；
- Policy pipeline；
- Approval：本次 / 本 Session / 拒绝；
- Native Capability request；
- Rust Native Protocol 扩展。

### Rust Native 第一批

- filesystem confinement；
- process spawn/kill/tree；
- PTY/ConPTY；
- native network primitives；
- hash/archive；
- capability token / request validation。

### 当前落地（本批次）

- `core/src/tool/schema.ts`：模型参数在进入 Policy 前做最小 JSON Schema fail-loud 校验；
- `core/src/tool/router.ts`：Registry → frozen ToolPlan → 同源 ToolRouter，模型 Schema 与可执行 Runtime 不漂移；
- `core/src/tool/policy.ts`：standard/paranoid/auto、monotonic Guard、allow-once/allow-session/deny；
- durable `tool/approval` 审计事件；
- `parallel-safe` batch + `exclusive` barrier；
- `core/src/native.ts` + `plugins/tools/native.ts`：TypeScript Capability Bridge 与 Native Tool Adapter；
- Rust Host Policy：Native 初始化时锁定最大 roots/programs/resource limits，后续 capability 只能申请子集；
- Rust `filesystem.read` / `filesystem.write`：真实 canonical path confinement、大小硬上限、一次性 capability lease；
- Rust `process.spawn`：Host Policy 只接受绝对可执行文件路径，Host/lease/execute 三阶段 canonical identity 核对；单次 lease 只下放本次程序；cwd confinement、argv 分离无 shell、超时与输出上限；
- 当前明确未完成：Windows Job Object/Unix process group、进程树取消、PTY/ConPTY、network capability、hash/archive、可执行文件内容/文件句柄级 TOCTOU identity hardening。

### 出口标准

- read/write/execute/network 至少各一条 Tool 实链；
- path traversal/越界失败；
- approval 拒绝形成 Tool Result 而非进程崩溃；
- 取消能终止受控 process tree；
- Native 端独立校验权限，不盲信 TypeScript 参数。

## 6. 阶段 D：Workspace / Context / Session 产品化

### 实现

- Workspace ID/root/allowed roots；
- repo/project metadata；
- instructions discovery（含 `AGENTS.md` 等）与硬上限；
- cross-workspace authorization；
- Context source registry；
- large tool output attachment；
- context compaction durable event；
- Session list/show/export/resume/fork；
- usage ledger / cost estimation；
- redaction；
- future Session format version/migration Contract。

### 当前落地（Stage D 第一批）

- `core/src/workspace.ts`：稳定 Workspace Descriptor、绝对 roots、Owner identity、Binding digest 与 Registry；
- Stage D 新 Session 可冻结 `WorkspaceBinding` 到 Header，`requireWorkspace` 可强制产品 Session 必须绑定 Workspace；
- Session resume 对 owner/root/allowed roots descriptor drift fail loud；
- durable `workspace/access-granted` / `workspace/access-revoked` / `workspace/access-used`；
- Tool `workspaceAccess()` + `WorkspaceToolSecurityGuard`，跨 Agent grant 在真实 execute 前写审计；
- Native Tool Adapter 绑定稳定 workspaceId，并分别声明 read/write/execute；
- Context Source 可声明 Workspace read scope，跨 Workspace 未授权时在 render 前拒绝；
- App Protocol 已增加 workspace list/grant/revoke 类型面；
- 当前仍未完成：Workspace 持久 Registry、repo metadata、instructions discovery、rebind/migration、large-output attachment、compaction、Session fork。

### 出口标准

- Code/Minecraft/Writer Workspace 不互相越权；
- 同一 Session resume 后模型看到的事实一致；
- Compaction 不暗改历史；
- 大输出不会无限塞入模型 Context；
- 导出无 Secret。

## 6.1 插入批次：Agent + Skill Platform Foundation

### 目标

把“XMA 是多专业 Agent 平台”从产品描述变成稳定 Core Contract，同时避免提前创建一堆空 Agent。

### 当前落地（本批次）

- `core/src/agent/contract.ts`：正式 `AgentDefinition`，包含 manager/specialist、Skills、Tools、Brain capability、Workspace、Memory、Delivery、Delegation Policy；
- `core/src/agent/registry.ts`：不可变 Agent Registry 与基础一致性校验；
- `core/src/agent/delegation.ts`：`AgentTask` 与 Manager delegation fail-closed Contract；
- `core/src/skill/contract.ts`：产品 Skill metadata；
- `core/src/skill/loader.ts`：从 `skills/<domain>/<name>/skill.json + SKILL.md` 安全加载 canonical Skill；
- `core/src/skill/registry.ts`：Agent↔Skill 绑定、Tool/Brain requirements 校验；
- `createAgentSkillContextSource()`：Agent identity + Skill 文本通过标准 Context Assembly 进入模型，并由现有 durable `context/snapshot` 记录实际模型可见内容；
- `xiaoyu` 当前 Code Session 已接 `AgentRegistry + SkillLoader + SkillRegistry`，源码模式读取根 `skills/`，portable 通过 `XIAOYU_SKILLS_HOME` 读取随包 Skills；
- 内置真实 Agent 只保留 `Xiaoyu Manager` 与 `Xiaoyu Code`；旧 Writer/Minecraft 单文件空骨架删除；
- 首批 4 个产品 Skills：`common/task-planning`、`common/verification`、`code/bug-fixing`、`code/testing`；
- 新测试覆盖 Skill 加载、Agent loadout、Context 注入和 delegation deny。

### 明确未完成

- Xiaoyu Manager durable Task Store / Scheduler / 子 Agent 实际执行；
- Agent 自动 Brain route；
- 用户安装 Agent/Skill；
- Codex/Claude Code/DeepSeek Harness/Zcode Host Adapter；
- Writer/Minecraft/GameDev/Art 等专业 Agent 实现。

### 出口标准

- Agent/Skill canonical definition 有唯一来源；
- Skill requirement 与 Agent declared capability 不匹配时 fail loud；
- 模型可见 Skill 通过 Context Assembly，可形成 durable snapshot；
- Manager 可以创建合规 specialist Task，普通 specialist 默认不能委派；
- 不为未来功能创建空 Agent/Skill 目录。

## 6.5 插入批次：Distribution + Terminal Runtime

这批在 Stage D 第二批前优先完成“真正能安装、真正能在终端持续运行”的产品入口，但不改变 Backend First 原则。

### 第一批落地

- `xiaoyu` canonical command + `xma` compatibility alias；
- 持续 TUI，而不是欢迎页打印后退出；
- 固定 Pi TUI 0.74.0 作为 Node 22 兼容差分渲染/Overlay/硬件光标基础层；主输入使用 XMA `SafePromptInput`，禁止使用上游 Editor/Input 的 reverse-video cursor；支持 CJK 硬件光标、历史、多行与已实现命令的 `/` 自动补全；Home/Prompt Dock 固定锚点，丰富视觉只刷新装饰层；`Ctrl+P` 命令面板 + Terminal Settings（丰富/简洁、提示、Logo）作为真正可操作的 Overlay，不推动主布局；
- Workspace Home/root 风险确认；
- CLI 绑定正式 Workspace + JSONL Session Runtime；
- OpenAI-compatible Brain Terminal 配置闭环：用户级非 Secret Profile Store、OS Credentials 默认安全录入、Credential Env Reference 兼容、Brain Ready、模型列表/选择；旧 `XIAOYU_*` 环境变量保持兼容；
- `xiaoyu doctor/server/web` 入口；
- portable bundle：私有 Node + CLI/Server/Web + Rust Native；
- Windows / Unix bootstrap installer；
- Release manifest / SHA-256 / `.cache` staging 与 `dist/release` 合同；
- Terminal Native 文件 ToolSet：Rust-backed `read_text/write_text` + TUI deny/allow-once/allow-session Approval；默认不开放 process 工具。

### 尚未完成

- OS Credentials 三平台实机验收：代码已桥接 Windows Credential Manager / macOS Keychain / Linux Secret Service，仍需在对应系统完成真实写入→重启→读取→Probe→删除 E2E；
- Terminal process Tool allowlist / Approval（文件 read/write 第一批已接 Rust Kernel）；
- PTY/ConPTY；
- 正式公网安装域名；GitHub tag release workflow 已有代码，但尚未完成真实 tag/release E2E；
- macOS/Linux 实机 installer E2E 与签名/公证。

### 出口标准

Windows/Linux/macOS 各自平台构建的资产至少完成：install → 新终端 `xiaoyu --version` → `xiaoyu doctor` → 安全 Workspace TUI → upgrade → uninstall/PATH cleanup。

## 7. 阶段 E / Pivot P2：`xma-plugin` 与 DeepSeek Harness Compatibility

### 实现

- 将现有 `core/src/plugin.ts` 渐进迁移到 `packages/xma-plugin/`；
- XMA Plugin scope/lifecycle transaction；
- stable Service Registry；
- typed event maps；
- effect/disposer；
- Provider/Tool/Context/Session extension points；
- Capability Definition / Provider / Consumer 规范；
- DSH Tool/LLM/Session/Skill bridges；
- package-level Conformance Test harness。

### 出口标准

- mount/unmount/reload 不泄漏注册；
- 一个插件失败能回滚；
- Tool/Provider 可通过插件替换而不修改 Agent Loop；
- 至少一个真实 DSH plugin package 达到 Package Compatible 后才对该包宣称兼容。

## 8. 阶段 F：Xiaoyu Code 第一条通用 Coding Agent 闭环

Code Agent 是检验通用 Runtime 的第一条专业链，不另造 Coding 内核。

### 能力

- repo/worktree discovery；
- read/list/search；
- edit/patch；
- shell/terminal；
- git status/diff；
- web/doc search；
- MCP；
- approvals；
- project instructions；
- change summary / test evidence。

### 参考 Codex 的重点

Thread/Turn、Tool Router、approval/sandbox、AGENTS discovery、exec/file-system、app protocol、thread store。**参考行为，不复制其 Rust 业务架构。**

### 出口标准

让用户在一个真实仓库里提出一个多文件任务，Xiaoyu Code 能：读规则 → 查代码 → 修改 → 执行测试 → 展示 diff/证据 → 继续同一 Session 修正，并且所有机器副作用受 Permission/Native 约束。

## 9. 阶段 G：Minecraft 专业 Agent 闭环

在通用 `xma-agent-loop/xma-ai/xma-plugin/xma-tools` 稳定后，Minecraft 不另造 Runtime。领域第一参考固定为 `AndrewNog0724/minecraft-host-agent`：Agent-First 行为、`server-setup` Skill、Knowledge/API、真实工具语义与演示轨迹都作为设计/验收基线。

建议产品组合：专业 Agent identity + Minecraft Skill/Knowledge + Minecraft Tool Plugin。领域编排仍由用户选中的真实模型完成，Skill 只提供红线、决策清单和验收标准。

重点能力：

- 开工“先看后动”：发现已有 `server/`/Profile 先陈述现状并确认沿用、继续或新开；
- MC/Java/server software 兼容查询，易变事实不写死 Prompt；
- Java 探测/受管供给、Vanilla/Paper/Spigot/Fabric server artifact、配置生成；
- `check_plan` 作为确定性部署前验收，不替模型做决策；
- server 独立窗口启动、`latest.log` 就绪判定、端口探测与 MC SLP ping；
- Modrinth + CurseForge/社区镜像的 mod 检索、依赖闭包、安装期权威重取与哈希校验；
- Profile/Session/Usage 留痕；
- 内网穿透七件套：`check_tunnel / ensure_frpc / select_tunnel_node / create_tunnel / start_tunnel / tunnel_status / delete_tunnel`，樱花frp API v4 + frpc 下载校验 + 节点确定性打分 + API online 轮询 + 端到端验证；
- XMA 中所有文件/进程/网络副作用仍经 `xma-tools → Approval → xma-native → Rust Kernel`，不复制 MCHA Rust Agent Loop。

### 出口标准

在支持范围内完成一条真实用例：用户只用自然语言描述“版本 + 账号情况 + 服务端/mod + 网络需求”，Minecraft Agent 能自动查证 → 必要追问 → 部署 → 启动验证 → 必要时穿透 → 交付连接信息；真实版本、下载源、哈希、Tool/Approval/Native 轨迹均可审计。外部第三方服务、账号实名、网络故障等不可控条件必须结构化解释，产品不做绝对 100% 成功承诺。

## 10. 阶段 H：External Host Adapters

在 XMA Native Runtime + Xiaoyu Code 真闭环证明 Agent/Skill Contract 稳定之后，再开始“把属于用户的 Agent 带到外部宿主”。

### 目标

- 定义稳定 Host Contract / Host Capabilities；
- Agent/Skill canonical definition 只有一份；
- Host Adapter 负责格式转换、安装、同步、移除和 capability negotiation；
- 优先选一个 Host 做完整 Adapter + Conformance，再扩 Codex / Claude Code / DeepSeek Harness / Zcode；
- Tool/MCP/权限桥不能绕过 XMA Policy/Approval/Native 安全边界。

### 禁止

- 不得为每个 Host 复制一套 `Xiaoyu Code`；
- 不得把 `codex-agent.ts`、`claude-agent.ts` 等宿主特例写进 Core；
- 没有真实安装/运行/卸载 Conformance 证据不得宣称兼容完成。

## 11. 阶段 I：Desktop Workbench

只有 Runtime/Provider/Tool/Workspace/Agent-Skill/Code 等核心出口基本完成后才进入复杂 Desktop UI。

### 已锁定产品方向

- 现代三栏布局；
- 左栏默认展开；
- 中央大 Workspace；
- Chat / Work；
- 右栏 Inspector 默认收起；
- 左右栏可吸附拉伸；
- 中央底部可展开 Terminal；
- Work Summary、Sources、Git/Diff/Environment 等投影；
- 左下用户/设置；
- layout preference 持久化。

### UI 技术原则

- UI 不拥有 Agent 状态；
- Runtime 通过 App Protocol/Event Stream 提供数据；
- Terminal 经过 Rust PTY；
- renderer 不获得任意 Node/Rust 权限；
- Electron 41.2.0 主 / Tauri 2 副继续复用同一 Web UI 与 Core。

## 12. 0.1.x 版本推进原则

0.1.0 仍是可测试骨架。本版本未冻结期间的修复继续使用 0.1.0 同名包；真正冻结后下一批能力按 `0.1.1...0.1.100` 推进。

版本号不是任务完成的替代品。每个 patch 必须对应可验证增量；不能为了看起来“更新很多”空增版本。

## 13. 0.2.0 进入条件

只有 0.1.100 阶段验收完成后进入 0.2.0。最低要求：

- Agent Runtime / Session / Tool / Workspace 稳定；
- 多 Provider 实链；
- Rust Native 核心安全能力；
- Code Agent 真闭环；
- Minecraft Agent 至少一条真闭环；
- DSH Compatibility 有明确等级证据；
- Desktop Workbench 建立在稳定 App Protocol 上，而不是 UI 内嵌业务。

Writer、Research、DevOps 等 Agent 在此基础上逐步加入，禁止为了展示数量制造空壳。
