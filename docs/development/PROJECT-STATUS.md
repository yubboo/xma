# XMA 0.1.0 项目状态

## 已实现的骨架证据

- XMA Core 最小 Agent Loop；
- Model Provider Contract；
- Tool Registry；
- Workspace Registry；
- Plugin Host；
- `ctx.<service>` Service Proxy；
- `inject + apply(ctx)` DeepSeek Harness/Cordis 基础适配；
- effect/disposer；
- emit/parallel/serial/bail/waterfall 基础事件语义；
- Rust stdio JSON-RPC Runtime 骨架；
- Minecraft / Code / Writer Agent 身份骨架；
- CLI / Web / Desktop / Server Shell；
- Windows 环境/同步/GitHub/构建脚本；
- 中文注释与架构文档 Gates。

## 尚未完成，禁止过度宣称

- 真实 OpenAI/Claude/Gemini/DeepSeek/MiMo Provider；
- Provider Brain Ready Probe；
- 完整 Session/Memory/Context；
- Rust Workspace Sandbox/Capability/PTY/Process；
- DeepSeek Harness 所有 Service 的 package-level 完整兼容；
- Minecraft 真实开服闭环；
- Xiaoyu Code 产品闭环；
- Writer Agent 产品闭环；
- Desktop 安装包跨平台实装验证。

0.1.0 的定位是**可测试的平台骨架**，不是可对外宣称全部能力完成的正式产品版。

## Desktop Runtime

- 主：Electron 41.2.0（精确锁定，运行/构建时惰性下载 Runtime）；
- 副：Tauri 2（系统 WebView2，作为备用桌面运行时）；
- 两者共享 apps/web 与 core，不复制 Agent Runtime。
