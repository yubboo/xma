# XMA Code Map

> 作用：给 AI 与开发者提供“能力 → 目录”的第一跳索引。找代码先看这里，再进入对应模块；不要靠全仓猜路径。

## 平台能力

| 我要找什么 | 主要位置 | 说明 |
| --- | --- | --- |
| Agent Loop / Turn / Step / AgentDefinition | `packages/xma-agent-loop/` | Agent Engine 与 Agent 平台 Contract |
| Model / Provider / Streaming / OpenAI-compatible | `packages/xma-ai/` | 模型与 Provider 稳定协议 |
| Plugin Host / Service / Effect / Event | `packages/xma-plugin/` | Everything is a Plugin Runtime |
| Tool / ToolPlan / Policy / Approval / Router | `packages/xma-tools/` | Tool Contract 与执行流水线 |
| Session / durable event / JSONL Store / export | `packages/xma-session/` | Session 稳定 Contract 与当前持久化 |
| Context / Workspace | `packages/xma-context/` | Context Assembly 与 Workspace identity / grant |
| TypeScript ↔ Rust Native | `packages/xma-native/` | Native RPC Client 与 OS Credentials Bridge |
| Host-neutral App Protocol / Runtime Events | `core/` 迁移薄层 → 后续稳定 capability | CLI/Desktop/Web/Server 统一 Commands/Events/Queries；不得在 Host 复制 Agent/Permission 逻辑 |

## 插件与 Agent

| 我要找什么 | 主要位置 | 说明 |
| --- | --- | --- |
| DeepSeek 产品接入 | `plugins/deepseek/` | Provider Catalog / Plugin；共享协议在 `xma-ai` |
| Native 文件/进程 Tool | `plugins/native-tools/` | 通过 `xma-native` 调 Rust Kernel，不直连 Node OS API |
| DeepSeek Harness / Cordis 兼容 | `plugins/dsh-compat/` | DSH compatibility bridge / conformance seam |
| 小鱼 Manager | `agents/xiaoyu/` | Agent 身份与 loadout 定义 |
| Xiaoyu Code | `agents/code/` | Code 专业 Agent 定义 |
| 产品运行时 Skill | `skills/` | 给真实模型读取的专业知识与规程 |

## 产品与 Native

| 我要找什么 | 主要位置 |
| --- | --- |
| Windows 源码开发控制台 / 项目更新 | `xma-dev.bat` → `scripts/windows/xma-console.ps1`（[10] 安全更新 / 强制恢复） |
| Windows 开发态 `xiaoyu / xma` PATH shim | 共享实现 `scripts/windows/xma-common.ps1`，由 `xma-prepare.ps1 → [1]` 注册/校验，并由 `xma-sync.ps1` 在用户已存在开发 shim 时把 checkout 路由切到本次同步目标；状态位于 checkout `.git/xma-state/dev-bin/`（非 Git 树回退 `.cache/xma-state/dev-bin/`；`.cmd` 只做 ASCII 跳板，`xiaoyu-dev.ps1` 用 .NET UTF-8 读取 `source-root.txt` 后**直接调用** `xma-console.ps1 -Command cli`，不回跳 cmd/bat；本地生成，不提交） |
| 开发环境 Bootstrap / JavaScript Runtime | Windows `[1]` 自动确保 Git、Node、兼容 pnpm、Rust/MSVC/Native crates，并且**每次运行都无条件在项目根执行原生 `pnpm install`**，由 pnpm 自己恢复/同步 Workspace `node_modules`；Unix prepare 同样使用标准 `pnpm install`；`scripts/runtime/update.mjs` 只负责 `[8]` 的 Bun/OpenTUI/Solid 定向 latest 刷新 |
| Windows 源码依赖 | JavaScript Runtime（Bun/OpenTUI/Solid）统一声明在根 `package.json` 并安装到根 `node_modules/`；`apps/cli/opentui-runtime/` 只保留源码，不是嵌套 Workspace；Rust/Cargo 唯一位于 checkout 本地 `runtime/rust/{cargo,rustup}`，由 `scripts/windows/xma-common.ps1` + `xma-prepare.ps1` 管理，短命令探测走 `Invoke-XmaProbe`，native 安装/同步动作直接继承 Windows Terminal；不读取用户 `%USERPROFILE%/.cargo/.rustup` 或旧 Rust state |
| Linux/macOS 源码开发控制台 | `xma-dev` → `scripts/unix/xma-console.sh` |
| Windows 普通用户安装器 | `scripts/install/xma-install.ps1` |
| Linux/macOS 普通用户安装器 | `scripts/install/xma-install.sh` |
| Windows 维护者 Source Sync | `XMA-Sync.bat` → `scripts/windows/xma-sync.ps1` |
| Windows 维护者 GitHub Helper | `XMA-GitHub.bat` → `scripts/windows/xma-github.ps1` |
| CLI / TUI | `apps/cli/src/`（Host 入口/Trust/Provider 状态/权限 UI）+ `apps/cli/opentui-runtime/`（Bun/OpenTUI Active Renderer；只投影 Runtime，不拥有 Agent 状态） |
| Desktop | `apps/desktop/`（GUI Host；消费同一 Runtime/App Protocol，不复制 Agent/Permission） |
| Web | `apps/web/`（Browser UI Host；云部署时 Native capability 默认作用于 Server Host） |
| Server | `apps/server/`（Headless Runtime/App Protocol Host） |
| Rust Native Protocol | `native/protocol/` |
| Rust Security / Native Runtime | `native/runtime/` |
| 迁移期旧入口 | `core/`（Compatibility Facade only） |
| Terminal OpenTUI 父级协调 | `apps/cli/opentui-runtime/app.tsx` |
| Terminal UI 子模块 | `apps/cli/opentui-runtime/ui/`（Transcript / Prompt / Decoration / Logo / Dialog） |
| Terminal 子模块稳定合同 | `apps/cli/opentui-runtime/contracts.ts` |

