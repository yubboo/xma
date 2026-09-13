# XMA Agent Engine / Platform Strategy

> 状态：**已批准，正式生效**  
> 批准日期：2026-09-13  
> 目的：固定 XMA Agent Platform 的上游优先、`xma-*` 包族、Everything is a Plugin、模型智力保护和渐进迁移策略。  
> 核心目标：**停止无方向地重复造 Agent 基础轮子；先研究成熟开源实现，再做 XMA 自己可控、可改、可长期维护的实现。**

---

## 1. 结论先行

XMA 继续保持原来的产品身份、语言所有权、安全边界、Provider Truth Contract、Workspace/Manager 方向和 Windows-first 工程体系，但 Agent 基础设施开发策略正式换轨：

1. **Upstream-first**：任何 Agent 基础能力开工前，必须先研究成熟上游的真实源码、测试、协议和失败处理；禁止凭感觉重新设计一个缩水版。
2. **XMA package family**：稳定能力统一使用 `xma-*` 命名，例如 `xma-agent-loop`、`xma-ai`、`xma-plugin`、`xma-session`、`xma-tools`。
3. **接口归 XMA，成熟实现优先参考上游**：`xma-agent-loop` 表示 XMA 对 Agent Loop 的稳定接口和代码所有权，不代表必须从零发明 Agent Loop。
4. **Everything is a Plugin**：Provider、Tool、Context、Memory、Workflow、Subagent、Browser、Artifact、UI extension 等都通过稳定插件/Capability seam 接入；主循环只保留最小、稳定生命周期。
5. **DeepSeek Harness/Cordis 兼容是正式目标**：不仅模仿 `apply(ctx)` 外形，而是尽量兼容 Service / Event / Effect / lifecycle / scope 语义，并用 Conformance Tests 分级证明。
6. **模型智力不再被 Harness 降级**：顶级模型保留任务判断和行动决策权；Skill 用来增加知识与工作方法，不用来替代模型推理；完整 Tool Surface、真实反馈、长期 Context/Memory、Subagent 才是增强模型的主要方式。
7. **Rust Kernel 保持不变**：Process、Filesystem confinement、Sandbox、Capability、Approval enforcement、OS Credential 等真实副作用仍由 XMA Rust Native/Security Kernel 负责。

一句话：

> **先看成熟项目怎样把顶级模型变成真正能工作的 Agent，再实现 XMA 自己的版本；不盲写、不做黑盒依赖、不把模型关进缩水 Harness。**

---

## 2. “复用 / 参考”的准确含义

本方案中的“复用”不是以下两种极端：

- 不是把第三方 SaaS / 远程 Runtime 当成 XMA 核心，导致别人停服或闭源后 XMA 失效；
- 也不是为了“原创”而无视成熟实现，再从零写一套功能残缺的 Agent Loop。

正确流程是：

```text
需求 / 能力
   ↓
找到成熟上游对应子系统
   ↓
阅读真实源码 + tests + protocol + failure handling
   ↓
写清 XMA 要吸收的 Contract / 数据流 / invariant
   ↓
结合 XMA 的 TypeScript ownership + Rust Kernel 重新落地或选择性移植
   ↓
XMA 自己构建 / 测试 / 发布 / 长期维护
```

因此：

> **Upstream 是实现导师和事实参考，不是 XMA 的远程控制面。**

重要能力必须保证：即使某个上游明天停止维护，XMA 已经实现的代码仍然能够独立构建和运行。

---

## 3. 上游角色分工

### 3.1 Pi：Agent Engine / AI Provider 第一参考

重点研究：

- Agent Loop；
- streaming message lifecycle；
- text / thinking / tool-call 增量；
- Tool execution；
- parallel / sequential tool execution；
- steering / follow-up message；
- state management；
- multi-provider AI abstraction。

XMA 对应：

- `xma-agent-loop`
- `xma-ai`
- streaming/event contract
- tool execution orchestration

原则：**Pi 已经解决的基础 Agent Loop 问题，XMA 不再凭空设计另一个简化版本。**

