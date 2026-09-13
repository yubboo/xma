# XMA Agent 平台架构

## 1. 目的

本文定义 Xiaoyu Management Agent（XMA）的 Agent / Skill / Task 长期边界。XMA 不是 Minecraft 专用工具，也不是某一个 Coding Agent 的外壳；它的产品目标是让用户拥有一个与模型厂商解耦的主管理智能体 Xiaoyu，并在同一 Runtime 上组合多个专业 Agent、Skills、Tools、Knowledge、Memory、Workspace 与 Plugins。

核心原则仍然是：

> **Model is replaceable. Agent is ours.**

模型提供推理能力；Agent 身份、专业方法、权限、长期状态和交付标准属于 XMA 与用户。

## 2. Xiaoyu Manager 与专业 Agent

用户首先面对主 Agent：`xiaoyu`。主 Xiaoyu 的长期职责是理解目标、规划、选择专业 Agent、创建子任务、跟踪结果和最终验收，而不是把所有领域知识塞进一份巨大 System Prompt。

```text
User
  ↓
Xiaoyu Manager
  ├─ plan / route / delegate / verify
  ↓
Professional Agents
  ├─ Xiaoyu Code
  ├─ Writer（未来）
  ├─ Minecraft（未来）
  ├─ GameDev（未来）
  ├─ Art / Animation（未来）
  └─ user-installed Agent（未来）
```

0.1.x 当前只创建已经进入真实开发的 `Xiaoyu Manager` 与 `Xiaoyu Code`。Writer/Minecraft/Art 等继续记录为产品方向，但在有真实 Contract/Skill/Tool 实现前不创建空目录和“假完成” Agent。

## 3. AgentDefinition

`packages/xma-agent-loop/src/agent/contract.ts` 是 Agent 身份的单一 Core Contract。AgentDefinition 至少表达：

- stable `id/name/version`；
- `manager | specialist` kind；
- Skills 绑定；
- Tool requirements；
- Brain required/preferred capabilities；
- Workspace policy；
- Memory policy；
- Delivery/verification policy；
- Delegation policy。

AgentDefinition **不保存** Session 瞬时状态，不写 Provider API Key，不绑定 OpenAI/Claude/DeepSeek/MiMo，也不包含第三方 Host 特例。

因此：

```text
Agent ≠ Model
Agent ≠ Prompt
Agent ≠ Workspace
Agent ≠ Plugin
Agent ≠ Skill
Agent ≠ Host
```

Agent 是这些能力在一个专业身份上的组合声明。

## 4. Skill 是一级产品能力

正式产品 Skills 位于根 `skills/`，与 `.agents/skills/` 的“AI 开发者辅助 Skill”完全不同：

- `skills/`：给 **XMA 运行中的专业 Agent/模型**读取的产品能力；
- `.agents/skills/`：给 **开发 XMA 的 AI 编程工具**读取的仓库开发指南。

一个产品 Skill 使用：

```text
skills/<domain>/<skill>/
├─ SKILL.md       给模型看的专业方法/约束/流程/交付标准
└─ skill.json     机器可读 ID/version/能力要求
```

Skill 的职责是告诉模型“怎样专业地完成这一类工作”，而不是实现程序副作用。真正读取文件、运行程序、访问 Browser/API 的能力必须来自 Tool/Plugin，并继续经过 Policy/Approval/Native enforcement。

0.1.x 第一批 canonical Skills：

```text
common/task-planning
common/verification
code/bug-fixing
code/testing
```

## 5. Agent ↔ Skill 绑定

`SkillRegistry.resolveForAgent()` 按 AgentDefinition 声明顺序解析 Skills，并 fail loud 校验：

- Skill 是否已注册；
- Agent 是否声明 Skill 需要的 Tool；
- Agent 是否声明 Skill 需要的 Brain capability。

`createAgentSkillContextSource()` 把 Agent identity、Delivery Policy 和绑定 Skill 文本通过标准 `ContextRegistry` 注入模型。

因此 Skill 不通过 UI 临时 state 偷偷进入模型；Runtime 会继续把最终 model-visible Context 写成 durable `context/snapshot`，满足：

