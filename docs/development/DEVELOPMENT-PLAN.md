# XMA 开发计划

## 1. 总目标

0.1.x 的目标不是把界面做得像一个完成品，而是让 XMA 成为**真正可持续工作的多 Provider Agent Platform**：真实模型能够持续多轮推理、调用受控工具、恢复 Session、操作 Workspace，并通过 Rust Native Kernel 安全执行本地副作用。

开发顺序固定为：**底层 Runtime → 真实 Provider → Tool/Permission/Native → Session/Workspace/Context → Plugin/Compatibility → Code Agent → Minecraft Agent → Desktop Workbench。**

UI 当前只维持开发壳和 Host 通路验证，不提前投入复杂工作台细节。完整三栏布局目标见 `docs/architecture/DESKTOP-WORKBENCH.md`。

## 2. 上游参考方法

XMA 长期参考：

- OpenAI Codex：Coding Agent Runtime、Thread/Turn、ToolRouter、Provider、Permission/Sandbox、App Protocol；
- DeepSeek Harness：TypeScript Plugin Harness、Cordis Service/Event/Effect、Session、Tool Pipeline、Agent Loop；
- Minecraft Host Agent：Agent-First、Minecraft Skills/Knowledge/Tools、会话/用量/确认门、真实上游验证。

固定 commit、路径映射和许可证见 `UPSTREAM-REFERENCE.md`。实现任何重要子系统前，必须审阅对应上游子系统在固定 commit 下的全部相关源码/README/测试，而不是只看一个文件。

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
- 原始 reasoning 只走 live event，不默认进入 durable model history；
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

- `ProviderRegistry` 已实现 Adapter/Profile 注册与非 Secret Profile 校验；
- `EnvironmentCredentialResolver / MemoryCredentialResolver / CompositeCredentialResolver` 已实现请求时 Secret 解析；
- Profile 静态拒绝 `Authorization` / `X-Api-Key` 等 Secret-bearing Header；
- `ProviderCapabilities / ModelDescriptor / ProviderRequestError / BrainReadyProbeResult` 已进入 Core；
- `xma.openai-compatible` 已实现真实 HTTP/SSE Chat Completions transport family；
- 已覆盖 `/models`、stream text、分片 Tool Call arguments、Usage、取消、错误分类与最小 Brain Ready Probe；
- 本地 HTTP 测试证明协议实现，但不构成任何外部厂商 Ready 证据。

仍未完成：真实外部 Provider E2E、通用 Retry driver、OS Keychain Credentials、Anthropic/Gemini native、通用跨 Adapter Conformance Harness、Cost Catalog。

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

### 出口标准

- Code/Minecraft/Writer Workspace 不互相越权；
- 同一 Session resume 后模型看到的事实一致；
- Compaction 不暗改历史；
- 大输出不会无限塞入模型 Context；
- 导出无 Secret。

## 7. 阶段 E：Plugin Host 与 DeepSeek Harness Compatibility

### 实现

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

## 9. 阶段 G：Minecraft Agent 第一条垂直闭环

在通用 Runtime 稳定后，把 Minecraft Host Agent 的成熟场景经验 TypeScript 化进 `agents/minecraft/` 与相关 plugins：

- server-setup Skill；
- MC/Java/server software Knowledge；
- Mojang/Paper/Fabric/Modrinth 等真实 API tools；
- sys info / Java / server artifact / config / process / probe；
- Profile；
- 网络/穿透按 XMA 安全边界后续接入；
- 真实版本/哈希校验；
- “先感知现状，再动作”。

### 出口标准

一条真实 Minecraft 用例从自然语言到可验证本地服务器闭环，轨迹、版本事实、下载来源、Native 副作用全部可审计。

## 10. 阶段 H：Desktop Workbench

只有 A–F 的核心出口基本完成后才进入复杂 Desktop UI。

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

## 11. 0.1.x 版本推进原则

0.1.0 仍是可测试骨架。本版本未冻结期间的修复继续使用 0.1.0 同名包；真正冻结后下一批能力按 `0.1.1...0.1.100` 推进。

版本号不是任务完成的替代品。每个 patch 必须对应可验证增量；不能为了看起来“更新很多”空增版本。

## 12. 0.2.0 进入条件

只有 0.1.100 阶段验收完成后进入 0.2.0。最低要求：

- Agent Runtime / Session / Tool / Workspace 稳定；
- 多 Provider 实链；
- Rust Native 核心安全能力；
- Code Agent 真闭环；
- Minecraft Agent 至少一条真闭环；
- DSH Compatibility 有明确等级证据；
- Desktop Workbench 建立在稳定 App Protocol 上，而不是 UI 内嵌业务。

Writer、Research、DevOps 等 Agent 在此基础上逐步加入，禁止为了展示数量制造空壳。