### 3.2 DeepSeek Harness：Plugin / Capability Architecture 第一参考

重点研究：

- Everything is a Plugin；
- Cordis `ctx.<service>`；
- `inject`；
- `apply(ctx)`；
- Effect / disposer；
- typed event；
- scoped registration；
- Agent / Tool / Session / LLM capability seam；
- live event 与 durable event 分离；
- plugin mount / unmount / reload。

XMA 对应：

- `xma-plugin`
- `xma-plugin-dsh`（兼容插件 package 名，物理位置 `plugins/dsh-compat/`，不等于新的 Platform Core 目录）
- Capability graph
- Plugin lifecycle

### 3.3 OpenAI Codex：Security / Approval / Execution 第一参考

重点研究：

- approval policy；
- sandbox / process execution；
- Thread / Turn / Session lifecycle；
- Tool Router；
- cancellation；
- multi-agent；
- app protocol。

XMA 对应：

- `xma-approval`
- `xma-process`
- `xma-sandbox`
- Rust Native Kernel
- App Protocol

Codex 的 Rust 产品架构不直接改变 XMA 的语言所有权：**Agent/Product orchestration 仍归 TypeScript；OS enforcement 归 Rust。**

### 3.4 MiMo Code：Long-horizon Intelligence 第一参考

重点研究：

- context compaction / reconstruction；
- persistent project memory；
- checkpoint；
- task tree；
- subagent lifecycle；
- parallel work；
- goal / stop condition；
- deterministic workflow；
- skill discovery / on-demand loading；
- long task cost / cache awareness。

XMA 对应：

- `xma-context`
- `xma-memory`
- `xma-subagent`
- `xma-workflow`
- `xma-task`

### 3.5 MCHA：Minecraft 专业 Agent 领域实现第一参考

MCHA 继续作为“模型决策 → 工具执行 → Observation → 同一模型继续推理”的 Agent-First 行为参考，尤其用于验证：Skill 是知识/操作规程，不是把任务流程硬编码成决策树。

---

## 4. Capability Matrix：保持当前策略不变

| 能力 | Pi | DeepSeek Harness | Codex | MiMo Code | XMA 策略 |
| --- | --- | --- | --- | --- | --- |
| Agent Loop | ✅ | ✅ | ✅ | ✅ | **直接复用 Pi 的成熟实现思路与代码路径，形成 `xma-agent-loop`** |
| Multi-provider | ✅ | ✅ | 较偏 OpenAI | ✅ | **Pi AI 思路 + XMA Provider Profile / Credential / Truth Contract** |
| Streaming | ✅ | ✅ | ✅ | ✅ | **直接复用成熟 streaming/event 模型** |
| Tool calling | ✅ | ✅ | ✅ | ✅ | **直接复用成熟 Agent 层语义** |
| Parallel tools | ✅ | ✅ | ✅ | ✅ | **直接复用成熟执行语义** |
| Process/Shell | ✅ | ✅ | ✅ | ✅ | **XMA Rust 后端** |
| Approval | Pi 默认较弱 | ✅ | ✅ | ✅ | **XMA Rust enforcement + Codex/DSH 思路** |
| Sandbox | 外部 | ✅ | ✅ | 有 | **XMA Rust Kernel** |
| Session | ✅ | ✅ | ✅ | ✅ | **重点评估 Pi / DSH，选成熟 Contract** |
| Context compaction | 有 | 有 | 有 | ✅ 很完整 | **重点吸收 MiMo** |
| Memory | 扩展 | 插件 | 有 | ✅ | **重点吸收 MiMo** |
| Subagent | 有能力 | ✅ seam | ✅ | ✅ | **优先吸收成熟上游实现** |
| Agent Teams | — | experimental | ✅ | ✅ | **后续** |
| Workflow | — | plugin | — | ✅ | **参考 MiMo** |
| Browser | 扩展 | plugin | 有 web tool | ✅ | **后续 Capability** |
| Computer control | — | 可插件 | — | Desktop | **后续 Capability** |
| Artifact / PPT / PDF | Skill / Tool | plugin | — | ✅ | **Skill + Tool** |

