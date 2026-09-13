# XMA Model Provider 架构

## 1. 目标

XMA 的核心理念是 **Model is replaceable. Agent is ours.** Provider 层必须让 GPT、Claude、Gemini、DeepSeek、MiMo、本地模型和未来 Provider 可以替换，而不要求 Agent Loop 到处写 `if provider === ...`。

当前 0.1.0 已落地第一版 Provider 平台 Contract：`packages/xma-ai/src/provider/provider.ts` 负责非 Secret Profile、Credentials、Capabilities、Catalog、Registry、Probe 与统一错误分类；`packages/xma-ai/src/openai-compatible.ts` 已实现真实 HTTP/SSE 的 OpenAI-compatible Chat Completions transport family；`plugins/deepseek/catalog.ts` 把用户看到的真实 Provider 品牌与底层协议 Adapter 分离。首个品牌产品入口是 **DeepSeek Official**，使用官方 endpoint、OS Credentials 与动态 `/models`；它复用 OpenAI-compatible transport 的前提是目标官方 API 实际兼容，而不是因为品牌名相似。当前本地协议测试仍**不能**替代 DeepSeek 外部真实凭据 E2E，未取得真实 E2E 前不得宣称 Product Ready。

## 1.1 `xma-ai` 长期边界

Model/Provider/streaming 基础抽象已经归属 `packages/xma-ai/`；具体品牌实现按插件本体聚合，DeepSeek 位于 `plugins/deepseek/`。Platform Skeleton 只完成 ownership 迁移，`xma-ai` 后续仍要以 **Pi AI** 为第一参考吸收成熟多 Provider、streaming 与统一消息/工具事件语义，同时保留 XMA 自己的 Provider Profile、OS Credential、Provider/Model Truth Contract、Brain Ready Probe 与品牌身份/协议 Adapter 分层。

目标不是把所有厂商裁成最低公分母，而是建立统一基础事件后允许 Adapter 保留 provider-specific continuation、thinking、usage、tool semantics。上游实现只能作为成熟参考，实际外部 Provider Contract 仍以厂商当前官方协议与真实 E2E 为准。

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

## 2.1 当前代码落点（0.1.0）

```text
packages/xma-ai/src/model/model.ts                         统一 ModelRequest / ModelEvent / ModelProvider
packages/xma-ai/src/provider/provider.ts                      Profile / Credential / Capability / Catalog / Registry / Probe
plugins/deepseek/catalog.ts              真实 Provider 品牌目录 / preset；品牌身份与协议 Adapter 分离
packages/xma-ai/src/openai-compatible.ts    第一条真实 HTTP/SSE transport family
plugins/deepseek/plugin.ts              内建 Provider service 装配，不内置任何 Secret
core/tests/provider-openai-compatible.test.ts
                                         本地协议级 Conformance 起点
```

当前已经具备：Profile Secret 边界、环境/内存 Credential Resolver、OS Credentials Store Contract 与 Native bridge、Provider Adapter Registry、`providerId` 品牌身份、内建 Provider Catalog、能力声明、模型目录发现、真实 HTTP/SSE 流解析、分片 Tool Call arguments 合并、Usage 归一化、取消与错误分类，以及包含 catalog/text/tool-call round trip 的 Brain Ready Probe。

当前**没有**具备：外部厂商真实 Ready 证据、通用自动 Retry 驱动、Anthropic/Gemini native Adapter、价格/Cost Catalog、远程 compaction、OS Credentials 三平台实机 E2E 证据，以及完整的跨 Adapter Conformance Harness。


## 2.2 Provider / Model Truth Contract

Provider 产品层必须保证“用户配置什么真实模型，Xiaoyu 就由什么真实模型推理”，而不是只把 Provider 做成一个 Base URL 表单：

