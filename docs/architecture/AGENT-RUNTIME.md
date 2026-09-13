# XMA Agent Runtime 架构

## 1. 目的

本文定义 XMA 0.1.x 最重要的底层 Runtime Contract，并区分“已落地第一版”与“后续目标”。当前 0.1.0 已有正式 `Session → Turn → Step` driver、Memory/JSONL Session Store、durable Context Snapshot、Provider/Tool 请求快照和取消结算；本批又落地了 frozen ToolPlan/ToolRouter、Schema → Policy → Security Guard → Approval → Execute 流水线，以及 Rust filesystem/process 最小 Capability 链。PTY/Network/process-tree ownership 等仍按本文继续实现。

参考上，XMA 借鉴 Codex 的 Thread/Turn/ToolRouter/Permission 运行语义、DeepSeek Harness 的 Session/Event/Service/Effect 结构和 Minecraft Host Agent 的 Agent-First/Skill/Tool 实践；实现上仍严格服从 XMA 自己的 **TypeScript Agent Core + Rust Native/Security Kernel** 边界。

## 2. 核心对象

XMA 不再把一次 Agent 执行理解为“复制一个 messages 数组然后 while(true)”。正式 Runtime 需要以下稳定对象：

### AgentDefinition

描述专业身份和能力组合，不保存一次会话的瞬时状态：

- `agentId` / display name；
- system instruction sections；
- 默认 Skill / Knowledge catalog；
- Tool / Plugin capability set；
- Workspace policy；
- 默认 Provider Profile；
- 专业 Agent 自己的业务配置。

Minecraft / Code / Writer 的差异应该主要来自 AgentDefinition、Plugin、Skill、Knowledge 和 Tool，而不是复制三套 Loop。

### Session

用户与某个 Agent 的**持久会话事实源**。Session 负责：

- durable event append；
- conversation history；
- Provider/Model route 的可追踪变更；
- Tool calls/results；
- approval decisions；
- workspace references；
- context/compaction markers；
- usage / latency / error records；
- resume / fork / export 的基础身份。

**Model-visible ⇔ reconstructable：模型可见内容必须能从 Session durable state 重建。**任何动态内容如果进入了模型请求，却只存在于某个 UI state 或进程内变量里，就是架构错误。

### Turn

Turn 是一次用户驱动的工作单元，从用户输入被正式接纳开始，到当前没有欠下的 Tool/Step 工作并把控制权交还用户结束。一个 Turn 可以包含多个 Step。

### Step

Step = **一次模型请求 + 该请求产生的一组 Tool Call 的处理**。如果工具结果要求模型继续推理，则同一 Turn 进入下一个 Step。

### ModelRequest

ModelRequest 是对当前 Step 的冻结视图：

- Provider / Model；
- derived message history；
- system/context sections；
- visible tool schemas；
- reasoning/config parameters；
- cancellation signal；
- request metadata / correlation id。

构造完成后不得被 UI 或并发插件偷偷原地修改。

## 3. Runtime 主链

```text
user input
  ↓
Session append / Turn open
  ↓
Context Assembly
  ├─ system sections
  ├─ Agent instructions
  ├─ Workspace instructions
  ├─ Skills / Knowledge results
  └─ durable history projection
  ↓
Provider Route + ToolPlan freeze
  ↓
Model Step (stream)
  ├─ text/reasoning live events
  └─ tool calls
  ↓
Tool Pipeline
  parse → schema → policy → approval → execute → post-process → durable result
  ↓
Observation append to Session
  ↓
同一个真实 Provider Model 继续下一 Step
  ↓
没有 tool debt → Turn close → UI 获得稳定结果
```

模型选择“做什么”；Framework 决定“是否允许以及如何安全执行”；Rust Native Kernel 只执行经过授权的 Native side effects。

## 4. Durable Event 与 Live Event

XMA 事件必须明确分两类。

### Durable Session Event

会影响恢复、模型上下文、审计或最终事实的事件必须持久化，例如：

- `session/created`；
- `turn/started` / `turn/ended`；
- `user/message`；
- `request/route`；
- `assistant/message` 或已结算 attempt；
- `tool/call` / `tool/result`；
- `approval/decision`；
- `context/compacted`；
- `usage/recorded`；
- `workspace/attached`。

名称可在实现期调整，但“哪些事实必须 durable”不能模糊。

### Live Runtime Event

只用于即时 UI/Host 展示、进度或短期控制的事件，例如：

- reasoning/text stream chunk；
- download progress；
- terminal output frame；
- spinner/progress；
- pending approval UI request。

Live event 可以丢失而不破坏 Session 的逻辑可恢复性。最终结算结果仍必须形成 durable fact。

## 5. Context Assembly

Context 不是把所有 Markdown 一股脑拼进 Prompt。当前 `core/src/context.ts` 已落地第一版 `ContextRegistry`：每个 Source 有稳定 `id`、可选 `order`、可释放注册；组装按 `order + id` 确定性排序，默认 64 KiB 字符硬上限，超限直接失败，不静默截断；组装结果生成 SHA-256 digest。Runtime 在每个 Step 前组装 Context，只有有效 digest 变化时才追加 `context/snapshot` durable event；从非空变为空时显式写入空快照清除旧 Context。