这张表是后续 Agent Platform 开发的默认决策表。改变其中任一策略，需要新的架构决议，而不能在实现过程中临时改方向。

---

## 5. XMA Package Family

### 5.1 命名规则

稳定 Agent Platform 能力统一采用：

```text
xma-<capability>
```

Platform Skeleton v1 首批核心包已经落地：

```text
packages/
├─ xma-agent-loop/      # Agent Turn/Step/Tool loop
├─ xma-ai/              # Model / Provider / streaming abstraction
├─ xma-plugin/          # Plugin Context / Service / Event / Effect / lifecycle
├─ xma-tools/           # Tool definition / plan / router / policy facade
├─ xma-session/         # Durable Session / event log / projection
├─ xma-context/         # Context Assembly / Workspace identity / grant
└─ xma-native/          # TypeScript ↔ Rust Kernel capability bridge
```

后续只有进入真实开发阶段才创建：

```text
xma-memory
xma-task
xma-subagent
xma-workflow
```

能力成熟后再增加：

```text
xma-browser
xma-computer
xma-artifact
xma-mcp
xma-git
xma-search

# DSH compatibility 当前保持自包含插件：
plugins/dsh-compat/   # workspace package name: xma-plugin-dsh
```

### 5.2 Package 的真正含义

`xma-*` 表示：

- XMA 稳定公共 Contract；
- XMA 自己维护的源码；
- XMA 自己的测试和发布责任；
- XMA 可以自由修改实现。

它**不表示必须从零发明内部实现**。

例如：

```text
xma-agent-loop
  interface / ownership → XMA
  mature implementation reference → Pi
  plugin/capability integration → DSH-inspired
  security enforcement → XMA Rust
```

### 5.3 不走“微包地狱”

新的 `xma-*` 方向会替代当前“Core 永远单包”的旧约束，但也不意味着每个 helper 都建 package。

建立 package 至少需要满足一项：

- 是稳定能力 seam；
- 有独立生命周期；
- 有多个消费者；
- 有明确上游对应能力；
- 有独立测试/替换价值。

普通内部 helper 仍留在所属 package 内。

---

## 6. Everything is a Plugin

### 6.1 核心目标

Agent Loop 不再是所有功能的垃圾场。以下能力都应该通过 Plugin / Capability seam 挂载：

```text
Model Provider
Tool Provider
Context Source
Memory Provider
Session Projection
Approval Policy
Sandbox Provider
Subagent Provider
Workflow
Browser
Computer Control
Artifact Generator
Search / MCP / Git
UI Extension
Telemetry
```

### 6.2 `xma-plugin` 基础语义

至少支持：

```text
ctx.<service>            稳定 Service 容器
inject                   显式依赖
apply(ctx)               mount 生命周期
effect() / disposer      可逆副作用
typed events             类型化事件
scope                    Agent / Session / Workspace 作用域
mount / unmount / reload 插件生命周期
```

插件注册必须可撤销；卸载后不能残留 listener、timer、tool、provider 或幽灵状态。

### 6.3 DeepSeek Harness Compatibility

目标不是只做“名字相同”的假兼容，而是分级：

1. **Contract Compatible**：`inject / apply / ctx / effect` 行为兼容；
2. **Service Compatible**：某类 DSH Service 可以通过 XMA bridge 正常工作；
3. **Package Compatible**：真实第三方 DSH 插件无需修改即可 mount；
4. **Behavior Compatible**：通过 Conformance Suite 证明 lifecycle / event / dispose / error behavior 一致。

只有通过对应测试的层级才能对外宣称兼容。

### 6.4 Plugin 不能绕过 Security Kernel

Everything is a Plugin 不等于 Everything can bypass security。

正确路径：

```text
Plugin
  ↓
xma-tools / capability
  ↓
Policy / Approval
  ↓
xma-native
  ↓
Rust Security Kernel
  ↓
Filesystem / Process / Network / OS
```

禁止插件直接使用 Node `child_process`、无约束 `fs` 等方式绕过 XMA Native policy 执行真实副作用。

