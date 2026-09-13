# XMA AI 开发上下文

`.agents/` 是 XMA 仓库级 AI 开发辅助内容的**公共事实源**。它服务于 Codex、Claude Code 和未来其他 Coding Agent，但不能覆盖根 `AGENTS.md`。

使用顺序：

1. 先读根 `AGENTS.md`；
2. 再读其中要求的架构/开发文档；
3. 根据任务加载 `.agents/skills/` 对应 Skill；
4. 工具专属入口（`.codex/` / `.claude/`）只做兼容映射。

本目录允许提交 Skill、维护说明和未来 Agent Notes；禁止存 Secret、个人机器路径、用户 Workspace、Session、私有 Prompt 或运行数据。