> **Model-visible ⇔ reconstructable**

## 6. Task / Delegation

Multi-Agent 不能靠几个 Agent 随意互发字符串。`packages/xma-agent-loop/src/agent/delegation.ts` 定义第一版 `AgentTask`：

- requester（user / agent）；
- assigned Agent；
- objective；
- Workspace ID；
- structured inputs；
- status；
- parent task identity。

当前 `AgentDelegationService` 只做创建 Task 前的 Registry/Delegation Policy 校验，不执行子 Agent，也不假装已有完整 Multi-Agent Scheduler。

后续 Xiaoyu Manager 阶段再增加 durable Task Store、Task events、结果/证据、重试/取消和验收。

## 7. Provider 与 Agent 解耦

Agent 只声明需要的 Brain 能力，例如：

```text
text
native tool calling
reasoning
vision
long context
```

Provider Platform 再决定哪些具体模型满足要求。未来完全允许：

```text
Xiaoyu Manager → Provider A
Xiaoyu Code    → Provider B
Writer         → Provider C
Cheap Worker   → Local vLLM
```

也允许所有 Agent 复用同一个旗舰模型。专业差异主要来自 Agent identity + Skills + Tools + Context + Knowledge + Memory，而不是强迫每个专家绑定不同模型。

## 8. Plugin、Skill、Knowledge 必须分开

- **Skill**：专业工作方法与交付规则；
- **Plugin/Tool**：程序能力；
- **Knowledge**：相对稳定的事实资料；
- **Tool/API**：快速变化或必须实时读取的外部事实。

例如“如何诊断 Minecraft 崩溃”可以是 Skill；真实 RCON/API 是 Plugin/Tool；某项目服务器说明是 Knowledge；最新 Mod 版本应通过 Tool/API 查询。

## 9. Host 是外部宿主，不是 Provider

长期 XMA 还会允许同一个 Agent/Skill 安装到 Codex、Claude Code、DeepSeek Harness、Zcode 等外部 Agent Host。

```text
XMA Agent / Skill
      ↓
Host Contract / Adapter
      ├─ Codex
      ├─ Claude Code
      ├─ DeepSeek Harness
      └─ Zcode
```

这里必须区分：

- Provider = 给 XMA 提供模型推理能力；
- Host = 承载 XMA Agent/Skill 的第三方运行环境。

Host compatibility 只能放 Integration/Adapter 层，不能在 `core/` 写 `codex-agent.ts`、`claude-agent.ts` 等平行实现。Agent/Skill canonical definition 永远只有一份。

0.1.x 当前只锁定这个边界，**尚未创建 Host Adapter 空目录或宣称兼容完成**。

## 10. 当前物理结构

本阶段真实创建的产品结构只有：

```text
core/src/
├─ agent/
│  ├─ contract.ts
│  ├─ registry.ts
│  └─ delegation.ts
└─ skill/
   ├─ contract.ts
   ├─ registry.ts
   └─ loader.ts

agents/
├─ xiaoyu/
│  └─ agent.ts
└─ code/
   └─ agent.ts

skills/
├─ common/
│  ├─ task-planning/
│  └─ verification/
└─ code/
   ├─ bug-fixing/
   └─ testing/
```

不提前创建 Writer/Minecraft/GameDev/Art 等空目录。真正有独立实现时再按同一 Contract 增加。

## 11. 下一阶段

Agent/Skill Foundation 完成后，开发优先级是：

1. OS Credentials + Provider 产品化；
2. Process executable registry / absolute allowlist / Approval；
3. Workspace persistence + repo/project/instructions discovery；
4. Xiaoyu Manager durable Task/Delegation；
5. Xiaoyu Code 真实 `读 → 改 → 测试 → 观察 → 再修 → Diff/证据` 闭环；
6. 再复制专业 Agent 模式；
7. 最后深化 Host compatibility、Marketplace/Cloud 与完整 UI。

任何阶段都不得为了展示“很多功能”提前制造空 Agent、空 Skill 或无 Conformance 证据的兼容声明。