---

## 7. Model Intelligence Preservation Contract

这是本次换轨最重要的产品原则之一。

### 7.1 强模型负责思考

用户选中的真实模型负责：

- 理解任务；
- 判断下一步；
- 选择工具；
- 根据 Observation 修正方案；
- 决定是否需要子 Agent；
- 判断何时完成。

Framework 负责：

- 提供真实能力；
- 管理 Session / Context；
- 执行 Tool；
- 保护权限；
- 记录事实；
- 防止失控。

Framework 不应替模型写一个缩水版“脑子”。

### 7.2 Skill 是增强，不是限制

Skill 正确用途：

- 专业知识；
- 操作经验；
- 领域约束；
- 验收标准；
- 高质量工作方法。

Skill 错误用途：

- 固定模型必须按 A→B→C 思考；
- 用大量低层步骤替代顶级模型自主规划；
- 因为绑定 Skill 就缩小 Tool Surface；
- 把 legacy workflow 强制施加给所有模型。

强模型默认应获得**简洁身份 + 丰富真实 Tool + 必要安全约束 + 按需 Skill**。

### 7.3 Build / Plan / Compose

- **Build**：默认真实工作模式，完整可用工具面，副作用由 Approval/Sandbox 控制；
- **Plan**：同一个真实模型，只限制为只读/分析能力；
- **Compose (legacy)**：保留兼容，但不作为旗舰模型默认工作方式；固定课程式流程只在明确适合时使用。

### 7.4 Provider Truth Contract 不变

当前选择的 `providerId + profileId + modelId` 仍然必须是真实请求目标。

未来如果实现智能模型路由，必须满足：

- 用户明确启用路由策略；
- 每次 route/model change 可见；
- 形成 durable fact；
- 可审计成本与原因；
- 不允许隐藏降级或偷偷换模型。

---

## 8. XMA Agent Runtime 目标数据流

```text
User Input
   ↓
xma-agent-loop
   ↓
Context Assembly
   ├─ Session history
   ├─ Project / Workspace context
   ├─ Memory
   ├─ On-demand Skills
   └─ Tool schemas
   ↓
xma-ai → selected real Provider / Model
   ↓
STREAM
   ├─ text delta ───────────────→ Live UI
   ├─ reasoning delta ──────────→ Live UI (provider actually supports it)
   └─ tool call delta
            ↓
        xma-tools
            ↓
      Policy / Approval
            ↓
        xma-native
            ↓
       Rust Kernel
            ↓
        Tool Result
            ↓
 Durable Session Event
            ↓
 same model next Step
```

必须同时满足：

- **live ≠ durable**：token/chunk 是 live event；最终 message/tool fact 进入 durable Session；
- **model-visible ⇒ reconstructable**：进入模型的动态事实必须能够从 Session/Context state 重建；
- **Tool result 回同一模型继续推理**；
- **普通 Tool failure 不杀死 Agent Loop**，而是结构化返回模型决定恢复方式。

---

## 9. Long-horizon Agent：真正“能工作”的关键

仅仅把 API 接通不等于 Agent。

XMA 后续真正要补齐的是：

```text
Model Intelligence
      +
Rich Tool Surface
      +
Persistent Session
      +
Context Reconstruction
      +
Memory / Checkpoint
      +
Task Tree
      +
Subagents
      +
Workflow
      +
Browser / Computer / Artifacts
      +
Security Kernel
```

这解释了为什么相同的旗舰模型放进不同 Harness 后能力差异巨大：**模型是大脑，Harness 决定它有没有手、眼睛、长期记忆、工作台和协作者。**

---

## 10. 迁移现有 XMA 0.1.x 的方式

不做“一次推倒全部重写”。采用兼容迁移。

### Stage 0：文档与 Gate 先换轨

**状态：已完成。** 文档/Gate 换轨后又完成 Platform Skeleton v1：首批 `xma-*` workspace package、插件按本体聚合、`core/` Compatibility Facade、`CODEMAP.md` 与 Stable Import Gate 已落地。这里不代表 Pi Agent Loop 的行为级吸收已完成。

