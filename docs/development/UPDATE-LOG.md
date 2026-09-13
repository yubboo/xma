# XMA Update Log

> 作用：XMA 内部实时工程更新记录，主要给后续 AI / 开发者快速恢复上下文。每完成一批可独立说明的修改就追加一个编号；编号只增不改，格式固定为 `##01`、`##02`、`##03`……。
>
> 本文件不是用户发行说明，也不是 Git commit 替代品。它回答四件事：**这批在干什么、架构现在是什么、锁了什么规范、下一步从哪里继续。**

##01 · Agent Platform 架构换轨

- 日期：2026-09-13
- 目的：从自研缩水 Agent Runtime 转向 Upstream-first 的成熟 Agent Platform；保护真实顶级模型的推理能力。
- 架构：确定 `xma-*` 稳定 package family、Everything is a Plugin、Model Intelligence Preservation、Rust Security Kernel 安全边界。
- 上游职责：Pi → Agent Loop / AI；DeepSeek Harness → Plugin；Codex → Approval / Sandbox；MiMo Code → Context / Memory / Subagent / Workflow；MCHA → Minecraft 专业 Agent 领域参考。
- 规范：Skill 增强知识而不替模型思考；Model → Tool → Observation → 同模型继续推理；禁止隐藏 Planner / 换模 / 假能力。
- 主要文档：`docs/architecture/AGENT-ENGINE-STRATEGY.md`、`docs/development/UPSTREAM-REFERENCE.md`。

##02 · Platform Skeleton v1

- 日期：2026-09-13
- 目的：把平台稳定能力从旧 `core/` 实现区迁到可独立维护的 `packages/xma-*`，先整理骨架，不改 Agent 对外行为。
- 已建立：`xma-ai`、`xma-agent-loop`、`xma-plugin`、`xma-tools`、`xma-session`、`xma-context`、`xma-native`。
- `core/`：降级为 **Compatibility Facade only**；新平台能力不得继续写入 `core/`。
- Agent：`agents/xiaoyu`、`agents/code` 成为独立 workspace package，并通过 `xma-agent-loop` 使用 AgentDefinition Contract。
- 规范：不创建尚未开发的 memory/subagent/workflow/browser/computer/artifact 空 package。

##03 · Plugin Cohesion / Predictable Location / Stable Imports

- 日期：2026-09-13
- 目的：避免插件按 Provider/Tool/Context 类型被拆散，也避免几十个文件无分类平铺；同时消除 `../../../../` 目录耦合。
- 插件结构：按插件本体组织为 `plugins/deepseek/`、`plugins/native-tools/`、`plugins/dsh-compat/`；插件内部达到实际复杂度后再按功能簇分类。
- 共享 OpenAI-compatible Transport：归 `xma-ai`，DeepSeek 只保存产品品牌 / preset / plugin 逻辑。
- 导入规则：跨 package / plugin / agent 使用 `xma-*` / `xma-plugin-*` / `xma-agent-*` 稳定公共入口；禁止通过多级相对路径感知另一模块的物理位置。
- 可发现性：新增根 `CODEMAP.md`；能力名应能直接推断主要目录。
- 目录规则：适度分层、功能聚合；优先 `领域 / 功能簇 / 文件`，禁止无意义单文件目录链和 `misc/common/helpers` 垃圾桶。
- 下一步：在保持现有行为与测试不退化的前提下，继续把 Skill/App Protocol 等遗留薄层从 Compatibility Facade 迁往明确的稳定能力边界，再进入 Pi Agent Loop 行为级吸收。

##04 · Platform Skeleton 源码归位

- 日期：2026-09-13
- 目的：把已批准的目录骨架落实到真实源码，不再让平台 Contract 继续散落在旧 `core/` 与按类型拆散的旧 Plugin 目录。
- 已迁移：AI / Agent Loop / Plugin / Tool / Session / Context / Native bridge 分别归入 `packages/xma-*`；`core/` 只保留薄 Compatibility Facade 与尚未迁出的 Skill/App Protocol。
- 插件归位：DeepSeek、Native Tools、DSH Compatibility 分别聚合到 `plugins/deepseek/`、`plugins/native-tools/`、`plugins/dsh-compat/`；旧 `plugins/providers/`、`plugins/tools/`、`plugins/compat/` 等目录退出。
- 功能分类：`plugins/native-tools/` 已按 `filesystem.ts / process.ts / contract.ts / plugin.ts` 做适度功能分组，避免单文件堆积，也不制造多层单文件目录链。
- Stable Imports：跨 ownership 统一改为 `xma-*`、`xma-plugin-*`、`xma-agent-*` 公共入口；`core` facade 也只能 re-export 稳定 package，不能通过物理相对路径穿越。
- 骨架验证：新的 Platform 源码（packages/agents/plugins/core source）已用 TypeScript strict 配置做本地 typecheck；完整 pnpm/Windows/Rust Gate 仍需在正式包生成前继续验证并在下一编号记录结果。
- 下一步：同步 PROJECT-STATUS / DEVELOPMENT-PLAN / Provider / Plugin 等文档到“Skeleton 已落地、Pi 行为级 Agent Loop 吸收尚未开始”的真实状态，然后完成 Gates、Manifest 与正式 0.1.0 包验证。

##05 · Platform Skeleton v1 验证与收口

- 日期：2026-09-13
- 目的：完成 Platform Skeleton v1 的验证与正式源码包收口，确认目录/ownership/Stable Import 重构没有改变现有核心行为。
- TypeScript：`core/ + packages/ + agents/ + plugins/ + gates` 在 strict 配置下通过本地 `tsc --noEmit`；当前沙箱缺少 Electron 类型依赖，因此完整 root typecheck 仍以 Windows `pnpm check` 为最终权威。
- 测试：在 Node 22 `--experimental-transform-types` 下通过 57 个可离线执行测试（Core 41 + Brain 8 + Desktop build/runtime 8），0 fail；TUI 测试依赖未安装的 `@earendil-works/pi-tui`，本环境不冒充已执行。
- Gates：Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 共 9 项全部 PASS；Comment Gate 当前覆盖 80 个源码文件。
- 架构核对：跨 ownership 使用 `xma-*` / `xma-plugin-*` / `xma-agent-*` 公共入口；Architecture Gate 阻止深层相对穿越、`xma-*/src/*` 内部偷穿和未声明的 workspace 依赖。
- Source Manifest：本批正式源码树共 202 个受管文件；正式 ZIP 只允许包含这 202 个文件 + `.xma-package/source-manifest.json`。
- 状态：Stage S0（Platform Skeleton v1）收口完成；下一开发阶段正式进入 Stage P1：按固定 Pi commit 做 Agent Engine 行为级研究与 `xma-ai / xma-agent-loop` 吸收。
- 下一步：先产出 Pi Agent Loop capability/behavior 对照与 XMA migration checklist，再逐项实现 streaming lifecycle、parallel/sequential tools、steering/follow-up、cancellation/error settlement；不进行 flag-day Runtime 重写。
