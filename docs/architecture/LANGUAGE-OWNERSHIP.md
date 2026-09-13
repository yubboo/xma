# TypeScript + Rust 语言职责

## TypeScript 是主语言

XMA 的 Agent Harness 和业务变化速度快，TypeScript 更适合 Provider API、JSON Schema、Tool Calling、MCP、插件、HTTP/SSE/WebSocket、TUI/Desktop/Web 以及 I/O 编排。

因此 XMA 默认所有新业务先考虑 TypeScript。

## Rust 是 Native/Security Kernel

只有在以下场景优先 Rust：

- PTY / ConPTY；
- Process / Job lifecycle；
- 文件系统真实路径限制；
- Capability / Sandbox；
- Native network probe；
- Hash / Archive；
- OS 原生能力；
- 经基准证明需要的高性能本地能力。

## 禁止的语言漂移

- 不把 Agent Loop 重写进 Rust；
- 不在 Rust 中写 Minecraft/Fabric/Paper 业务决策；
- 不增加 Go Core；
- Python 只能作为未来可选插件运行时，不能成为 XMA Core 的基础依赖。

## 判断口诀

**TypeScript 决定做什么；Rust 保证怎么安全地做。**

## 上游参考不能改变 XMA 的语言所有权

OpenAI Codex 与 Minecraft Host Agent 都有大量 Rust 产品/Agent 逻辑，DeepSeek Harness 则以 TypeScript Plugin Harness 为主。XMA 参考它们时只吸收适合自己的 Contract 和工程经验：

- Codex 的 Thread/Turn、ToolRouter、Permission/Sandbox 语义在 XMA Core 中主要由 TypeScript 编排，只有真实 OS enforcement 下沉 Rust；
- MCHA 的 Agent-First、Skills、Minecraft tools/knowledge 在 XMA 中 TypeScript 化，不能把其 Rust Agent Loop 搬进 `native/`；
- DSH 的 Service/Event/Effect/Agent Loop 思想可以直接指导 TypeScript Core/Plugin Host，但不要求复制其 workspace package 粒度。

任何“为了对标上游而把 Agent/业务写进 Rust”的改动都属于架构回退。
