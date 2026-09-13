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
| CLI / TUI | `apps/cli/` |
| Desktop | `apps/desktop/` |
| Web | `apps/web/` |
| Server | `apps/server/` |
| Rust Native Protocol | `native/protocol/` |
| Rust Security / Native Runtime | `native/runtime/` |
| 迁移期旧入口 | `core/`（Compatibility Facade only） |

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

## 定位规则

1. 先按能力名定位顶层目录；一个能力必须有一个主要归属位置。
2. `packages/xma-*` 放稳定 Contract / Runtime；`plugins/<name>` 放具体实现；`agents/<name>` 放 Agent 身份与 loadout。
3. 模块内部按真实功能簇分类，默认深度控制在 `领域 / 功能簇 / 文件`。
4. 跨 package / plugin / agent 只使用稳定 package 名，不使用 `../../..` 穿越物理目录。
5. 找不到位置时先更新本文件或目录设计，不要创建 `misc/`、`common/`、`helpers/` 之类垃圾桶目录。