先更新架构规则，避免代码改到一半又被旧 Gate 判错。

重点废除/修订：

- “0.1.x 不要拆成独立 package”作为普遍规则；
- “Agent Loop 等基础能力默认独立重写”的隐含假设；
- 上游只有 Codex / DSH / MCHA 的旧参考表。

新增：

- Pi；
- MiMo Code；
- Upstream-first Development Rule；
- No Blind Reinvention Rule；
- `xma-*` package family；
- Everything is a Plugin。

### Stage 1：`xma-ai` + `xma-agent-loop`

先解决当前最根本的问题：模型明明很强，但 Harness 太弱。

迁移：

```text
packages/xma-ai/src/model/model.ts
packages/xma-ai/src/provider/provider.ts
packages/xma-agent-loop/src/runtime.ts
```

逐步变成：

```text
packages/xma-ai/
packages/xma-agent-loop/
```

要求：

- streaming text/thinking/toolcall 原生事件；
- tool loop；
- parallel tools；
- cancellation；
- steering/follow-up 可扩展点；
- Provider continuation；
- 不破坏 Provider Truth Contract。

旧 `core/` 暂时作为 compatibility facade re-export，直到所有 Host 切完。

### Stage 2：`xma-plugin`

把现有 `packages/xma-plugin/src/plugin.ts` 升级成正式 Plugin Runtime：

- Service Context；
- inject；
- effect/disposer；
- typed event；
- scope；
- lifecycle；
- plugin-owned capability registration。

随后在 `plugins/dsh-compat/`（workspace package `xma-plugin-dsh`）建设 Conformance。

### Stage 3：`xma-tools` + Process/Shell

给模型真正的“手”。

补齐：

- read/write/edit；
- grep/glob/search；
- shell/process；
- git；
- Tool progress；
- structured error；
- parallel-safe / exclusive semantics。

真实 Process/Shell 仍走 XMA Rust executable registry / absolute identity / approval / sandbox。

### Stage 4：Session / Context / Memory

建立真正长期工作的基础：

- durable session；
- checkpoint；
- compaction；
- context reconstruction；
- project memory；
- budgeted injection；
- session resume。

重点研究 DSH Session + MiMo Context/Memory。

### Stage 5：Task / Subagent / Workflow

- durable Task Tree；
- child agent lifecycle；
- parallel investigation / implementation / review；
- cancellation / wait / result merge；
- deterministic workflow engine；
- human steerable interactive path 与 fire-and-forget workflow 分离。

### Stage 6：Browser / Computer / Artifact

逐步让小鱼进入真实办公/设计/创作工作：

- Browser automation；
- Computer control；
- DOCX / PPTX / XLSX / PDF；
- Web/App artifact；
- preview / selected-region edit / version rollback。

这些都作为 Capability + Plugin，不把逻辑写进 Agent Loop。

---

## 11. 开发准入：Upstream-first Development Rule

任何下列基础能力开工前：

```text
Agent Loop
Provider
Streaming
Tool Calling
Session
Context
Memory
Subagent
Workflow
Approval
Sandbox
Plugin
Browser
Computer
Artifact
```

任务记录必须回答：

1. 哪些成熟上游已经实现？
2. 对应源码目录、测试、协议文件是什么？
3. 实际读过哪些关键实现？
4. 上游解决了哪些 edge case / failure mode？
5. XMA 为什么采用 / 修改 / 拒绝？
6. XMA 的 Rust Kernel、Workspace、Manager 是否造成必要差异？
7. 有什么真实 E2E 验收？

### No Blind Reinvention Rule

> “我们自己也能写”不构成重新实现的理由。

如果成熟项目已经有经过真实用户验证的实现，XMA 必须先研究它。只有明确发现不符合 XMA Contract / Security / Language Ownership 时，才设计不同方案，并记录原因。

---

## 12. 测试策略也要升级

不能再只满足“单元测试绿”。Agent 平台至少分四层验收：

### Contract Tests

验证 package API、event、tool schema、plugin lifecycle。

