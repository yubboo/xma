# XMA 0.1.0 项目状态

## 1. 当前定位

0.1.0 是**可测试的平台骨架 + Agent/Skill Foundation + Windows/Desktop 工程通路验证版本**，不是已经具备完整 Agent 产品能力的正式版。

本轮开发优先级已经明确调整为：**底层 Agent Runtime 与真实 Model Provider 优先，复杂 Desktop UI 后置。** 当前 Desktop 只要求能启动、能打包、能验证 Shell/Runtime 通路；完整 Codex 风格三栏 Workbench 作为后续目标记录在 `docs/architecture/DESKTOP-WORKBENCH.md`。

## 1.1 2026-09-13 Agent Platform Architecture Pivot（已批准）

项目正式从“在单体 `core/` 内继续自研完整 Agent 基础设施”换轨为 **Upstream-first + `xma-*` package family + Everything is a Plugin**。这次换轨不否定现有 0.1.0 Runtime/Provider/Tool/Workspace 成果，它们是迁移基线；但后续不再盲目扩建简化版 Harness。

新的长期主线：`xma-ai + xma-agent-loop`（Pi 第一参考）→ `xma-plugin` / DSH compatibility → `xma-tools` + Process/Shell → Session/Context/Memory（DSH + MiMo）→ Task/Subagent/Workflow → Browser/Computer/Artifact。Model Intelligence Preservation 同时生效：强模型保留任务判断权，Skill 用于增强知识与方法，不替模型写死思考流程。CLI/TUI、Desktop、Web、Server 只允许作为同一 Runtime 的不同 Host；权限采用统一 `ask / smart / full` Profile，用户控制副作用，批准后 Agent 必须在同一 Turn 自动继续。

Platform Skeleton v1 已进入源码：`xma-ai / xma-agent-loop / xma-plugin / xma-tools / xma-session / xma-context / xma-native` 成为稳定 workspace package，DeepSeek / Native Tools / DSH compatibility 按插件本体聚合，`core/` 已收缩为 Compatibility Facade。**这只完成 ownership/目录/稳定入口迁移，尚未开始 Pi Agent Loop 的行为级吸收或大规模 Runtime 语义重写。** 正式战略见 `docs/architecture/AGENT-ENGINE-STRATEGY.md`，快速定位见根 `CODEMAP.md`，实时工程变更见 `docs/development/UPDATE-LOG.md`。

Platform Skeleton v1 当前已完成本地收口验证：平台源码 targeted strict typecheck 通过；57 个可离线执行测试通过；9 项静态 Gate 通过。当前 Terminal 表现层已进入 OpenTUI 迁移批次；Windows/Unix `[7] 全量检查` 已把 Bun/OpenTUI CLI 的真实编译与 `--version` / `--help` 烟测纳入强制步骤。沙箱仍不能替代用户 Windows Terminal / IME / Native Renderer 实机验证，完整 `pnpm check`、Cargo 与用户机器 `[7] 全量检查` 仍是最终权威。

## 2. 已实现的骨架证据

