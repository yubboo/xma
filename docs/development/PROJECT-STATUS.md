# XMA 0.1.0 项目状态

## 1. 当前定位

0.1.0 是**可测试的平台骨架 + Agent/Skill Foundation + Windows/Desktop 工程通路验证版本**，不是已经具备完整 Agent 产品能力的正式版。

本轮开发优先级已经明确调整为：**底层 Agent Runtime 与真实 Model Provider 优先，复杂 Desktop UI 后置。** 当前 Desktop 只要求能启动、能打包、能验证 Shell/Runtime 通路；完整 Codex 风格三栏 Workbench 作为后续目标记录在 `docs/architecture/DESKTOP-WORKBENCH.md`。

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
- Brain Ready Probe 已升级：目标 catalog/model 校验 + 真实 text request；声明 native tool calling 时还要求最小 Tool Call → Tool Result → 同模型继续响应 round trip；DeepSeek 当前 named/`required` tool choice 与 thinking 不兼容，因此确定性 Tool 子探针只在探针请求中关闭 thinking，实际 Agent Turn 仍使用 thinking/high；真实 thinking + tools 所需 `reasoning_content` 通过 opaque provider continuation 持久续传，redacted export 会移除；
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
- portable Terminal staging（内置 Node + CLI/Server/Web + Native）与 Windows/Unix bootstrap installer 第一版；
- `xiaoyu` canonical command、`xma` compatibility alias、Home/root Workspace 风险确认；Brain 已升级为多 Profile 的真实 Provider Catalog：首个品牌入口是 DeepSeek Official，自定义 OpenAI-compatible 继续保留；`brain.json` v3 保存品牌/Profile/Adapter/Base URL/Model/Credential Reference，OS Credentials 为默认 Secret 路径，v1/v2 legacy 配置继续显式迁移；
- Terminal 已增加 `/model` 与真实模型目录选择；DeepSeek Profile 不要求用户手填官方 Base URL/初始 model，保存后从官方 model catalog 读取当前可用 model ID 并按选择结果 Probe；DeepSeek preset 使用 thinking/high reasoning，并保留 thinking+tools 的协议续传状态；
- Terminal TUI 使用固定 `@earendil-works/pi-tui@0.74.0` 的差分渲染/Overlay/硬件光标基础能力，但主 Prompt 已改成 XMA `SafePromptInput`：不再使用上游 Editor/Input 的 reverse-video 假光标，专门规避 Windows Terminal 白块/反色泄漏；支持 CJK 硬件光标、输入历史、多行、斜杠补全；Home/Prompt 使用固定锚点并按终端高度保留纵向留白，Overlay 打开时进入 modal focus、背景只保留紧凑状态 Dock，丰富显示只动态刷新装饰层；`Ctrl+P` 命令面板、Terminal Settings 与 Brain / Provider 管理已接线；
- Terminal 第一批 Rust-backed 文件 ToolSet：`native.fs.read_text/write_text`，写入通过 TUI deny/allow-once/allow-session Approval；process Tool 默认不注册；
- Architecture / Naming / Comment / Documentation / Version / Windows / Repository Gates；
- 项目命名/模块粒度规则已锁定：TS/目录 kebab-case、Rust snake_case、语义点号、1～3 核心词、父目录去重；Session/Tool/Electron/Gate 已按规则完成分组重构；
- Electron 41.2.0 Runtime 的显式下载、校验、Windows staging 原子安装链；
- Desktop 发布资源使用相对 Vite base，解决 `file://` 黑屏；
- 仓库级 `.agents/.codex/.claude` AI 开发上下文规范和上游参考基线文档。

## 3. 当前架构已确定但尚未完成的底层

以下是当前 0.1.x 真正的开发主线：

- Session Store generation migration / fork（export/redaction/纯 migration Contract 已有第一版）；
- system-message reconciliation / compaction（Context Assembly/durable snapshot 已有第一版）；
- OS Keychain/安全 Credential Store（env/memory resolver 已有第一版）；
- Provider 通用 Retry / Cost Catalog / App Protocol 配置面；Terminal 已有第一版 Provider Profile/Brain Ready/模型选择，但 Desktop/Web/App Protocol 配置面仍未完成；
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

XMA 已建立三条固定参考线：

- OpenAI Codex：Coding Runtime / Thread-Turn / ToolRouter / Provider / Permission-Sandbox / App Protocol；
- DeepSeek Harness：Cordis Plugin Harness / Session / Agent Loop / Tool Pipeline / Skills；
- Minecraft Host Agent：Minecraft Agent-First / Skills / Knowledge / Tool vertical / E2E。

固定 commit、许可证、路径映射和吸收/拒绝项见 `docs/development/UPSTREAM-REFERENCE.md`。后续每个子系统实现必须在对应上游固定 commit 下做子系统全文件审阅，不能靠概括记忆。

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

## 7. 下一开发批次

Agent/Skill Platform Foundation 已进入代码，后续开发不再优先修 TUI 外观；Terminal 只修阻断性输入/白屏/崩溃问题。当前顺序锁定为：

1. **Provider Catalog + DeepSeek Official 真实 E2E**：品牌/协议分离、多 Profile、DeepSeek 官方入口、真实 `/models`、`/model` 与强化 Probe 已落地；下一步先在用户 Windows 上验证 API Key → Credential Manager → 重启 → 动态 model catalog → text/tool round trip → 实际 Agent Turn，形成第一份真实品牌 Provider 证据；
2. **OS Credentials 其余平台验收**：在 macOS Keychain / Linux Secret Service 分别完成真实写入→重启→读取→Probe→删除；
3. **Process executable registry / absolute allowlist / Approval**：把已存在的 Rust `process.spawn` 安全链接到产品配置面，先支持明确绝对路径的 node/pnpm/git/cargo/python 等；
4. **Workspace persistence + discovery**：repo/project metadata、Git identity、`AGENTS.md/CLAUDE.md` instructions discovery、显式 rebind/migration；
5. **Xiaoyu Manager durable Task/Delegation**：Task Store、父子任务、状态、结果与验收，不做“多个 Agent 随意聊天”；
6. **Xiaoyu Code 真闭环**：读规则 → 查代码 → 修改 → 运行测试 → 观察失败 → 再修 → Git diff/验证证据；
7. **App Protocol Handler + process tree / PTY/ConPTY**，让 CLI/Desktop/Web/Server 继续共享一套 Runtime；
8. **Plugin/Host Compatibility**：先选一个外部 Host 做完整 Adapter + conformance，再扩 Codex/Claude Code/DeepSeek Harness/Zcode；
9. Code Agent 证明平台后，再增加 Minecraft/Writer/GameDev/Art 等真实专业 Agent，不提前创建空目录。

完整 Workbench UI 仍后置；现有 UI 参考继续由 `DESKTOP-WORKBENCH.md` 保存。

详细分阶段出口见 `DEVELOPMENT-PLAN.md`。
