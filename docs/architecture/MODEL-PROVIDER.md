# XMA Model Provider 架构

## 1. 目标

XMA 的核心理念是 **Model is replaceable. Agent is ours.** Provider 层必须让 GPT、Claude、Gemini、DeepSeek、MiMo、本地模型和未来 Provider 可以替换，而不要求 Agent Loop 到处写 `if provider === ...`。

当前 `core/src/model.ts` 只有最小 `identity + stream()` 骨架。0.1.x 下一阶段要把它升级成完整 Runtime Provider Contract。

## 2. Provider 不只是一个 HTTP stream 函数

正式 Provider 至少包含以下职责：

```text
ProviderDescriptor
  ├─ identity / display metadata
  ├─ transport family
  ├─ authentication strategy
  ├─ provider capabilities
  ├─ model catalog / discovery
  ├─ request preparation
  ├─ streaming decoder
  ├─ tool-call normalization
  ├─ reasoning normalization
  ├─ usage normalization
  ├─ error mapping / retry hints
  └─ health / brain-ready probe
```

这些 Provider-specific 逻辑应该留在 Provider Plugin 内，Agent Loop 只处理 XMA 统一事件。

## 3. Provider Profile 与 Secret

用户配置的是 Provider Profile，而不是把 key 混在 Agent 定义里。建议 Contract：

- profile id / provider kind；
- display name；
- base URL / region / project 等非 Secret 配置；
- auth reference；
- default model；
- optional model allowlist；
- proxy/network settings；
- provider-specific advanced options。

Secret 交给 Credentials Service，Provider 请求时按 profile scope 获取。Secret 不进入 Session message、Workspace、普通日志或导出；错误对象在对用户可见前做 redaction。

## 4. Provider Capabilities

Provider 必须明确宣布能力上限，不能让 UI 或 Agent 通过模型名称猜。第一版至少需要：

```text
streamingText
nativeToolCalling
parallelToolCalls
reasoning
visionInput
fileInput
imageOutput
webSearch
promptCaching
remoteCompaction
usageReporting
modelCatalogDiscovery
```

能力还要能被具体 ModelDescriptor 收窄。例如同一 Provider 下，不同模型的 vision/reasoning/context window 可能不同。

## 5. Model Catalog

ModelDescriptor 至少记录：

- model id / display name；
- context window；
- max output；
- supported input/output modalities；
- tool calling；
- reasoning capability / 可选 effort；
- known usage/price metadata（如果可靠可得）；
- source / fetchedAt；
- availability/probe state。

若 Provider 有 models API，应优先动态发现并缓存；没有时允许 Provider Plugin 提供带来源日期的静态 catalog。静态信息不得冒充实时可用性。

## 6. 统一 ModelRequest / ModelEvent

XMA Core 面向 Provider 的请求要稳定，不暴露某厂商原始 JSON：

- `messages`：由 Session projection 派生；
- `system/context`：Context Assembly 结果；
- `tools`：当前 Step 冻结 ToolPlan 的模型可见部分；
- `model`；
- reasoning/config；
- response limits；
- cancellation signal；
- correlation metadata。

Provider 返回归一化流事件：

- response started；
- text delta；
- reasoning delta / summary（Provider 支持时）；
- tool call start/args delta/complete；
- usage；
- finish reason；
- provider warning；
- terminal error。

Core 不应该因为 OpenAI 叫 `function_call`、Anthropic 叫 `tool_use`、Gemini 结构不同就改变 Agent Loop。

## 7. Reasoning

Reasoning 是 Provider capability，不是 XMA 自己编造的“思维链”。

- UI 只展示 Provider 真正允许公开的 reasoning/summary；
- Provider 不返回 reasoning 时，XMA 不伪造“思考中内容”；
- reasoning effort 等配置由 ModelDescriptor/Provider 验证；
- usage 中的 reasoning token 按 Provider 能提供的事实记录；
- 不把隐藏 reasoning 当成 Session 可恢复文本。

## 8. Usage / Cost / Latency

每次真实模型请求生成 `UsageRecord`：

- provider/model/profile；
- input/output/cache/reasoning tokens（能获取多少记录多少）；
- request start/end/first-token latency；
- retries；
- provider request id（可安全记录时）；
- cost estimate + price source；
- usage source = provider reported / estimated。

费用是可解释估算，不能在 Provider 不返回 usage、价格表又缺失时伪造精确金额。

## 9. Retry 与错误分类

Retry policy 由 Provider/Transport 提供建议，RunManager 决定是否执行。至少区分：

- auth invalid / expired；
- permission/plan；
- model not found；
- rate limited；
- timeout/network；
- context too large；
- unsupported capability；
- server 5xx；
- malformed provider stream；
- cancelled。

429/5xx 等临时错误可以有限重试；认证、model not found、unsupported capability 不应盲重试。所有尝试都进入调用记录。

## 10. Brain Ready Probe

“配置保存成功”不等于 Provider Ready。每个 Profile 至少要有一条真实 Probe：

1. auth/config syntactic validation；
2. model catalog / target model exists（Provider 支持时）；
3. 最小 text request；
4. 目标模型宣称 native tool calling 时执行最小 tool-call round trip；
5. 记录 first-token / total latency、capability observation、usage availability；
6. 返回结构化结果供 CLI/Desktop 展示。

只有真实请求成功才能标记 Brain Ready。假 Provider / fixture 只用于测试，不能改变产品状态。

## 11. Provider 实现顺序

0.1.x 不同时写五个半成品 Adapter。顺序固定为：

1. 完成 Provider Registry / Profile / Credential / Capability / Catalog Contract；
2. 完成一个 **OpenAI-compatible transport family** 的真实 Adapter，打通 streaming text + tool call + usage + cancellation；DeepSeek/MiMo 等只有在其目标 API 实际兼容时才复用，不凭品牌名称假定兼容；
3. 完成一个**非 OpenAI 协议族**的真实 Adapter，优先 Anthropic Claude native，证明 Contract 没被 OpenAI JSON 绑死；
4. Gemini native；
5. OpenAI first-party/Responses 特有能力、额外云 Provider、本地模型作为独立能力迭代；
6. 每加入一个 Provider 都必须跑同一套 Provider Conformance Tests。

具体先后可由实际账号/测试条件调整，但“先 Contract + 至少两个不同协议族验证抽象”不能跳过。

## 12. Provider Conformance Tests

同一测试套件验证：

- Profile 解析；
- Secret 不泄漏；
- capability；
- model catalog；
- stream text；
- tool call 参数拼装；
- cancellation；
- retry/error normalization；
- usage；
- Brain Ready Probe。

真实 API 测试使用环境 Secret，自缺 Key 时可以 skip，但发布“已支持某 Provider”必须有目标 Provider 的真实 E2E 证据。