正式 Context Assembly 继续遵守：

1. 有明确 source/type 和稳定来源 ID；
2. 有 token/字符硬上限；
3. 稳定排序，减少 Provider prefix cache 无意义失效；
4. 模型可见动态内容必须先形成 durable Snapshot，可按 Step digest 重建；
5. 动态事实优先通过 Tool/Knowledge 查询进入；
6. Workspace / Agent / Skill instructions 有作用域；
7. 大输出先持久化，模型只拿必要摘要或引用；
8. Compaction 必须是可追踪的显式行为，而不是暗中改历史。

当前 Context Snapshot 作为模型历史中的有效 `system` message 投影；后续 system-message reconciliation / compaction 会继续把“Prompt 指令”和“动态 Runtime Context”拆得更细。对于代码 Agent，根 `AGENTS.md`、子目录 instructions、`.agents/.codex/.claude` 只是开发者上下文来源的一部分；产品 Runtime 未来也应支持 Workspace 级 instructions，但绝不能无限递归读取。

## 5.1 Session Export / Redaction / Migration

当前 `core/src/session-export.ts` 已提供第一版安全导出 Contract：`SessionExportEnvelope` 带独立 export version；调用方可把 Credentials Service 已知 Secret 临时交给 `SessionRedactor`，递归清理 user/assistant/tool/context/turn 文本与 JSON 数据，且不修改原 Session。带 redactor 的导出明确标记 `redacted: true`，它是安全分享投影，不承诺保持原始 digest 的可重放一致性。

`SessionMigrationRegistry` 只允许 `vN → vN+1` 相邻单向升级，拒绝 future format 与隐式 downgrade。当前 `SESSION_FORMAT_VERSION = 1` 没有历史已发布格式，因此默认 migration registry 为空；**它尚未接入 JSONL Store generation 发布流程**，不能写成“持久格式迁移已经完成”。

## 6. Tool Definition / ToolPlan / ToolRouter

### Tool Definition

每个工具至少声明：

- stable name / namespace；
- model-facing description；
- JSON input schema；
- output contract；
- permission/capability requirements；
- parallel safety；
- timeout / cancellation semantics；
- implementation runtime。

### ToolPlan

每个 Step 在真正请求模型前生成一个**冻结 ToolPlan**。它同时保存：

- 模型能看到的 Tool Schema；
- 同名的实际 Runtime；
- Agent/Workspace 范围限制；
- Provider capability 兼容结果；
- Plugin/Policy 过滤结果。

这避免模型请求和实际执行面漂移。

### Tool Pipeline

标准流水线：

```text
resolve call
  → validate schema
  → pre-policy / plugin interception
  → monotonic security guard
  → user approval（需要时）
  → execute
  → post-process / redact / attach context
  → freeze ToolResult
  → append durable event
  → return observation to model
```

普通工具错误必须转换为结构化 ToolResult，除非 Runtime 自身完整性已经失效；“一个文件不存在”不能让整个 Agent 进程崩溃。

并发默认保守：只读且工具明确声明 parallel-safe 时才能并行；Write/Execute/Network 等有顺序依赖的调用默认串行或形成 barrier。

### 当前 0.1.0 落地

`core/src/tools.ts` 已把 Tool Registry 生成的 Schema 与真实 Runtime 一起冻结到同一个 `ToolPlan`；每个 Step 只创建一次 Plan，并把 `toolPlanId + tools[]` 写入 `step/start`。Registry 在模型请求之后发生增删，不会改变该 Step 的 Router。`core/src/tool-schema.ts` 在 Policy 之前做 fail-loud 参数校验，普通参数错误变成 `TOOL_INVALID_ARGUMENTS` 返回模型自纠。

`core/src/tool-policy.ts` 已提供 standard/paranoid/auto Policy、单调 Security Guard、allow-once/allow-session/deny Approval 与 Session cache。没有 Host Approval Provider 时，write/execute/network 默认 fail closed。`parallel-safe` 调用可在同一批次并行；`exclusive` 调用形成 barrier。


## 7. Permission / Approval / Capability

XMA 要把三个概念分开：

- **Permission Policy**：本 Session/Workspace 对某类动作原则上允许到什么程度；
- **Approval**：当前具体调用是否需要用户这一次/本会话确认；
- **Native Capability**：Rust Kernel 最终真正拿到的最小 OS 权限令牌/限制。

模型不能通过改参数绕过任一层。TypeScript Tool 只能请求 Native Capability；Rust Runtime 必须独立验证 path、process、network 等约束。

第一阶段 Tool 交互语义可采用 `ReadOnly / Write / Execute / Network`，后续 Native 内部应细化为 filesystem/process/network/pty/archive 等具体 Capability，而不是让一个 `Network=true` 获得所有机器权限。

