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
