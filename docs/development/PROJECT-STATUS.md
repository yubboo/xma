# XMA 0.1.0 项目状态

## 1. 当前定位

0.1.0 是**可测试的平台骨架 + Windows/Desktop 工程通路验证版本**，不是已经具备完整 Agent 产品能力的正式版。

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
- Provider Registry / Profile / Credentials Resolver / Capabilities / Model Catalog / Error taxonomy；
- OpenAI-compatible Chat Completions HTTP/SSE Adapter 第一版（协议测试，不等于外部厂商 Ready）；
- Brain Ready Probe 第一版：必须真实发 HTTP 模型请求才可返回 ready；
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
- Minecraft / Code / Writer Agent 身份骨架；
- `xiaoyu` 持续 Terminal TUI + Web / Desktop / Server Shell；
- Windows 环境/同步/GitHub/构建脚本；
- portable Terminal staging（内置 Node + CLI/Server/Web + Native）与 Windows/Unix bootstrap installer 第一版；
- `xiaoyu` canonical command、`xma` compatibility alias、Home/root Workspace 风险确认与环境变量 OpenAI-compatible Brain；
- Terminal TUI 已迁到固定 `@earendil-works/pi-tui@0.74.0`：真实 Editor/IME 光标、差分渲染、输入历史、斜杠命令自动补全；Home/Prompt 使用固定锚点，丰富显示只动态刷新装饰层；`Ctrl+P` 命令面板与 Terminal Settings（丰富/简洁、提示、Logo）已接线，风险页默认退出并支持键盘选择；UI 不再展示尚未实现的假快捷入口；
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
- Provider 通用 Retry / Cost Catalog / App Protocol 配置面；
- 外部真实 Provider E2E 与 Product Ready 证据；
- 至少两个不同协议族真实 Provider；
- App Protocol Approval request/decision 与多 Host 交互；
- Rust process-tree ownership / cancellation、PTY/ConPTY、network/hash/archive capability；
- process executable 已完成“绝对路径 + canonical identity + 不经 PATH”第一版；仍缺可执行文件内容/句柄级 TOCTOU identity hardening；
- Workspace persistence / repo metadata / instructions / explicit rebind migration（ownership/grant 第一版已落地）；
- App Protocol / Event Stream；
- DSH Tool/LLM/Session/Skill bridge 与 Conformance Tests。

## 4. 尚未完成，禁止过度宣称

- 真实 OpenAI/Claude/Gemini/DeepSeek/MiMo **品牌 Provider 产品支持**；当前只有通用 OpenAI-compatible 协议 Adapter；
- 任何外部 Profile 的 Brain Ready 证据；当前只有 Probe 实现与本地协议测试；
- 完整 Session/Memory/Context；
- 完整 Rust Workspace Sandbox：process tree / PTY / network / executable content identity；（FS 与 absolute-path direct process 最小 capability 已有第一版）
- DeepSeek Harness 所有 Service 的 package-level 完整兼容；
- Xiaoyu Code 真实 coding 闭环；
- Minecraft 真实开服闭环；
- Writer Agent 产品闭环；
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

Stage C 已经由用户 Windows `[7]` 完成真实 Rust 验证；Stage D 第一批 Workspace ownership/binding/grant/scope 已进入代码。当前插入 Distribution + Terminal Runtime 第一批，让 XMA 具备真实安装与持续终端入口，然后继续 Stage D：

1. Windows `xiaoyu` portable/installer 实机 E2E：构建、安装、PATH、doctor、升级；
2. Linux/macOS release workflow 与对应 installer E2E（各平台原生构建，不伪造跨平台）；
3. Terminal `process.run` absolute executable allowlist 配置 + Approval；文件 read/write + Approval 第一批已完成；
4. Workspace persistence + repo/project metadata；
5. Workspace instructions discovery（AGENTS.md/CLAUDE.md 等）与作用域/硬上限；
6. large Tool output attachment + compaction / Session fork；
7. App Protocol Workspace/Approval Handler + process-tree / PTY/ConPTY。

完整 Workbench UI 仍后置；新增参考图已经固化到 `DESKTOP-WORKBENCH.md`。

详细分阶段出口见 `DEVELOPMENT-PLAN.md`。
