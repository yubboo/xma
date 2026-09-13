# XMA Plugins

`plugins/` 存放具体能力实现。XMA 采用 **一个插件一个自包含目录**，不先按 Provider / Tool / Context / Session 类型把同一个插件拆散。

当前：

- `deepseek/`：DeepSeek 产品品牌、Provider Catalog/preset 与插件装配；共享 OpenAI-compatible Transport 在 `xma-ai`；
- `native-tools/`：把 `xma-native` 的 Rust Capability 暴露为 Agent Tool；
- `dsh-compat/`：DeepSeek Harness / Cordis compatibility seam。

插件内部文件较少时保持扁平；达到真实复杂度后再按 `filesystem/`、`process/`、`mods/`、`tunnel/` 等功能簇分类。禁止制造单文件目录链，也禁止把同一个插件拆到多个顶层目录。

任何真实文件、进程、网络、系统副作用必须继续走：

`Plugin → xma-tools / Capability → Policy / Approval → xma-native → Rust Security Kernel`

禁止为了方便改成 Node `fs` / `child_process` 绕过安全边界。
