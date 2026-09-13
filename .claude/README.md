# XMA Claude Code Context

Claude Code 进入仓库后先读根 `CLAUDE.md`，再按它的要求阅读根 `AGENTS.md` 与项目文档。

- 最高规则：`AGENTS.md`；
- 公共 Skills 权威源：`.agents/skills/`；
- `.claude/skills/` 是 Windows 兼容镜像，由 `gate:ai-context` 校验；
- 不在 `.claude/` 维护第二套架构规则。

禁止在本目录放 Secret、个人机器路径、用户 Workspace、Session 或私有 Prompt。