- XMA Core 正式 `Session → Turn → Step` Runtime 第一版；
- Durable Session Event / Live Runtime Event 分层；
- Memory Session Store + JSONL Session Store；
- JSONL create/open/append/flush/close/list/stat + 单写者锁；
- Session resume 与末尾截断 JSONL 恢复；
- 多 Step `model → tool → observation → same model` Runtime；
- Tool Call 取消结算，保证 durable 历史结构合法；
- 每 Step 冻结 Provider / Tool Schema 请求快照；
- Context Source Registry + 确定性组装 + 字符硬上限 + durable Context Snapshot/digest；
- 历史 Step 的 message/tool/context 请求输入重建；
- Session export + Secret value redaction + 相邻单向 migration Contract；
- Provider Registry / Profile / Credentials Resolver / OS Credentials Store bridge / Capabilities / Model Catalog / Error taxonomy；Profile/ModelIdentity 已区分真实 `providerId`、Profile 与协议 `adapterId`；
- OpenAI-compatible Chat Completions HTTP/SSE Adapter 第一版（协议测试，不等于外部厂商 Ready）；
- Brain Ready Probe 已升级：目标 catalog/model 校验 + 真实 text request；声明 native tool calling 时还要求最小 Tool Call → Tool Result → 同模型继续响应 round trip；DeepSeek 当前 named/`required` tool choice 与 thinking 不兼容，因此确定性 Tool 子探针只在探针请求中关闭 thinking，实际 Agent Turn 仍使用 thinking 与用户选择的 reasoning effort；真实 thinking + tools 所需 `reasoning_content` 通过 opaque provider continuation 持久续传，redacted export 会移除；
- Model Provider 最小 Contract；
- Tool Definition / deterministic frozen ToolPlan / ToolRouter；
- JSON Schema validation → Policy → monotonic Security Guard → Approval → Execute/Finalize Tool Pipeline；
- allow-once / allow-session / deny 与 durable `tool/approval` 审计；
- parallel-safe batch + exclusive barrier；
- TypeScript Native Capability Bridge + `native.fs.read_text` / `native.fs.write_text` / `native.process.run` Tool Adapter；
- Rust Host Policy（roots/绝对 executable identities/resource limits）+ filesystem canonical confinement + 一次性 Capability lease + 无 shell process allowlist/timeout/output cap；
- Workspace Registry + stable Descriptor/Binding digest；
- Workspace-bound Session Owner 校验 + resume descriptor drift fail-loud；
- durable cross-workspace grant/revoke/use + Workspace Tool Security Guard；
- Workspace-scoped Context Source read authorization + Native Tool stable workspaceId；
- Plugin Host；
- `ctx.<service>` Service Proxy；
- `inject + apply(ctx)` DeepSeek Harness/Cordis 基础适配；
- effect/disposer；
- emit/parallel/serial/bail/waterfall 基础事件语义；
- Rust stdio JSON-RPC Runtime 骨架；
- Agent Platform Foundation：正式 `AgentDefinition`、Agent Registry、manager/specialist、Brain/Skill/Tool/Workspace/Memory/Delivery/Delegation Policy；
- Skill Platform Foundation：`skill.json + SKILL.md` Loader/Registry、Agent↔Skill requirements 校验、`agent/skills` model-visible Context Source；
- Terminal 的 `Xiaoyu Code` 已把首批 canonical Skills 接入正式 Context Assembly；portable bundle 随包复制 `skills/` 并由 `XIAOYU_SKILLS_HOME` 定位；
- 当前内置真实 Agent 只保留 `Xiaoyu Manager` 与 `Xiaoyu Code`，不再提前创建 Writer/Minecraft 空骨架；
- 首批产品 Skills：`common/task-planning`、`common/verification`、`code/bug-fixing`、`code/testing`；
- Agent Task delegation Contract：Manager 可创建经过 Registry/Policy 校验的 specialist Task，普通 specialist 默认 deny；
- `xiaoyu` 持续 Terminal TUI + Web / Desktop / Server Shell；
- Windows 环境/同步/GitHub/构建脚本；
- Windows Terminal Native 启动使用独立 Cargo target + 唯一 staging exe，避免旧 Xiaoyu 进程锁定编译目标；GitHub 助手拒绝在正式源码包目录初始化第二个仓库；
- portable Terminal staging（内置 Node + CLI/Server/Web + Native）与 Windows/Unix bootstrap installer 第一版；
- `xiaoyu` canonical command、`xma` compatibility alias、Home/root Workspace 风险确认；Brain 已升级为多 Profile 的真实 Provider Catalog：首个品牌入口是 DeepSeek Official，自定义 OpenAI-compatible 继续保留；`brain.json` v3 保存品牌/Profile/Adapter/Base URL/Model/Credential Reference，OS Credentials 为默认 Secret 路径，v1/v2 legacy 配置继续显式迁移；
- Terminal 已增加 `/model` 与真实模型目录选择；DeepSeek 品牌配置按 API Key → 真实模型 → 推理强度 → 已就绪 顺序完成，reasoning effort 支持 Default/high/max 并持久化为 Profile option；Prompt Dock 显示 Mode + Provider/Model + Reasoning，Tab/Shift+Tab 在 Build/Plan/Compose(legacy) 间切换，其中 Plan 只暴露只读工具、Compose 不暴露 Workspace 工具；DeepSeek 保留 thinking+tools 的协议续传状态；
- #07 补充已进入源码：Build/Plan/Compose 现在通过 Context Assembly 让用户配置的真实模型知道当前 Work Mode；Plan ToolPlan 增加纯 control `xma.plan.ready`，只有模型显式声明计划 ready 后才询问用户 Yes/No。Yes 才 durable 记录并切 Build 执行 retained Plan；No 保留计划不执行。`ask` Tool Approval 产品 UI同样收口为显式 Yes/No。当前等待 Windows 实机验收后关闭 #07。
- #08 已进入源码：OpenTUI Ctrl+C 路由优先读取真实文本 Selection；有选区复制，busy 中止 Turn，modal 取消/deny，idle 单次只提示、二次才退出。当前等待 Windows Terminal 鼠标选择 + Ctrl+C clipboard E2E。
- Terminal Active Renderer 已迁移为根 pnpm Workspace 管理的 `Bun + OpenTUI + Solid`；Runtime 依赖统一位于根 `package.json/node_modules`，`apps/cli/opentui-runtime` 只保留源码；`[1]` 只安装当前 Workspace 依赖，`[8]` 才刷新 registry latest，并由 lockfile 固化解析版本：主 Prompt 使用 OpenTUI 原生 Textarea，命令/Provider Dialog 使用同一 Renderer/focus/key event，Home/Transcript/Prompt/快捷栏使用 Flexbox 响应式布局；focused Textarea 原生拥有 terminal cursor/IME，动画帧通过 editor requestRender 把 caret 稳定锚定在输入位置；旧 Pi TUI 仅暂留 Workspace Trust 与纯回归兼容，不再承担主工作台。
- Terminal Runtime live projection 继续复用既有 Agent Runtime：真实 Provider text/reasoning delta、Tool Call、Tool Result 进入同一事件面；OpenTUI 默认将原始 reasoning delta 折叠为“正在思考”状态，首个 text delta 到达后直接切换为最终回答流式输出，不把原始思维正文铺进 Transcript；OpenTUI 仅负责 live projection 的显示，不复制 Provider/Agent Loop。
- Terminal 第一批 Rust-backed 文件 ToolSet：`native.fs.read_text/write_text`，写入通过 TUI deny/allow-once/allow-session Approval；process Tool 默认不注册；
- Architecture / Naming / Comment / Documentation / Version / Windows / Repository Gates；
- 项目命名/模块粒度规则已锁定：TS/目录 kebab-case、Rust snake_case、语义点号、1～3 核心词、父目录去重；Session/Tool/Electron/Gate 已按规则完成分组重构；
- Electron 41.2.0 Runtime 的显式下载、校验、Windows staging 原子安装链；
- Desktop 发布资源使用相对 Vite base，解决 `file://` 黑屏；
- 仓库级 `.agents/.codex/.claude` AI 开发上下文规范和上游参考基线文档。

