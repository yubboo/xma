# XMA 项目架构

## 1. 目的

本文定义 Xiaoyu Management Agent（XMA）的长期产品架构边界。它回答“谁负责推理、状态放在哪里、工具如何执行、插件如何扩展、桌面/CLI 如何复用同一 Runtime”。具体 Agent Loop、Provider 和 Desktop 细节分别见：

- `docs/architecture/AGENT-RUNTIME.md`；
- `docs/architecture/WORKSPACE.md`；
- `docs/architecture/AGENT-PLATFORM.md`；
- `docs/architecture/MODEL-PROVIDER.md`；
- `docs/architecture/PLUGIN-SYSTEM.md`；
- `docs/architecture/DESKTOP-WORKBENCH.md`。

上游参考和吸收规则见 `docs/development/UPSTREAM-REFERENCE.md`。

## 2. 产品原则

### Model is replaceable. Agent is ours.

用户配置的真实 Provider Model 是每个 Run/Turn 的推理核心。XMA 不训练或隐藏一个“小鱼小模型”去替代它，也不在 Framework 中加入关键词路由、固定业务决策树或隐藏 Planner 抢走正常推理权。

### Agent-First

XMA 的业务主链是：

```text
用户目标
  ↓
Agent + Workspace + Session
  ↓
Context / Skill / Knowledge
  ↓
真实 Provider Model
  ↓
Tool Call
  ↓
Policy / Approval / Capability
  ↓
Tool Runtime / Rust Native Kernel
  ↓
Observation
  ↓
同一个真实 Provider Model 继续推理
```

Framework 可以限制权限、Schema、生命周期、预算和副作用，但不能替模型做本应由模型完成的专业判断。

### 一个 Runtime，多种 Shell

CLI、Desktop、Web、Server 只是同一个 XMA Runtime 的不同入口。任何 Shell 都不能复制 Agent Loop、Session Store 或 Tool execution 逻辑。

## 3. 顶层目录

XMA 产品代码长期只保留以下核心区域：

```text
apps/       CLI / Desktop / Web / Server Shell
core/       TypeScript Agent 平台核心
agents/     Xiaoyu Manager / Code 等已实现专业 Agent
skills/     XMA 产品级专业 Skill（SKILL.md + skill.json）
plugins/    Provider、Tool、Integration、兼容层
native/     Rust Native / Security / Performance Kernel
scripts/    开发、同步、构建、发布、Gate
docs/       架构、规则、计划、安全文档
```

仓库根还允许 `.agents/`、`.codex/`、`.claude/` 和 `CLAUDE.md` 这类**开发者 AI 上下文**。它们不是产品 Runtime 目录，不保存用户会话、Workspace 或 Secret。

## 4. TypeScript 与 Rust 的语言所有权

### TypeScript：产品 / Agent / 业务主语言

TypeScript 负责：

- Agent Registry / Agent Loop / RunManager；
- Session / Turn / Step；
- Model Provider Registry / Model Catalog / Provider adapters；
- Context Assembly / Memory / Compaction；
- Tool Definition / ToolPlan / ToolRouter / Policy / Approval；
- Workspace；
- Plugin Host / Cordis compatibility；
- Skills / Knowledge / MCP / Integrations；
- Minecraft / Code / Writer 专业业务；
- CLI/TUI / Desktop/Web App Protocol / Server API。

### Rust：Native / Security / Performance Kernel

Rust 负责：

- PTY / ConPTY；
- Process tree / lifecycle / Job Object；
- filesystem confinement / canonical-path enforcement；
- sandbox / OS capability enforcement；
- native networking；
- hash / archive；
- OS integration；
- 经基准证明需要的高性能本地能力。

> **TypeScript decides WHAT to do. Rust guarantees HOW native side effects are executed safely.**

Rust 不认识 Minecraft Agent、Writer Agent、Claude 或 GPT，也不决定应该调用哪个模型/工具。

## 5. Core Runtime 分层与模块粒度

0.1.x 不急于拆成几十个 npm package。源码先按领域聚合，但**物理目录只在领域真正长大时创建**：