- `providerId` 表示用户真实选择的品牌/服务身份，例如 `deepseek`；`adapterId` 表示协议/transport family，例如 `xma.openai-compatible`。二者不能互相冒充。
- Profile 负责一个真实账号/endpoint 的非 Secret 配置，同一品牌允许多个 Profile；`profileId` 不能被当成品牌身份。
- 当前活动的 `providerId + profileId + modelId` 必须进入每个真实请求与 `ModelIdentity`；未经用户可见、可审计的路由变化，不得隐藏换模或降级。
- Tool Call / Observation 必须回给当前真实模型继续推理。XMA 的 Tool Policy、Approval 与 Rust Native Kernel 负责“能不能做、怎么安全做”，不替模型做正常任务推理。
- Provider 有真实 catalog API 时，可用 model ID 以实时 catalog 为准；preset 的默认模型仅用于首次创建 Profile 的 bootstrap。
- Provider Catalog 只展示已经有真实 endpoint/auth/protocol 产品路径的品牌；计划中的品牌不得用可点击假卡片冒充支持完成。
- Provider-specific thinking/reasoning/tool/usage 能力必须按实际 API Contract 验证与透传；XMA 不伪造，也不主动裁成最低公分母。
- XMA canonical Tool identity 与 Provider wire function name 分层：Core 可以保留 `native.fs.read_text` 这类领域名；OpenAI-compatible 等协议如果只接受 `[A-Za-z0-9_-]`，Adapter 必须把 canonical 名稳定映射为合法 wire alias，并在 Tool Call 返回时解码回原名。Session、ToolPlan、Approval、审计始终记录 canonical Tool 名，不被外部协议限制污染。

### DeepSeek Official 第一批产品路径

当前 DeepSeek Catalog entry 使用官方 `https://api.deepseek.com`，通过真实 `/models` 获取账号当前可用 model ID；preset 中的默认模型只负责首次 Profile bootstrap，模型选择页随后以 API 返回结果为准。DeepSeek 的品牌身份始终保留为 `providerId = deepseek`，即使底层 transport 复用 OpenAI-compatible Adapter，也不会把用户看到的 Provider 伪装成“Generic OpenAI”。

Terminal 支持多个 Provider Profile；DeepSeek 可分别保存多个独立 Profile。API Key 默认只写 OS Credentials，`brain.json` 保存稳定 Credential Reference。品牌 Provider 首次配置主路径固定为 API Key → 真实 `/models` 模型选择 → 推理强度 → Brain Ready；`/model` 可再次切换当前 Profile 的真实 model catalog。DeepSeek 对**真实 Agent Turn**显式启用 thinking；reasoning effort 由用户在 `Default / high / max` 中选择并持久化为非 Secret Profile option，Default 表示不强制 `reasoning_effort`，由真实 Provider 决定默认强度。当前 DeepSeek API 在 thinking 模式下不接受 named/`required` `tool_choice`，因此 Brain Ready 的确定性 Tool Call 子探针会**仅在该探针请求中**关闭 thinking；这不是对实际 Agent Turn 的能力降级，外部真实验收仍必须覆盖 thinking + tools 的自然 Tool Call 闭环。

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

Secret 交给 Credentials Service，Provider 请求时按 profile scope 获取。当前 `CredentialReference` 支持 `env`、进程内 `memory` 与 `os` 三类引用；Profile 只保存引用，不保存 Secret 值，并静态拒绝 `Authorization`、`X-Api-Key` 等 Secret-bearing header。`os` 由 Rust Native Runtime 统一桥接：Windows 使用 Credential Manager、macOS 使用 Keychain、Linux 在检测到系统 `secret-tool` 时使用 Secret Service。Terminal 默认安全录入路径只把稳定别名写入 `brain.json`；旧环境变量路径继续兼容。这里的“已实现”只指代码 Contract/bridge，Windows/macOS/Linux 真实系统凭据库仍需分别做实机 E2E 后才能算 Product Ready。

