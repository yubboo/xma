# XMA 插件系统与 DeepSeek Harness 兼容层

## 1. 目标

XMA 坚持“能力可注册、卸载、替换”，但不要求所有源码都拆成 npm package。插件化强调 Service、生命周期、依赖、作用域和可逆副作用。

XMA Plugin Host 支持两条路径：

1. **XMA Native Plugin**：XMA 自己的稳定 Contract；
2. **DeepSeek Harness / Cordis Compatibility**：在兼容层中适配 DSH 当前公开约定。

兼容层不得让 XMA Core/Kernel 依赖 DeepSeek Harness 内部源码。

## 2. Context / Service

Context 是稳定 Service 容器。插件通过稳定 key 协作，例如未来：

```text
ctx.sessions
ctx.agents
ctx.models
ctx.tools
ctx.workspaces
ctx.skills
ctx.permissions
ctx.native
```

插件应依赖 Service Contract，不直接 import 某个具体 Provider 实现。这样替换 Local/Remote/Sandbox provider 时，消费者无需改业务代码。

## 3. XMA Plugin Contract

第一阶段 XMA Contract 至少支持：

- `inject`：声明 required service；
- `apply(ctx, config)`：mount；
- `ctx.<service>` / `ctx.get()` / `ctx.require()`；
- `ctx.provide()`；
- `ctx.effect()`；
- `ctx.on()` / typed event facade；
- disposer；
- scoped context；
- mount / unmount / reload。

Plugin mount 必须是一个可以失败并回滚的生命周期事务。不能“注册三个东西，第四步失败，然后前三个永远留在进程里”。

## 4. Registrations are effects

所有长期注册都必须拥有 disposer：

- Tool registration；
- Provider registration；
- Service registration；
- Event listener；
- Context contributor；
- Session projection；
- timer/watcher；
- MCP/Integration connection。

Plugin unload 时以明确顺序释放。旧 disposer 不能误删之后新 mount 的同名对象。

这条规则既用于 XMA Native Plugin，也用于 Cordis compatibility。

## 5. Capability Seam

参考成熟 Harness 的实践，XMA 把一个完整可替换能力定义为三类角色：

- **Definition**：稳定接口 / Schema / Event Contract；
- **Provider**：具体实现，例如 Local FS、Native FS、Remote Sandbox FS；
- **Consumer**：Tool、Agent、Shell 或其他 Service。

例如 filesystem：

```text
Filesystem Definition
   ├─ NativeLocalFilesystem Provider → Rust confinement
   ├─ RemoteSandboxFilesystem Provider
   └─ fs tools / Code Agent Consumer
```

只写一个 `FilesystemService` interface 但没有真实 Provider/E2E，不算能力完成。

## 6. Event 分类

插件事件不应全部混成一个全局 string bus。目标分三类：

- **Session durable events**：进入日志、可恢复；
- **Agent live events**：Turn/Step/stream 生命周期；
- **Capability events**：Tool/FS/Provider 等能力的扩展点。

TypeScript 实现期应通过 declaration merging 或等价 typed map 约束事件名与 payload；兼容层再映射 Cordis event semantics。

## 7. Agent Loop 不做插件业务垃圾场

新行为优先挂在 extension point：

- Provider → model registry；
- Tool → tool registry；
- context → context assembly contributor；
- Tool policy → pre/post pipeline；
- usage → request/session observer；
- session projection → durable event projector；
- Agent-specific capability → Agent scope plugin。

如果一个功能的实现需要在 Core Loop 内写大量 `if pluginId` / `if agentId`，必须先证明现有 extension point 不足并更新架构文档。

## 8. DeepSeek Harness / Cordis Compatibility

XMA 以 DeepSeek Harness 当前 Cordis 插件约定为重要兼容目标，包括：

- 插件以函数或对象形式提供 `apply(ctx)`；
- `inject` 声明依赖 Service；
- Context 是稳定 Service 容器；
- typed event / `emit` / `parallel` / `serial` / `bail` / `waterfall`；
- `effect()` / disposer；
- plugin mount/unmount/reload；
- Service registration 的可逆性。

兼容适配固定放 `plugins/compat/deepseek-harness/`。XMA 自身 Service 可以提供 DSH bridge，但 XMA Core 不 import DSH 私有包实现。

## 9. 兼容性等级

文档必须区分：

- **Contract Compatible**：`inject / apply(ctx) / service / event / effect` 基础 Contract 已验证；
- **Service Compatible**：某个 DSH Service（tools / llm / sessions / skill 等）有 bridge + conformance tests；
- **Package Compatible**：真实第三方插件包无需修改即可加载，并通过行为测试。

没有测试通过的 Service 不得宣称“完整兼容”。兼容目标可以很大，但已验证能力必须精确。

## 10. Tool Service Bridge

DSH 与 XMA 的 Tool Contract 不要求内部类型完全相同。Bridge 必须处理：

- schema 转换；
- scope / visibility；
- policy/approval；
- cancellation；
- structured error/result；
- durable tool call/result；
- disposer/lifecycle。

DSH 的工具不能因为来自“兼容插件”就绕过 XMA Workspace、Permission 或 Rust Capability。

## 11. Provider / LLM Bridge

DSH Provider/LLM bridge 只把模型能力接到 XMA `ModelProvider` Contract：

- model id/capability；
- stream；
- tool calls；
- usage；
- error/cancel。

Provider Secret、profile 和 capability truth 仍由 XMA Provider/Credentials Service 管理。

## 12. Session Bridge

Session 兼容的底线是“不破坏 XMA durable truth”：

- DSH 插件若产生模型可见动态内容，必须形成 XMA 可重建 Session fact；
- live event 可以桥接但不冒充 durable；
- 兼容插件不能直接重写已提交 Session history；
- schema/version migration 由 XMA Session Store 控制。

## 13. 第一阶段适配顺序

0.1.x 顺序：

1. Context Service lookup/provide；
2. inject 依赖；
3. apply/effect/disposer；
4. typed event semantics；
5. Tool Service Bridge；
6. Provider/LLM Bridge；
7. Session Bridge；
8. Skill Registry Bridge；
9. 真实 DSH 插件 package conformance。

Slot/UI/self-modification 等更高阶能力后置，不能因为“追求完全兼容”拖慢 XMA Runtime 基础闭环。
