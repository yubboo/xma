# XMA 目录结构规范

## 1. 目的

本文件定义 XMA Platform Skeleton v1 的长期目录骨架、功能归属、目录深度与导入规则。目标不是“目录越多越专业”，而是做到：**能力位置可预测、功能聚合、边界稳定、内部可移动、跨模块不依赖物理相对路径。**

根目录 `CODEMAP.md` 是快速定位索引；本文件是正式架构规范。

## 2. 顶层骨架

```text
xma/
├─ apps/                  # CLI / Desktop / Web / Server 产品入口
├─ agents/                # Agent 身份、Prompt、Loadout
├─ packages/              # 稳定 xma-* Agent Platform 能力
├─ plugins/               # 具体能力实现；一个插件一个自包含目录
├─ skills/                # XMA 产品运行时 Skill
├─ native/                # Rust Native / Security Kernel
├─ core/                  # 0.1.x Compatibility Facade only
├─ docs/                  # 架构 / 开发 / 安全文档
├─ scripts/               # Gate / Windows / Release / Install
├─ .agents/               # 开发 XMA 的 AI 编程 Skill 镜像
├─ .claude/
├─ .codex/
├─ CODEMAP.md
└─ AGENTS.md
```

### 2.1 四层职责

```text
产品层       apps / agents / skills
平台层       packages/xma-*
实现层       plugins/*
安全执行层   packages/xma-native → native/*
```

`core/` 只是一条迁移期兼容桥，不是第五个平台实现层。

## 3. 稳定 Platform Package

当前第一批真实 package：

```text
packages/
├─ xma-ai/
├─ xma-agent-loop/
├─ xma-plugin/
├─ xma-tools/
├─ xma-session/
├─ xma-context/
└─ xma-native/
```

职责：

- `xma-ai`：Model、Provider、Streaming、Provider Profile/Credentials Contract、共享 Transport；
- `xma-agent-loop`：AgentDefinition、Registry、Delegation、AgentRuntime、Turn/Step Tool Loop；
- `xma-plugin`：Plugin Context、Service、Event、Effect、mount/unmount 生命周期；
- `xma-tools`：Tool Contract、Schema、ToolPlan、Policy/Approval、Router、Workspace Tool Guard；
- `xma-session`：durable Session event、Store、resume/export；
- `xma-context`：Context Assembly、Workspace identity / binding / grant；
- `xma-native`：TypeScript ↔ Rust Native RPC Client、OS Credentials bridge。

`xma-*` 表示 XMA 对接口、源码、测试和发布拥有长期控制权；它不表示必须从零发明内部算法。尚未进入真实开发的 `xma-memory`、`xma-subagent`、`xma-workflow`、`xma-browser`、`xma-computer`、`xma-artifact` 不创建空目录。

## 4. Package 内部：适度分层，按功能簇分类

默认目录深度优先保持：

```text
领域 / 功能簇 / 文件
```

例如：

```text
packages/xma-ai/src/model/model.ts
packages/xma-ai/src/provider/provider.ts
packages/xma-context/src/workspace/workspace.ts
packages/xma-agent-loop/src/agent/registry.ts
native/runtime/src/process/runner.rs
```

### 4.1 Feature Cluster Rule

目录按真实功能簇组织，不按 `classes/`、`interfaces/`、`helpers/`、`utils/` 等语言语法类别组织。

当同一功能只有 1～3 个小文件时优先平铺；达到约 4～6 个稳定文件、出现独立生命周期、平台差异或明显子系统边界时再建立目录。

合理：

```text
plugins/minecraft/
├─ server/
├─ mods/
├─ tunnel/
└─ knowledge/
```

不合理：

```text
plugins/minecraft/tools/mods/providers/curseforge/client/http/request.ts
```

### 4.2 Shallow Structure Rule

禁止为了“架构感”创建无实际边界的单文件目录链。超过 `domain / feature / file` 的深度必须能说明真实的平台差异、独立生命周期或复杂子系统理由。

### 4.3 Predictable Location Rule

看到能力名，应能直接猜到主要位置：

- Agent Loop → `packages/xma-agent-loop/`
- DeepSeek → `plugins/deepseek/`
- Native Tool → `plugins/native-tools/`
- CLI/TUI → `apps/cli/`
- Rust Process → `native/runtime/src/process/`
- Minecraft → `agents/minecraft/` + `plugins/minecraft/` + `skills/minecraft/`（进入开发阶段后才创建）

同一个能力只能有一个主要归属位置；共享 Contract 与具体实现可以分层，但不得把同一个插件拆散到多个顶层分类目录。

## 5. Plugin 结构：一个插件一个目录

