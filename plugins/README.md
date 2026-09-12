# XMA Plugins

`plugins/` 放跨多个 Agent 可复用的能力。

当前结构：

- `providers/`：真实大模型 Provider 注册与适配；
- `compat/deepseek-harness/`：DeepSeek Harness / Cordis 兼容层；
- `tools/`：未来 Git、SSH、Browser、Docker 等通用 Tool；
- `integrations/`：未来 MCP、GitHub 等外部 Integration；
- `examples/`：插件写法示例。

Minecraft 专用 Tool 不必强行放在这里，可以留在 `agents/minecraft/`，避免为了“一切皆插件”牺牲项目可读性。
