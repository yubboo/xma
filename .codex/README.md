# XMA Codex Context

这是 XMA 给 Codex/Coding Agent 的仓库级入口。

- 最高规则：根 `AGENTS.md`；
- 公共 Skills 权威源：`.agents/skills/`；
- `.codex/skills/` 是 Windows 兼容镜像，由 `gate:ai-context` 检查内容一致；
- `.codex/environments/environment.toml` 只定义开发动作，不自动安装依赖；首次准备仍走 XMA 固定 Windows 工作流或项目明确的准备命令。

禁止在本目录放 API Key、个人机器路径、Session 或 Workspace 内容。
