# XMA Upstream Study Skill

## 作用

在实现 XMA 重要子系统前，按能力系统研究 Pi、DeepSeek Harness、Codex、MiMo Code、Minecraft Host Agent 的对应实现，避免“只看 README 就照着写”或无方向盲写。

## 固定入口

先读 `docs/development/UPSTREAM-REFERENCE.md`，使用文档中固定的 commit 和许可证信息。未经显式任务，不自动把参考基线追到最新 commit。

## 研究步骤

1. 根据任务按能力矩阵定位一个或多个主要上游的对应目录；不要求每个任务机械阅读五个项目。
2. 审阅该目录在固定 commit 下的全部相关源码、README、协议、测试和直接架构说明。
3. 记录：上游 Contract、生命周期、状态模型、错误/取消、测试方式。
4. 对每个设计写“吸收 / 修改后吸收 / 拒绝”结论。
5. 重新套 XMA 边界：TypeScript Agent/business，Rust Native/Security；Workspace/Permission/Plugin/Session 规则优先。
6. 先吸收成熟 Contract / 数据流 / invariant；需要选择性移植或改编实质代码时进入许可证/NOTICE/版权审查。核心运行不得依赖上游远程仓库或远程包永远存在。
7. 更新 XMA 架构/计划/Gate，让研究成果成为长期规则，而不是留在聊天里。

## 五个主要上游的职责

- Pi：Agent Loop、streaming、tool execution、steering/follow-up、multi-provider AI 第一参考。
- DeepSeek Harness：Everything is a Plugin、Cordis Service/Event/Effect、Session/Tool/Agent capability seam、Subagent/Workflow。
- Codex：Approval、Sandbox、Process/Tool execution、Thread/Turn/Session、multi-agent、App Protocol。
- MiMo Code：Context compaction/reconstruction、Memory、Checkpoint、Task Tree、Subagent、Workflow、Skill discovery、长期任务成本。
- Minecraft Host Agent：Minecraft Agent-First、server-setup Skill、领域 Tools/Knowledge、真实上游 API、mod、服务器生命周期、樱花frp 穿透与场景 E2E。

## 禁止

- 不把 Codex 或 MCHA 的 Rust Agent 业务架构搬进 XMA Rust Kernel。
- 不机械复制 DSH/Codex 的 package/crate 数量；XMA 只按批准的稳定 `xma-*` capability seam 建包。
- 不声称“参考了全部文件”却只看搜索片段；应以子系统全文件审阅记录为准。
- 不把上游品牌、UI 资产、文案当成 XMA 产品资产。
