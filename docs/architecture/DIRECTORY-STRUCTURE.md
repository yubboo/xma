# XMA 目录结构说明

## 1. 为什么不拆成几十个 Package

XMA 0.1.x 处于平台出生期。当前优先级是把 Agent Runtime、真实 Provider、Session、Tool/Permission、Workspace、Plugin Host 和 Native Kernel 真正跑通，而不是制造大量 npm workspace 边界。

产品代码核心目录保持精简：

```text
xma/
├─ apps/       # CLI / Desktop / Web / Server 四种产品入口
├─ core/       # XMA TypeScript Agent 平台核心
├─ agents/     # Xiaoyu Manager / Code 等已实现 Agent
├─ skills/     # XMA 产品级 Skill（SKILL.md + skill.json）
├─ plugins/    # Provider / Tool / Integration / Compatibility
├─ native/     # Rust Native / Security Kernel
├─ scripts/    # 开发、构建、同步、GitHub、Gates
└─ docs/       # 架构、计划、规则、安全文档
```

## 2. apps/

只负责“用户从哪里使用 XMA”。CLI、Desktop、Web、Server 必须复用 Core，不能各自复制 Agent Loop、Session Store 或 Provider 逻辑。

未来 Desktop 三栏 Workbench 仍只是 Shell，布局见 `docs/architecture/DESKTOP-WORKBENCH.md`。

## 3. core/

当前统一承载 Agent、Session、Model、Provider Contract、Context、Plugin、Tool、Workspace 等 TypeScript 核心 Contract。0.1.0 采用“**小领域保持扁平，达到稳定规模再分组**”的物理布局：

```text
core/src/
├─ agent.ts                   # legacy runAgent 迁移兼容
├─ agent/                     # Agent identity / registry / delegation
│  ├─ contract.ts
│  ├─ registry.ts
│  └─ delegation.ts
├─ skill/                     # 产品 Skill metadata / registry / loader
│  ├─ contract.ts
│  ├─ registry.ts
│  └─ loader.ts
├─ runtime.ts
├─ context.ts
├─ workspace.ts
├─ provider.ts
├─ session/                   # Durable Session Contract / Store / Export
│  ├─ contract.ts
│  ├─ store.ts
│  └─ export.ts
└─ tool/                      # Router / Policy / Schema 是三个不同安全职责
   ├─ router.ts
   ├─ policy.ts
   └─ schema.ts
```

这里的子目录只是源码组织，不代表拆成独立 npm package。只有真正需要独立发布/生命周期/消费者时才考虑 package 边界。

### 3.1 命名规则与父目录去重

- 目录、TypeScript/TSX、PowerShell：小写 `kebab-case`；
- Rust 模块：`snake_case`；
- 正式 docs 文件：`UPPER-KEBAB.md`；
- `.` 只表示 `test/config/d` 等角色或生态固定命名；普通单词不得用点号连接；
- 普通名字优先 1～3 个核心词；目录已经表达领域时文件名去掉重复前缀；
- 同逻辑优先聚合，只有真正不同的逻辑职责才拆文件；通常领域达到约 3 个稳定文件或独立生命周期后才建立子目录；
- 可机械判断的规则由 `scripts/gates/naming.ts` 锁定。

例如：`session/store.ts`、`tool/policy.ts`、`apps/desktop/scripts/electron/install-runtime.ts` 都优于重复写成 `session/session-store.ts`、`tool/tool-policy.ts`、`install-electron-runtime.ts`。

## 4. agents/ 与 skills/

`agents/` 保存 XMA 内置专业身份；`skills/` 保存运行时给专业 Agent/模型读取的产品级 Skill。两者不是一回事。

当前真实结构：

```text
agents/
├─ xiaoyu/
│  └─ agent.ts
└─ code/
   └─ agent.ts

skills/
├─ common/
│  ├─ task-planning/
│  │  ├─ SKILL.md
│  │  └─ skill.json
│  └─ verification/
└─ code/
   ├─ bug-fixing/
   └─ testing/
```

规则：

- Agent = 专业身份与能力组合；
- Skill = 给模型的专业工作方法/约束/交付标准；
- Plugin/Tool = 程序能力；
- `.agents/skills/` 是开发 XMA 的 AI 工具上下文，与根 `skills/` 产品能力严格分离；
- Writer/Minecraft/GameDev/Art 等未来 Agent 在拥有真实 Skill/Tool 实现前不创建空目录。

详细 Contract 见 `docs/architecture/AGENT-PLATFORM.md`。

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

XMA 只保留两种构建目录语义：

