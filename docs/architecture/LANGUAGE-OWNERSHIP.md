# TypeScript + Rust 语言职责

## TypeScript 是主语言

XMA 的 Agent Harness 和业务变化速度快，TypeScript 更适合 Provider API、JSON Schema、Tool Calling、MCP、插件、HTTP/SSE/WebSocket、TUI/Desktop/Web 以及 I/O 编排。

因此 XMA 默认所有 Agent/Product 新业务先考虑 TypeScript。长期物理边界是 `packages/xma-*` TypeScript Platform packages，而不是把稳定能力继续永久塞进单一 `core/`。

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

Pi、DeepSeek Harness、OpenAI Codex、MiMo Code 与 Minecraft Host Agent 的语言选择各不相同。XMA 采用 Upstream-first，但上游不能改变自己的语言所有权：

- Pi Agent Core / Pi AI 是 `xma-agent-loop` / `xma-ai` 的第一实现参考，吸收成熟事件、Tool Loop、Provider 抽象，但最终 XMA Platform 仍是 TypeScript；
- Codex 的 Thread/Turn、ToolRouter、Permission/Sandbox 语义主要由 TypeScript 编排，只有真实 OS enforcement 下沉 Rust；
- MiMo 的 Context/Memory/Task/Subagent/Workflow 重点在 TypeScript `xma-*` 包中吸收；
- MCHA 的 Agent-First、Skills、Minecraft tools/knowledge 在 XMA 中 TypeScript 化，不能把其 Rust Agent Loop 搬进 `native/`；
- DSH 的 Service/Event/Effect/Capability seam 直接指导 `xma-plugin`，包粒度按 XMA 稳定能力边界决定，而不是机械复制。

任何“为了对标上游而把 Agent/业务写进 Rust”的改动都属于架构回退。
