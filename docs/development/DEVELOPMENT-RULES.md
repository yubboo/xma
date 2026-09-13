# XMA 开发规则

## 1. 每次开发前

任何 AI / 开发者修改 XMA 前必须先读根 `AGENTS.md`，再按任务阅读架构、插件、版本、上游参考和 Windows Workflow 文档。

涉及 Agent Runtime / Provider / Tool / Plugin / Session / Workspace 的非机械改动，必须至少阅读：

- `docs/architecture/PROJECT-ARCHITECTURE.md`；
- `docs/architecture/AGENT-RUNTIME.md`；
- `docs/architecture/AGENT-PLATFORM.md`；
- `docs/architecture/MODEL-PROVIDER.md`；
- `docs/architecture/PLUGIN-SYSTEM.md`；
- `docs/development/UPSTREAM-REFERENCE.md`；
- `docs/development/DEVELOPMENT-PLAN.md`。

## 2. 语言所有权

- 产品、Agent、业务、Provider、Session、Context、Tool Registry、Plugin、Skill、Knowledge、Workspace、UI 主逻辑优先 TypeScript。
- Rust 只用于 Native/Security/Performance：PTY、Process、FS confinement、Sandbox、Capability、Native network、Hash/Archive、OS integration。
- 禁止把 Agent Loop、模型路由、Minecraft/Writer/Code 专业判断下沉 Rust。
- 不新增 Go Core。
- Python 只能作为可选插件/工具生态，不得成为 XMA Core 的基础运行依赖。

上游项目即使采用不同语言边界，也不能覆盖 XMA 规则。

## 3. 源码规则

- 所有核心 `.ts/.tsx/.rs` 文件顶部必须有中文文件说明，至少包含文件作用、关联模块、当前实现、职责边界。
- 安全判断、权限、协议、生命周期、兼容层和容易误解的逻辑必须有中文解释。
- 不给显而易见的赋值写无意义注释。
- TypeScript Core 保持 strict；新增 `any` 必须有明确理由。
- 不为了“架构漂亮”过度拆目录和 package。
- 同一个事实只保留一个权威文档；AI Skill/README 引用它，不复制一份长期规则。

### 3.1 文件/目录命名与拆分

开发时先确定“领域”，再决定文件名，不用文件名重复整条路径。

| 对象 | 固定形式 | 示例 |
|---|---|---|
| 产品目录 | 小写 `kebab-case` | `model-provider/`、`deepseek-harness/` |
| TypeScript / TSX | 小写 `kebab-case` | `agent/registry.ts`、`install-runtime.ts` |
| Rust 模块 | `snake_case` | `host_policy.rs`、`process_guard.rs` |
| 测试 | `*.test.ts` | `workspace-runtime.test.ts` |
| 配置代码 | `*.config.ts` | `desktop.config.ts` |
| 类型声明 | `*.d.ts` | `vite-env.d.ts` |
| 正式 docs 文档 | `UPPER-KEBAB.md` | `PROJECT-ARCHITECTURE.md` |
| 生态固定文件 | 保持官方名称 | `package.json`、`Cargo.toml`、`tauri.conf.json` |

额外规则：

- 普通名字优先 1～3 个核心词，尽量不超过 32 个字符；测试/config/d 等角色后缀不算普通词；
- `-` 用于普通英文词组合；`_` 只用于 Rust/Python 等语言自身约定；`.` 只用于角色后缀或生态固定文件；
- 父目录已经表达领域时去掉重复前缀：`tool/policy.ts` 优于 `tool/tool-policy.ts`；
- 同一逻辑的 types/constants/helpers 默认留在同一文件；只有不同职责、不同生命周期、不同安全边界或文件持续过大时再拆；
- 一个只有单个实现文件的普通领域不应为了“整齐”新建文件夹；通常至少出现约 3 个稳定同领域文件才分组；
- 已分组的 `agent/`、`skill/`、`session/`、`tool/`、Desktop `scripts/electron/` 和 `scripts/gates/` 不得退回重复长文件名；
- 改名必须同时修复 import、脚本、文档、Gate 和测试，禁止留下兼容别名文件制造两套命名；
- 完成前运行 `pnpm gate:naming`；该 Gate 不替代架构判断，不能因为 Gate 通过就继续过度拆文件。 Naming Gate 只检查 XMA 自己维护的源码/配置，必须递归忽略 `node_modules/.cache/dist/build/target/release` 等第三方依赖、缓存和生成产物；第三方包命名不受 XMA 命名规则约束。