## 文档与规则

| 内容 | 文件 |
| --- | --- |
| 项目最高开发规则 | `AGENTS.md` |
| 总体架构 | `docs/architecture/PROJECT-ARCHITECTURE.md` |
| Agent Engine / Upstream-first | `docs/architecture/AGENT-ENGINE-STRATEGY.md` |
| 目录骨架与命名 | `docs/architecture/DIRECTORY-STRUCTURE.md` |
| Plugin 架构 | `docs/architecture/PLUGIN-SYSTEM.md` |
| 开发规则 | `docs/development/DEVELOPMENT-RULES.md` |
| 当前开发计划 | `docs/development/DEVELOPMENT-PLAN.md` |
| 当前状态 | `docs/development/PROJECT-STATUS.md` |
| 上游参考 | `docs/development/UPSTREAM-REFERENCE.md` |
| 实时工程更新记录 | `docs/development/UPDATE-LOG.md` |
| Bug 修复工作流 | `docs/development/REPAIR-WORKFLOW.md` |
| 修复 Prompt / 历史台账 | `docs/development/REPAIR-PROMPTS.md` |

## 定位规则

1. 先按能力名定位顶层目录；一个能力必须有一个主要归属位置。
2. `packages/xma-*` 放稳定 Contract / Runtime；`plugins/<name>` 放具体实现；`agents/<name>` 放 Agent 身份与 loadout。
3. 模块内部按真实功能簇分类，默认深度控制在 `领域 / 功能簇 / 文件`。
4. 跨 package / plugin / agent 只使用稳定 package 名，不使用 `../../..` 穿越物理目录。
5. 找不到位置时先更新本文件或目录设计，不要创建 `misc/`、`common/`、`helpers/` 之类垃圾桶目录。

## 根目录卫生（Root Hygiene）

根目录只放一级领域目录、工具链根配置、导航文档和极少量顶级 Launcher。普通实现文件/临时脚本不允许继续堆到根；`.git/`、`.cache/`、`node_modules/` 属于本机状态，不是源码 ownership；`xma-path/` 与 `.xma/` 仅作为 0.1.0 旧本地依赖/状态迁移兼容，不再承载现役 Windows Rust。

- `scripts/windows/xma-common.ps1`：Windows Bootstrap 公共 helper，包括外部命令/Probe、Rust 环境、可写目录探针、PATH 规范化/条目解析，以及开发态 `xiaoyu/xma` shim 的生成、自检与单 checkout User PATH 路由；`[1]` 与 Source Sync 复用同一实现，Windows Gate 对 `*-Xma*` 调用做静态闭包检查。
