# XMA 目录结构说明

## 1. 为什么不拆成几十个 Package

XMA 0.1.x 处于平台出生期。当前优先级是把 Agent Runtime、真实 Provider、Session、Tool/Permission、Workspace、Plugin Host 和 Native Kernel 真正跑通，而不是制造大量 npm workspace 边界。

产品代码核心目录保持精简：

```text
xma/
├─ apps/       # CLI / Desktop / Web / Server 四种产品入口
├─ core/       # XMA TypeScript Agent 平台核心
├─ agents/     # Minecraft / Code / Writer 等专业 Agent
├─ plugins/    # Provider / Tool / Integration / Compatibility
├─ native/     # Rust Native / Security Kernel
├─ scripts/    # 开发、构建、同步、GitHub、Gates
└─ docs/       # 架构、计划、规则、安全文档
```

## 2. apps/

只负责“用户从哪里使用 XMA”。CLI、Desktop、Web、Server 必须复用 Core，不能各自复制 Agent Loop、Session Store 或 Provider 逻辑。

未来 Desktop 三栏 Workbench 仍只是 Shell，布局见 `docs/architecture/DESKTOP-WORKBENCH.md`。

## 3. core/

当前统一承载 Agent、Session、Model、Provider Contract、Context、Plugin、Tool、Workspace 等 TypeScript 核心 Contract。0.1.0 当前关键文件包括 `runtime.ts`、`session.ts`、`session-store.ts`、`session-export.ts`、`context.ts`、`provider.ts`、`app-protocol.ts`。目标逻辑模块见 `PROJECT-ARCHITECTURE.md`，但在模块真正长大前不强制每个概念成为独立 package。

## 4. agents/

一个 Agent 表示一个专业身份与能力组合：

- `agents/code/`：Coding Agent 场景知识与能力组合；
- `agents/minecraft/`：Minecraft 场景知识与能力组合；
- `agents/writer/`：Writer 场景知识与能力组合。

专业业务不能写进 Core Agent Loop。

## 5. plugins/

跨 Agent 共用能力和外部生态接入：

- Provider adapters（当前 `plugins/providers/openai-compatible.ts` 为第一条 transport family）；
- Git / Browser / Search / MCP / Integration；
- Tool/Capability providers；
- `plugins/compat/deepseek-harness/` 兼容层。

“一切能力可插件化”不等于“一切文件都拆 npm package”。

## 6. native/

Rust 边界非常明确：Native / Security / Performance。第一阶段保留 `protocol` 与 `runtime` 两个 crate，优先完成 PTY、Process、Filesystem confinement、Capability、Network、Hash/Archive。

特别注意：

- 根 `/runtime/` = 用户运行数据，禁止提交；
- `native/runtime/` = Rust 源码，必须提交、同步、测试。

## 7. 本地构建缓存与发布产物

XMA 明确区分“编译缓存”和“产品产物”：

- `.cache/cargo-target/`：XMA 根 Rust Workspace 的中间对象、build script 输出和 release 编译缓存，可随时删除，不提交 Git，不进入源码包；
- `.cache/tauri-target/`：Tauri 2 备用桌面端的独立 Rust 编译缓存，避免与 Native Runtime release 目录混在一起；
- `.cache/electron/`：Electron ZIP 下载缓存；
- `dist/`：XMA 统一的产品构建/发布产物入口，例如 Web、CLI、Server、`dist/release`。

仓库根目录不再使用 `target/` 作为正常 Cargo 输出。根 `.cargo/config.toml` 固定 `build.target-dir = ".cache/cargo-target"`。旧版本遗留的根 `target/` 只是历史编译缓存，`XMA-Sync.bat` 会在同步新源码时清理。

`target/` 与 `dist/` **不是同一种目录**：前者属于 Cargo 内部编译状态，后者才是 XMA 对开发者/发布流程暴露的产品输出。

## 8. docs/

长期事实必须有唯一文档归属：

- 架构 Contract → `docs/architecture/`；
- 开发顺序/当前状态/上游参考 → `docs/development/`；
- 安全策略 → `docs/security/`。

AI Skills 可以引用这些文档，但不能复制成另一套权威规则。

## 9. 仓库级 AI 开发目录

XMA 明确允许下面这些开发元数据目录，它们**不是产品 Runtime**：

```text
AGENTS.md                    # 所有 AI / 开发者最高规则
CLAUDE.md                    # Claude 入口，只能指向/摘要 AGENTS.md
.agents/                     # XMA 公共 AI Skills 的单一事实源
  README.md
  skills/
.codex/                      # Codex 专用环境/Skill 兼容入口
  README.md
  environments/
  skills/
.claude/                     # Claude Code 专用 Skill 兼容入口
  README.md
  skills/
```

由于 XMA Windows-first，不依赖 Git symlink。`.codex/skills` 与 `.claude/skills` 对公共 Skill 使用受 Gate 约束的镜像文件；真正权威内容在 `.agents/skills`。

这些目录禁止保存：

- API Key / token；
- 用户私有 prompt；
- 个人机器绝对路径；
- Workspace 内容；
- 运行 Session；
- 可绕过 `AGENTS.md` 的“隐藏规则”。

## 10. 什么时候才拆包

只有至少满足其一才考虑把 Core 模块拆为独立 workspace package：

- 需要独立发布/版本；
- 生命周期与 Core 明显独立；
- 有多个稳定消费者；
- 编译/测试隔离有真实收益；
- 单包已经造成持续的 ownership/变更冲突。

不能因为参考项目拆了很多包，就机械复制其目录规模。


## 当前 Stage C 新增源码归属

- `core/src/tool-schema.ts`：模型 Tool arguments 的 TypeScript Schema 校验；
- `core/src/tool-policy.ts`：Permission Policy / Security Guard / Approval Contract；
- `core/src/tools.ts`：Tool Registry / frozen ToolPlan / ToolRouter；
- `core/src/native.ts`：TypeScript ↔ Rust Native Capability Bridge；
- `plugins/tools/native.ts`：Native FS/Process 的 Tool Definition Adapter；
- `native/protocol/`：稳定 JSON-RPC / Capability wire contract；
- `native/runtime/`：Rust path/process enforcement；
- `docs/security/NATIVE-CAPABILITIES.md`：当前安全能力与未完成边界。
