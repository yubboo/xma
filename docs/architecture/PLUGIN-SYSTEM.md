# XMA 插件系统与 DeepSeek Harness 兼容层

## 1. 目标

XMA 坚持“一切能力可插件化”，但不要求所有源码都被拆成独立 npm 包。插件化强调的是生命周期、依赖、注册和卸载能力，而不是目录数量。

## 2. 两种插件入口

### XMA Native Plugin

XMA 原生插件通过统一 Contract 注册 Provider、Tool、Integration、事件或服务。

### DeepSeek Harness / Cordis Compatible Plugin

XMA 将 DeepSeek Harness 当前 Cordis 插件模型作为重要兼容目标。官方文档的核心约定包括：

- 插件以函数或对象形式提供 `apply(ctx)`；
- `inject` 声明依赖的服务；
- Context 是稳定 Service 容器，例如 `ctx.tools`；
- 服务之间通过 key 协作，不直接绑定具体实现；
- 类型化事件用于通信；
- `effect()` / disposer 让注册行为可以在 unload/reload 时撤销。

XMA 在 `plugins/compat/deepseek-harness/` 中实现适配，不把 Cordis 直接变成 XMA Kernel 依赖。

## 3. 为什么采用兼容层，而不是直接复制 Harness

这样可以同时获得：

- 尽可能复用 DeepSeek Harness 插件生态；
- XMA 仍然拥有自己的 Kernel、Workspace 和权限模型；
- 外部 Harness API 变化时只修改 Adapter；
- XMA 原生插件可以增加 Workspace Scope、Capability、审计等自己的约束。

## 4. 兼容性等级

文档必须区分：

- **Contract Compatible**：`inject / apply(ctx) / service / event / effect` 基础 Contract 已验证；
- **Service Compatible**：某一个 DSH Service（如 tools/llm/sessions）有适配与测试；
- **Package Compatible**：真实第三方插件包不修改源码即可在 XMA 加载，并通过 conformance test。

只有第三层通过测试后，才能对对应插件声明“直接兼容”。

## 5. 第一阶段适配表

0.1.x 优先实现：

- Context Service lookup/provide；
- `inject` 依赖等待；
- `apply(ctx)` mount；
- disposer / effect；
- 基础事件 on/emit；
- Tool Service Bridge；
- Provider/LLM Bridge；
- Session Bridge。

后续再增加 DSH 特定 slot、UI、动态 Cordis 等高级服务。