Secret 不进入 Session message、Workspace、普通日志或导出；Provider HTTP 错误在转成用户可见错误前必须 redaction。

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
- 上述 text/reasoning delta 必须保持真实增量语义进入 Runtime live event，Host/TUI 在收到后即可渲染，不能等完整响应结束后批量回放；
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
- 不把隐藏 reasoning 当成普通 assistant 文本或对用户展示的“思考过程”；
- 若目标 Provider 协议为了 thinking + tools 的正确续传**强制要求**回传隐藏状态，Adapter 可以产生 opaque `providerContinuation`，Runtime 只做 durable round-trip、不理解厂商字段；redacted Session export 必须移除该 continuation。

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

只有真实请求成功才能标记 Brain Ready。当前 OpenAI-compatible Adapter 的 `probe()` 会在声明相应 capability 时先读取真实 `/models` 并确认目标 model 存在，再执行最小 text request；若声明 native tool calling，还会执行一次确定性最小 Tool Call，并把 Tool Result 作为 observation 回给同一模型要求其继续响应。Provider 可以为**探针本身**声明最小兼容 override；DeepSeek 当前因为官方 API 不允许 thinking 模式与 named/`required` `tool_choice` 同时使用，Tool Call 子探针临时设为 `thinking: disabled`，但普通 text probe 与实际 Agent Turn 仍使用 Profile 的真实 thinking 与用户选择的 reasoning effort 配置。对于真实 DeepSeek thinking + tools Agent Turn，Adapter 会保存并回传协议要求的 `reasoning_content` continuation；Core 只看 opaque `providerContinuation`，不会把它当普通消息文本。Terminal 只在当前 `profileId + modelId` 的真实 Probe 成功后显示 Brain Ready；重启后首次实际发送会重新验证，而不是把“配置文件存在”当成 Ready。本地测试服务器只验证协议实现，不构成任何外部厂商 Ready 证据。

## 11. Provider 实现顺序

0.1.x 不同时写五个半成品 Adapter。顺序固定为：

1. 完成 Provider Registry / Profile / Credential / Capability / Catalog Contract； **第一版已落地**
2. 完成一个 **OpenAI-compatible transport family** 的真实 Adapter，打通 streaming text + tool call + usage + cancellation； **协议实现与本地 Conformance 已落地**。在它之上先做真实品牌 Catalog，DeepSeek Official 已进入第一批产品路径，但外部真实凭据 E2E 尚待 Windows 实机验收；其他品牌只有在目标 API 实际兼容时才复用，不凭品牌名称假定兼容；
3. 完成一个**非 OpenAI 协议族**的真实 Adapter，优先 Anthropic Claude native，证明 Contract 没被 OpenAI JSON 绑死；
4. Gemini native；
5. OpenAI first-party/Responses 特有能力、额外云 Provider、本地模型作为独立能力迭代；
6. 每加入一个 Provider 都必须跑同一套 Provider Conformance Tests。

具体先后可由实际账号/测试条件调整，但“先 Contract + 至少两个不同协议族验证抽象”不能跳过。

## 12. Provider Conformance Tests

最终同一测试套件验证：

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


## 13. 当前 0.1.0 验证边界

当前本地协议测试覆盖：Profile 不保存 Secret、Secret-bearing Header 拒绝、OS CredentialReference/Store 适配与 legacy env 配置迁移、品牌 `providerId` 与 Adapter 分离、DeepSeek Catalog preset、thinking/reasoning 参数映射、`reasoning_content` durable provider continuation、redacted export 移除 continuation、`/models` 目录读取、SSE 文本、分片 Tool Call、Usage、取消、错误归一化，以及 catalog → text → tool call → observation round trip 的真实 HTTP Probe 语义。这里的“真实 HTTP”指 Adapter 确实经过网络栈与 HTTP/SSE Parser，而不是 Fake Provider；测试 endpoint 是进程内测试服务器，因此**不能据此写“OpenAI/DeepSeek 等已支持”**。同样，本地 Fake Native 只能验证 Credentials Contract，不能替代 Windows Credential Manager、macOS Keychain、Linux Secret Service 的实机 E2E。发布某个品牌 Provider 支持前，必须补该品牌目标 endpoint 的真实 E2E 证据。