### Conformance Tests

验证与选定上游语义是否一致，例如：

- Pi-style streaming/tool lifecycle；
- DSH plugin lifecycle；
- Provider protocol；
- approval/cancellation semantics。

### Integration Tests

真实 Agent Loop：

```text
model → tool call → tool result → same model → final
```

并覆盖失败恢复、parallel tool、cancel、resume。

### Real E2E

Windows 实机 + 真实 Provider + 真实文件/命令：

```text
“检查当前项目为什么测试失败，修复后重新运行测试并告诉我证据。”
```

只有这个真正完成，才能说 Xiaoyu Code “能工作”。

---

## 13. 与当前文档的冲突点

当前 0.1.0 文档中有几条已经与新方向冲突，用户确认本评审稿后应正式修改。

### `AGENTS.md`

需要修改：

- §6 “不要过度拆包” → 改成“稳定 Agent Platform 能力使用 `xma-*` package；普通 helper 不碎拆”；
- §13 “只吸收 Contract/经验” → 升级为 Upstream-first implementation study；
- 上游列表加入 Pi、MiMo Code；
- 插件规则升级为 Everything is a Plugin；
- 增加 Model Intelligence Preservation Contract。

### `DIRECTORY-STRUCTURE.md`

当前开头“为什么不拆成几十个 Package”和“Core 统一承载一切”需要重写。

新的长期结构应变成：

```text
apps/
packages/xma-*/
agents/
skills/
plugins/
native/
scripts/
docs/
```

### `PROJECT-ARCHITECTURE.md`

把单一 `TypeScript Core` 物理结构升级成 **XMA TypeScript Platform package family**；逻辑上仍然只有一个 Runtime。

### `AGENT-RUNTIME.md`

加入 Pi Agent Loop 第一参考；正式定义 streaming / tool / follow-up / plugin extension seam。

### `MODEL-PROVIDER.md`

加入 `xma-ai`，明确 Provider Profile 是 XMA 产品层，基础模型 transport / streaming 优先研究 Pi AI 与厂商真实协议。

### `PLUGIN-SYSTEM.md`

从“能力可插件化”升级为 **Everything is a Plugin**，同时保持 Security Kernel 不能绕过。

### `LANGUAGE-OWNERSHIP.md`

语言边界不改变，只把“TypeScript Core 单包”改成“TypeScript `xma-*` Platform packages”。

### `DEVELOPMENT-RULES.md`

新增：

- Upstream-first Development Rule；
- No Blind Reinvention Rule；
- upstream study evidence；
- real E2E requirement。

### `UPSTREAM-REFERENCE.md`

这是改动最大的开发文档：

- 上游从 Codex / DSH / MCHA 扩为 **Pi / DSH / Codex / MiMo / MCHA**；
- 每个能力明确 Primary Reference；
- 固定 commit 更新；
- 不再写“DSH package 粒度不得参考”“Core 一直单包”等旧结论。

### `DEVELOPMENT-PLAN.md`

把后续主线改成：

```text
Docs/Gates
→ xma-ai + xma-agent-loop
→ xma-plugin + DSH compatibility
→ xma-tools + Process/Shell
→ session/context/memory
→ task/subagent/workflow
→ browser/computer/artifact
```

### `PROJECT-STATUS.md`

明确记录一次 **Agent Platform Architecture Pivot**，避免以后开发者误以为旧单体 Core 仍然是最终目标。

---

## 14. 不改变的 XMA 核心原则

这次是 Agent Platform 实现策略换轨，不是把整个项目推翻。

以下保持不变：

- 产品名称：**Xiaoyu Management Agent / 小鱼管理智能体 / XMA**；
- TypeScript = Agent/Product 主语言；
- Rust = Native/Security/Performance Kernel；
- Provider / Model Truth Contract；
- 用户选中的真实模型默认就是实际推理模型；
- Workspace ownership / isolation；
- Manager Agent 长期方向；
- Skill ≠ Model ≠ Agent ≠ Plugin ≠ Workspace；
- Native side effect 必须通过 Kernel；
- Windows-first 开发/同步/发布流程；
- Desktop/Web/TUI 共享同一 Agent Runtime；
- 不复制第三方品牌和 UI 资产；
- 不把任何上游项目变成 XMA 的不可替换远程依赖。