## 4. Agent Runtime 硬规则

### 4.1 真实模型是推理核心

- 用户配置的 Provider Model 是当前 Run/Turn 的真实推理核心。
- 不得加入关键词路由、固定业务决策树、隐藏 Planner 或“低智商小鱼模型”替代正常模型推理。
- Skill 是操作指南，不是脚本化思考。
- 实时可查询事实必须优先走 Tool/API/Knowledge service，不能作为永久事实写死 Prompt。

### 4.2 Model-visible 必须可重建

任何进入模型请求的**动态**内容，都必须能从 Session durable state 或有明确来源的 Context source 重建。

禁止：

- UI state 偷偷影响模型但不记录；
- 插件直接篡改已提交历史；
- 用进程内隐藏数组承载关键 Context，resume 后消失；
- Compaction 暗中删除历史而没有 durable marker。

stream chunk / progress 可以是 live event，但最终结算必须形成 durable fact。

### 4.3 Turn / Step 结构

- Session 是持久事实源；
- Turn 是一次用户驱动工作单元；
- Step 是一次模型请求 + 其 Tool Call 处理；
- 一个 Turn 允许多 Step；
- cancellation / timeout 后消息结构仍必须合法可恢复。

### 4.4 主循环保持通用

能通过 Provider、Tool、Context contributor、Policy、Session projection、Plugin extension point 完成的功能，不得给 Agent Loop 塞专业业务特例。

`if (agentId === 'minecraft')`、`if (provider === 'claude')` 一类分支进入 Core Loop 前必须经过架构评审。

## 4.5 Agent / Skill Platform 规则

- `AgentDefinition` 只描述专业身份与能力组合，不保存 Session 瞬时状态，不绑定具体 Provider/Host。
- 主 `xiaoyu` 是 Manager Agent；专业 Agent 复用同一 Runtime。新增专业 Agent 前必须至少有真实 Skill/Tool/验收链，禁止空骨架。
- 产品级 Skill 固定放根 `skills/<domain>/<skill>/SKILL.md + skill.json`；`.agents/skills/` 只服务于开发 XMA 的 AI 编程工具，两者不得混用。
- Skill 是模型工作方法，不是程序能力；需要文件、进程、Browser/API 时必须声明并使用 Tool/Plugin。
- Agent 绑定 Skill 时，Skill 所需 Tool/Brain capability 必须由 Agent 显式声明，缺失时 fail loud。
- Agent/Skill model-visible 内容必须通过 Context Assembly 并形成 durable snapshot，不能在 Shell/UI 中临时拼 Prompt。
- Multi-Agent 委派使用稳定 `AgentTask` / Delegation Policy；后续 durable Task Store 也必须保留 requester/assigned Agent/Workspace/objective/result/verification。
- Codex、Claude Code、DeepSeek Harness、Zcode 等属于外部 Host；Host Adapter 不得污染 Core Agent 定义。

## 5. Provider 开发规则

- Provider 不能只实现 `stream()`；必须逐步拥有 capability、auth、model catalog、usage/error normalization 和 Brain Ready Probe。
- Provider-specific JSON/headers/auth 不得散落 Agent Loop。
- UI 不通过 model name 猜 capability；以 Provider/Model Descriptor 为准。
- Secret 通过 Credentials Service 获取，不进入 Session message、Workspace、普通日志、导出。
- “Brain Ready”必须有真实请求证据；fixture/mock 不能改变产品 Ready 状态。
- 新 Provider 必须跑同一套 Conformance Tests；没有真实 E2E 不得宣称产品支持完成。
- 同品牌不同 API 协议不能假定兼容；OpenAI-compatible 必须以真实协议/实测为依据。

## 6. Tool / Permission / Native 规则

### 6.1 Tool Definition