## 3. 当前架构已确定但尚未完成的底层

以下条目是现有 0.1.x 基线仍需补齐的能力；Platform Skeleton 已把主要 ownership 迁到 `xma-*` packages，后续在这些稳定边界内继续实现，不再回流到单体 `core/`：

- Session Store generation migration / fork（export/redaction/纯 migration Contract 已有第一版）；
- system-message reconciliation / compaction（Context Assembly/durable snapshot 已有第一版）；
- OS Keychain/安全 Credential Store（env/memory resolver 已有第一版）；
- Provider 通用 Retry / Cost Catalog / App Protocol 配置面；Terminal 已有第一版 Provider Profile/模型选择/可选 Brain Ready Probe；活动模型已保存且凭据可读取时 UI 直接显示“模型已就绪”，连接测试不再是就绪前置条件；Desktop/Web/App Protocol 配置面仍未完成；
- 外部真实 Provider E2E 与 Product Ready 证据；
- 至少两个不同协议族真实 Provider；
- App Protocol Approval request/decision 与多 Host 交互；
- Rust process-tree ownership / cancellation、PTY/ConPTY、network/hash/archive capability；
- process executable 已完成“绝对路径 + canonical identity + 不经 PATH”第一版；仍缺可执行文件内容/句柄级 TOCTOU identity hardening；
- Workspace persistence / repo metadata / instructions / explicit rebind migration（ownership/grant 第一版已落地）；
- App Protocol / Event Stream；
- Xiaoyu Manager durable Task Store / Scheduler / result verification；
- Host Contract/Adapter 与 Codex/Claude Code/DeepSeek Harness/Zcode capability negotiation/conformance；
- 用户级 Agent/Skill 安装、签名/来源/版本管理；
- DSH Tool/LLM/Session/Skill bridge 与 Conformance Tests。

## 4. 尚未完成，禁止过度宣称