```text
core/src/
  agent.ts                          legacy runAgent 迁移兼容入口
  agent/                            Agent identity / registry / delegation
    contract.ts
    registry.ts
    delegation.ts
  skill/                            Skill metadata / registry / loader
    contract.ts
    registry.ts
    loader.ts
  runtime.ts                        Turn/Step driver
  session/                          durable contract / store / export
    contract.ts
    store.ts
    export.ts
  model.ts / provider.ts            标准 Model Contract / Provider Platform
  context.ts                        Context Assembly
  tool/                             Tool Router / Policy / Schema
    router.ts
    policy.ts
    schema.ts
  workspace.ts                      Workspace identity / ownership / access
  plugin.ts                         services/events/effects/lifecycle
  app-protocol.ts                   Shell ↔ Runtime command/event types
```

命名和拆分遵循三个原则：**短、可辨识、不重复路径**。目录与 TypeScript 使用小写 kebab-case，Rust 使用 snake_case；普通文件/目录优先 1～3 个核心词，父目录已经表达领域时文件名去掉领域前缀。只有职责、生命周期或安全边界确实不同才拆文件；同一逻辑的类型/helper/constants 默认留在一起。

`session/`、`tool/`、`agent/`、`skill/` 都已经形成至少三个稳定且职责不同的模块，因此使用领域子目录；legacy `agent.ts` 只保留迁移兼容。未来仍按同一标准演进，而不是参考上游目录数量机械拆包。

## 6. Session 是事实源

XMA 必须把“模型看到了什么”和“用户界面显示了什么”建立在可重建的 Session facts 上。

关键规则：

- 用户输入、最终 assistant message、tool call/result、Provider route、usage、approval 等需要恢复/审计的事实进入 durable Session；
- stream chunk、spinner、progress 等只作为 live event；
- **Model-visible ⇔ reconstructable**：进入模型请求的动态事实必须能从 Session / Context source 重建；
- UI 只是 durable/live events 的投影，不维护另一套秘密对话历史。

这条原则参考成熟 Harness 的经验，但在 XMA 中由 TypeScript Session Core 实现。

## 7. Provider 与 Model

Provider 是可替换能力，不是一个裸 HTTP 函数。完整 Provider 需要：

- auth；
- capabilities；
- model catalog；
- request preparation；
- streaming/tool-call normalization；
- usage/error/retry normalization；
- Brain Ready Probe。

Agent Loop 只消费 XMA 标准 ModelRequest/ModelEvent，不理解各厂商原始 JSON。详见 `MODEL-PROVIDER.md`。

## 8. Tool 与副作用

模型不能直接碰 OS。所有副作用必须经过：

```text
Tool Call
  → schema validation
  → Plugin/Policy interception
  → security guard
  → user approval（需要时）
  → Tool Runtime
  → Native Capability Bridge（需要 Native 时）
  → Rust Kernel enforce
  → structured result
  → durable Session result
```

模型决定是否请求；安全层决定是否允许；Rust 只执行最小授权副作用。

## 9. Workspace

Workspace 是 Agent 的工作领地和安全边界，不只是 cwd。Stage D 第一批已经落地稳定 `WorkspaceDescriptor / WorkspaceBinding`、Owner-only Session 绑定、resume descriptor-digest 漂移检测、Session durable grant/revoke/use、Tool Workspace Security Guard 与 Context Source read scope。详细 Contract 见 `docs/architecture/WORKSPACE.md`。

Workspace 长期包含：

- stable id；
- root / allowed roots；
- repo/project metadata；
- Agent ownership；
- instructions sources；
- persistent state；
- Native filesystem scope。

默认新 Session 只能绑定 Owner Agent 自己的 Workspace。跨 Agent Workspace 访问需要用户显式 durable grant；Tool/Context 在使用前必须经过 Workspace Policy，真实 filesystem/process 副作用仍由 Rust Native Kernel 二次 enforcement。

## 10. Plugin / Capability

XMA Native Plugin 与 DeepSeek Harness/Cordis Compatibility 并存。

Core 提供稳定 Service/extension points；新能力优先注册 Provider、Tool、Context contributor、Session projection、Policy 等，而不是修改 Agent Loop。注册必须可逆，mount/unmount/reload 不留幽灵副作用。

Capability 设计至少回答：