每个 Tool 必须有：

- 稳定 name/namespace；
- 清晰 description；
- JSON input schema；
- output contract；
- permission/capability requirement；
- cancellation semantics；
- parallel-safety；
- structured failure。

模型可见 Schema 与实际 Runtime 必须来自同一个 Step 的冻结 ToolPlan。

### 6.2 Tool Pipeline

固定思想：

```text
schema → policy/plugin interception → security guard → approval → execute → post-process/redact → durable result
```

安全 guard 的拒绝是单调的：后续普通插件不能把已经被安全层拒绝的调用重新变成允许。

需要 Approval 的真实副作用必须先形成最终 Approval 决策，并在执行副作用前把该决策 append 为 durable audit；不能“先写文件/跑命令，成功以后再补一条批准记录”。`allow-session` 只有 Tool 明确提供稳定 approval scope key 时才可复用；未声明 scope key 时必须按单调用 fail-safe，不能默认把一次参数授权扩成整个 Tool 授权。

普通工具失败形成结构化 Tool Result 回模型，不得因为“文件不存在/命令失败/API 404”直接炸毁整个 Session。

### 6.3 并发

只有工具明确声明 parallel-safe 才并行。Write/Execute/Network 默认按顺序执行或成为 barrier，除非工具能证明并发语义安全。

### 6.4 Native

TypeScript Tool 只请求 Native Capability；Rust 必须独立验证 path/process/network 限制，不能盲信 TypeScript 已验证。Native capability 默认应最小化并短生命周期；Native Runtime 必须先锁定 Host Policy，Tool lease 只能申请其子集。当前文件/进程第一版使用一次性 lease，真实文件路径必须在 Rust 侧 canonicalize 后再做 root containment。进程执行不得用 `shell:true` 替代受限 argv 执行。

## 7. Plugin 规则

- XMA Native Plugin 和 DSH compatible plugin 都由同一 Plugin Host 生命周期管理。
- 注册行为必须可逆；Tool/Provider/Service/Event/timer/watcher 都需要 disposer。
- mount 失败要能回滚；unmount/reload 不留幽灵注册。
- 插件不能绕过 Workspace/Permission/Capability 直接执行危险副作用。
- 新能力优先走 extension point，不随意修改 Agent Loop。
- 一个完整 Capability 至少考虑 Definition / Provider / Consumer 三个角色。
- DSH compatibility 只能按 Conformance Tests 声明等级，禁止“看起来能跑”就写完全兼容。

## 8. Session / Workspace / Context 规则

- Session append 是关键事实的主来源；Store 必须支持 crash/recovery 的演进设计。
- 同一个 Session 同时只允许一个写所有者，除非 Store 明确定义并发协调。
- Workspace 是 stable identity + roots + owner + binding digest，不是裸 cwd。
- Stage D 新 Workspace Session 默认只能绑定 Owner Agent 自己的 Workspace；Product Host 可启用 `requireWorkspace` 禁止 workspace-less Session。
- Workspace-bound Session resume 必须验证安全 Descriptor identity；owner/root/allowed roots 漂移时 fail loud，未来 relocation 必须走显式 rebind/migration。
- 跨 Agent Workspace 默认 deny；只有用户显式 durable grant 才允许对应 `read/write/execute` permission，且必须可 revoke。
- Tool 的 Workspace access 必须在 Approval/execute 前经过单调 Workspace Security Guard；跨 Workspace grant 真正使用时要先 durable audit。
- Context Source 若读取其他 Workspace，必须在 render 前检查 `read` grant，并在 durable Context Snapshot source 中保留 workspaceId。
- Native Tool 必须绑定稳定 Workspace identity；TypeScript Workspace policy 不能替代 Rust Host Policy/Capability/canonical confinement，反之亦然。
- instructions/Skill/Knowledge 注入必须有来源、作用域和大小预算。
- 大 Tool 输出应落盘/附件化，模型只拿必要部分，避免无限撑爆 Context。

## 9. UI / Desktop 规则

CLI、Desktop、Web、Server 是同一个 Core 的 Shell，禁止复制 Agent Runtime。