---

## 15. 本方案的最终目标

XMA 不应该只是“能接模型 API 的聊天框”。

最终的小鱼应该能够：

```text
理解一个真实目标
→ 检查当前环境
→ 自主规划
→ 调用工具
→ 遇错恢复
→ 必要时搜索/浏览
→ 必要时委派多个子 Agent 并行工作
→ 修改真实文件/项目
→ 运行验证
→ 保持长期任务上下文
→ 产出可预览的文档/网页/应用/设计产物
→ 给出可核验完成证据
```

模型越强，XMA 应该越能发挥它，而不是通过狭窄 Skill、缩水 ToolPlan、固定流程把模型能力压低。

> **小鱼的价值不是替模型思考，而是给模型一个可靠、可扩展、有记忆、有工具、有协作者、有安全边界的工作系统。**

---

## 16. 正式执行动作

本方案批准后，先完成一次**文档原子更新**，再进入 Runtime 代码迁移：

1. 新增正式架构文档：`docs/architecture/AGENT-ENGINE-STRATEGY.md`；
2. 更新 `AGENTS.md`；
3. 更新 `DIRECTORY-STRUCTURE.md`、`PROJECT-ARCHITECTURE.md`、`AGENT-RUNTIME.md`、`MODEL-PROVIDER.md`、`PLUGIN-SYSTEM.md`、`LANGUAGE-OWNERSHIP.md`；
4. 更新 `DEVELOPMENT-RULES.md`、`DEVELOPMENT-PLAN.md`、`PROJECT-STATUS.md`、`UPSTREAM-REFERENCE.md`；
5. 更新 Architecture / Documentation / Naming Gates，防止旧规则与新 package family 冲突；
6. **只更新文档/Gate，不在同一批偷偷开始 Runtime 大重构**；
7. 文档和 Gate 全部一致后，再开始 `xma-ai + xma-agent-loop` 第一批代码迁移。

这样可以保证后面的所有开发者和 AI 都在同一张地图上工作。

## 17. Minecraft 专业 Agent：MCHA 作为领域实现第一参考

Minecraft 专业 Agent 后续不从“写几个 MC Prompt”开始，而是基于通用 XMA Agent Engine 叠加领域能力。第一参考实现固定为 `AndrewNog0724/minecraft-host-agent` 的公开源码与配套设计文档。

重点吸收：

- Agent-First：模型自主决定下一步，工具执行，结果回到同一模型；
- `server-setup` Skill：只提供决策清单、红线、验收标准，不替模型硬编码完整流程；
- 版本/Java/服务端/mod 等易变事实必须经 Knowledge/API Tool 查询，不写死进 Prompt；
- Minecraft 领域 Tool：兼容性、Java、server jar、配置生成、进程生命周期、SLP ping、Profile、mod 双源安装；
- 内网穿透七件套：账号检查、frpc 安装、节点选择、隧道创建、启动、状态、删除；
- “探测 / 执行分离 + 确认门只落真实副作用”；
- 真实演示轨迹、Session/Usage/Profile 和失败恢复作为 E2E 验收基线。

XMA 实现仍服从自己的边界：MC 决策/Skill/Tool orchestration 位于 TypeScript `xma-*` 平台和专业 Agent；进程、文件、网络、Hash/Archive 等真实副作用由 Rust Kernel enforce。MCHA 的 Rust 单体结构不直接搬入 `native/`。

未来建议的产品边界是“Minecraft 专业 Agent + Minecraft Skill/Knowledge/Tool 插件”，而不是第二套 Agent Loop。支持范围内的标准开服路径应以“自然语言任务 → 自动查证 → 部署 → 验证 → 必要时穿透 → 交付证据”为闭环目标；但外部网络、第三方 API、账号实名、平台配额等不可控条件意味着产品不得承诺数学意义上的 100% 成功率。