- Definition：消费者看到什么 Contract？
- Provider：谁实现？
- Consumer：谁使用？
- Permission：需要什么权限？
- Lifecycle：如何 mount/dispose？
- Evidence：什么 Conformance/E2E 证明它真的工作？

## 11. Xiaoyu Manager / 专业 Agent / Skill

XMA 的用户入口首先是主管理智能体 `xiaoyu`。主 Xiaoyu 负责理解、规划、委派、跟踪和验收；Code、Writer、Minecraft、GameDev、Art 等是复用同一 Runtime 的专业 Agent，而不是平行内核。

当前 0.1.x 已正式落地 `core/src/agent/` 与 `core/src/skill/` Foundation：AgentDefinition 包含 Brain/Skill/Tool/Workspace/Memory/Delivery/Delegation Policy；Skill 使用 `SKILL.md + skill.json`，并可通过标准 Context Source 进入模型且形成 durable Context Snapshot。详细 Contract 见 `AGENT-PLATFORM.md`。

### 当前真实内置 Agent

- `Xiaoyu`：Manager Agent Foundation；
- `Xiaoyu Code`：第一条 Specialist Foundation。

Writer/Minecraft/GameDev/Art 等仍是产品方向，但在拥有真实 Skill/Tool/验收链之前不提前创建空骨架。

### Skill / Plugin / Knowledge

- Skill = 给模型的专业工作方法、约束、流程和交付标准；
- Plugin/Tool = 程序能力；
- Knowledge = 相对稳定的事实资料；
- 实时事实 = Tool/API。

Skill canonical source 位于根 `skills/`，与用于开发 XMA 的 `.agents/skills/` 完全不同。

### 外部 Host

长期 XMA Agent/Skill 可以通过 Host Adapter 安装到 Codex、Claude Code、DeepSeek Harness、Zcode 等宿主，但 Host 只是 Integration 层：Provider 提供 Brain，Host 承载 Agent，两者不能混淆。Core 不能出现 `codex-agent.ts`、`claude-agent.ts` 等厂商平行 Agent。

## 12. App Protocol 与 Shell

Core 要提供稳定 App Protocol / Event Stream：

```text
CLI ─────┐
Desktop ─┼─ Commands / Events / Queries ─→ XMA Runtime
Web ─────┤
Server ──┘
```

Desktop 后期三栏 Workbench、CLI TUI、Web 管理页都只消费这层。这样 UI 可以大改而不改变 Agent 语义，也可以先完成底层再做复杂 UI。

## 12.5 Distribution / Launcher

XMA 的产品不是某一个壳，而是同一 Runtime 的多入口发行：`xiaoyu` Terminal、Desktop、Server、Web。正式终端主命令固定为 `xiaoyu`，`xma` 仅兼容旧入口。

普通用户安装与源码开发必须彻底分开：开发者通过 Git + `[1]` 恢复依赖；普通用户只下载预构建 portable runtime。0.1.x 第一批 portable bundle 包含私有 Node Runtime、bundled CLI/Server/Web 与 Rust Native Kernel，因此终端用户不需要安装 Node/pnpm/Rust/MSVC。

安装器必须先验证 Release Manifest / SHA-256，再通过 staging 原子替换。Windows 默认 `%LOCALAPPDATA%\Programs\Xiaoyu` + User PATH；Linux/macOS 默认 `~/.local/share/xiaoyu` + `~/.local/bin`。发行 staging 只能进入 `.cache/release`，正式资产只进入 `dist/release`，二者都不提交 Git。详细合同见 `DISTRIBUTION.md`。

## 13. 参考项目的正确定位

- **OpenAI Codex**：Coding Agent Runtime、Thread/Turn、ToolRouter、Provider/Permission/Sandbox、App Protocol 的重要实现参考；
- **DeepSeek Harness**：TypeScript Plugin Harness、Cordis Service/Event/Effect、Session、Tool Pipeline、Agent Loop extension 的兼容与实现参考；
- **Minecraft Host Agent**：Minecraft 垂直场景、Agent-First、Skill、Knowledge、真实上游工具和验收的实现参考。

三者都是参考，不是 XMA 的父项目。XMA 的产品边界、语言所有权、目录结构和版本规则由自己的 `AGENTS.md` 决定。
