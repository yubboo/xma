# XMA Upstream Study Skill

## 作用

在实现 XMA 重要子系统前，系统研究 Codex、DeepSeek Harness、Minecraft Host Agent 的对应实现，避免“只看 README 就照着写”。

## 固定入口

先读 `docs/development/UPSTREAM-REFERENCE.md`，使用文档中固定的 commit 和许可证信息。未经显式任务，不自动把参考基线追到最新 commit。

## 研究步骤

1. 根据任务定位三个上游的对应目录。
2. 审阅该目录在固定 commit 下的全部相关源码、README、协议、测试和直接架构说明。
3. 记录：上游 Contract、生命周期、状态模型、错误/取消、测试方式。
4. 对每个设计写“吸收 / 修改后吸收 / 拒绝”结论。
5. 重新套 XMA 边界：TypeScript Agent/business，Rust Native/Security；Workspace/Permission/Plugin/Session 规则优先。
6. 只在确实需要复制实质代码时进入许可证/NOTICE/版权标注审查；默认独立实现行为 Contract。
7. 更新 XMA 架构/计划/Gate，让研究成果成为长期规则，而不是留在聊天里。

## 三个上游的主要职责

- Codex：Coding Runtime、Thread/Turn、ToolRouter、Provider、Permission/Sandbox、App Protocol、AGENTS/.codex。
- DeepSeek Harness：Cordis Service/Event/Effect、Session、Agent Loop、Tool Pipeline、Skills、AI Agent workflows。
- Minecraft Host Agent：Minecraft Agent-First、Skills/Knowledge、工具权限、真实上游 API 与场景 E2E。

## 禁止

- 不把 Codex 或 MCHA 的 Rust Agent 业务架构搬进 XMA Rust Kernel。
- 不因为 DSH workspace 数量多就过度拆 XMA package。
- 不声称“参考了全部文件”却只看搜索片段；应以子系统全文件审阅记录为准。
- 不把上游品牌、UI 资产、文案当成 XMA 产品资产。