当前 0.1.x **底层优先**：在 Agent Runtime、真实 Provider、Tool/Permission、Workspace、App Protocol 没达到计划出口前，不继续大规模堆 Desktop UI。

后续 Desktop Workbench 目标由 `DESKTOP-WORKBENCH.md` 约束：三栏布局、左开右闭、中央 Workspace、底部 Terminal、可吸附拉伸。但 UI 必须建立在 App Protocol/Event Stream 上，不能反向把业务塞进 renderer。

Electron renderer 禁止直接获得任意 filesystem/shell/Native 权限。

## 10. 上游参考规则

XMA 参考 Codex、DeepSeek Harness、Minecraft Host Agent，但不得“看哪个像就抄哪个”。

重要子系统开发前必须：

1. 使用 `UPSTREAM-REFERENCE.md` 固定的 commit 或显式升级；
2. 审阅对应上游子系统目录的全部相关源码/README/测试；
3. 记录吸收的 Contract 和拒绝的设计；
4. 重新经过 XMA TypeScript/Rust、Workspace、安全、Plugin 边界；
5. 如复制/改编实质代码，单独处理许可证/NOTICE/版权标注。

禁止把 Codex 的 Rust 产品业务、MCHA 的 Rust Agent Loop 或 DSH 的包粒度机械搬进 XMA。

## 11. AI 开发上下文规则

- `AGENTS.md` 是最高事实源。
- `.agents/skills/` 是 XMA 公共 AI 开发 Skill 的单一事实源。
- `.codex/` 和 `.claude/` 是工具适配入口，不得覆盖 `AGENTS.md`。
- `CLAUDE.md` 只能作为 Claude 入口和导航，不维护另一套架构规则。
- Windows-first 项目不依赖 symlink；公共 Skill 镜像由 Gate 检查一致性。
- AI 目录禁止提交 Secret、个人机器路径、用户会话、私有 Prompt、Workspace 内容。
- AI Agent 在修改项目前也必须遵守版本、Windows、GitHub Safety 和 Gate 规则，不能以“自动化工具”身份绕过。

## 12. 完成标准

“代码存在”不等于“能力完成”。必须按对应层给证据：

- Contract → typecheck/unit；
- lifecycle → integration；
- Provider → real API E2E；
- Tool/Native → target OS/runner；
- compatibility → conformance；
- UI → real packaged app；
- release → package/hash + Windows workflow。

CI 绿也不等于产品完成；没有真实 Provider/Tool/Native/Workspace/E2E 证据的能力只能标记骨架/实验。

## 13. Windows PowerShell 外部命令统一规则

