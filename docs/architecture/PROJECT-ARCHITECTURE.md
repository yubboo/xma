# XMA 项目架构

## 1. 目的

本文定义 XMA 的长期架构边界。它回答“哪些代码应该放在哪里、为什么这样放、未来如何扩展”。

## 2. 总体结构

XMA 只保留五个长期核心区域：

```text
apps/     → 用户如何使用 XMA
core/     → XMA 如何编排 Agent
agents/   → Xiaoyu 有哪些专业身份
plugins/  → 有哪些可复用能力与外部兼容层
native/   → Rust 如何安全执行机器副作用
```

这样做是为了避免一开始把每个概念拆成单独 npm 包，降低构建、依赖和理解成本。等某个模块真正成长到需要独立发布时再拆。

## 3. TypeScript 与 Rust 的职责

### TypeScript

TypeScript 是默认开发语言，负责：

- Agent Loop / RunManager；
- 模型 Provider；
- Plugin Host；
- Workspace、Memory、Session、Context；
- Tool Registry、Skills、Knowledge；
- Minecraft / Code / Writer 业务；
- CLI/TUI、Desktop/Web、HTTP/SSE/WebSocket。

### Rust

Rust 只负责 Native/Security/Performance Kernel：

- PTY / ConPTY；
- Process lifecycle；
- Workspace-confined filesystem；
- Sandbox / Capability；
- Native network；
- Hash / Archive；
- 必要的高性能本地搜索和 OS 集成。

Rust 不知道 Minecraft、Writer、Claude 或 GPT。

## 4. Agent 运行关系

```text
用户目标
  ↓
当前 Agent + Workspace
  ↓
Context / Skill / Knowledge
  ↓
用户配置的真实大模型
  ↓
Tool Call
  ↓
XMA Tool / Permission / Native
  ↓
Observation
  ↓
同一个真实大模型继续推理
```

禁止在中间插入隐藏的“Xiaoyu 小模型”或固定流程 Planner。

## 5. Agent 与 Workspace

Agent 是专业身份，Workspace 是它的领地。

例如 Minecraft Agent 默认只操作当前 Minecraft Workspace。Writer Agent 不应读取或修改 Minecraft Workspace，除非用户显式授权跨工作区操作。

这种隔离既防止文件污染，也防止 Memory、Knowledge 和业务上下文互相污染。