```text
xma/
├─ .cache/                    # 可删除的本地下载/编译/staging，不提交 Git
│  ├─ cargo-target/          # 根 Rust Workspace 编译缓存
│  ├─ tauri-target/          # Tauri Rust 编译缓存
│  ├─ electron/              # Electron Runtime ZIP 下载缓存
│  ├─ electron-builder/      # Electron Builder 下载缓存
│  └─ desktop/
│     ├─ electron/           # Electron dev/release staging
│     └─ tauri/              # Tauri Web staging
└─ dist/                      # 唯一正式产品构建/发布输出
   ├─ web/
   ├─ cli/
   ├─ server/
   └─ release/
      ├─ electron/
      └─ tauri/
```

硬规则：

- `.cache/` = 下载缓存、编译缓存、打包 staging，删除后只影响下一次构建速度；
- `dist/` = 用户/发布流程真正关心的产品产物；
- XMA 自己不得新增根 `build/`、根 `target/`，也不得重新生成 `apps/desktop/dist/`、`apps/desktop/web/`、`apps/desktop/release/`、`apps/desktop/native/`；
- 第三方工具内部出现名为 build/target 的概念不改变 XMA 的目录合同；能重定向的 XMA-controlled 输出必须重定向；
- 根 `.cargo/config.toml` 固定 `build.target-dir = ".cache/cargo-target"`；Tauri 脚本单独设置 `.cache/tauri-target`；
- Electron build orchestrator 先在 `.cache/desktop/electron/app` 生成最小打包 staging，再由 electron-builder 直接输出到 `dist/release/electron`，不再“先 apps/desktop/release 再复制”。

旧版本遗留的根 `target/` / `build/` 和 app-local Desktop 输出会由 `XMA-Sync.bat` 尝试清理；被进程占用时只警告，关闭进程后可手动删除。

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


## 当前 Agent / Skill Foundation 关键源码归属

- `core/src/agent/contract.ts`：AgentDefinition / Brain / Workspace / Memory / Delivery / Delegation Policy；
- `core/src/agent/registry.ts`：Agent Registry；
- `core/src/agent/delegation.ts`：AgentTask / delegation validation；
- `core/src/skill/contract.ts`：Skill metadata Contract；
- `core/src/skill/loader.ts`：`skill.json + SKILL.md` 安全加载；
- `core/src/skill/registry.ts`：Agent↔Skill 绑定校验与 model-visible Context Source；
- `agents/xiaoyu/`、`agents/code/`：当前真实内置 Agent；
- `skills/common/`、`skills/code/`：当前真实产品 Skills。

## 当前 Stage C / D 关键源码归属

- `core/src/session/contract.ts`：Session/Turn/Step durable fact Contract；
- `core/src/session/store.ts`：Memory / JSONL Session Store；
- `core/src/session/export.ts`：安全导出 / redaction / migration Contract；
- `core/src/tool/schema.ts`：模型 Tool arguments 的 TypeScript Schema 校验；
- `core/src/tool/policy.ts`：Permission Policy / Security Guard / Approval Contract；
- `core/src/tool/router.ts`：Tool Registry / frozen ToolPlan / ToolRouter；
- `core/src/native.ts`：TypeScript ↔ Rust Native Capability Bridge；
- `plugins/tools/native.ts`：Native FS/Process 的 Tool Definition Adapter；
- `native/protocol/`：稳定 JSON-RPC / Capability wire contract；
- `native/runtime/`：Rust path/process enforcement；
- `docs/security/NATIVE-CAPABILITIES.md`：当前安全能力与未完成边界。

### Naming Gate 扫描边界

`pnpm gate:naming` 只治理 XMA 自己维护的源码/配置；`node_modules/.cache/dist/build/target/release` 与 Tauri `src-tauri/gen` 等依赖、缓存、构建和生成目录必须被递归忽略。第三方文件命名不能反向污染 XMA 的 kebab-case / snake_case 规则。


## Distribution / Terminal 目录

```text
apps/cli/
├─ src/
│  ├─ main.ts          # xiaoyu 产品入口 / Runtime 接线
│  ├─ brain.ts         # Terminal Provider Profile / 非 Secret Credential Reference
│  └─ tui.ts           # 纯 Terminal Shell / Safe Prompt / Overlay 交互
└─ tests/

scripts/
├─ install/
│  ├─ windows.ps1      # 独立 Windows bootstrap
│  └─ unix.sh          # Linux/macOS bootstrap
└─ release/
   ├─ cli.ts           # portable staging
   └─ manifest.ts      # release manifest / checksum 元数据
```

发行中间态只允许进入 `.cache/release/`；用户可下载资产只允许进入 `dist/release/`。`xiaoyu` 是正式 CLI 主命令，`xma` 仅兼容旧入口。