- `scripts/windows/xma-common.ps1` 是 Windows 外部命令执行的唯一公共入口。
- `xma-prepare.ps1`、`xma-github.ps1`、`xma-console.ps1`、`xma-build-release.ps1` 必须复用 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`。
- 禁止自行定义 `Run(..., $Args)`、`Invoke-External(..., $Args)` 或任何 `$Args/@Args` 参数转发；PowerShell `$args` 是自动变量且大小写不敏感。
- 新增 Git、pnpm、cargo、rustup、winget 等外部命令时必须用命名参数 `-FilePath` 与 `-ArgumentList`。
- PowerShell 5.1 读取 UTF-8 JSON/中文文本时必须显式 `-Encoding UTF8`。

## 14. pnpm / Windows 项目依赖准备规则

- `XMA.bat -> [1] 一键准备开发环境` 是首次运行唯一推荐入口，一次准备系统工具、Workspace JS metadata、esbuild Native Binary 与 XMA Native Rust crates。
- `[1]` 使用 `pnpm install --ignore-scripts`，不得触发 Electron Chromium Runtime。
- Web / CLI 已准备后直接运行，不再次安装依赖。
- Desktop 只有用户明确选择 Electron/Tauri 时准备对应 Runtime。
- `electron` 不进入 `allowBuilds`；`pnpm-workspace.yaml -> allowBuilds` 只显式白名单确有构建需求的依赖。
- 禁止 `dangerouslyAllowAllBuilds` 和固定工作流中的交互 `pnpm approve-builds`。
- `esbuild` 是内部依赖；禁止以根 `pnpm exec esbuild` 是否存在作为通用验证。
- `[7] 全量检查` 不下载依赖；缺失时提示先跑 `[1]`，Rust check/test 使用 offline。
- 构建发布复用 `[1]` 的 Workspace，不重复 `pnpm install`；只允许补齐用户明确选择的 Desktop Runtime/构建依赖。

## 15. Electron 41.2.0 固定规则

- Electron 精确锁定 `41.2.0`，只在 `apps/desktop/`；Tauri 2 为备用。
- `[1]` 可准备 Electron JS package metadata，但不执行 Electron postinstall。
- Chromium Runtime 由 `apps/desktop/scripts/electron/install-runtime.ts` 显式按需下载，禁止 `pnpm rebuild electron`。
- 默认缓存根在 XMA `.cache/electron/`，不占用户 C 盘默认缓存；用户显式 `electron_config_cache` 可覆盖。
- Windows 下载 ZIP 后用系统 PowerShell `Expand-Archive` → staging → `dist/version + executable` 校验 → 原子替换 → `path.txt`。
- Runtime 完整性不使用 GUI `electron.exe --version` + `$LASTEXITCODE` 判定。
- `@electron/get.downloadArtifact` 必须先收窄确定函数类型再跨 async closure。
- `pnpm-workspace.yaml -> overrides.yauzl >= 3.3.1` 保护非 Windows/Electron Builder ZIP 链。

## 16. GitHub 推送职责边界

### XMA-GitHub 是纯 Git 工具

`XMA-GitHub.bat` / `xma-github.ps1` 只允许 Git 初始化/状态、安全扫描、远端同步、暂存、提交、Push。

严禁在 GitHub Helper 中调用：

- `xma-prepare.ps1`；
- `pnpm install/rebuild`；
- `cargo fetch`；
- Electron/Tauri 准备；
- winget 或任何环境安装。

Git 不存在时只能提示用户先运行 `XMA.bat → [1]`。

### 仓库内容

应提交：源码、文档、测试、AI 开发上下文、脚本、配置模板、CI、`pnpm-lock.yaml`、`Cargo.lock`。

禁止提交：`node_modules/`、`.cache/`、`target/`、`dist/`、`build/`、根 `runtime/`、`.xma/`、用户 Workspace、覆盖率、缓存、日志、`.env`、Secret、安装包、发布归档。XMA-controlled 中间产物必须统一进入 `.cache/`，正式构建产物必须统一进入 `dist/`；根 `build/target` 与 app-local Desktop 输出只作为旧版遗留/防误提交路径处理。

`.gitignore` 是第一层，GitHub Safety 是第二层。Safety 必须扫描 Git 真正可能提交的文件，不能把已忽略二进制缓存误判 Secret。

> 根 `/runtime/` 是用户运行数据；`native/runtime/` 是 XMA Rust 源码。任何规则都不得混淆。

## 17. 版本与交付

版本与包名遵守 `VERSIONING-AND-RELEASES.md`：未冻结 0.1.0 的修正仍重新生成 `xma-0.1.0.zip` 和 `xma-0.1.0.sha256.txt`；禁止 fixed/hotfix/final/v2/new 后缀。


## Distribution 与终端入口

- 正式终端命令使用 `xiaoyu`；`xma` 只做兼容 alias。
- Terminal/Desktop/Web/Server 只做 Host，不得复制 Core Agent Runtime。
- 普通用户 installer 只安装预构建资产，不得 clone 源码或运行 pnpm/cargo/MSVC。
- Windows 使用 `%LOCALAPPDATA%\Programs\Xiaoyu` + User PATH；Unix 使用 `~/.local/share/xiaoyu` + `~/.local/bin`。
- 安装资产必须 HTTPS + SHA-256 + staging 验证后再替换正式目录；开发缓存、源码、`node_modules` 不得进入用户包。
- Home/根目录属于高风险 Workspace，Terminal 必须默认拒绝并要求“仅本次信任”。
- 当前第一批 portable bundle 内置 Node Runtime；Node SEA 只作为未来优化，不得先于安装/升级/回滚合同。