当前 Rust Kernel 第一批实现见 `docs/security/NATIVE-CAPABILITIES.md`：Native 进程先锁定一次 Host Policy，`filesystem.read` / `filesystem.write` / `process.spawn` capability 只能申请它的子集并采用一次性 lease；文件路径由 Rust 真实 canonicalize 后再做 root confinement；进程 Host Policy 只接受绝对 executable path，Host/lease/execute 三阶段都 canonicalize 后按真实路径身份核对，并且调用不经过 shell/PATH。process tree ownership、PTY/ConPTY、network capability 与可执行文件内容/句柄级 TOCTOU identity 仍未完成。

## 8. Cancellation 与结构合法性

取消必须是设计的一部分，不是 `AbortController` 到处传一下就算完成。

- 模型流式请求可协作取消；
- 工具收到同一生命周期下的 signal；
- Native process/PTY 必须有可终止的 Job/Process ownership；
- 已经展示给用户并被接受为最终事实的 Assistant 内容要有 durable settlement；
- 已产生 Tool Call 但因取消未执行的调用，必须有明确 aborted result 或等价的结构化结算，保证恢复后消息协议合法；
- 中断不能让 Session 停在“assistant 声明调用工具，但永远没有 result”的不可恢复状态。

## 9. Session Store 与恢复

0.1.x 首选 append-only JSONL 作为可审计基线，等性能/索引需要明确后再引入 SQLite。Store Contract 要支持：

- create/open/append/flush/close；
- list/stat；
- resume；
- export with redaction；
- future format version / migration；
- 单 Session 写所有权，避免两个 Runtime 同时破坏日志。

UI 的“聊天历史”“工作记录”“摘要”“来源”都应从这一事实源投影，而不是另存一套互相打架的数据。

## 10. Workspace

Workspace 不只是 cwd 字符串，而是 Agent 的安全领地：

- stable workspace id；
- root path + allowed roots；
- attached repo/project metadata；
- Agent ownership / cross-agent authorization；
- instructions discovery；
- persistent state location；
- Native filesystem capability scope。

默认一个 Agent 不修改另一个 Agent Workspace；跨 Workspace 操作必须显式授权并进入 Session 记录。

## 11. Plugin extension points

主循环只保留稳定 lifecycle；新产品行为优先通过插件/服务完成：

- context contribution；
- provider registration；
- tool registration/restriction；
- request preparation；
- tool pre/post policy；
- session event observer/projection；
- usage/telemetry；
- workspace hooks。

如果某功能只能通过 `if (agentId === 'minecraft')` 塞进 Core Loop，通常说明 extension point 设计还没完成。

## 12. UI/Host 边界

CLI / Desktop / Web / Server 只能通过 App Protocol、Commands 和事件投影观察/控制 Runtime。UI 不得：

- 自己维护另一套对话真相；
- 直接执行 shell/file native 操作绕过 Tool Policy；
- 在 renderer 中保存 Provider secret；
- 通过隐藏状态改变模型上下文而不记录 durable event。

这条边界是后续 Codex 风格三栏 Desktop 能稳定演进的前提。

## 13. 0.1.x 实现出口

Agent Runtime 不能只靠“类和接口已经写出来”验收。最低出口：

- Fake Provider 驱动多 Step Tool loop；
- 真实 Provider 完成 text + tool-call 往返；
- Session 可关闭后恢复继续；
- 取消后历史仍合法；
- Tool Schema、Policy、Approval、Native Capability 至少有一条完整链；
- UI/CLI 从同一事件流展示，不复制状态；
- 集成测试覆盖 model → tool → observation → same model。
## 14. 当前代码落地（0.1.0 未冻结）

当前第一版已经不再只有 `messages[] + runAgent()`：

- `core/src/runtime.ts`：`AgentRuntime / AgentSession`，负责 create/resume、Context Assembly 与 Turn/Step driver；
- `core/src/session.ts`：durable event Contract、模型消息投影与历史 Step 请求重建；
- `core/src/session-store.ts`：Memory / JSONL Store；
- `core/src/session-export.ts`：安全导出、Secret redaction 与相邻 migration Contract；
- `core/src/context.ts`：Context Source Registry、确定性组装、硬上限与 digest；
- `core/src/provider.ts`：Provider Profile/Credential/Capability/Catalog/Registry/Probe Contract；
- `core/src/app-protocol.ts`：Host command/result/event envelope 第一版；
- `core/src/tools.ts`：结构化 Tool Result 和普通异常/取消归一化。

第一版 durable event 已包含：`session/created`、`turn/start`、`user/message`、`context/snapshot`、`step/start`、`assistant/message`、`tool/approval`、`tool/result`、`usage`、`step/end`、`turn/end`。`step/start` 保存当次 Provider identity、`toolPlanId`、Tool Schema 快照和 `contextDigest`；模型历史由 context/user/assistant/tool durable fact 重新投影，并可按 Step 重建当时的 messages/tools/context。Approval 是审计事实，不进入模型消息投影；原始 provider reasoning 目前只发布 live delta，不写入后续模型历史。

JSONL Store 已支持单写者、正常 close、resume 和最后一行半写入恢复；Session export/redaction 与纯 migration registry 已有第一版，但 migration **尚未接入 JSONL Store generation 发布流程**。Context Assembly 已接入 Runtime，不过 system-message reconciliation、compaction、Workspace instructions discovery 仍未完成。