- DeepSeek Official **外部真实 Product Ready 证据**；品牌 Catalog/官方 endpoint/真实 catalog/Probe 代码已经进入仓库，但尚未在用户 Windows 上用真实 DeepSeek 凭据完成重启 E2E，因此不得写“DeepSeek 已验收完成”；
- 真实 OpenAI/Claude/Gemini/MiMo 等其他**品牌 Provider 产品支持**；未实现的品牌当前不会出现在可用 Catalog 中；
- 真实外部 Profile 的 Brain Ready **验收证据**；Terminal 已可通过 OS Credentials/env 引用执行真实 Probe，但当前仓库仍只有本地协议测试，不能冒充外部厂商 E2E 已通过；
- OS Credentials 三平台**实机验收证据**；Windows Credential Manager、macOS Keychain、Linux Secret Service bridge 已进入代码，但当前沙箱没有对应 Rust/系统后端实机验证条件；
- 完整 Session/Memory/Context；
- 完整 Rust Workspace Sandbox：process tree / PTY / network / executable content identity；（FS 与 absolute-path direct process 最小 capability 已有第一版）
- DeepSeek Harness 所有 Service 的 package-level 完整兼容；
- Xiaoyu Manager 真正多 Agent 调度闭环；
- Xiaoyu Code 真实 coding 闭环；
- Minecraft / Writer / GameDev / Art 等未来专业 Agent 产品闭环；
- 完整三栏 Desktop Workbench；
- Desktop 安装包跨平台实装验证。

**文档中有目标架构，不代表代码已经具备这些能力。**

## 5. 上游参考状态

XMA 当前固定五条参考线：

- Pi：Agent Loop / streaming / Tool execution / multi-provider AI；
- DeepSeek Harness：Everything is a Plugin / Cordis / Session / Tool / Agent capability seam；
- OpenAI Codex：Approval / Sandbox / Process / Thread-Turn / multi-agent / App Protocol；
- MiMo Code：Context / Memory / Checkpoint / Task / Subagent / Workflow / Skill discovery；
- Minecraft Host Agent：Minecraft Agent-First / server-setup Skill / Knowledge / Tool vertical / mod / 樱花frp / E2E。

固定 commit、许可证、路径映射和吸收/拒绝项见 `docs/development/UPSTREAM-REFERENCE.md`。后续重要子系统必须按 Upstream-first 规则读真实源码、tests、protocol、failure handling；不能只靠 README 或概括记忆。

## 6. Desktop Runtime

- 主：Electron 41.2.0（精确锁定，运行/构建时惰性下载 Runtime）；
- 副：Tauri 2（系统 WebView2，备用桌面运行时）；
- 两者共享 `apps/web` 与 Core，不复制 Agent Runtime；
- Electron ZIP 默认缓存到项目 `.cache/electron`；
- XMA-controlled 中间产物统一进入 `.cache/`：Cargo 使用 `.cache/cargo-target`、Tauri Rust 使用 `.cache/tauri-target`、Desktop staging 使用 `.cache/desktop`；`dist/` 是唯一正式产品构建/发布入口，根 `build/target` 与 app-local Desktop 输出不再作为正常目录；
- Windows 使用 `@electron/get` 校验下载 → PowerShell `Expand-Archive` staging → version/executable 校验 → 原子替换 → `path.txt`；
- `pnpm-workspace.yaml` 固定 `yauzl >= 3.3.1` override；
- Electron 原子安装核心有离线测试；
- 发布包 Web UI 使用 `--base ./`，避免 `file://` 绝对 `/assets` 黑屏。

当前用户 Windows 已证明 Setup 能安装、Electron 能启动；但完整 Workbench 仍未实现，因此不得把“能安装启动”写成“Desktop 产品完成”。

## 5.1 统一 Session Runtime Metrics（#05）

- 状态：**验证中**。Host-neutral `SessionRuntimeMetrics`、Provider Telemetry Registry、App Protocol `session/metrics` 与 Terminal `SessionStatusBar` 已进入代码。
- 已有真实语义：当前 Provider/Model、Turn/Request、会话/本轮 tokens、cache、latency、context、API cost/余额、subscription quota、permission、compaction unavailable。未知字段显示 `—`。
- API/subscription/unknown、多模型历史归属、DeepSeek balance 本地 HTTP mock 已有自动测试；DeepSeek 外部真实余额/费用仍需用户真实 API E2E 才能作为 Product Ready 证据。
- Desktop/Web 尚未做 UI，但后续必须直接消费同一 `session/metrics` Contract，禁止复制统计逻辑。
- #05 完整 Gate / Manifest / Windows 状态栏实机验收完成后标记已完成。

