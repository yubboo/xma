# XMA 目录结构说明

## 为什么不拆成几十个 Package

XMA 0.1.x 处于平台出生期。当前优先级是让 Agent Runtime、Plugin Host、Workspace、Native Kernel 真正跑通，而不是制造大量 npm workspace 边界。

因此核心目录保持精简：

```text
xma/
├─ apps/       # CLI / Desktop / Web / Server 四种产品入口
├─ core/       # TypeScript Agent 平台核心，先保持一个核心包
├─ agents/     # Minecraft / Code / Writer 等专业 Agent
├─ plugins/    # 跨 Agent 可复用插件、Provider、Integration、兼容层
├─ native/     # Rust Native / Security Kernel
├─ scripts/    # 开发、构建、同步、GitHub、Gates
└─ docs/       # 给开发者和 AI 阅读的长期文档
```

## apps/

只负责“用户从哪里使用 XMA”。CLI、Desktop、Web、Server 必须复用 Core，不能各自复制一套 Agent Loop。

## core/

当前统一承载 Agent、Model、Plugin、Tool、Workspace 等 TypeScript 核心 Contract。等某个模块达到需要独立发布、独立版本或独立团队维护的规模后再拆包。

## agents/

一个 Agent 表示一个专业身份。Minecraft 业务必须留在 `agents/minecraft/` 或相关插件中，不能写进 Core。

## plugins/

只放跨 Agent 共用能力和外部生态兼容：Provider、Git/SSH/Browser 等 Tool、MCP/GitHub Integration、DeepSeek Harness Compatibility。

“一切皆插件”指能力可以注册、卸载、替换，不等于把每个文件都做成一个 npm package。

## native/

Rust 的边界非常明确：只保证 Native 副作用安全可靠。第一阶段只保留 `protocol` 与 `runtime` 两个 crate，避免过早拆成十几个 crate。