`plugins/` 不再先按 `providers/`、`tools/`、`context/`、`sessions/` 分类。插件自己声明提供哪些 Service / Tool / Context / Provider 能力。

当前：

```text
plugins/
├─ deepseek/
├─ native-tools/
└─ dsh-compat/
```

规则：

- `plugins/deepseek/`：DeepSeek 产品品牌、Catalog、preset、Plugin 装配；共享 OpenAI-compatible Transport 在 `xma-ai`；
- `plugins/native-tools/`：把 `xma-native` Capability 暴露成模型 Tool；
- `plugins/dsh-compat/`：DeepSeek Harness / Cordis compatibility seam；
- 一个插件可以同时提供 Tool、Context、Service、Event、Provider，不因为能力类型不同拆到不同顶层目录；
- 插件出现真实复杂度后，内部再用 `filesystem/`、`process/`、`mods/`、`tunnel/` 等领域功能簇分类。

## 6. Agent 与 Skill

当前 Agent：

```text
agents/
├─ xiaoyu/
└─ code/
```

Agent 目录保持薄：身份、Prompt、Loadout、少量 Agent 专用装配；大能力应位于 `xma-*` 或插件中。专业 Agent 不复制自己的 Agent Loop。

产品 Skill 位于根 `skills/`；`.agents/skills/`、`.claude/skills/`、`.codex/skills/` 是“开发 XMA”的外部 AI 编程指南，二者不得混用。

## 7. Core Compatibility Facade

`core/` 从 Platform Skeleton v1 起定位锁死为：

> **Compatibility Facade only**

已迁出的 `model.ts`、`provider.ts`、`runtime.ts`、`context.ts`、`native.ts`、Session/Tool/Agent 文件只能转发 `xma-*` 公共入口，不再承载真实实现。尚未迁出的 Skill / App Protocol 可暂留，但后续只能减少不能继续扩张。

新代码禁止为了方便把新的 Agent Platform 能力重新写回 `core/`。

## 8. Stable Import Rule

跨 package、plugin、agent、app 边界只使用稳定公共名称；代码不得知道另一个模块在仓库里的物理相对位置。

正确：

```ts
import { AgentRuntime } from 'xma-agent-loop'
import { ProviderRegistry } from 'xma-ai'
import { ToolRegistry } from 'xma-tools'
import { registerNativeTools } from 'xma-plugin-native-tools'
import { codeAgent } from 'xma-agent-code'
```

禁止：

```ts
import { AgentRuntime } from '../../../../packages/xma-agent-loop/src/runtime.ts'
```

同一 package/插件内部允许短相对路径：

```ts
import { Foo } from './foo.ts'
import { Bar } from '../bar.ts'
```

`../../` 及更深穿越默认视为目录/ownership 设计错误，并由 Architecture Gate 拦截。禁止通过 `xma-ai/src/...` 等方式钻入另一个 package 的内部源码。

每个 workspace package 必须用 `package.json` `exports` 提供公共入口，并在依赖方 `package.json` 用 `workspace:*` 声明真实依赖，禁止依赖 pnpm hoist 偶然可见的幽灵依赖。

## 9. 命名规则

- TypeScript / TSX / PowerShell 与产品目录：小写 **kebab-case**；
- Rust 模块：**snake_case**；
- 正式架构/开发/安全 Markdown：`UPPER-KEBAB.md`；
- `README.md`、`AGENTS.md`、`CLAUDE.md`、`CODEMAP.md` 等行业/项目固定入口例外；
- 父目录去重：父目录已经表达领域时文件名不要重复，例如 `session/store.ts`，不要 `session/session-store.ts`；
- 文件名优先 1～3 个核心词；禁止靠超长名字代替目录语义；
- `misc/`、`common/`、`helpers/`、`utils/` 不得作为大型通用垃圾桶；确有跨域公共能力时必须先明确稳定 Contract 和 ownership。

## 10. Native 目录

Rust 仍按真实能力分类：

```text
native/
├─ protocol/
└─ runtime/
```

当 `filesystem`、`process`、`security` 的实现达到多文件规模时再建立对应功能簇；TypeScript 不得因为 Everything is a Plugin 绕过 Rust Kernel 直接使用无约束 `fs` / `child_process` 执行真实副作用。

## 11. 文档定位

- 快速找代码：`CODEMAP.md`
- 架构总览：`PROJECT-ARCHITECTURE.md`
- Agent Engine：`AGENT-ENGINE-STRATEGY.md`
- 本目录规范：`DIRECTORY-STRUCTURE.md`
- 实时工程上下文：`docs/development/UPDATE-LOG.md`

每次目录 ownership、稳定 package、关键导入规则发生变化，都必须同步更新 `CODEMAP.md`、本文件和 `UPDATE-LOG.md`。