## 6.1 当前阻断性修复状态（2026-09-16）
- `REPAIR-PROMPTS #09` 当前**验证中**：Terminal Turn Activity 已升级为真实 `已处理 N + Xiaoyu · 正在思考` / 完成态 `用时 N`，展开区只显示公开阶段与脱敏 Tool 活动，不展示 hidden reasoning；Windows `[10]` 已升级为正确 clone 原地 fetch/prune + ahead/behind 核验 + 安全同步/带恢复备份的强制恢复。35/35 Activity 定向回归、Runtime updater 2/2 与 9 项 Gate 已通过；Source Manifest 242 files/成品 243 entries 已做独立解压一致性复核，仍待 Windows Terminal 点击展开和 PowerShell 5.1 Git 同步实机验收。
- `REPAIR-PROMPTS #08` 当前**验证中**：Ctrl+C 已改为真实 Selection 复制优先，其次 busy Abort、modal cancel、idle 二次确认退出；等待 Windows Terminal 真实鼠标选择 + Clipboard E2E。
- `REPAIR-PROMPTS #07` 当前**验证中**：已把 Work Mode 与三档 Permission Profile 分离并接入真实 Tool Policy；Plan 保持只读上限；Context 小比例/used-window、DeepSeek 官方余额可见性与 V4 Pro 当前路由计费已修正。等待 Windows 权限切换、Plan+full、真实余额与 context 实机验收。
- `REPAIR-PROMPTS #06` 已通过用户实机核心路径并标记**已完成**：模型配置 SecretInput 在模块拆分后调用 `usePaste` 但未在 `dialogs.tsx` 导入，触发 `ReferenceError`；已修正 hook/helper ownership，并用 Dialog ErrorBoundary + Promise settlement 防止单个弹窗异常拖死整个 TUI。等待 Windows 实机完成首次配置、Ctrl+P 重配、API Key 粘贴与失败后继续操作验收。

- `REPAIR-PROMPTS #01` 仍处于**验证中**：用户 Windows 实机已确认稳定 User PATH 生效（任意目录 `xiaoyu/xma` 可启动）、Textarea caret 稳定、Prompt 可持续多轮聊天、历史鼠标滚轮与离底后 sticky follow 均已通过；#01 仅保留 `[4]` 二次启动耗时的独立验收项。
- Transcript 使用单一受限高度 ScrollBox + 正向 spacer 处理短对话贴底；长内容不再使用 `justifyContent:flex-end`/负向 overflow。用户手动离底后的 sticky 行为继续交给 OpenTUI 原生 ScrollBox。
- Prompt Textarea 恢复原生 cursor blink ownership；背景/Logo 动画不再通过父级状态或回调触发 Prompt 重绘。
- Windows `[4]` 开发启动改为项目 Bun 直接执行 CLI 源码，Native Runtime 先 fingerprint 快路径，cache miss 才验证 Cargo/build；`[1]` 使用固定 `%LOCALAPPDATA%\Xiaoyu\dev-bin` User PATH 入口。
- 自动证据：OpenTUI 29/29 回归通过，9 项 Gate 通过，TS/TSX 语法转译通过；Source Manifest 已扩展为 225 个受管源码文件，成品候选 ZIP 独立解压后缺失/哈希差异/额外文件均为 0，并从解压树再次跑过 29 个回归与 9 项 Gate。**Windows Terminal 鼠标滚轮与 caret 已由用户实机确认通过；当前只剩 `[4]` 二次启动耗时的独立实机验收，因此 #01 暂不标“已完成”。**
- `REPAIR-PROMPTS #02` 已由用户 Windows 实机验收为**已完成**：#01 模块拆分后 `PromptDock` 以 Fragment 把输入区/快捷键/提示散成父级兄弟，实机中 Transcript ScrollBox 抢占主工作区并把 Prompt 挤出 viewport；现已把 Prompt 收口为单一 `flexShrink=0` Dock 原子，父工作区显式 `overflow=hidden`，Transcript 只消费剩余高度。

- `REPAIR-PROMPTS #03` 已由用户 Windows 实机验收为**已完成**：#02 后 PromptDock 虽已成为单根 `flexShrink=0`，Windows 实机仍出现会话态 Prompt 整块被 Transcript 挤出、wheel 无法移动历史。当前根因收敛为 ScrollBox 仍直接参与父级 intrinsic sizing；#03 改为“bounded Transcript slot（height=0/flexBasis=0）+ ScrollBox height=100%”，并新增 OpenTUI Core 行为测试锁定 Prompt 屏内、真实 scroll range 与 mouse wheel 位移。
- #02 同时修复 direct-Bun `[4]` 的 Workspace 参数回归：主菜单未显式传 `WorkspacePath` 时现在显式使用项目 `$Root`；全局 `xiaoyu/xma` 仍使用调用者当前目录。

- `REPAIR-PROMPTS #04` 已识别为 Windows 环境行为：截图中真实 caret 上下的蓝色水滴是 Windows“文本光标指示器”辅助功能，不是 XMA 第二套 cursor。XMA 保持 OpenTUI 原生 caret，不静默修改系统辅助功能；若用户不希望显示，可在 Windows“设置 → 辅助功能 → 文本光标”关闭/调整。
- `[4]` 二次启动耗时验收完成后即可结束 #01 并恢复 Stage P1 Agent Engine 主线；后续若出现新的真实症状，继续按新的 Repair 编号留证据，不再直接往 `app.tsx` 叠补丁。

## 7. 下一开发批次

Platform Skeleton v1 已进入代码，后续开发不再优先修 TUI 外观；Terminal 只修阻断性输入/白屏/崩溃问题。当前顺序锁定为：

1. **Pi Agent Engine 行为研究与 `xma-agent-loop` 吸收**：按固定 Pi commit 审阅真实 Agent Loop / streaming / tool execution / steering / follow-up / parallel execution 源码与测试；优先形成 Host-neutral Runtime/Event Contract，使 Terminal/Desktop/Web/Server 消费同一生命周期；保持真实模型自主选 Tool/自纠，不用 Harness Planner 替模型思考，并把 Permission/Approval 作为可挂起续跑的统一 Runtime 语义；
2. **`xma-ai` Provider seam 收敛 + DeepSeek Official 真实 E2E**：保留当前品牌/Profile/OS Credential/真实 catalog 与 Probe，先在用户 Windows 上形成 API Key → Credential Manager → 重启 → 动态 model catalog → text/tool round trip → 实际 Agent Turn 证据；
3. **`xma-plugin` + DSH compatibility**：补 Service/Event/Effect/lifecycle transaction 与 conformance，不把 DSH 私有实现硬塞进 Core；
4. **完整 Tool Surface / Process/Shell/Git**：把 Rust `process.spawn` 的安全能力接到真实 coding 工作面，完成 executable registry、Approval、取消/进程树等；
5. **Session / Context / Memory**：在现有 `xma-session/xma-context` 上吸收 DSH/MiMo 的 compaction、reconstruction、checkpoint/memory 思路；
6. **Task / Subagent / Workflow**：先建立 durable Task/Delegation/verification，再增加并行 specialist 与 deterministic workflow；
7. **Xiaoyu Code 真闭环**：读规则 → 查代码 → 修改 → 运行测试 → 观察失败 → 再修 → Git diff/验证证据；
8. **Browser / Computer / Artifact + Host Compatibility**：在通用 Agent Engine/Tool/Session 稳定后扩展；
9. Code Agent 证明平台后，再增加 Minecraft/Writer/GameDev/Art 等真实专业 Agent；Minecraft 第一参考固定为 MCHA，不提前创建空目录。

完整 Workbench UI 仍后置；现有 UI 参考继续由 `DESKTOP-WORKBENCH.md` 保存。

详细分阶段出口见 `DEVELOPMENT-PLAN.md`。

- Terminal 启动合同已固定为两层：每次 `xiaoyu / xma` 都先对调用者当前目录显示 Workspace Trust；通过后仅在没有已配置 Profile 时，在同一 Xiaoyu TUI 中央打开 Brain Setup。已有 Profile 跳过第二步，Ctrl+P 长期管理不变。Windows 开发环境 `[1]` 会把稳定 `%LOCALAPPDATA%\Xiaoyu\dev-bin` 注册到 User PATH，并通过 UTF-8 `source-root.txt` 指向当前激活 checkout；Source Sync 切换 checkout 时只更新该指针，便于在任意 Workspace 直接运行开发态 `xiaoyu / xma`。
