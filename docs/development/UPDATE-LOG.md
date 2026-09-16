# XMA Update Log

## 90 · Terminal 模型状态精简、真实 Metrics 回显与 `[10]` Unicode 路径修复

- #11 将 Prompt 正常模型组从 `● Provider · model · 模型已就绪 · reasoning` 收口为 `● canonical-model · reasoning`；绿色 dot 继续表达 Ready truth，未配置/凭据异常仍保留明确异常文案，最右 `flexShrink=0` ownership 不变。
- #05 canonical metrics 没有丢失：#10 只是把部分 cache/token/turn 指标裁到超宽屏。#11 在常见宽度恢复本次/平均 cache hit（两位小数）、精确 session/turn token 千分位、turn count、真实费用/permission；compaction 只在 canonical `available=true` 时显示真实 threshold，当前未实现时继续显示 `—`，不伪造 80%。
- Transcript 用户消息使用独立浅灰背景 + 深色文字，短提问形成清晰的一行用户会话高亮；长文本仍按既有 content width 正常换行，ScrollBox ownership 不变。
- Windows `[10]` 不再读取 `git rev-parse --show-toplevel` 后交给 `[IO.Path]::GetFullPath`；脚本已从自身位置解析 `$Root`，现在用 `$Root/.git` marker + `git rev-parse --show-prefix` 空前缀验证仓库顶层，保留 main/origin whitelist、安全 rebase/autostash、强制恢复前备份与 no-clean 约束。
- 自动验证：`session-status.test.ts` 8/8、`opentui-runtime.test.ts` 34/34、`terminal-shortcuts.test.ts` 1/1（定向合计 43/43）PASS；Runtime updater 2/2 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate PASS。当前 Linux 沙箱没有 Windows PowerShell 5.1 / Windows Terminal，因此 `[10]` 中文路径与最终 TUI 视觉仍保留实机 E2E。

## 89 · Terminal Session Metrics 分区布局与 Ctrl+C 按需提示

- #05 Metrics 的 Terminal 投影改为两层：Prompt 主状态行在 Provider truth 左侧显示真实 `上下文 used/window + API 余额/套餐额度`，Provider/Model/Ready/Reasoning 保持最右固定；两组之间保留稳定间距。
- 下方 detail row 删除重复 model/context/balance，常见宽度仅保留 billing、本轮 tokens、真实会话费用与 permission；canonical metrics 不删字段，宽屏再逐级增加次要统计。
- 永久快捷栏删除 Ctrl+C，解决 #08 后文案过长导致的换行；实际 Ctrl+C 才通过 transient notice 显示复制、中止、取消/拒绝或二次退出提示，#08 路由优先级不变。
- Repair 编号治理增强：已占用编号永不复用，用户/任务给出冲突编号时自动顺延到下一空闲 ID；既有业务模块的 Host/UI 优化建立新 Repair ID 并引用来源编号。
- #08 已获用户 Windows 实机确认原始 Ctrl+C 退出冲突解决并标记完成；#10 当前验证中。定向 Node 回归 41/41 PASS、关键 TS/TSX transpile syntax PASS、Runtime updater 2/2 PASS、9 项 Gate PASS；Source Manifest 242 files。成品 ZIP 独立解压后 242 source + manifest 完整，missing/extra/hash diff 均为 0，并从成品再次通过 41/41 + 2/2 + 9/9。

## 87 · Ctrl+C 文本选择复制与中止/退出路由修复

- 2026-09-16 用户 Windows 实机确认原始“选中文本后一按 Ctrl+C 直接退出”问题已解决，#08 状态转为已完成；后续永久快捷栏长度问题由独立 #10 处理。
- 新增 `apps/cli/src/terminal-shortcuts.ts` 作为 Host-neutral 快捷键决策合同：真实 Selection → copy；busy → cancel Turn；modal → cancel/deny；idle 单次只 arm exit、二次才退出。
- OpenTUI Root 现在先读取 `renderer.getSelection()?.getSelectedText()`；有真实选区时禁止退出，优先 OSC 52，失败时回退 OpenTUI Native Host Clipboard；复制失败也保留进程和选区。
- Esc 有选区时只清 Selection；无选区才走原有返回/取消语义。Renderer 继续保持 `exitOnCtrlC: false`，避免 OpenTUI 默认 SIGINT 路径抢走产品级快捷键。
- 当前状态：已完成；#07/#08 相关自动回归合计 92/92 PASS、Runtime updater 2/2 PASS、9 项 Gate PASS，且用户 Windows 实机已确认 selection copy 不再触发退出。

## 86 · Plan 模式模型可见 Context、显式 ready 与 Yes/No 执行交接

- Work Mode 从 TUI 标签提升为 model-visible Context：Build/Plan/Compose 会进入真实用户 Provider/Model 的 system context；Xiaoyu 继续只是 Agent identity。
- Plan 保持 read-only ToolPlan，并新增纯 control `xma.plan.ready`。只有真实模型判断计划已足够完整并显式调用 ready，Host 才弹出执行确认；普通 Plan 问答不会误触发 handoff。
- Plan ready 的完整计划保存为 durable `plan/snapshot`；Host `Yes` 才写 `plan/decision=yes`、切 Build 并以 retained Plan 继续；`No` 写 durable deny、保留计划但不执行。
- `ask` Permission 的产品 Approval 收口为 Yes/No：Yes = allow-once，No/Esc/Abort = deny；不再在 ask UI 暴露“本会话允许”。
- 当前状态：验证中；Work Mode / Plan ready / Tool Policy / OpenTUI 合同已纳入 92/92 自动回归；仍需 Windows 实机验证 Plan 对话、ready handoff 与真实 Tool Approval。

## 85 · 真实模型身份 / Work Mode / 三档 Permission / Context 与账户指标一致性

- 修复 Terminal Permission 长期硬编码 `ask`：新增 Host-neutral `PermissionProfileController`，`ask / smart / full` 进入真实 ToolRouter Policy；每个 Turn 冻结 Policy 快照。
- Work Mode 与 Permission 分离：Tab 只切 Build/Plan/Compose；Plan ToolPlan 保持 read-only ceiling，`full` 也不能恢复 write/execute Tool。
- Terminal 新增 `/permission` 与 Ctrl+P 权限入口并持久化，状态栏权限来自同一 Runtime state；产品文案统一“请求批准 / 替我审批 / 完全权限”。
- Context 显示改为真实同模型 input/window，并保留 sub-percent 精度；例如 1,791/1M 显示约 0.2%，切模后不会混用旧 usage。
- DeepSeek 官方 telemetry 保持 1M context 与真实 `/user/balance`；按 2026-09-16 官方价格页更新 `deepseek-v4-pro` 在 2026-09-14 04:00 UTC 后路由 V4.1 Flash 并按 Flash 价格计费的估算语义。
- 窄/中等 Terminal 状态栏优先保留 context、真实账户/套餐与权限；Xiaoyu 明确锁定为 Agent/Product identity，不形成隐藏第二模型。
- 当前状态：验证中，等待 Windows 权限策略、Plan+full、真实余额/context E2E。
- 自动验证：#07 相关 Node 测试 54/54 PASS，Runtime updater 2/2 PASS，9 项 Gate PASS；Source Manifest 235 files。

## 84 · Provider Setup usePaste 模块归属与 Modal 存活性修复

- 修复 `ui/dialogs.tsx` SecretInput 在运行时调用未导入 `usePaste/decodePasteBytes` 导致模型配置失败的问题；hook/helper 现在由使用它们的子模块自己拥有。
- `askList/askInput` 增加同步 setDialog 失败 rollback；Dialog 树增加局部 ErrorBoundary，modal render/hook 异常只取消/拒绝当前交互并恢复主 Prompt，不再让整个 TUI renderer 假死。
- 新增回归合同锁定模块 import ownership、Dialog settlement、setupFlow finally 恢复；#02/#03/#04 的 PromptDock/scroll/caret 行为不改。
- 当前状态：验证中，等待 Windows 首次配置、Ctrl+P 重配、API Key 粘贴及失败后 UI 存活性 E2E。


## 83 · 统一 Session Runtime Metrics / Provider Telemetry 状态栏

- 新增 `xma-ai` Provider Telemetry Contract：`api | subscription | unknown`、model metadata、cost estimator、account balance/quota。
- 新增 `xma-session` durable metrics projection：Turn/Request/Usage/Cache/Latency/Context/Cost/Permission/Compaction，历史 Step 保留真实 ModelIdentity。
- App Protocol 增加 `session/metrics`；Terminal 新增 `SessionStatusBar`，只消费 canonical metrics，未来 Desktop/Web 直接复用。
- DeepSeek 官方 telemetry 仅对官方 HTTPS Profile 查询 `/user/balance`，测试使用本地 HTTP mock，不使用真实用户 API Key。
- 未知数据统一 unavailable/`—`；套餐模式不使用 API 单价推算费用；当前 durable compaction 未实现时显示 `压缩—`。
- 当前状态：验证中；完成全量 Gate/Manifest/Windows 实机状态栏验收后关闭 #05。


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

##06 · 公共安装与源码开发入口统一

- 日期：2026-09-13
- 目的：彻底区分“普通用户安装后的正式产品命令”和“源码开发控制台”，避免开发入口 `XMA.bat` / `xma.bat` 与正式 `xma` 命令混淆，并让 Windows / Linux / macOS 都有清晰入口。
- 正式产品：主命令固定为 `xiaoyu`，`xma` 仅为兼容短别名；Windows portable 内部为 `xiaoyu.cmd / xma.cmd`，Linux/macOS 为 `xiaoyu / xma`。普通用户不 clone 源码、不安装 pnpm/Rust/MSVC。
- 一行安装：Windows Release 资产统一命名 `xma-install.ps1`，Linux/macOS 统一命名 `xma-install.sh`；README 使用 `releases/latest/download/xma-install.*`，只有真实 Release 资产存在时才允许宣称公网命令可用。
- 源码开发：旧 `XMA.bat` 退出，Windows 固定根入口 `xma-dev.bat` → `scripts/windows/xma-console.ps1`；Linux/macOS 新增根 `xma-dev` → `scripts/unix/xma-console.sh`。源码入口必须带 `-dev`，绝不占用正式 `xma` 产品命令。
- 路径合同：`xma-dev.bat / xma-dev` 都从自身位置解析仓库根，允许任意本地目录/盘符；`H:\一键部署\xma` 仍只属于维护者 Source Manifest 默认目标。Git clone 用户不需要 `XMA-Sync.bat`。Windows Git Helper 会为 canonical Unix 入口写入 Git executable bit，避免跨平台 clone 后 `./xma-dev` 失效。
- 发行脚本：canonical installer 改为 `scripts/install/xma-install.ps1` / `scripts/install/xma-install.sh`，Release workflow 与 Windows release builder 均发布同名资产；安装器继续使用预构建 portable runtime + SHA-256 校验。
- 可发现性：`CODEMAP.md` 明确区分产品安装、源码开发、维护者 Sync/GitHub Helper；`README.md` 顶部优先展示普通用户一行安装，源码开发独立成节。
- 验证：Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 共 9 项 PASS；57 个可离线执行 TypeScript 测试 PASS；修改 Gate 的 targeted `tsc --noEmit` PASS；`xma-dev`、Unix console、`xma-install.sh` 均通过 `sh -n`。
- Source Manifest：本批 204 个受管源码文件；相对上一个已推送 Skeleton 基线为新增 5、更新 24、删除 3、未变化 175。
- 未验证边界：当前环境不能替代 Windows/Linux/macOS 三平台真实 Release 安装 E2E；公网 `releases/latest` 只有发布对应 Release 资产后才算可用。
- 下一步：Stage P1 顺延为 `##07 · Pi Agent Engine 行为研究与迁移设计`，先列行为迁移矩阵，再改 `xma-ai / xma-agent-loop`。

##07 · 首次 Brain 引导与开发态 CLI PATH

- 日期：2026-09-13
- 目的：让正式/开发 Terminal 的第一次使用更自然，同时让 Windows 开发者在 `[1]` 准备完成后可从任意 Workspace 直接运行当前源码 `xiaoyu / xma`。
- 首次启动：Workspace Trust 仍发生在进入 TUI 之前；进入 TUI 后仅当当前没有已配置 Brain/Profile 时自动打开“首次配置 Xiaoyu Brain”，沿用现有 API Key → 真实模型目录 → Reasoning → 已就绪流程。已有 Profile 的后续启动不再重复弹出。 Workspace 风险识别同时覆盖 Windows 系统目录（例如 `C:\Windows\System32`），默认仍为退出。
- 长期配置：`Ctrl+P → Brain / Provider` 完整保留，继续负责新增账号/Profile、切换 Provider/Model、修改 Reasoning 与重新 Probe；首次引导不是替代入口。
- Windows 开发命令：`xma-dev.bat → [1]` 新增第 8 步，在仓库忽略状态 `.xma\dev-bin` 生成 `xiaoyu.cmd / xma.cmd`，并自动写入当前用户 **User PATH**。不修改 Machine PATH，也不把整个 Git 仓库加入 PATH。
- Workspace 语义：开发 shim 在任意目录调用时把调用者当前目录传给 `xma-dev.bat cli`，因此 `xiaoyu` 从 `D:\Project\foo` 启动就绑定 `D:\Project\foo`，不会被开发控制台切换到 XMA 仓库根。
- Checkout 切换：同一用户只保留一个激活的 `.xma\dev-bin` PATH entry；在另一份 XMA checkout 重新运行 `[1]` 会替换旧 entry。移动仓库后也只需重跑 `[1]`。
- 规范：正式 Release `xiaoyu/xma` 与开发 shim 仍是两个发行语义；正式安装器继续使用 `%LOCALAPPDATA%\Programs\Xiaoyu\bin`，开发 shim 只为源码工作流便利。
- 验证：75 个可离线 TypeScript 测试 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9 项 Gate PASS；本批 CLI/TUI/Windows Gate targeted strict `tsc --noEmit` PASS；`xma-dev`、Unix console、`xma-install.sh` 通过 `sh -n`。完整 root typecheck 仍因当前沙箱缺少 Electron package/types 不能替代 Windows `[7]`；当前环境也不能真实写 Windows User PATH，因此 PATH shim 仍需用户 Windows 实机验收。
- Source Manifest：204 个受管源码文件；相对当前已推送 `6154e61` 基线预计 Source Sync 为新增 5、更新 29、删除 3、未变化 170，共 37 个实际源码变更。
- 下一步：Stage P1 顺延为 `##08 · Pi Agent Engine 行为研究与迁移设计`，先列行为迁移矩阵，再改 `xma-ai / xma-agent-loop`。


##08 · Root Hygiene 与 Terminal 启动契约

- 日期：2026-09-13
- 目的：锁定仓库根目录长期卫生规则，并纠正 Terminal onboarding 语义：Workspace Trust 是每次启动的第一层；首次 Brain Setup 是仅无 Profile 时出现的第二层。
- Workspace Trust：`xiaoyu / xma` 每次交互式启动都解析调用者当前目录并显示信任确认；普通项目也必须显式确认，本次授权不持久化为下次跳过。Home、文件系统根与 Windows 系统目录继续显示额外高风险提示并默认选择退出。
- Brain Setup：Trust 通过后，仅当当前没有已配置 Brain/Profile 时，在**同一个 Xiaoyu TUI** 中以居中 modal 启动 Provider → API Key → 真实 Model Catalog → Reasoning → 已就绪流程；已有 Profile 后续启动跳过第二层。
- 长期管理：`Ctrl+P → Brain / Provider` 始终保留；首次 Setup 与 Ctrl+P 共享同一 Provider/Profile/Credential/Model/Probe 实现，禁止维护两套配置业务逻辑。首次 Setup 未完成时不能通过 Esc 静默绕过进入无 Brain 工作台；可继续配置或用 Ctrl+C 退出。
- Root Hygiene：根目录只允许一级领域目录、标准工具链根配置、导航文档和极少量顶级 Launcher；普通实现文件与临时脚本必须进入真实 ownership。`.git/.cache/.xma/node_modules/dist` 为本机状态，不属于源码架构。
- Gate：Architecture Gate 新增 root allowlist/本机状态忽略集；Distribution Gate 锁定“每次 Workspace Trust + 居中首次 Brain Setup + Ctrl+P 长期入口”标记。
- 验证：75 个可离线 TypeScript 测试 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 共 9 项 Gate PASS；`apps/cli + core + packages + agents + plugins + gates` targeted strict `tsc --noEmit` PASS；Unix launcher/install 脚本 `sh -n` PASS。
- Source Manifest：仍为 204 个受管源码文件；相对上一正式源码包为新增 0、更新 15、删除 0、未变化 189。当前环境无法代替 Windows Terminal 做真实键盘/alternate-screen E2E，Workspace Trust 与首次 Brain Setup 的最终视觉/交互仍需 Windows 实机验收。
- 下一步：Stage P1 顺延为 `##09 · Pi Agent Engine 行为研究与迁移设计`，先完成能力/行为迁移矩阵，再改 `xma-ai / xma-agent-loop`。

##09 · TUI 中文化、模型面板布局与干净取消

- 日期：2026-09-13
- 目的：修复 Windows 实机验收发现的两类产品问题：命令/模型设置仍混有英文功能名，模型设置 Overlay 与 Home Logo/装饰层视觉穿透；同时修复工作区信任选择“否，退出”被 `pnpm/xma-dev` 当作错误并打印 PowerShell 堆栈。
- 中文化：Ctrl+P 命令面板的 `Workspace / Brain / Provider / Agent` 用户标签改为“工作区 / 模型 / 提供方 / 智能体”；模型配置页统一使用“添加提供方 / 模型就绪测试 / 选择模型 / 推理强度”等中文功能词，品牌名与真实 model ID 继续保留原文。
- 布局：模型/提供方、提供方目录、真实模型、推理强度与 API Key 输入统一使用居中 Overlay；模型管理主面板扩宽为终端约 78%，并限制相对高度。任何 Overlay 打开时 Home Logo、星点和口号不再渲染，只保留底部紧凑状态 Dock，避免背景内容穿过设置面板。
- 取消语义：工作区信任选择“否，退出”或在该确认层取消后，CLI 输出简短“已取消”并以成功退出码结束；这是用户主动取消，不是生命周期错误，开发 shim / pnpm / PowerShell 不得再打印 `ELIFECYCLE` 或 `failed with exit code 3`。
- Gate：Distribution Gate 锁定中文模型入口、modal 背景隐藏和 `USER_CANCEL_EXIT_CODE = 0`；Architecture Gate 同步更新 Provider 失败保护标记，避免 UI 文案改名导致 Gate 与真实产品状态漂移。
- 验证：Core + CLI + Desktop 可离线 TypeScript 测试 76/76 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 共 9/9 Gate PASS；CLI/TUI/Gates targeted strict `tsc --noEmit` PASS。
- 未验证边界：当前沙箱不能代替 Windows Terminal 真实 alternate-screen 视觉验收；模型管理面板的新宽度/居中效果与“否，退出”无错误堆栈仍需用户 Windows 实机确认。
- 下一步：Stage P1 顺延为 `##10 · Pi Agent Engine 行为研究与迁移设计`，先列真实 streaming/tool/steering/cancellation 行为迁移矩阵，再改 `xma-ai / xma-agent-loop`。

##10 · Terminal 鼠标接管、统一菜单栅格与命令搜索

- 日期：2026-09-14
- 目的：收口 Windows Terminal 实机验收中的交互问题：普通左键拖动会触发宿主终端文本选择并形成大片白块/蓝色选择手柄；命令与模型菜单的名称/说明列不统一，说明过长；命令主菜单缺少可直接输入的搜索能力。
- 鼠标输入：Workspace Trust 与 Xiaoyu alternate-screen 工作台活跃期间启用 SGR mouse reporting（button-event + SGR coordinates），普通左键点击/拖动由 Xiaoyu 接收并忽略，退出、取消与异常收口时显式恢复终端模式；不修改终端自身 Shift+拖动的主动文本选择语义。
- 菜单组件：新增 `apps/cli/src/tui-menu.ts` 作为纯 TUI 菜单投影层，统一 CJK cell width、名称列、简短说明列、快捷命令列、截断与选择窗口；命令面板、Terminal Settings、Provider/Model 列表共享同一 `showListOverlay` 栅格，不再依赖 Pi SelectList 的页面级自由宽度。
- 命令搜索：`Ctrl+P` 与新增 `Ctrl+K` 共用同一居中命令面板；命令面板顶部提供即时搜索，匹配 label/value/description/keywords，支持中文、命令名、Provider/Model 别名（例如 DeepSeek/API Key），↑↓ 选择、Enter 执行、Esc 返回。真实 `/settings`、`/provider` 等命令在最右列统一对齐显示。
- 文案与模型页：主菜单说明统一缩短；“添加提供方 / 自定义提供方”移除多余 `＋`；Profile 行缩短为 Provider + Model + Credential 状态，避免把来源、密钥说明等全部挤成一条超长字符串。
- Gate / 测试：Distribution Gate 新增 mouse capture、Ctrl+K 搜索与统一菜单栅格静态合同；CLI TUI 测试补搜索、列宽与 mouse sequence 回归。本批已完成 `tui-menu.ts` strict TypeScript 检查 PASS、`tui.ts/tui.test.ts/distribution.ts/tui-menu.ts` Node strip-types 语法检查 PASS、纯菜单 search/layout/selection smoke PASS，以及 Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 共 9/9 Gate PASS。当前源码包不携带 `node_modules`，沙箱也无法联网准备 workspace 依赖，因此未冒充执行完整 `pnpm test/typecheck`；Windows Terminal 鼠标视觉效果仍以用户实机验收为最终证据。
- Source Manifest：正式源码包重新生成 `.xma-package/source-manifest.json`，仍按未冻结 `0.1.0` 同名交付 `xma-0.1.0.zip` + `xma-0.1.0.sha256.txt`，禁止临时 fixed/hotfix 包名。
- 下一步：用户 Windows 实机重点验收普通左键拖动不再产生白色选择块、命令搜索与菜单列对齐；确认后继续 Stage P1 的 Pi Agent Engine 行为研究与迁移，不把后续开发重心长期停留在 TUI 外观。

##11 · Terminal 居中、命令三列、软光标与动态提示

- 日期：2026-09-14
- 目的：继续收口 Windows Terminal 实机验收：Home/Prompt 可见内容偏左；命令面板列顺序不符合“命令 / 菜单 / 说明”；Windows Text Cursor Indicator 在硬件光标位置显示蓝色双标记；低价值通知会长期覆盖底部自动提示。
- 横向布局：Home/Prompt Dock 从 76 cell 收窄到最多 64 cell，并继续按终端宽度居中；Provider 主面板改用固定居中宽度，避免 78% 宽 Overlay 中实际内容长期贴左。
- 命令面板：统一菜单栅格改为左侧真实 Slash 命令、中间产品菜单、右侧简短说明；Provider/Model 等没有快捷命令的列表自动退化为菜单/说明两列，搜索、选择和 CJK cell width 逻辑不变。
- 光标：Pi TUI 改为隐藏硬件光标；`CURSOR_MARKER` 继续定位隐藏光标以保留 IME 跟随，可见插入点由 XMA 橙色下划线软光标绘制，搜索框使用同类软光标，不再触发 Windows Text Cursor Indicator 的蓝色上下标记；继续禁止 reverse-video 假光标。
- 鼠标：mouse reporting 扩展为 1000/1002/1003 + SGR 1006，并在 `tui.start()` 后重申接管，降低 Pi TUI 初始化覆盖终端模式导致宿主重新进入文本选择的风险；退出按逆序完整恢复。
- 动态提示：Home 恢复自动轮换 Ctrl+P / Ctrl+K / Slash / Mode / History 提示；模型未配置或未就绪时显示对应引导；普通操作通知仅短暂展示，Esc 清空输入不再留下“已清空输入”长期占位。
- 验收边界：本批仍需要 Windows Terminal 实机确认隐藏硬件光标后的 Microsoft IME 候选窗跟随、普通拖动不出现宿主选择白块，以及 64-cell Home Dock 与命令三列的最终视觉。
- 下一步：实机通过后停止继续扩张 TUI 外观改动，回到 Stage P1 Agent Engine 行为研究与迁移。

##12 · Terminal 响应式正文宽度

- 日期：2026-09-14
- 目的：修复 Windows Terminal 实机验收中 Home/对话区固定 64-cell 宽度导致左右黑色留白过大、正文过早换行的问题。
- 横向布局：Home Prompt、对话 transcript、快捷键与底部提示继续共享同一居中内容栅格，但内容宽度改为响应式：窄终端保留最小安全边距，常规终端约保留两侧各 10 cell，超宽终端最多扩展到 132 cell，避免重新变成贴边布局。
- 对话正文：assistant/reasoning/tool 的 wrap 宽度随同一内容栅格扩大，112 列终端从上一版 64-cell Dock 扩展到 92 cell，正文可用宽度同步增加，减少无意义换行。
- 验证：新增 `terminalContentWidth()` 纯函数回归，锁定 64/112/160 列下的 56/92/132 cell 行为；继续保持居中、命令三列、软光标、mouse reporting 与动态提示合同不变。
- 交付：未冻结 `0.1.0` 继续覆盖生成同名 `xma-0.1.0.zip` 与 SHA-256，不创建 fixed/hotfix 临时包。


##13 · Terminal 对话底栏节奏与 Esc 返回

- 日期：2026-09-14
- 目的：修复 Windows Terminal 实机验收中对话态底部快捷栏紧贴固定 footer、视觉拥挤，以及 `esc 返回` 只有文案没有真实返回行为的问题；同时统一快捷项之间的横向间距和左右边界。
- 对话底栏：对话态快捷栏整体上移一行，固定 footer 上方保留独立呼吸行；Prompt Dock 随同一布局上移，避免快捷栏与左下 Workspace / 右下版本号挤在连续两行。
- Esc 返回：对话态且当前没有流式执行/Overlay 时，Esc 真实返回 Home 视图并清空当前输入显示；运行中 Esc 仍优先走取消语义，Overlay Esc 继续由各自面板关闭逻辑处理，避免把“返回”误做成摆设或覆盖取消行为。
- 快捷栏栅格：`tab / shift+tab`、`ctrl+p`、`ctrl+k`、`/`、`ctrl+c`、`esc` 作为同一组快捷项按当前内容宽度等分剩余间距；整行宽度严格等于居中内容栅格，因此左/右黑色留白继续保持对称，Esc 与其他快捷项共享同一基线。
- 回归：新增纯布局测试，锁定 34 行终端下 `hintRow=31 / promptEnd=29`、footer 前独立空行、Esc 可返回条件，以及 92-cell 快捷栏等距分布/右端 `esc 返回` 对齐合同。
- 交付：未冻结 `0.1.0` 继续覆盖生成 `xma-0.1.0.zip` 与 `xma-0.1.0.sha256.txt`；Windows Terminal 最终视觉与 Esc 键实机行为仍以用户验收为最终证据。

##14 · Terminal 硬件光标彻底隐藏与输入软提示

- 日期：2026-09-14
- 目的：修复 Windows Terminal 实机中输入占位首字改为白色闪烁后，Pi TUI 的硬件光标定位标记缺失/回退导致 Windows Text Cursor Indicator 在右上角重新出现蓝色双标记的问题。
- 根因：上一批空输入状态改为直接绘制“输”字闪烁，占位渲染不再消费 `SafePromptInput.render()` 返回的 `CURSOR_MARKER`；Pi TUI/终端仍保留硬件光标坐标语义，Windows 的 Text Cursor Indicator 因而在 fallback 坐标（实机表现为右上角）显示蓝色上下标记。
- 修复：Xiaoyu 主工作台与命令搜索框不再输出任何 Pi TUI `CURSOR_MARKER`；输入焦点统一由 XMA 自绘软提示表达。空输入使用白色闪烁“输”字，已有输入继续使用下划线软光标，搜索框使用白色闪烁竖线。
- 终端契约：进入 alternate-screen 前和 `tui.start()` 后都显式发送 `DECTCEM hide`（`ESC[?25l`），退出时在恢复 mouse reporting 后发送 `DECTCEM show`（`ESC[?25h`），确保不把隐藏硬件光标状态泄漏给父终端。
- 回归：CLI TUI 测试改为断言 Safe Prompt 不输出 `CURSOR_MARKER`、仍保留非反色软光标与 secret mask；`tui.ts` / `tui.test.ts` Node strip-types 语法检查通过。Windows Text Cursor Indicator 的最终视觉仍以 Windows Terminal 实机验收为准。
- 交付：未冻结 `0.1.0` 继续覆盖同名正式源码包与 SHA-256，不创建临时 hotfix/fixed 包。

##15 · OpenTUI Active Renderer 迁移

- 日期：2026-09-14
- 目的：结束旧 Pi TUI + 手写 ANSI caret/mouse 补丁在 Windows Terminal 上持续出现的 Text Cursor Indicator 锚点漂移、Tab 模式切换后蓝色双标记复发与布局状态互相干扰问题；不再继续叠加局部光标补丁。
- Upstream 依据：按 MiMo Code 已验证组合锁定 `Bun 1.3.14 + @opentui/core@0.1.101 + @opentui/solid@0.1.101 + solid-js@1.9.11`，只吸收 `createCliRenderer`、原生 `TextareaRenderable`、Solid key/focus、Dialog/Flex layout 与 Bun build/plugin 用法；不复制 MiMo 的 Agent、Provider、Session、命令体系或品牌视觉。
- Active Renderer：新增 `apps/cli/opentui-runtime/` 作为独立 Bun/OpenTUI 前端域，主工作台改用原生 `<textarea>` 管理 caret/IME/selection/paste，多行输入、Tab/Shift+Tab 模式切换、Ctrl+P/Ctrl+K、Esc、Provider/Model/Reasoning、Tool Approval、鼠标与 resize 统一进入同一 Renderer 生命周期；`apps/cli/src/tui.ts` 暂只保留 Workspace Trust、纯合同与历史回归兼容，不再承担主工作台。
- 布局：新增 `apps/cli/src/opentui-layout.ts` 纯函数，Home/Transcript/Prompt/Shortcut/Notice 使用同一居中响应式宽度；OpenTUI 迁移只更换 Renderer，不改变既有 Xiaoyu 视觉规格；112 列终端继续使用 92 cell 内容宽度、左右各 10 cell 对称留白。
- 依赖边界：OpenTUI 依赖固定放 `apps/cli/opentui-runtime/package.json`，由 Bun 独立安装，不进入根 pnpm Workspace lock；根 Node/pnpm 继续负责 XMA 业务、Server/Web/脚本，portable CLI 则由 Bun + Solid transform plugin 编译为 `xiaoyu[.exe]`，Server 仍使用随包 Node Runtime。
- 环境/发行：Windows `[1]` 与 Unix prepare 新增固定 Bun/OpenTUI 准备，CI/Release 同样独立 `bun install --cwd apps/cli/opentui-runtime --no-save`；`build:cli` 经 `scripts/cli/bun.ts` 构建，portable staging/installer 改为分发编译后的 `app/xiaoyu.exe` 或 `app/xiaoyu`。
- 回归合同：Active OpenTUI 源码静态禁止 `CURSOR_MARKER`、手写 DECTCEM、手写 mouse capture/release 与 `new toolkit.TUI`；新增离线测试验证固定版本、原生 Textarea/focus、动态加载边界及响应式左右对称布局，并把 OpenTUI runtime 纳入中文文件头 Gate。
- 当前验证：本沙箱已完成变更文件 TypeScript/TSX 语法转译、OpenTUI 纯合同测试 4/4、Unix Shell `sh -n` 与 9 项静态 Gate；Source Manifest 已在本批重新生成。另新增 `scripts/cli/smoke.ts`，Windows/Unix `[7]`、CI 与 Release 在依赖已准备环境中都会先编译 `xiaoyu[.exe]`，再执行 `--version` / `--help` 无交互烟测，避免“静态 Gate 通过但 OpenTUI Native CLI 实际不能启动”。当前沙箱没有 Bun/OpenTUI node_modules 且无法访问 npm registry，因此不冒充执行本机 OpenTUI Native build 或完整 `pnpm typecheck`。Windows Terminal 最终仍必须实机验收原生 caret/IME、Tab/Shift+Tab 后焦点不漂移、蓝色 Text Cursor Indicator 不再跑到屏幕其他位置、Ctrl+P/Ctrl+K/Esc、鼠标拖动、resize 与退出状态恢复。
- 交付：未冻结 `0.1.0` 继续只生成正式 `xma-0.1.0.zip` + `xma-0.1.0.sha256.txt`，禁止临时 OpenTUI/fixed/hotfix 包名。



##16 · OpenTUI 视觉兼容、Bun 缓存收口与 Windows Typecheck 修复

- 日期：2026-09-14
- 目的：修复首轮 OpenTUI 实机迁移暴露的三个问题：`[4]` 视觉与已经验收的 Xiaoyu Terminal 差异过大、`[7]` 在 `build.ts` 的动态 compile target 上触发 TypeScript `TS2322`、`[1]` 会重复执行独立 OpenTUI install 且一次性 Bun ZIP/解压副本长期占用项目空间。
- 视觉兼容：OpenTUI 只替换 Renderer/Input/Focus，不重新设计 Xiaoyu。Home 内容宽度恢复迁移前规则（常规终端左右各约 10 cell、112 列为 92 cell）；Prompt 恢复三行连续模式色竖轨“输入 / 空行 / Build|Plan|Compose 状态”，命令/输入/Tool Approval modal 移除额外边框卡片外观，继续沿用既有黑底、留白、Logo、提示与三列命令结构。
- Bun Runtime：固定 Bun 1.3.14 仍只在本机尚未准备时下载一次，安装后的唯一项目内 Runtime 为 `.xma/tools/bun/1.3.14/bun.exe`；下载 ZIP 与临时解压目录在校验成功后立即删除，不再长期留在 `.cache/bun`。
- OpenTUI 依赖：独立依赖继续位于 `apps/cli/opentui-runtime/node_modules`，不进入根 `node_modules`；`[1]` 会检查 `@opentui/core/@opentui/solid 0.1.101 + solid-js 1.9.11`，完全匹配时跳过重复 `bun install`。同时把 Solid peer 从错误的 1.9.10 修正为 OpenTUI 0.1.101 实际要求的 1.9.11，消除 `incorrect peer dependency` 警告。
- 构建修复：`apps/cli/opentui-runtime/build.ts` 不再用 `process.arch` 拼出过宽字符串联合；改为显式枚举 Windows/Linux/macOS 的 x64/arm64 Bun compile targets，从类型层排除 `bun-darwin-arm` 等非法目标，修复 Windows `[7]` 的 TS2322。
- 验证：OpenTUI 纯合同测试与布局测试继续作为离线回归；Windows `[7]` 在用户环境中应继续完成完整 `pnpm check → build:cli → smoke:cli`，最终 Native Renderer/IME/caret 以 Windows Terminal 实机为准。


##17 · 开发环境幂等准备、OpenTUI 启动修复与全量检查回归

- 日期：2026-09-14
- 目的：修复 Windows 实机暴露的三类问题：`[1]` 在依赖已准备后仍重复执行 pnpm/esbuild/Cargo/PATH 写入；`[7]` 因居中快捷栏测试仍按“无外边距”旧假设失败；`[4]` 的 Bun 参数顺序把 `../src/main.ts` 误判为 package script，导致只打印 `bun run` 帮助并报 `No scripts found in package.json`。
- `[1]` 幂等化：新增 `.xma/state/prepare` 本地指纹，仅当 Workspace package.json / `pnpm-lock.yaml` / `pnpm-workspace.yaml` / 平台发生变化时重跑 `pnpm install --ignore-scripts + pnpm rebuild esbuild`；首次没有 stamp 但已有 node_modules 时先用 offline/frozen + tsx 探针认领旧缓存。Cargo 同样先 `fetch --locked --offline` 验证本地 crate 缓存，只有缺失时才联网 `fetch --locked`。固定 Bun 仍只缺失/版本错误时下载；OpenTUI 四个固定包（core/solid/solid-js/@types/bun）版本完全匹配时跳过 `bun install`。
- PATH 幂等化：`.xma/dev-bin/xiaoyu.cmd`、`xma.cmd`、`source-root.txt` 只在内容变化时重写；User PATH 只有目标值真正变化时才调用 `SetEnvironmentVariable`，已匹配时输出缓存命中。
- `[4]` 启动：`scripts/cli/bun.ts` 改为把进程 `cwd` 固定到 `apps/cli/opentui-runtime`，再执行 `bun run --no-install ../src/main.ts`；不再使用错误的 `--cwd ... run` 排序。这样 `bunfig.toml` / OpenTUI preload 在真实 Runtime 目录生效，同时锁死运行/构建阶段不自动下载依赖。Windows CLI Native build 复用统一 `.cache/cargo-target` 增量缓存，只把最终 exe 复制到唯一 run staging，避免重复编译同一 crates。
- `[7]` 回归：快捷栏实现本身保持“左右对称外边距 + 内部等距”的既定视觉；修正测试为先 `trim()` 验证首尾内容，再独立断言左右 outer padding 相等，避免把正确居中产生的 1-cell 外边距误判为失败。新增 Bun runner 静态回归，锁定 runtime cwd、`--no-install` 与禁止旧 `['--cwd', ...]` 参数顺序。
- Gate：Windows Gate 同步锁定准备指纹、Cargo `--locked`、PATH no-op 与共享 Cargo target；Distribution Gate 锁定 Bun runner 的 cwd/no-install 合同。当前沙箱 OpenTUI runtime 纯测试 7/7 PASS，Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate PASS。完整 `pnpm check → build:cli → smoke:cli` 仍由用户 Windows 已准备环境作为最终 Native/OpenTUI 证据。
- 交付：未冻结 `0.1.0` 继续覆盖生成同名 `xma-0.1.0.zip` + `xma-0.1.0.sha256.txt`；Source Manifest 随本批重新生成。

##18 · OpenTUI 实机回归：Logo 行距、鼠标返回语义与 Gate 依赖边界

- 日期：2026-09-14
- 目的：修复 Windows 实机继续暴露的三个回归：OpenTUI Logo 每个像素行之间被父级 `gap=1` 插入空行导致字形被纵向拉散；Ctrl+P 命令面板把普通左键点击背景误当成取消/返回；Comments Gate 在 `[1]` 安装独立 OpenTUI 依赖后递归扫描第三方 `node_modules`，从而错误要求依赖源码带 XMA 中文文件头。
- Logo：父级不再对 Logo 的五个 glyph row 统一施加 gap；星点与 Logo、Logo 与 tagline 的呼吸间距改为显式局部 padding，五行 `XIAO / YU` 像素字恢复连续渲染，保持迁移前 Xiaoyu 视觉比例。
- 鼠标语义：ListDialog 全屏 backdrop 的普通鼠标 down/up 只 stop propagation，不再执行 `finish(undefined)`；返回/取消仍只由 Esc（或明确的业务取消动作）触发。菜单项自身的点击仍执行该项，不把点击空白区域解释成“返回上一步”。
- Gate：Comments Gate 增加统一 third-party/build/cache 目录排除，至少跳过 `node_modules/.git/.cache/dist/build/target/coverage`；Gate 只检查 XMA 第一方源码，不扫描 OpenTUI/Babel/Jimp 等已安装依赖。
- Workspace：Bun 仍以 `apps/cli/opentui-runtime` 为 runtime cwd 解析 OpenTUI，但 `[4]` 没有显式 Workspace 参数时会把仓库调用目录作为默认 Workspace 参数传给 `main.ts`，避免 footer/Agent Workspace 错显示为 `apps/cli/opentui-runtime`。
- 回归：新增 Logo 连续行、Command Palette backdrop 不返回、Comments Gate 忽略 node_modules 与 Bun 默认 Workspace 静态合同；未改变 OpenTUI 固定版本与 Native/Agent/Provider 安全边界。


##19 · OpenTUI 首页视觉对齐与 Comments Gate 路径级忽略

- 日期：2026-09-14
- 目的：继续收口 Windows 实机反馈：`[7]` 仍会把 OpenTUI 独立依赖里的第三方源码误判为需要中文文件头；OpenTUI 首页需要更贴近参考图的居中视觉，并加入像素星空/流星氛围，而不破坏 Xiaoyu 自身品牌与既有交互合同。
- Gate：`scripts/gates/comments.ts` 在目录名忽略之外，新增按完整路径 segment 的统一忽略判断；即便第三方依赖通过嵌套路径、符号链接或其他路径组合出现，只要命中 `node_modules/.git/.cache/dist/build/target/coverage` 任一 segment，就不会再被中文文件头 Gate 扫描。
- OpenTUI 首页：`apps/cli/opentui-runtime/app.tsx` 新增 `BackgroundSky`，在 vivid 模式下渲染像素星点与间歇性流星；Home 页面改为更强的居中 Hero 布局，Logo、Prompt Dock、快捷键与提示集中在中部区域。输入区保持 Xiaoyu 既有三段式模式竖轨，但 Home 态为参考图增加深色卡片式 Dock，形成更稳定的视觉聚焦。
- 交互边界：命令面板与输入焦点语义不变，Esc 仍是返回/取消主通道；背景动画只承担视觉装饰，不接管 Provider/Session/Native 逻辑，也不引入新的点击返回语义。
- 回归：OpenTUI 静态合同测试补充像素星空/流星与居中 Dock 检查；Comments Gate 测试补充 `hasIgnoredSegment` 路径级忽略合同。最终 `[7]` 完整通过与首页视觉效果仍需用户 Windows 已准备环境实机确认。
- 交付：未冻结 `0.1.0` 继续覆盖生成正式 `xma-0.1.0.zip` 与 `xma-0.1.0.sha256.txt`，不创建临时 hotfix/fixed 包名。

##20 · Windows 实机收口：Gate 依赖岛、平滑星空流星与实时打字机

- 日期：2026-09-14
- 依据：直接检查 GitHub `yubboo/xma` 最新提交 `d9d6f973045505643c8b444f7a634940a37ed160`，并以用户 Windows Terminal 实机截图与 `[7]` 输出为最终问题证据，不再基于旧本地快照猜测。
- `[7]` 根因收口：`apps/cli/opentui-runtime` 是独立 Bun 依赖岛，Comments Gate 不应递归该目录再尝试排除 `node_modules`；改为从通用 roots 中移除整个依赖岛，仅显式检查 `app.tsx` 与 `build.ts` 两个第一方入口。即使 Windows/Bun 使用 junction、nested node_modules 或第三方包携带 `.ts/.d.ts`，Gate 也不可能再进入依赖树。
- 动画性能：vivid 背景由 420ms 粗粒度帧改为 60ms 视觉帧；星点按独立 period/offset 循环亮度与 glyph，恢复连续闪烁；流星周期拉长为间歇出现、单次约 25~28 帧，方向统一为右上 → 左下，并把尾迹放在头部右上方。
- 层级：背景星空固定 `zIndex=0`，主 TUI / footer 固定更高层；Logo、Transcript、快捷栏、提示与 Dock 都使用不透明工作台背景遮罩，流星可以“从后面经过”，但不会再穿过 `XIAOYU`、输入卡或对话文本。
- 实时回复：OpenTUI 在提交后立即显示 `Think · 正在思考…`；Provider 的 `reasoning-delta/text-delta/tool` 事件进入 30ms 缓冲泵，按 backlog 自适应 3/6/10/18 个字符逐批投影，既保留真实 streaming 顺序，又在 Provider 偶尔一次返回大块文本时仍呈现稳定打字机吐字。底部提示同步区分“正在思考 / 正在生成回复 / 正在执行工具”，Ctrl+C 继续中止。
- 运行边界：Agent Runtime、Provider SSE、Tool Approval、Session durable truth 均未改语义；本批只修 Gate ownership 与 OpenTUI 投影/动画层。OpenAI-compatible Adapter 与 AgentRuntime 已确认原本就逐 chunk 发 `model/reasoning-delta` / `model/text-delta`，静默感来自 UI 缺少平滑投影与明确等待状态，而不是把模型调用改成非流式。
- 回归：OpenTUI 离线静态合同扩展到 12 项，覆盖依赖岛显式文件、右上→左下流星、居中 Dock、空白点击不返回、思考状态与打字机缓冲；Comments Gate 另用伪造 `apps/cli/opentui-runtime/node_modules/fake-dep/index.ts` 验证后仍 PASS（84 个第一方源码）。变更 TS/TSX 使用 TypeScript 5.8 transpile parser 语法检查 PASS。
- 实机边界：完整 `pnpm check → build:cli → smoke:cli` 与 OpenTUI Native 动画帧率仍必须由用户 Windows 已准备环境执行；本沙箱没有项目 node_modules/Bun Native Runtime，因此不冒充本地跑过完整 `[7]`。
- 交付：未冻结 `0.1.0` 继续覆盖正式 `xma-0.1.0.zip` + `xma-0.1.0.sha256.txt`，禁止 fixed/hotfix 临时命名。

##21 · 对话 ScrollBox 历史浏览与 OpenTUI parser worker 构建修复

- 日期：2026-09-14
- 依据：用户 Windows Terminal 实机截图显示长回复超过可视高度后顶部内容被裁掉，Windows Terminal 原生滚轮在 OpenTUI alternate-screen 中不再承担 scrollback；同时直接读取 GitHub Actions run `34807868323`，确认 `[7]` 的真实失败点已经不在 `pnpm check`，而是 `pnpm build:cli`：`Cannot find module '@opentui/core/parser.worker.js'`。
- `[7]` 构建根因：`apps/cli/opentui-runtime/build.ts` 使用 `Bun.resolveSync('@opentui/core/parser.worker.js', ...)` 走 package exports 解析，但 OpenTUI 0.1.101 的 parser worker 是构建时需要作为额外 entrypoint 嵌入 BunFS 的真实文件，不应依赖 package subpath export。修复方式与 MiMo Code 0.1.101 基线一致：优先直接定位 `apps/cli/opentui-runtime/node_modules/@opentui/core/parser.worker.js`，再回退根 node_modules，校验存在后 `realpathSync` 并作为 Bun.build entrypoint 注入。
- 对话历史：Active OpenTUI Transcript 改为原生 `<scrollbox>`，使用 `stickyScroll=true + stickyStart="bottom" + viewportCulling=true`；不再 `slice(-18)` 截断历史。长单条回复和多轮历史都保留在 ScrollBox 中，新内容默认跟随底部，用户滚轮向上后可停留查看旧内容，回到底部后恢复 sticky。
- 滚轮命中：ScrollBox 横向命中区扩展到整个终端宽度，内部正文仍按 `openTuiContentWidth()` 居中，因此鼠标不必精准停在文字上才能滚动；隐藏 scrollbar 仅保留滚轮体验。另补 PageUp/PageDown 和 Ctrl+Home/Ctrl+End 作为键盘历史浏览兜底，不抢占普通输入字符。
- 层级：对话正文仍由居中的不透明背景块承载，星空/流星保持背景层，不会穿过正文；Prompt/快捷栏/footer 继续固定在 ScrollBox 之外，不再被长输出挤出可视区域。
- 回归：OpenTUI 静态合同新增 parser worker 真实路径、禁止 `Bun.resolveSync('@opentui/core/parser.worker.js')`、ScrollBox/sticky/full transcript/PageUp-End 合同。完整 Native build/smoke 仍以用户 Windows `[7]` 与 GitHub CI 为最终证据。
- 交付：未冻结 `0.1.0` 继续覆盖正式 `xma-0.1.0.zip` + `xma-0.1.0.sha256.txt`。

##22 · OpenTUI 特效设置分层、MiMo 风格流星与 Xiaoyu Logo 渐变

- 日期：2026-09-14
- 目的：根据 Windows Terminal 实机截图继续收口视觉与设置体系：流星需要呈现 MiMo Code 同类的长点阵尾迹，从右上向左下掠过；Xiaoyu Logo 保持自身像素字形，但每隔数秒出现横向颜色高亮扫过；Ctrl+P → 设置需要拆成可逐层返回的子菜单，并能独立开关星星、流星和 Logo 渐变。
- 设置持久化：`TerminalUiSettings` 新增 `stars / meteors / logoGradient` 三个布尔项，旧 `tui.json` 缺少字段时按开启迁移；默认仍为 vivid + tips + auto logo，并默认开启三类视觉特效。设置继续写入既有用户配置文件，不进入 Workspace/Session durable truth。
- 设置导航：OpenTUI `Ctrl+P → 设置` 改为三级导航根：`外观 / 特效 / 系统`。外观包含显示模式与 Logo 模式；特效包含星星闪烁、流星坠落、Logo 颜色渐变和全部特效总开关；系统包含提示信息与恢复默认。子菜单 Esc 返回设置根，设置根 Esc 返回 Ctrl+P 命令面板，普通鼠标空白点击仍不承担返回语义。
- 流星视觉：背景轨迹改为长点阵拖尾，头部高亮、尾部蓝灰逐级衰减；轨迹只在错峰周期内短暂出现，运动方向固定右上 → 左下。动画保持背景层 `zIndex=0`，正文/Logo/Dock/快捷栏继续使用前景层与不透明遮罩，特效不会覆盖可读内容。
- Logo 动画：Xiaoyu 原有橙色 `XIAO` + 灰色 `YU` 像素字不改造品牌结构，只增加一条白→暖橙→灰的高亮带周期性横向扫过。Logo 渐变独立开关，并受 vivid 总显示模式控制；minimal 模式保持静态 Logo。
- 性能：全局视觉 tick 调整为 50ms；流星使用每 tick 位移，星星降频为 3 tick 一次，Logo 渐变降频为 2 tick 一次，避免所有视觉元素都以同一高频率重算。
- `[7]` 构建：继续修复 OpenTUI parser worker。`build.ts` 以 `apps/cli/opentui-runtime` 作为 Bun.build cwd，直接读取已准备依赖岛中的 `node_modules/@opentui/core/parser.worker.js`，并按该 cwd 计算 BunFS 相对路径；不再使用失败的 package subpath resolve。该方式与 MiMo Code 0.1.101 构建策略对齐。
- 回归：OpenTUI 静态合同补充层级设置、三项特效持久化、右上→左下长尾流星、Logo 高亮扫过和 parser worker cwd/relative-path 约束。Native build/smoke 仍由 Windows `[7]` 与 GitHub CI 作为最终平台证据。
- 交付：`0.1.0` 未冻结，继续只生成 `xma-0.1.0.zip` 与 `xma-0.1.0.sha256.txt`，不创建临时 fixed/hotfix 包名。

##22 · Bun Windows compile 临时目录与稳定构建修复

- 日期：2026-09-14
- 现象：Windows `[7]` 已通过 99 个测试和 9 个 Gate，但 `pnpm run build:cli` 在 Bun 1.3.14 compile 阶段报 `failed to copy bun executable into temporary file: ENOENT / Failed to get temp file path: FileNotFound`。
- 根因边界：失败发生在 Bun 单文件 compile 自身创建/复制临时 bun.exe 的阶段，不是 TypeScript、OpenTUI parser worker、Agent Runtime 或用户 Provider 配置失败。构建入口此前直接继承用户进程的临时目录环境，无法保证 TEMP/TMP/TMPDIR/BUN_TMPDIR 指向真实可写目录。
- Runner：`scripts/cli/bun.ts` 在 build 前选择并创建可写临时目录，写入探针验证后，同时固定 `BUN_TMPDIR/TMPDIR/TEMP/TMP`；Windows 优先使用 `%LOCALAPPDATA%\\Temp\\xma-bun-compile\\1.3.14`，不再信任失效的临时目录环境。
- Build：`apps/cli/opentui-runtime/build.ts` 先把单文件可执行程序编译到上述临时目录，成功后再复制到 `dist/cli/xiaoyu.exe`；避免项目 checkout 位于 CJK/特殊字符路径时让 compile 输出路径直接参与 Bun 的临时可执行文件处理。
- 稳定性：Bun 1.3.14 Windows compile 暂停 `minify`，优先保证 `[7]` / Release 的可复现构建与烟测；后续升级 Bun 后再单独评估恢复压缩。
- 回归：OpenTUI 测试新增编译临时目录、四个环境变量、staged outfile 与最终复制合同检查。

##20 · 模型配置弹层居中、Esc 返回与光标焦点修复

- 日期：2026-09-14
- 目的：修复 OpenTUI 模型配置流程的三个实机问题：非搜索列表残留底层输入光标、弹层偏上不居中、首次配置虽然显示 `esc` 但逻辑上禁止取消；同时收紧 Provider 菜单文案，避免描述过长和语义含混。
- 焦点：打开 List/Input/Approval modal 前显式 `prompt.blur()` 并隐藏原生 cursor；主 Prompt 不再声明永久 `focused`，而由工作台 `refocusPrompt()` 在 modal 关闭后恢复焦点。非搜索列表与 Secret 输入不会再留下底层白色 caret。
- 布局：List/Input dialog 改为水平 + 垂直真正居中；列表最大宽度收窄，标签列由 24 收到 20 cells，Provider 两列信息更紧凑。
- 返回：首次 Provider/Model/Reasoning/API Key 配置不再传 `allowCancel: false`；所有显示 `Esc 返回/取消` 的步骤都复用统一 cancel path，Esc 可真实回到上一级/工作台。
- 文案：`添加提供方`、`自定义提供方`、Provider Catalog 与连接测试说明改为短句；自定义 Catalog 名称统一为 `自定义接口`，说明为 `OpenAI 兼容 · 自定义 Base URL`；DeepSeek 等官方 Provider 说明统一为 `官方 API · 自动读取模型`。
- 交付：未冻结 `0.1.0`，继续覆盖生成 `xma-0.1.0.zip` 与 SHA-256 文件。

##20 · 首次 Provider 配置向导连续性与 DeepSeek V4 当前模型目录

- 日期：2026-09-14
- 目的：修复首次配置 DeepSeek 时 API Key 保存后短暂闪回主工作台、随后才弹出模型选择的问题；同时同步 DeepSeek 官方当前 API 模型名，避免旧别名继续出现在模型选择器中。
- 首次配置流程：OpenTUI 新增首次配置向导遮罩状态。API Key 输入完成后，工作台保持在配置流程中，依次显示“保存凭据 / 读取最新模型 / 选择模型 / 验证连接”；完成模型选择与连接验证后才进入主工作台。首次配置不再额外强制弹出推理强度选择，推理强度仍可在 Ctrl+P → 模型 / 提供方 中修改。
- DeepSeek 模型：内建目录固定当前公开基线 `deepseek-v4-pro`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`；`deepseek-chat`、`deepseek-reasoner`、`deepseek-flash` 作为旧/停用别名不再展示。`/models` 动态发现仍保留，未来出现的新模型 ID 会追加在当前官方基线之后。
- 选择器说明：为 V4 Pro 0813、V4 Flash 0731 与 V4 Flash Vision 实验版增加简短说明；Vision 实验版可以出现在模型列表中，但当前 Terminal 输入链路仍以文本为主。
- 回归：Brain Catalog 测试锁定 DeepSeek 当前模型集合和旧别名排除；OpenTUI 回归锁定首次向导连续显示、API Key → 模型 → Probe 顺序，以及首次配置不再强制插入 reasoning 选择页。

##24 · 官方 Provider 单例化与重复 Profile 自动合并

- 日期：2026-09-14
- 目的：修复重复配置 DeepSeek 后出现 `DeepSeek` / `DeepSeek 2` 两个 Profile，并导致主工作台显示 `DeepSeek · DeepSeek 2 · model` 的身份重复问题。
- Brain：官方 Provider 改为单例语义；启动时自动合并同一官方 providerId 的历史重复 Profile，优先保留当前活动项并把显示名恢复为官方品牌名。自定义 OpenAI-compatible Provider 继续允许多 Profile。
- Credentials：被合并移除的历史官方 Profile 若使用 OS Credential，其旧 credential alias 由启动流程 best-effort 清理；活动 Profile 的凭据与模型保持不变。
- 配置：再次添加 DeepSeek 时更新现有 DeepSeek 配置，不再自动创建 `DeepSeek 2/3`。模型 / 提供方页的官方 Profile 行只显示一次品牌名，说明列只显示当前模型。
- Workbench：状态栏统一显示 `DeepSeek · <model> · <reasoning>`；不会再拼接 Provider 品牌与 Profile 别名两层身份。
- 回归：新增 Brain consolidation 测试与 OpenTUI Provider identity 静态合同测试，锁住官方 Provider 单例与主界面单品牌显示。


##25 · MiMo 同类 Braille 子像素流星与透明前景层

- 日期：2026-09-14
- 目的：修复现有流星“整体向左平移、字符折线感明显、中部被大面积背景遮罩吃掉”的视觉问题；继续保留 Ctrl+P → 设置 → 特效 中的独立开关。
- 上游研究：直接审阅 XiaomiMiMo/MiMo-Code 当前 `packages/opencode/src/cli/cmd/tui/component/starry-background.tsx`。其流星不是预制 glyph 队列，而是使用单一 `StyledText` 背景平面，把连续浮点轨迹按 2×4 Unicode Braille 子像素采样；头部为小型高亮核，长尾沿真实运动向量反向延伸并按距离/生命周期衰减。星空以较低 200ms 粒度更新局部亮度，流星仅在活动期间以 50ms 刷新。
- Xiaoyu 实现：移除 `METEOR_TRACKS + METEOR_TRAIL` 固定字符步进；采用 `METEOR_ANGLE=0.36 / TAIL=32 / STEP=0.15 / DURATION=3600ms / FRAME=50ms` 的连续轨迹。起点位于右上约 15% 区域，运动向量固定左下，速度根据当前终端高度计算，避免宽屏下只水平滑过。
- 性能：星空和流星合并为一个全屏 `StyledText`，不再为每个星点/尾迹创建独立绝对定位 Box；无流星时只由 200ms 星点亮度变化触发，流星活动期间才进入 50ms 帧刷新。
- 层级：StarryBackground 继续固定 `zIndex=0`，业务 UI 在前景层；Logo、Transcript、快捷栏、提示、footer 去掉无必要的大块 `COLOR.background` 遮罩，使流星可在空白区域连续穿过中部，但 Prompt 卡片等需要可读性的实体面板仍保持前景背景，不让装饰覆盖文本。
- 稳定性：清理迁移过程中误落入 ListDialog/InputDialog 的重复 `runInitialSetup` helper，并补回 `createEffect` 显式导入；避免后续 `[7]` TypeScript 检查出现无关回归。
- 回归：OpenTUI 静态合同改为锁定 Braille 位映射、连续左下运动向量、StyledText 单背景面、MiMo 同类帧率/尾长参数，并禁止恢复旧 `METEOR_TRACKS/METEOR_TRAIL` 字符队列。


##26 · 主输入光标降频与 OpenTUI 空闲性能收口

- 日期：2026-09-14
- 目的：根据 Windows Terminal 实机反馈，降低主 Prompt 首字符白色块光标的闪烁频率，并减少 vivid 首页在空闲状态下的无意义重绘；本批不改 Provider、模型配置、菜单、会话、Agent Runtime 与既有流星视觉语义。
- 光标：OpenTUI 0.1.101 原生 EditBuffer 光标默认 `blinking: true`，闪烁节奏由终端控制。主 Prompt 改为 `blinking: false` 的 block cursor，再由 Xiaoyu 以 800ms 半周期控制 `showCursor`，形成约 1.6 秒完整闪烁周期；输入、移动光标或重新获得焦点时立即显示，避免操作时等待下一帧。搜索框和配置输入框保持原生行为，不扩大改动面。
- Renderer：`targetFps/maxFps` 从 60 下调到 30；当前 TUI 没有 hover 交互，因此关闭 `enableMouseMovement`，保留点击和滚轮；Provider 状态轮询由 250ms 放宽到 1000ms，而配置/状态变更仍通过既有 `refresh()` 立即刷新。
- 动画：流星继续保持 50ms 轨迹帧，不为性能牺牲坠落平滑度；星星帧通过独立 `starFrame` memo 降频。Braille 流星尾部采样点预计算，活动帧使用数字 cell key 代替字符串 key/split，减少 Map 热路径中的短生命周期分配。
- 回归：OpenTUI 静态合同新增慢光标、30FPS renderer、关闭 mouse-move、1s clock 与流星低分配热路径检查。
- 交付：`0.1.0` 未冻结，继续只生成 `xma-0.1.0.zip` 与 `xma-0.1.0.sha256.txt`。


##27 · Provider 配置真值与 Prompt 状态左右布局

- 日期：2026-09-14
- 目的：修复主工作台同时显示具体 Provider/Model，但提示区又写“模型未就绪/像未配置”的语义冲突；并把 Prompt 状态行改为左右两端布局，左侧固定 Build/Plan/Compose，右侧展示 Brain 配置真值。
- 真值语义：`providerConfigured` 只表示已经存在活动 Provider/Profile/Model 配置；`providerReady` 表示该配置当前已经通过凭据与真实 Provider Probe。两者不再混写。未配置时明确提示“模型未配置”，已配置但未 Ready 时明确提示“模型已配置 · 尚未就绪”，避免把“尚未验证/连接未通过”误说成“没有配置”。
- 主状态行：OpenTUI Prompt 第三行改为两端对齐。左侧模式标签保持原位置；右侧在已配置时显示 `●/○ Provider · Model · Reasoning`，未配置时显示 `○ 模型未配置 · Ctrl+P /provider`。Reasoning 只在存在 Provider 配置时展示。
- 提示入口：未配置提示统一给出 `Ctrl+P → 模型 / 提供方` 和 `/provider` 两条可执行入口；已配置但未 Ready 时提示进入“连接测试”。Ready 后恢复普通轮播提示。
- 兼容：旧 Pi TUI compatibility renderer 同步采用相同左右布局与配置真值语义，避免未来 fallback/测试路径再次产生不同产品表达。
- 回归：更新 `tui.test.ts` 的配置/Ready 三态语义，并新增 OpenTUI 状态行 `space-between`、未配置文案与 Reasoning 条件展示合同。

## 20 · Windows 新电脑 Rustup/Path 自愈

- 日期：2026-09-14
- 目的：修复新电脑运行 `xma-dev.bat → [1]` 时，`rustup` shim 已存在但没有 default/active toolchain，导致 `[8/9] cargo fetch` 报 `rustup could not choose a version of cargo to run`；同时增强源码入口对不同盘符、空格/中文路径和刚安装工具 PATH 尚未刷新场景的兼容。
- Rust：准备流程不再把“存在 cargo.exe/rustc.exe”误判成 Rust 已可用。若检测到 rustup，会先检查 stable toolchain 是否已安装；缺少时只安装 minimal stable，并在 XMA 项目目录设置 `rustup override set stable`，不修改开发者其他项目使用的全局默认 toolchain。随后真实执行 `rustc --version` / `cargo --version` 验证，失败即在 `[5/9]` 明确中止，不再拖到 `[8/9]` 才暴露错误。
- PATH：`Refresh-XmaPath` 改为合并 `.cargo\\bin + Machine PATH + User PATH + 当前进程 PATH` 并去重，不再为了刷新 winget/rustup/npm 安装结果而丢失调用者已有的临时路径；进入 `[1/9]` 前先刷新一次，因此新终端和刚安装工具都能在同一轮准备流程被发现。
- Launcher：`xma-dev.bat` 使用 `pushd "%~dp0"` 和 PowerShell 命名参数转发 `-Command/-Workspace`，不再直接 `%*` 拼接；保留调用者 Workspace，并加强任意盘符、空格、中文路径下的入口稳定性。
- Gate：Windows Gate 更新为锁定项目级 stable override、PATH 自愈和安全 launcher 参数转发，防止后续回退到只检查 shim/全局 default 的旧逻辑。

##28 · OpenTUI 动画拆帧后的回归测试合同同步

- 日期：2026-09-14
- 现象：Windows `[7]` 的 TypeScript 检查与绝大多数测试均通过，但 OpenTUI 流星回归测试仍断言旧接口 `frame={phase()}`，导致 108 个测试中 107 通过、1 个失败，阻断后续 Gate / build 阶段。
- 根因：`##26` 已把背景动画拆成低频 `starFrame` 与高频 `meteorFrame` 以优化空闲性能；运行时代码已经使用 `starFrame={starFrame()}` 和 `meteorFrame={phase()}`，但静态回归测试没有同步更新，继续锁定已废弃的单一 `frame` prop。
- 修复：测试合同改为显式验证 `starFrame = floor(phase / 4)`、`starFrame={starFrame()}` 与 `meteorFrame={phase()}`，继续锁定 Braille 流星、稀疏渲染和禁止全屏 StyledText 覆盖的安全边界。
- 验证：在无项目 node_modules 的隔离环境中使用 Node.js 22 的 type stripping 直接执行 `apps/cli/tests/opentui-runtime.test.ts`，24/24 PASS。该批只修改测试合同与 UPDATE-LOG，不改 TUI Runtime、Provider、模型配置、流星实现或构建逻辑。


##29 · Windows 新机依赖真实探测、Rust 安装位置与 Desktop 构建隔离

- 日期：2026-09-14
- 目的：根据全新 Windows 机器实测修复 `[1]` 在 rustup shim 存在但没有 toolchain/default 时直接失败的问题，并按用户要求给 Rust 提供 C/系统默认、D 盘和自定义安装位置；同时修复 `[5]/[6]` Desktop 构建错误捎带 CLI/Server/全 Rust workspace，导致无关 CLI 失败阻塞桌面安装包。
- Bun/OpenTUI：`[4/9]` 继续使用项目级 `.xma/tools/bun/1.3.14/bun.exe`。文件不存在或版本不符才下载，存在且版本正确显示缓存命中并跳过下载；OpenTUI package 仍独立位于 `apps/cli/opentui-runtime/node_modules`。
- Rust 真实探测：`[5/9]` 首先真实执行 `rustc --version` / `cargo --version`。`rustup.exe/cargo.exe/rustc.exe` shim 文件存在不再等价于 toolchain 可用；rustup 的 `no toolchain/default` stderr warn 通过可恢复 Probe 处理，不再被 `$ErrorActionPreference='Stop'` 提前升级成整个准备流程失败。若本机已经下载 stable 但仅未激活，则只设置 XMA 项目级 stable override，不重复下载。
- Rust 安装位置：真正缺少 stable 时先询问是否由 XMA 安装，再提供 `[1] 系统盘用户默认 XMA/Rust`、`[2] D:\XMA\Rust`、`[3] 自定义目录`。XMA 从 Rust 官方下载 `rustup-init.exe + .sha256`，校验 SHA-256 后以 minimal stable 安装；选定根目录下分别创建 `rustup/` 与 `cargo/`，持久化 User `RUSTUP_HOME/CARGO_HOME` 和对应 `cargo/bin` User PATH。D 盘不存在时不会假装创建盘符，而是要求改选。
- PATH：`Refresh-XmaPath` 同时识别进程级/User 级 `CARGO_HOME` 与传统 `%USERPROFILE%/.cargo`，合并 Machine/User/当前进程 PATH 并去重，支持自定义 Rust 位置且不覆盖其他临时路径。
- Desktop 构建隔离：`scripts/windows/xma-build-release.ps1` 改为真正 Desktop-only。Electron 路径只验证 Desktop 依赖、按需准备 Electron Runtime、运行 `apps/desktop/tests/*.test.ts`，随后调用 `build:desktop:electron`；Tauri 只在明确选择时要求 Cargo/预取 Tauri crates。删除 Desktop 流程中的 `pnpm run build`、`build:cli`、`build:server`、`cargo build --workspace`、`scripts/release/cli.ts` 和 CLI portable staging。
- 菜单：`[5]` / `[6]` 文案明确为 `Desktop 当前平台` / `Desktop Windows`，避免把“桌面安装包”误解为“全产品发行”。Xiaoyu Terminal portable 继续由独立 Release Workflow 构建。
- 回归：Windows/Distribution Gate 新增 Rust 安装位置、SHA-256、Desktop-only release 边界；同时同步此前 OpenTUI `enableMouseMovement=false` 的性能合同。隔离环境静态 9 Gate PASS，OpenTUI 定向测试 24/24 PASS；真实 Rust 下载与 Electron/Tauri Native 构建仍由 Windows 实机完成最终验证。

##30 · Electron Desktop 构建复用已准备 Runtime

- 日期：2026-09-14
- 目的：修复 Windows `[5]/[6]` 已显示 `Electron 41.2.0 Runtime 已就绪` 后，electron-builder 仍重新下载 `electron-v41.2.0-win32-x64.zip`，导致 Desktop 构建在 GitHub Releases 网络链路上长时间停滞的问题。
- 根因：XMA Runtime 安装器把已校验 Electron 解压到 `apps/desktop/node_modules/electron/dist` 并写入 `path.txt`，但 release build 只给 electron-builder 设置了下载缓存环境变量，没有通过 `electronDist` 明确指定这份已准备的 unpacked Runtime；因此 builder 仍按自己的 Electron 获取流程判断并下载发行 ZIP。
- 修复：`apps/desktop/scripts/electron/build.ts` 在生成 staging `electron-builder.json` 前，验证 Electron package 版本、`dist/version`、`path.txt` 与平台可执行文件，并把已验证的 `dist` 绝对路径写入 `electronDist`。构建脚本移除 `ELECTRON_CACHE` 回退，只保留 `.cache/electron-builder` 作为 builder 工具缓存；本地 Runtime 不完整时直接报错并引导从 Desktop 菜单显式准备。
- Windows 流程：`xma-build-release.ps1` 在 Runtime 验证通过后明确打印“electron-builder 通过 electronDist 复用，不会再次下载 Electron”；继续保持 `[1]` 不下载 Chromium、`[3]/[5]/[6]` 用户明确选择 Electron 时才允许准备 Runtime 的惰性下载规范。
- 回归：Desktop build-layout test、Architecture Gate 与 Windows Gate 增加 `electronDist` / 禁止 `ELECTRON_CACHE` / 本地 Runtime 验证合同，防止后续又退回 builder 自行下载 Electron。
- 交付：`0.1.0` 未冻结，继续覆盖生成正式 `xma-0.1.0.zip` 与 `xma-0.1.0.sha256.txt`，不创建 fixed/hotfix 临时包名。

##31 · 项目级 Bun 编译缓存、rustfmt 准备与动画光标锚定

- 日期：2026-09-14
- 目的：根据 Windows 实机反馈同时修复三类开发体验回退：Bun compile 默认写入 `C:\Users\<user>\AppData\Local\Temp`、`[7]` 最后才因缺少 `cargo-fmt.exe` 失败，以及 Windows Terminal 的真实文本光标被星星/流星动画帧带到装饰 glyph 的位置。
- Bun staging：`scripts/cli/bun.ts` 不再枚举 `LOCALAPPDATA/TEMP/TMP`。Bun Runtime 自复制、`BUN_TMPDIR/TMPDIR/TEMP/TMP` 与单文件临时 outfile 全部固定到项目 `.cache/bun-compile/1.3.14/`。该目录是可删除的 build cache；每次构建可自动重建，最终 `dist/cli/xiaoyu.exe` 只复制完整单文件结果，不依赖 `.cache` 或系统临时目录启动。
- Rust 准备：`[1]` 在真实验证 stable `rustc/cargo` 后继续执行 `cargo fmt --version`；minimal profile 缺少 rustfmt 时通过已有 rustup stable toolchain 安装 `rustfmt` 组件并再次验证。`[7]` 在 TypeScript/CLI 构建之前先做离线 rustfmt preflight，缺失立即提示运行 `[1]`，自身不下载。
- 光标：继续保留 OpenTUI 原生 `TextareaRenderable` 作为输入与 IME/focus 真值，不重新发明手写编辑器。动画 50ms phase 每帧同时请求聚焦 Prompt render，使前景 Textarea 的 `renderCursor()` 在装饰背景之后重新提交真实硬件 cursor 坐标；星点、流星、Logo 渐变只能改变画面，不能再改变硬件文本光标位置。
- 回归：OpenTUI 测试锁定项目 `.cache/bun-compile`、禁止 `LOCALAPPDATA/TEMP/TMP` fallback，并锁定动画帧 `prompt?.requestRender()`；Windows Gate 锁定 `[1] rustfmt` 安装职责与 `[7]` 离线预检。
- 交付：版本保持 `0.1.0`，继续覆盖正式 `xma-0.1.0.zip` 与 SHA-256，不生成 hotfix/fixed 临时命名。

##32 · Rust Home 恢复、Cargo 缓存真值校验与路径去硬编码

- 日期：2026-09-14
- 目的：修复 Windows 实机上 `[1]` 已明确使用 `D:\XMA\Rust`，但 `[4]` 仍在 `cargo build --offline` 阶段报 `serde` 不存在；同时清除维护者 Source Sync / GitHub Helper 对 `H:\一键部署\xma` 的默认硬编码。
- 根因：旧 `[8/9]` 只要 `Cargo.toml/Cargo.lock + Cargo 版本` fingerprint stamp 命中就直接跳过 `cargo fetch`，没有再次检查**当前 CARGO_HOME 的真实 registry/index/cache**。用户更换 Rust 安装位置、清理 Cargo 缓存或旧 stamp 来自另一 Cargo Home 时，会出现“[1] 显示 crates 已准备，实际 D 盘 Cargo Home 没有 serde”的假准备状态。
- Rust Home 真值：`[1]` 成功确认 Rust 后把有效 `CARGO_HOME/RUSTUP_HOME` 写入项目本地 `.xma/state/rust-environment.json`，同时仍保留 User 环境变量。Windows 控制台、Tauri Desktop 与 Desktop 发布入口统一从共享 `xma-common.ps1` 恢复 Rust 环境；读取顺序以 User 环境为权威、项目状态为恢复备份，再到当前 Process 环境。这样旧 Windows Terminal 未继承最新 User 环境时也不会误用另一套 Cargo。
- crates 准备：`[1]` 的 Cargo fingerprint 加入实际 `CARGO_HOME/RUSTUP_HOME`，但 stamp 只用于提示，不再当作“缓存一定存在”的证据。每次 `[1]` 都执行 `cargo fetch --locked --offline` 真值校验；缺 crate 时只在 `[1]` 联网 `cargo fetch --locked`，随后再次 offline 复检，确保 `[4]/[7]` 真能离线运行。
- CLI / 全量检查：`[4]` 和 `[7]` 在执行 build/check 前先恢复 `[1]` 的 Rust Home 并做 Cargo offline preflight；缓存不完整时直接提示回 `[1]`，不再把 `serde not found` 这类 Cargo 底层错误当成项目代码失败，也不在运行/检查阶段偷偷联网。
- 路径合同：`XMA-Sync.bat` 未设置 `XMA_TARGET_ROOT` 时根据**源码包自身位置**自动选择同级 `xma` / `xma-worktree`，复用已有 `.git` 或 `.xma/source-sync.json` worktree；不再默认 H:/D:/C:。`XMA-GitHub.bat` 只认脚本实际所在仓库根。普通 `git clone` 的“目标目录已存在且非空”仍是 Git 自己的覆盖保护，可选择其他目标名或进入已有仓库更新。
- 回归：Windows Gate 锁定 Rust 环境恢复、Cargo offline 真值校验、Tauri 复用 Cargo Home，以及 Sync/GitHub Helper 禁止重新出现维护者 H: 硬编码。版本保持 `0.1.0`。



##33 · Windows 中文路径 Bun compile 与 Git worktree 冲突收口

- 日期：2026-09-14
- 目的：修复 `[7]` 在 `H:\一键部署\xma` 等中文源码路径下执行 Bun 1.3.14 单文件 compile 时出现 `failed to copy bun executable into temporary file: ENOENT / Failed to get temp file path: FileNotFound`；同时继续收紧维护者工作目录选择，避免同名非 XMA 目录造成“路径绑死/覆盖”体验。
- Bun 根因：上一版已经把 `TEMP/TMP/BUN_TMPDIR` 从用户 C 盘迁移到项目 `.cache/bun-compile`，但 Bun 1.3.14 Windows 内部复制自身可执行文件时仍会经过对 Unicode 临时路径兼容不完整的底层逻辑。目录真实存在不代表 Bun 的内部临时文件 API 能正确处理中文路径。
- Bun 修复：真实缓存仍固定在当前 checkout 的 `.cache/bun-compile/1.3.14`。仅当 Windows 编译缓存路径含非 ASCII 字符时，runner 动态扫描一个空闲盘符，用系统 `subst.exe` 将该 `.cache` 临时映射为 ASCII 路径；`bun.exe` staging、`BUN_TMPDIR/TMPDIR/TEMP/TMP` 与 compile outfile 都通过该别名访问。build 子进程退出后在 `finally` 中立即 `subst /D` 解除映射。没有固定 C:/D:/H:，没有把真实文件搬到系统 TEMP，最终 `dist/cli/xiaoyu.exe` 不依赖映射或 `.cache`。
- Git/同步：`XMA-Sync.bat` 默认仍从源码包自身位置解析，不绑定盘符；目标名从固定两项扩展为 `xma`、`xma-worktree`、`xma-worktree-2..99` 自动选择。已有 `.git` 只有 origin 属于 `yubboo/xma`（或已有 Source Sync 状态）才视为可复用 XMA worktree；其他 Git/普通目录绝不覆盖。`XMA-GitHub.bat` 遇到错误 origin 改为拒绝执行，不再自动篡改其他仓库的 remote。
- clone 边界：用户直接执行 `git clone ...` 时，如果当前目录已经有非空 `xma/XMA`，Git 会在任何 XMA 代码运行前拒绝覆盖；仓库本身无法改变 Git 这个安全规则。README/Windows Workflow 改为明确“已有正确仓库就 fetch/pull；冲突就指定任意新目录名；维护者源码包直接 XMA-Sync 动态选择 worktree”。
- 回归：OpenTUI 定向测试锁定 `SUBST` Unicode alias、项目 `.cache` 真值与 `finally` 解除映射；Windows Gate 禁止 Bun runner 重新出现用户 TEMP fallback 或固定 C:/D:/H:。

##34 · 标准 Git clone 恢复与 Bun Home 可选安装

- 日期：2026-09-14
- 目的：纠正上一批把 Git 目录冲突引导成 `xma-work/xma-worktree` 的错误方向，并让 Windows `[4/9] Bun 1.3.14 / OpenTUI Runtime` 与 Rust/Cargo 一样拥有真实、可持久化的安装位置选择；后续 `[4]`、`[7]` 与 CLI build 必须统一复用用户选择的 Runtime。
- 标准 clone：公共源码流程重新锁死为 `git clone https://github.com/yubboo/xma.git` → `cd xma` → `.\xma-dev.bat`，不要求用户改 clone 目标名。Git 在父目录已有非空 `xma/XMA` 时会在任何仓库代码运行前拒绝覆盖；XMA 不能改写 Git 这个保护规则，但维护者脚本不再自动创建同级 `xma` 或 `xma-worktree-*` 制造冲突。`XMA-Sync.bat` 默认只复用已存在、origin 正确的 XMA Git 工作目录；没有目标时提示先执行标准 clone，或由维护者显式设置 `XMA_TARGET_ROOT`。
- Bun 安装位置：Windows `[1]` 首次没有有效 Bun 配置时提供“当前用户工具目录 / D 盘 / 自定义目录”三种选择。成功后写入 User `XMA_BUN_HOME`，并保存 `.xma/state/bun-environment.json` 作为旧终端尚未继承 User 环境时的恢复备份；Bun 版本仍固定 1.3.14。
- 真实恢复：`xma-console.ps1` 的 `[4]` / `[7]` 不再拼接 checkout `.xma/tools/bun/1.3.14/bun.exe`，而是通过 `xma-common.ps1` 从 User 环境/项目状态恢复 `XMA_BUN_HOME`，真实执行目标 `bun.exe --version` 后才继续。`scripts/cli/bun.ts` 同样读取 `XMA_BUN_HOME` / 项目状态，Windows 禁止因为 PATH 中碰巧存在另一个 Bun 而绕过用户选择；脚本根目录改由 `import.meta.url` 推导，不依赖调用者 cwd。
- 旧状态迁移：若 0.1.0 早期项目内 `.xma/tools/bun/1.3.14/bun.exe` 仍完整，`[1]` 会先让用户选择新位置，再把旧 Runtime 迁移过去，不重复下载；迁移成功后清理旧项目内版本目录。若用户选择位置本身已有正确 Bun，则直接接管并记录。
- 中文路径编译：上一批的项目 `.cache/bun-compile` + 单次动态 `SUBST` ASCII 别名继续保留，只解决 Bun 1.3.14 Windows `--compile` 对中文临时路径的 ENOENT；它不再承担 Bun 安装位置职责，真实 Runtime 来自 `XMA_BUN_HOME`，最终 `dist/cli/xiaoyu.exe` 不依赖 `.cache` 或 SUBST。
- 回归：Windows Gate 增加 Bun Home 选择/持久化/恢复合同，OpenTUI runner 测试锁定 `XMA_BUN_HOME`、项目状态和脚本位置解析，同时禁止 runner 回退到固定 checkout `.xma/tools/bun`；版本继续保持 0.1.0。

##35 · Source Sync 只复用真实仓库与根隐藏目录收口

- 日期：2026-09-14
- 目的：把维护者 Source Sync 最终收口到“识别/选择已有正确仓库”，不再把任何目录名、盘符或自动 worktree 创建当成流程；同时审计根目录 `.xxx` 条目，阻止无职责隐藏目录进入正式源码包。
- Sync 目标：`XMA-Sync.bat` 未设置 `XMA_TARGET_ROOT` 时先扫描源码包同级目录。唯一一个 `origin` 属于 `yubboo/xma` 的仓库可直接复用；存在多个时显示编号列表让维护者选择；没有时要求输入一个已经通过标准 `git clone https://github.com/yubboo/xma.git` 建立的仓库路径。输入路径必须存在且 origin 正确；Sync 禁止 `git init`、禁止创建 `xma/xma-worktree-*`、禁止改写其他仓库 origin。
- 显式目标：`XMA_TARGET_ROOT` 不再代表“允许 XMA 创建目标目录”，只允许指向一个已经存在、origin 正确的 XMA Git 仓库；错误路径或错误仓库直接 fail loud。
- 根隐藏目录：当前源码架构需要的根隐藏目录只有 `.agents/.cargo/.claude/.codex/.github`；`.cargo` 控制 Cargo target 收敛，`.github` 承载 CI/Release，三套 AI 目录是项目开发适配层，均不是垃圾目录。正式源码包额外保留 `.xma-package/source-manifest.json` 作为同步元数据；长期 Git 工作目录不需要 `.xma-package`，旧版若遗留会在 Sync 后清理；`.xma/.cache/.pnpm-store/.npm/.yarn/.turbo` 等本地状态不得进入源码包。
- Manifest：`source-manifest.ts` 新增根隐藏目录 allowlist，未知 `.xxx` 根目录即使本机存在也不会进入正式源码包；Architecture Gate 继续拒绝未知根源码条目。
- 文档/Gate：README、Windows Workflow、AGENTS、Development Rules、XMA Development Skill 与 Windows Gate 同步新合同，禁止再次出现“自动识别/创建 worktree”或用 `xma-work*` 代替标准 clone 的流程。

##36 · xma-path 统一依赖根、可跳过准备与 Bun/OpenTUI/Rust 真值恢复

- 日期：2026-09-15
- 目的：修复 Windows `[1]` 已存在旧 `.xma/tools/bun`，但新版又提示重新选择 Bun 安装位置的重复设计；同时按源码开发可移动/可换盘符要求，把 XMA 自管 Bun/OpenTUI/Rust、状态与开发 shim 收敛到明确的 `xma-path` 依赖根，并允许 Bun/Rust 在 `[1]` 中独立跳过、稍后单独补装。
- 依赖根：默认 `[1]` 使用 `<当前 checkout>/xma-path`，项目 clone 在 D:/E:/U 盘时依赖随项目位置解析，不主动把 XMA 自管 Bun/Rust 安装到系统 C 盘；`[2]` 使用 `D:/xma-path`，`[3]` 只接受用户输入的真实盘符并使用 `<盘符>:/xma-path`。目录内部固定为 `bun/`、`opentui/`、`rust/`，项目状态与开发命令使用 `state/`、`dev-bin/`。
- 准备流程：`[4/9] Bun/OpenTUI` 与 `[5/9] Rust/Cargo` 都先做真实探测；只有缺失时才询问 Y/N。选择 N 只跳过对应组件，Workspace JS 等其余步骤继续。主菜单新增 `[8] 单独安装 · Bun / OpenTUI` 与 `[9] 单独安装 · Rust / Cargo`，使用相同位置选择与校验逻辑。
- Bun/OpenTUI：旧 `.xma/tools/bun/1.3.14/bun.exe` 若真实版本正确，自动迁移到项目默认 `xma-path/bun`，不重复下载。OpenTUI 实体依赖迁移/安装到同一依赖根的 `opentui/node_modules`；源码 `apps/cli/opentui-runtime/node_modules` 只建立本地链接供模块解析，避免保存第二份真实依赖。`[4]/[7]/build:cli` 从 `xma-path/state/bun-environment.json` 恢复位置、重建必要链接并重新校验。
- Rust/Cargo：默认新安装到 `xma-path/rust/{rustup,cargo}`；如果用户原本已在 D:/E:/自定义位置安装且 `rustc/cargo` 真实探针通过，则直接采用并写回新的 `xma-path/state/rust-environment.json`，不重复安装。Cargo crates 继续用 offline 真值检查，避免 stamp 命中但 registry 实际缺失。
- 旧状态：`.xma` 不再是当前 XMA 本地状态根，只作为 0.1.0 旧数据迁移来源；prepare/source-sync 迁移完成后清理可识别旧内容。正式源码包继续排除 `xma-path/.xma/.cache` 等本地状态。
- 回归：Windows Gate 锁定默认 `xma-path`、D 盘/真实盘符选择、Y/N 跳过、`[8]/[9]`、OpenTUI 依赖实体位置与旧 `.xma` 仅迁移合同；OpenTUI 定向测试锁定 Bun runner 从 `xma-path/state` 恢复并连接 `xma-path/opentui/node_modules`。版本仍为 `0.1.0`，继续覆盖生成正式同名源码包与 SHA-256。

##37 · Windows PowerShell 路径字符数组回归修复

- 日期：2026-09-15
- 目的：修复 `xma-dev.bat` 启动时 `Add-XmaProcessPathFront` 因 `System.Char` 转换失败直接退出，恢复原有 `git clone → cd xma → .\xma-dev.bat` 开发流程。
- 根因：`xma-common.ps1` 在路径规范化中写成 `[char[]]@('\\','/')`。PowerShell 单引号字符串不会把反斜杠当转义符，因此 `'\\'` 实际包含两个字符，无法转换成单个 `System.Char`；正确字面量是 `'\'`。
- 修复：`Add-XmaProcessPathFront` 的目标路径、PATH 候选路径及 fallback 三处统一改为 `[char[]]@('\','/')`。不改变 `xma-path`、Bun/OpenTUI、Rust/Cargo 的依赖位置设计，只修复启动阶段路径标准化回归。
- 回归：Windows Gate 新增静态检查，禁止任何受管 PowerShell 脚本重新出现双反斜杠 `System.Char` 数组；继续保留 UTF-8 BOM + CRLF 合同。
- 交付：版本仍为 `0.1.0`，继续覆盖正式 `xma-0.1.0.zip` 与 `xma-0.1.0.sha256.txt`。



##38 · Bun/OpenTUI 整组件自愈与 Workspace Trust 光标收口

- 日期：2026-09-15
- 目的：根据 Windows 实机回归继续收口 `xma-path` 依赖真值：修复“Bun 本体仍在但 `xma-path/opentui` 被删后 `[1]` 不再询问修复”的不对称行为，同时处理 `[4]` 启动进入 Workspace Trust 前 Windows Text Cursor Indicator 仍显示蓝色上下标记的问题，并清理 Git 工作目录遗留的 `.xma-package`。
- Bun/OpenTUI 整组件：`[4/9]` 不再只以 `bun.exe` 是否存在作为完成条件。Bun 1.3.14 与固定 OpenTUI 依赖共同构成一个组件；任一部分缺失都视为未完整。若 Bun 已存在但 OpenTUI 被清理，`[1]` 会明确询问 Y/N 是否修复；选择 N 保留 Bun 但 `[4]/[7]` 继续 fail loud 并引导 `[8]`。若整个 `xma-path` 被删除，Bun 缺失时原有一次 Y/N 同意同时覆盖 Bun + OpenTUI，不重复弹第二次确认。
- 准备职责：OpenTUI 的安装/迁移从 `[7/9] Workspace JS` 收回 `[4/9] Bun/OpenTUI`。`[7/9]` 只复检组件真值并重建必要 junction，禁止在用户已经跳过 Bun/OpenTUI 后偷偷联网补装。
- Rust 恢复：删除 `xma-path/state` 但外部 `D:/XMA/Rust` 或其他自定义 Rust 实体仍存在时，`[5/9]` 会明确打印“发现可真实运行的外部 Rust/Cargo，已重新接管”，重建项目状态而不重复安装；只有实际 `rustc/cargo` 也不存在时才重新询问 Y/N。
- Workspace Trust 光标：OpenTUI 启动前的 raw Workspace Trust 选择界面现在在捕获鼠标期间显式隐藏硬件光标，并在退出 Trust 时恢复；避免 Windows Text Cursor Indicator 把硬件光标显示成蓝色上下标记。Active OpenTUI 仍保留原生 Textarea cursor 逻辑，不重新引入手写编辑器。
- 根目录清理：`.xma-package` 只属于正式源码包。除 Source Sync 继续在目标仓库清理外，`[1]`、`[8]`、`[9]` 在检测到当前目录已经是 Git checkout 时也会删除遗留 `.xma-package`；`.cache/dist/node_modules/xma-path` 仍分别承担缓存、正式构建产物、Workspace JS 依赖和本地依赖根职责，不做错误清理。
- 回归：Windows Gate 锁定 Bun/OpenTUI 整组件准备、`[7/9]` 只复检、Git checkout `.xma-package` 清理与外部 Rust 恢复提示；TUI 测试锁定 Workspace Trust raw 生命周期隐藏/恢复硬件光标。版本继续保持 `0.1.0`。

##39 · PowerShell 外部命令 stdout 污染返回值修复

- 日期：2026-09-15
- 现象：Windows 全新 `E:\xma` 环境中 `[1]` 的 Bun 1.3.14 / OpenTUI、Rust/Cargo、Workspace pnpm 安装均成功，但 `[7/9]` 在 `pnpm rebuild esbuild` 后报 `GetFullPath`“路径中具有非法字符”。
- 根因：`Invoke-XmaExternal` 为了保持 `[2]/[3]/[4]` 开发进程与真实终端直连，会保留 native stdout 的 PowerShell pipeline 语义。`Ensure-XmaBunOpenTuiRuntime` 又是一个需要返回单一 `bun.exe` 路径的函数；首次安装 OpenTUI 时，内部 `bun install` stdout 没有被消费，于是 PowerShell 把安装日志和最终路径一起组成返回数组，后续再次作为路径传给 `GetFullPath()` 就出现非法字符。该问题与 `E:\xma` 路径本身无关。
- 修复：保持公共 `Invoke-XmaExternal` 的直连语义，不全局把 dev/TUI stdout 改成管道（避免破坏交互 TTY）。只在“需要返回对象/路径”的准备函数中，把非交互安装命令显式 `| Out-Host`：OpenTUI 安装、rustup-init、项目级 stable override、rustfmt component add 的输出继续实时显示，但不再进入函数返回值。`Ensure-XmaBunOpenTuiRuntime` 因此保证只返回 `bun.exe` 路径。
- 回归：Windows Gate 锁定上述 `Out-Host` 隔离点，并在 `xma-common.ps1` 固化“交互命令保留直连、值返回函数必须消费非交互 stdout”的合同。版本仍为 `0.1.0`，继续覆盖正式同名源码包与 SHA-256。

##40 · Windows 依赖安装位置键盘选择器

- 日期：2026-09-15
- 目的：改进 `[4/9] Bun/OpenTUI` 与 `[5/9] Rust/Cargo` 的安装位置选择体验；原先只能通过 `Read-Host` 输入 1/2/3，现在支持 Windows Terminal / ConsoleHost 中直接使用 ↑/↓ 移动并按 Enter 确认。
- 交互：`Select-XmaDependencyRoot` 继续作为 Bun 与 Rust 共用的依赖根选择入口，新增 `Read-XmaArrowMenuChoice`。默认停在 `[1] 跟随当前项目`；↑/↓ 循环移动，Enter 确认；数字键 `1/2/3` 仍可直接选择，保持旧用户操作习惯。
- 兼容：若输入被重定向或当前 PowerShell Host 无法使用 `Console.ReadKey`，自动退回原来的 `Read-Host` 数字选择，不让 CI、特殊 Host 或非交互环境挂死。`[3] 自定义盘符` 后续仍要求用户输入真实盘符并做存在/可写校验。
- 复用：该选择器同时作用于 `[1]` 中 Bun/OpenTUI、Rust/Cargo 的首次安装，以及主菜单 `[8]` / `[9]` 单独补装；不改变 `xma-path`、D 盘、自定义盘符三种路径语义。
- 回归：Windows Gate 锁定 `ReadKey + UpArrow + DownArrow + Enter + 数字键直达` 合同；PowerShell 继续保持 UTF-8 BOM + CRLF。版本仍为 `0.1.0`。



##41 · 外部依赖位置不再生成项目根空壳 xma-path

- 日期：2026-09-15
- 目的：修复用户在 `[4/9] Bun/OpenTUI` 或 `[5/9] Rust/Cargo` 明确选择 `[2] D:/xma-path` / `[3]` 其他盘符后，源码根仍因为 state/dev-bin 硬编码而生成第二个 `<checkout>/xma-path` 的语义冲突。
- 根因：依赖实体位置已经跟随 `Select-XmaDependencyRoot`，但 `Get-XmaStateRoot` 与 `Install-XmaDevelopmentCommands` 仍固定把状态、prepare stamp 和开发 shim 写到 `<checkout>/xma-path/state|dev-bin`。因此“选择外部依赖”只移动了 Bun/OpenTUI/Rust，本地控制状态仍会制造项目根 xma-path。
- 修复：依赖实体与 checkout 控制状态彻底分离。普通 Git clone 的控制状态统一进入 `.git/xma-state/`；Git worktree 解析 `.git` 文件指向的真实 gitdir；非 Git 临时源码树回退 `.cache/xma-state/`。Bun/Rust state、prepare stamp、Source Sync state/report 与开发 `xiaoyu/xma` shim 都使用该 checkout state root。`xma-path` 只在用户真的选择“跟随当前项目”安装实体依赖时存在。
- 迁移：继续读取旧 `xma-path/state` / `xma-path/dev-bin` 与 `.xma`；新状态写入成功后迁移 Source Sync 元数据并清理旧控制目录。如果项目根 `xma-path` 只剩旧 state/dev-bin，会自动删除；如果其中仍有 bun/opentui/rust 实体则保留，不误删依赖。
- 行为：选择 `[2] D:/xma-path` 后，Bun/OpenTUI 实体位于 `D:/xma-path/{bun,opentui}`，项目根不会再仅因状态生成 `xma-path`；`[4]/[7]/build:cli` 仍从 checkout state 恢复该外部绝对位置。默认 `[1] 跟随当前项目` 时则继续合法使用 `<checkout>/xma-path/{bun,opentui,rust}`。
- 回归：Windows Gate/README/CODEMAP/AGENTS 同步锁定“依赖位置与控制状态分离”合同；版本仍为 `0.1.0`，继续覆盖正式同名源码包与 SHA-256。

##42 · 依赖位置原位键盘菜单、Rust 可移动安装与准备摘要真值

- 日期：2026-09-15
- 目的：根据 Windows `[1]` 全流程实机回归继续收口三个问题：安装位置的 `↑/↓` 需要直接移动 `[1]/[2]/[3]` 行本身的选中态；外部 `D:/xma-path` 安装完成后摘要仍显示项目默认依赖根容易误导；Rust 安装使用 `rustup override set stable` 会把当前 checkout 绝对路径写入 rustup，违背 U 盘换盘符/项目移动的路径合同。
- 原位菜单：`Read-XmaArrowMenuChoice` 改为用 Console cursor 在三条真实选项行上重绘，高亮行带 `>` + 绿色；↑/↓ 循环移动，Enter 确认，数字 1/2/3 仍直达并先刷新目标行高亮。特殊 Host/重定向输入仍退回 `Read-Host`。Bun/OpenTUI 与 Rust/Cargo 继续复用同一选择器。
- Rust 安装：选择目标依赖根后先直接探测目标 `cargo/rustc`；完整则直接接管。若目标已有 `rustup.exe` 但 stable 不完整，复用现有 rustup 执行 `toolchain install stable --profile minimal` + `default stable`，不重复下载 rustup-init。首次 rustup-init 使用隔离的 `RUSTUP_HOME/CARGO_HOME` 并设置单次 `RUSTUP_INIT_SKIP_PATH_CHECK=yes`，避免 PATH 中旧 shim 产生误导性“Rust is installed”警告。移除项目目录 `rustup override set stable`，不再产生 checkout absolute-path toolchain override。
- 控制状态：延续 ##41，state/prepare/source-sync/dev-bin 使用 `.git/xma-state`（非 Git 树 `.cache/xma-state`），外部依赖位置不再为了控制状态生成项目根空壳 `xma-path`；旧 `xma-path/state|dev-bin` 迁移后清理。
- 摘要：`[1]` 结束不再只打印“默认依赖根”。Bun/OpenTUI 和 Rust/Cargo 分别打印本轮真实依赖根，例如都选择 `[2]` 时显示 `D:/xma-path`；另行打印 checkout 控制状态路径，避免把项目默认位置误认为实际安装位置。
- 回归：Windows Gate 锁定三行原位高亮、禁止独立“当前选择”状态行、禁止 `rustup override set stable`、要求已有 rustup repair + PATH-check 隔离，并继续锁定 `.git/xma-state` 控制状态。版本仍为 `0.1.0`，覆盖生成正式同名源码包与 SHA-256。

##43 · Windows 依赖位置菜单 RawUI 原位选择修复

- 日期：2026-09-15
- 目的：修复 Windows 实机中依赖安装位置菜单出现“高亮 `[1]` + 下面又重复一套 `[1]/[2]/[3]` + `Read-Host`”的双菜单问题，以及 ↑/↓ 在 Windows Terminal 中没有真正接管选择的回归。
- 根因：上一版使用 `System.Console.SetCursorPosition/ReadKey` 做重绘；在当前 PowerShell + Windows Terminal Host 下，Console API 在动态绘制阶段抛异常后进入 fallback。由于异常发生前已经输出了一部分动态菜单，fallback 又重新打印静态选项并 `Read-Host`，因此既重复显示，又失去方向键输入。
- 修复：交互式 Windows Host 改用 PowerShell `$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')` 与 RawUI `CursorPosition`；菜单只顺序输出一次三条真实选项，然后 ↑/↓ 仅原位重绘这三行，Enter 确认，数字 1/2/3 直达。若 Host 不支持 RawUI，fallback 只在从未完整渲染动态菜单时打印选项；若动态菜单已经显示，则只补数字输入提示，绝不复制三行菜单。
- 回归：Windows Gate 禁止安装位置菜单重新使用 `System.Console.ReadKey/SetCursorPosition`，锁定 RawUI VK_UP/VK_DOWN/VK_RETURN 与“fallback 不重复打印选项”合同。Bun/OpenTUI 与 Rust/Cargo 继续共用同一选择器。
- 交付：版本仍为 `0.1.0`，继续覆盖正式 `xma-0.1.0.zip` 与 SHA-256。

##44 · 全量检查外部依赖离线再发现

- 日期：2026-09-15
- 目的：修复 `[1]` 已把 Bun/OpenTUI、Rust/Cargo 安装到 `D:/xma-path` 等外部依赖根，但脚本升级后 checkout 控制状态从旧 `xma-path/state` 迁到 `.git/xma-state` 时，直接运行 `[7]` 会误报“未检测到 Bun Runtime”的假缺失。
- Bun：`Import-XmaBunEnvironment` 在状态、项目默认、旧环境均未命中时，会枚举当前已挂载且 ready 的文件系统盘符，仅检查 `<盘符>:/xma-path/bun/<固定版本>/bun.exe`，真实执行 `bun --version`。唯一命中时自动重新接管并补写 `.git/xma-state/bun-environment.json`；多套命中不自动猜测，由 `[1]/[8]` 明确选择。
- Rust：同样离线检查 `<盘符>:/xma-path/rust`，并兼容 0.1.0 早期 `<盘符>:/XMA/Rust`；候选必须真实通过 `cargo --version` 与 `rustc --version`。唯一命中时恢复 `CARGO_HOME/RUSTUP_HOME`、PATH 并补写 checkout 状态。
- `[4]/[7]` 边界：再发现只读取本机现有文件并执行版本探针，不下载 Bun、不运行 `cargo fetch`、不安装组件；Rust crates 仍由既有 offline preflight 决定是否允许继续。多套依赖候选时 fail loud，不擅自改变用户选择。
- 回归：Windows Gate 锁定 `DriveInfo.GetDrives()`、Bun/Rust drive-scan、状态补写和 Console 恢复提示；版本继续保持 `0.1.0`。



##45 · Windows 依赖下载加速、实时进度与 CLI TypeScript 回归修复

- 日期：2026-09-15
- 目的：修复 Windows `[7]` 在 `scripts/cli/bun.ts` 因 `disposeCompileAlias` 被 TypeScript 推断为 `() => undefined` 而无法接受 `() => void` 的 typecheck 回归；同时改善 `[4/9] Bun/OpenTUI` 与 `[5/9] Rust/Cargo` 首次准备时“下载慢、长时间无进度像卡住”的体验。
- CLI typecheck：`disposeCompileAlias` 显式声明为 `() => void`，保持 build 结束 `finally` 释放 SUBST alias 的原语义，不改变 Bun compile/cache 生命周期。该修复直接消除 `[7] -> pnpm check -> tsc --noEmit` 的 TS2322。
- 下载源：新增 `XMA_DOWNLOAD_SOURCE=auto|official|mirror`。默认 `auto` 对官方源/批准镜像做短探针并按响应排序，失败或持续低速自动切换备用源；`official` 只用官方，`mirror` 镜像优先但仍允许官方兜底。探针结果在单次准备进程内缓存，避免同一源反复测速。
- Bun：Bun 1.3.14 ZIP 使用 GitHub 官方 + SourceForge Bun exact mirror；`curl.exe` 存在时显示 progress bar，并用 connect timeout + 低速 stall timeout 自动切源。ZIP 下载后读取 Bun 同版本 `SHASUMS256.txt` 做 SHA-256 校验，再解压/验证 `bun --version`。OpenTUI 的 `bun install` 在 npm 官方与 npmmirror 之间选择，并通过 `Start-Process -NoNewWindow` 继承真实终端，让 Bun 自己的 resolving/downloading 日志可见。
- Rust：Rustup 官方与 RsProxy 做同类选择；仅当前 XMA 进程临时设置 `RUSTUP_DIST_SERVER/RUSTUP_UPDATE_ROOT`，不写 User/Machine 环境。rustup-init 自身继续 SHA-256 校验；stable toolchain、rustfmt 与已有 rustup repair 通过可见子进程运行，并显示实时子进程日志 + PowerShell elapsed progress，避免“静默等待”。
- 边界：镜像只用于显式准备入口 `[1]/[8]/[9]`；`[4]/[7]` 仍严格 offline/`--no-install`，不会因为新增镜像逻辑偷偷联网。Cargo crates 的 offline 真值检查合同不变。
- 回归：Windows Gate 锁定下载源模式、curl progress/stall、Bun SHA 清单、SourceForge/npmmirror/RsProxy、可见子进程与 `disposeCompileAlias: () => void`；版本保持 `0.1.0`，继续覆盖同名正式源码包与 SHA-256。


##46 · Windows 外部 Rust 发现启动回归修复

- 日期：2026-09-15
- 现象：更新到 ##44/##45 后，双击 `xma-dev.bat` 在主菜单出现前直接退出；Windows PowerShell 报 `Get-XmaDiscoveredRustHomes : 参数数目不匹配`，调用点位于 `xma-common.ps1` 的外部 Rust 盘符发现。
- 根因：外部 Rust 扫描使用 `List[object]` 后通过 `@($results)` 返回；Windows PowerShell 5.1 对该 generic collection 的 array-subexpression 存在 binder 兼容问题，会抛 `System.ArgumentException / Argument types do not match`。同时 ##44 把盘符发现放进通用 `Import-XmaRustEnvironment`，而 `xma-console.ps1` 顶层在显示菜单前就调用 Import，因此发现层的任何异常都会拖垮整个开发控制台。
- 修复：Bun/Rust 发现结果统一通过 `List<T>.ToArray()` 返回，发现/候选去重改为 PowerShell 原生大小写不敏感 hashtable，避开 Windows PowerShell generic binder 差异。`Import-XmaBunEnvironment` / `Import-XmaRustEnvironment` 新增显式 `-DiscoverExternal`；普通控制台/准备器脚本顶层只恢复已知状态，不扫描盘符。只有 `[1]/[4]/[7]/[8]/[9]` 等真正解析依赖的路径以及明确的 Tauri 构建才允许离线发现。
- 边界：外部发现仍只检查 XMA 自管固定布局并执行 `bun/cargo/rustc --version`，不下载依赖；多套候选继续 fail loud。即使将来盘符扫描再次出现异常，也不得阻断 `xma-dev.bat` 主菜单启动。
- 回归：Windows Gate 锁定 `-DiscoverExternal` 显式入口、禁止 discovery helper 用 `return @($results)`，并要求脚本顶层 Import 不带外部发现开关。版本保持 `0.1.0`。


##47 · Bun/OpenTUI 成功安装误判与 Windows 子进程退出码修复

- 日期：2026-09-15
- 现象：`[1] -> [4/9] Bun/OpenTUI` 使用 npmmirror 时已经明确输出 `179 packages installed`，但 XMA 随后仍打印 `failed with exit code`（退出码为空），继续错误切换 npm 官方源/镜像并最终宣告安装失败。
- 根因：##45 为显示实时安装进度新增 `Start-Process -PassThru` + `Process.WaitForExit(timeout)` 轮询。在 Windows PowerShell 5.1 + 当前 Windows Terminal Host 下，子进程实际成功退出后 `Process.ExitCode` 仍可能没有稳定回填；空值与 0 比较后被当成非零失败，因此实体已经完整却被控制层误判。
- 修复：可见安装进程统一改为 `Start-Process -NoNewWindow -Wait -PassThru`，由 PowerShell 自身负责等待并稳定填充 ExitCode；Bun/rustup 继续直接继承当前终端并输出上游安装日志，Bun ZIP/rustup-init 文件下载仍由 curl progress bar 显示百分比/速度。移除 `WaitForExit(1000)` + `Write-Progress` 轮询，避免为了额外计时破坏退出码真值。
- OpenTUI 真值：registry 安装异常分支新增实体复检；只要固定 OpenTUI/Solid/Bun 依赖已经完整落盘，就按实体真值成功继续，不会因为 Host/退出码读取异常重复切换 registry。只有实体仍不完整时才切备用源。
- 回归：Windows Gate 锁定 `Start-Process -Wait -PassThru`、稳定 ExitCode、OpenTUI 实体真值兜底，并禁止重新引入 `WaitForExit(1000)` 轮询。版本保持 `0.1.0`，继续覆盖同名正式源码包与 SHA-256。


##48 · 首次 Clone 的 Bun 下载校验与 Windows Schannel 容错

- 日期：2026-09-15
- 现象：全新 `git clone -> xma-dev.bat -> [1]` 在 Bun 1.3.14 首次准备时，GitHub `SHASUMS256.txt` 连接被重置；切 SourceForge 后 Windows curl/Schannel 又因 `CRYPT_E_REVOCATION_OFFLINE` 退出，导致 Bun ZIP 尚未下载就直接失败。
- 根因：##45 为 Bun ZIP 增加了 SHA-256 安全校验，但实现成“先额外下载一份校验清单，再下载 ZIP”，把一次 Runtime 下载变成两次独立网络依赖；Windows Schannel 又会在证书吊销服务器离线时把 TLS 连接判失败。
- 修复：Bun 1.3.14 Windows x64/aarch64 的 SHA-256 直接固定为 Bun 官方 GitHub Release asset digest；GitHub/SourceForge 只负责下载同一个 ZIP，下载完成后统一对固定官方 digest 校验，不再联网获取 `SHASUMS256.txt`。当前固定值来源于 `oven-sh/bun` 的 `bun-v1.3.14` GitHub Release assets。
- Schannel：Windows curl 的测速和真实下载增加 `--ssl-revoke-best-effort`。它只允许“吊销服务不可达”时继续，不关闭正常证书链验证；Bun ZIP 仍必须通过固定 SHA-256，Rust 下载仍保留既有哈希校验。
- 行为：官方源连接重置时仍自动切 SourceForge；SourceForge 遇到 `CRYPT_E_REVOCATION_OFFLINE` 不再仅因吊销服务器离线失败。`[4]/[7]` 依旧不联网，本修改只作用于显式准备入口 `[1]/[8]/[9]`。
- 回归：Windows Gate 要求 x64/aarch64 固定 Bun digest、`--ssl-revoke-best-effort`，并禁止重新引入 Bun `SHASUMS256.txt` 额外下载依赖。版本保持 `0.1.0`。

##49 · 开发控制台项目更新与 Bun 高速稳定下载

- 日期：2026-09-15
- 目的：解决已有 `xma` clone 无法通过第二次 `git clone` 覆盖更新、以及 Bun 首次准备在 SourceForge 大文件镜像下载慢且 curl 动态进度条导致 Windows Terminal 光标高频闪烁的问题。
- `[10] 更新项目`：`xma-dev.bat` 主菜单新增项目更新入口。只允许在 Git 顶层且 `origin` 属于 `yubboo/xma` 的真实 clone 中使用；正式源码包包含 `.xma-package/source-manifest.json` 时拒绝。`[1] 安全更新` 执行 `git fetch origin main` + `git pull --rebase --autostash origin main`；`[2] 强制恢复 GitHub main` 必须输入 `YES` 二次确认后执行 `fetch + reset --hard origin/main`。强制恢复只覆盖 Git 已跟踪源码，不自动执行 `git clean`，因此不主动删除 `xma-path/node_modules/.cache/dist/.git/xma-state` 等本地依赖/缓存。更新完成后要求退出并重新运行 `xma-dev.bat`，避免旧 PowerShell 进程继续运行已被替换的脚本代码。
- Bun 下载源：移除 SourceForge Bun 大文件镜像。Bun 1.3.14 Windows x64/aarch64 改用 Bun 官方发布的 `@oven/bun-windows-*` npm platform binary，在 npm 官方 CDN 与 `registry.npmmirror.com` 间按短探针排序。tgz 使用对应 npm `dist.integrity` 固定 SHA-512 真值校验，解压后仍真实执行 `bun --version`；OpenTUI 继续复用 npm/npmmirror registry 选择。
- 下载进度：文件下载不再使用 curl `--progress-bar` 同行高频重绘。curl 改为 silent 模式，XMA 每约 4 秒追加一行稳定的“来源 + 已下载 MiB + 耗时”里程碑；连接超时缩短到 6 秒，持续低于 16 KiB/s 约 12 秒即切换备用源。这样既能看出没有卡死，也避免 Windows Text Cursor Indicator/硬件光标左右闪烁。无 curl 时回退 `Invoke-WebRequest`，同样不做动态同行重绘。
- 边界：`[10]` 不 commit/push，GitHub 推送仍只由 `XMA-GitHub.bat` 负责；`[4]/[7]` 继续保持离线，不因下载器变化偷偷联网；`XMA_DOWNLOAD_SOURCE=auto|official|mirror` 合同保持不变。
- 回归：Windows Gate 锁定 `[10]` 的 origin 校验、安全更新/强制恢复合同、禁止自动 `git clean`；锁定 Bun npm binary + SHA-512、npmmirror、稳定里程碑下载并禁止 SourceForge/`curl --progress-bar` 回归。版本继续保持 `0.1.0`，正式包仍覆盖 `xma-0.1.0.zip` 与对应 SHA-256。

##50 · pnpm Workspace Runtime 统一与 latest 刷新

- 日期：2026-09-15
- 目的：把最近多轮为 Bun 独立安装位置、镜像、状态恢复和外部盘符发现增加的复杂度收回标准包管理器。Bun/OpenTUI/Solid/@types-bun 不再作为 `xma-path` 独立组件，而是与 TypeScript/Vite/tsx 一样成为 pnpm Workspace JavaScript Runtime。
- 依赖声明：根 `package.json` 新增 `bun: latest`；`apps/cli/opentui-runtime/package.json` 的 `@opentui/core`、`@opentui/solid`、`solid-js`、`@types/bun` 使用 registry `latest`。`pnpm-workspace.yaml` 的 lifecycle allowlist 只允许 `bun` 与 `esbuild`，Electron 继续禁止普通 `pnpm install` 触发 Chromium postinstall。
- Workspace 收口：`apps/cli/opentui-runtime` 明确加入 `pnpm-workspace.yaml`，因此根 `pnpm install` 会同时安装 Bun 与 OpenTUI/Solid 的 node_modules；`runtime:update` 只负责在 `[1]/[8]` 主动把这组受管 Runtime 解析到 registry latest，不再存在第二套 Bun/OpenTUI 包管理器。
- 更新边界：`[1]` 与主菜单 `[8] 刷新 · JavaScript Runtime` 主动执行受管 Runtime 的 `pnpm update --latest`，然后 `pnpm install` 并刷新 lockfile/node_modules。这样用户重新运行 `[1]` 即会检查最新稳定 tag；`[4]`、`[7]`、`build:cli` 只消费当前 lockfile/node_modules，不在运行/检查阶段偷偷联网升级。
- 目录：Windows/Linux/macOS 源码开发统一从 Workspace `node_modules` 读取 Bun；OpenTUI/Solid 实体位于 `apps/cli/opentui-runtime/node_modules`。删除独立 Bun Home、`XMA_BUN_HOME`、`bun-environment.json`、Bun drive scan、`xma-path/bun`/`xma-path/opentui` junction 与 Bun ZIP/tgz/SourceForge/checksum 下载器。`xma-path` 从此只承担 Rust/Cargo 等非 npm Native Toolchain。
- CLI build：`scripts/cli/bun.ts` 动态读取 `node_modules/bun/package.json` 的真实安装版本，执行 `bun --version` 校验，并以该版本命名 `.cache/bun-compile/<version>`；Windows 中文路径的单次 SUBST ASCII alias 与最终 dist 独立性继续保留。
- Unix：`scripts/unix/xma-console.sh` 同步改为 pnpm latest + node_modules，不再自己 curl GitHub Bun ZIP 或维护第二套 OpenTUI node_modules。
- 发行边界：该改变只简化源码开发依赖。普通用户最终仍应通过 `install.ps1/install.sh` 下载 CI/Release 已预构建的 `xiaoyu`，不要求用户安装 pnpm/Node/Bun/Rust。
- 验证：OpenTUI 定向测试改为锁定 `latest` 声明、node_modules Bun resolver 与 `--no-install` 运行边界；Windows/Distribution Gate 禁止独立 Bun 安装器回归。历史 ##31–##49 保留作为 0.1.0 调试演进记录，本条为当前有效 Runtime 规则。

##51 · pnpm Runtime latest 可见进度与稳定日志

- 日期：2026-09-15
- 现象：全新 clone 后执行 `xma-dev.bat -> [1]`，`[4/8] Workspace JavaScript Runtime` 在打印 `> pnpm.cmd run runtime:update` 后可能长时间没有新输出。registry 探针已经显示 npmmirror 很快，但 nested pnpm update 的默认 TTY reporter 在当前 Windows Terminal/PowerShell Host 中没有形成可见的阶段日志，用户无法判断是在解析 latest、下载 binary，还是已经卡住。
- 修复：Windows 准备器不再用一条嵌套 `pnpm run runtime:update` 黑盒等待。它在已选 registry 下拆成两个明确阶段：`[1/2] Bun Runtime latest` 与 `[2/2] OpenTUI / Solid Runtime latest`，直接调用 `pnpm update --latest`，每步开始/完成都打印状态。
- Reporter：所有受管 Runtime 更新以及根 `pnpm install` 使用 `--reporter=append-only`。pnpm 的 resolving/reused/downloaded/added 等进度按追加行输出，避免 Windows Terminal 同一行高频重绘，也避免出现“命令已启动但屏幕完全不变化”的假卡死体验。Unix/CI 的 `runtime:update` 同样带 append-only reporter，保持跨平台行为一致。
- 边界：`latest` 更新仍只发生在 `[1]/[8]`；`[4]/[7]/build:cli` 继续只消费当前 lockfile/node_modules，不联网升级。registry `auto` 的 npm 官方/npmmirror 选择与失败切源逻辑保持不变。
- 回归：Distribution/Windows Gate 与 OpenTUI 定向测试锁定 `runtime:update` 的 append-only reporter、Windows 两阶段可见更新和 Workspace install append-only。版本继续保持 `0.1.0`。

##52 · pnpm Registry 排序 PowerShell 5.1 兼容修复

- 日期：2026-09-15
- 现象：`xma-dev.bat -> [1] -> [4/8] Workspace JavaScript Runtime` 已完成 npm/npmmirror 探针并打印 `npm 官方=不可达 · npmmirror=78ms · 优先 npmmirror` 后，尚未进入真正 `pnpm update` 就报 `System.Management.Automation.PSObject` 不包含 `op_Addition`。
- 根因：下载源排序函数使用 `return @($ready.Source + $failed.Source)`。Windows PowerShell 5.1 的单元素属性枚举会把 `$ready.Source` / `$failed.Source` 退化为单个 `PSObject`，此时 `+` 被解析为对象运算而不是数组拼接，直接抛 `op_Addition`。
- 修复：官方/镜像/测速成功/测速失败四类源全部先通过显式 `foreach` 组装真实 Object[]，再按顺序返回；不再对 `.Source` 投影结果使用 `+`。`Refresh-XmaPath` 的 generic `HashSet[string]` 同时改为 PowerShell 原生 hashtable，减少 Windows PowerShell 5.1 binder 差异。
- 回归：Windows Gate 新增 `PSObject.op_Addition` 静态合同，要求 ready/failed source 显式数组化，并禁止准备器重新引入 generic HashSet；`[4/8]` 的两阶段 append-only pnpm 可见进度、registry 自动切换与 `[4]/[7]` 不联网边界保持不变。
- 验证边界：当前构建环境没有 Windows PowerShell 5.1，不能冒充 Windows 实机 E2E；通过 TypeScript/OpenTUI 定向测试、9 项 Gate、脚本编码/Source Manifest/ZIP 完整性后仍需 Windows 实机重新执行 `[1]` 验收。



##53 · JavaScript Runtime Bootstrap 事务收口

- 日期：2026-09-15
- 根因：fresh clone / GitHub CI 在 pnpm 11 lifecycle 安全策略下会遇到 `ERR_PNPM_IGNORED_BUILDS`；旧实现同时在 Windows、Unix、CI、Release 分别拼 `update/install/rebuild`，失败时只留下部分 manifest/lockfile 变化，registry 切换也可能从脏状态继续。
- 唯一入口：新增 `scripts/runtime/update.mjs`，固定五阶段 `baseline install → Bun latest → OpenTUI/Solid latest → consistency install → esbuild rebuild`。Windows [1]/[8]、Unix prepare、CI 与 Release 全部委托同一实现。
- pnpm lifecycle：`pnpm-workspace.yaml` 显式 `bun/esbuild=true`、`electron/electron-winstaller/koffi=false`，启用 `strictDepBuilds: true`。新增 install/postinstall 包不会被自动批准；updater 会打印包名并失败。
- 事务回滚：执行前保存根 `package.json`、OpenTUI package、workspace 与 lockfile；任一步失败恢复。Windows registry 第一个源失败后，先回滚再从完整干净状态尝试下一源。
- 可观测性：pnpm stdout/stderr 边执行边透传，同时收集用于识别 `ERR_PNPM_IGNORED_BUILDS` / 未决 lifecycle 包，不再只显示包装器 exit code。
- CI：新增 Windows PowerShell 5.1 JavaScript Runtime lane，执行 `xma-prepare.ps1 -Component js` 后运行 `pnpm check → build:cli → smoke:cli`；Ubuntu CI/Release 移除重复 install/rebuild。
- 回归：Runtime updater 脱网事务测试覆盖五阶段成功路径和 `mystery-native` lifecycle 失败回滚；OpenTUI/9 Gates 与真实 GitHub Windows/Ubuntu 网络安装仍需在修复进入可写 ref 后完成最终远端验收。版本保持 `0.1.0`。

##54 · 首次准备回归单次 pnpm install

- 日期：2026-09-15
- 现象：`xma-dev.bat -> [1]` 为了同时承担“首次安装 + latest 刷新 + 一致性修复”，需要依次执行 baseline install、Bun latest、OpenTUI/Solid latest、consistency install，首次准备出现长时间依赖解析/下载，明显比普通项目安装更慢。
- 调整：恢复项目正常职责边界。`[1]` 只执行一次 Workspace `pnpm install --no-frozen-lockfile --prefer-offline --reporter=append-only`，目标只有一个：把当前 XMA 源码所需依赖装全并可运行；不再在首次准备时主动追 latest。
- `[8]`：保留显式升级能力，但只执行 `Bun latest -> OpenTUI/Solid latest` 两个定向阶段；不再 baseline install / consistency install / esbuild rebuild。更新失败仍恢复受管 manifest/lockfile。
- CI/Release：与 `[1]` 一样只安装当前 Workspace，不调用 `runtime:update`，避免构建过程隐式升级依赖。`[4]/[7]/build` 继续只消费已安装依赖，不联网。
- 生命周期安全：`strictDepBuilds: true` 与 `bun/esbuild=true`、`electron/electron-winstaller/koffi=false` 保持不变；Electron Chromium Runtime 仍只能在明确选择 Desktop Electron 后下载。版本继续保持 `0.1.0`。

##55 · [1] 一键完整 Bootstrap 与原生 pnpm install

- 日期：2026-09-15
- 用户语义：`xma-dev.bat -> [1]` 的职责固定为“把当前这份 XMA 源码所需的全部开发/运行工具与依赖准备到可用状态”。项目以后新增 npm package、Workspace、Rust crate 或调整工具最低版本，用户更新源码后只需重新运行 `[1]`，不需要理解内部依赖变化。
- JavaScript：Windows `[1]` 删除 npm/npmmirror 自动测速、registry 强切、`--no-frozen-lockfile`、`--prefer-offline`、`--reporter=append-only` 等 XMA 包装参数，项目根直接执行原生 `pnpm install` 并透传 pnpm 自己的正常实时输出。`[8]` 保持显式 Runtime latest 更新边界，但也默认尊重用户当前 pnpm registry 配置。
- 工具链：Git/Node/pnpm/Rust/MSVC 从“缺失时逐项询问是否安装”改为项目硬依赖自动补齐。Node 仅在缺失或低于 `>=22` 时自动安装/升级；pnpm 当前支持 `11.x >= 11.17.0`，兼容版本直接复用，缺失/过旧/跨不兼容主版本才自动回到项目基准 `11.17.0`；Rust/Cargo 可用即复用，缺失时 `[1]` 自动安装 stable 到 checkout 默认 `xma-path`，rustfmt/MSVC/crates 同步补齐。
- 版本原则：项目硬要求不满足时脚本负责自动修正；已经满足要求时不为了“最新”强制升级。可选稳定版更新不得成为 `[1]` 的阻塞网络前置条件。
- 边界：Electron Chromium Runtime 与 Tauri Rust crates 仍属于用户明确选择 Desktop 后的按需依赖，不进入通用 `[1]`；`[4]/[7]` 继续只消费已准备依赖，不偷偷联网。


##56 · [1] pnpm 网络卡死根因修复

- 根因：上一轮把 `[1]` 简化为原生 `pnpm install` 后，同时删除了所有 registry 可达性处理；在 npm 官方 registry 被当前网络阻断的 Windows 环境中，pnpm 会在首批 metadata 请求阶段长时间无进度。与此同时正式源码的 lockfile 仍需与 Bun/OpenTUI Workspace 声明保持同步，否则首次安装还会额外解析缺失 importer。
- 修复：`[1]` 仍然只执行一次项目根 `pnpm install`，不追加 reporter/prefer-offline/lockfile 参数、不重复安装。若用户/项目已显式配置 registry 则完全尊重；只有未配置自定义 registry 且 npm 官方快速探针不可达时，才对该次 install 临时设置 `npm_config_registry=https://registry.npmmirror.com`，命令结束立即恢复，不写入 User/Machine/npmrc。
- 依赖锁定：正式源码必须提交与 `package.json` / `pnpm-workspace.yaml` / `apps/cli/opentui-runtime/package.json` 一致的完整 `pnpm-lock.yaml`；`[1]` 负责安装当前项目依赖，不负责替仓库维护者现场生成缺失的正式 lockfile。

##57 · pnpm install 无输出等待与 Runtime 版本边界修复

- 现象：Windows `[1] -> [4/8]` 打印 `> pnpm.cmd install` 后可能长期没有 `resolved/reused/downloaded/added` 输出。实机同时存在用户 registry=npmmirror、反复测试产生的旧 `node_modules`，而 pnpm 11 在 modules purge 场景存在交互等待边界。
- Runtime 边界：根 Bun 与 `apps/cli/opentui-runtime` 不再使用 `latest` manifest；固定当前已验收版本 Bun 1.4.2、OpenTUI 0.5.11、Solid 1.9.15、@types/bun 1.4.2。`[1]` 只安装项目已声明版本；`[8]` 才执行 `pnpm update --latest` 并更新 manifest/lockfile。
- 安装可见性：`[1]` 仍然只有一次 Workspace `pnpm install`，增加 `--reporter=append-only` 让 PowerShell 5.1/Windows Terminal 稳定输出进度，并通过 `--config.confirmModulesPurge=false` 自动确认 pnpm 11 的 node_modules 重建提示，避免隐藏等待。
- 网络失败：registry 不再只看 `/-/ping`，同时探测 Bun 与 OpenTUI metadata。npm 官方/npmmirror 可在探针失败时仅对本次 install 临时互相回退；自定义/企业 registry 不自动切公共源。fetch timeout=20s、retries=1，失败明确报错而不是无限黑屏；所有环境变量在 install 后恢复。
- 边界：不引入第二遍 install，不恢复独立 Bun/OpenTUI 下载器，不使用 `--prefer-offline` / `--no-frozen-lockfile`，Electron Chromium 与 Tauri Rust crates 仍按 Desktop 选择后下载。

##58 · `[1]` 原生 pnpm install 与 node_modules 恢复语义纠正

- 现象：Windows 实机手工在项目根执行 `pnpm install` 能正常显示 `Scope / Packages / Progress: resolved/reused/downloaded/added` 并在删除 `node_modules` 后重新创建依赖；而 XMA `[1]` 的多轮修正曾引入 registry 探针、reporter/timeout/purge 参数和 Workspace prepare stamp，职责边界偏离 pnpm 原生安装语义，导致“环境检查通过”与“真实 node_modules 已安装”容易混淆。
- 修复：`xma-dev.bat → [1]` 的 Workspace JavaScript 阶段固定为**每次运行无条件在项目根执行一次 `pnpm install`**。XMA 不再替 pnpm 判断“是否需要安装”，不使用 `workspace-js` stamp/fingerprint 跳过，不注入 registry/reporter/timeout/purge 参数。`node_modules` 不存在时明确提示由 pnpm 重新创建；已存在时由 pnpm 自己复用 store 并补齐新增/变更依赖。
- Gate：Windows Gate 锁死唯一且精确的 `Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install')`，禁止重新引入 `workspace-js` prepare stamp、Workspace fingerprint、registry 探针或 install 包装 flags。这样以后项目新增任意 Workspace/npm 依赖，用户重新运行 `[1]` 就与手工 `pnpm install` 得到同一安装行为。
- 边界：`[8]` 仍是显式 JavaScript Runtime latest 刷新入口；`[4]/[7]/build` 继续只消费 `[1]` 已准备的 `node_modules`，不得偷偷联网安装。

##59 · Windows Bootstrap 输出流重构

- 日期：2026-09-15
- 根因：实机在项目根手工执行 `pnpm install` 能立即显示 `Scope / Packages / Progress`，但 `[1]` 打印 `> pnpm.cmd install` 后看似卡住。原因不是 pnpm、registry 或依赖体积，而是 PowerShell success output stream 被上层赋值捕获：`$jsRuntime = Ensure-XmaWorkspaceJavaScriptDependencies` 会把函数内部 native stdout 一并收进 `$jsRuntime`，导致 pnpm 实时进度不进入终端，同时污染业务返回对象。`xma-common.ps1` 早已有“返回对象场景需 `Out-Host`”约束，但准备器没有落实。
- 重构：`xma-prepare.ps1` 新增 Bootstrap 专用 `Invoke-XmaPrepareExternal`，统一把非交互准备命令的 native success stream 送到 Host；所有 `pnpm/npm/cargo/winget` 准备动作通过该边界执行。Workspace JS 进一步拆成 `Install-XmaWorkspaceJavaScriptDependencies`（只执行原生 `pnpm install`）、`Assert-XmaWorkspaceJavaScriptDependencies`（只验证）与 `Get-XmaWorkspaceJavaScriptRuntimeInfo`（只返回对象），禁止动作函数与对象读取混在同一个可赋值函数里。
- 用户语义：`[1]` 每次仍无条件只执行一次项目根原生 `pnpm install`，不增加 registry/reporter/timeout/purge 参数。删除 `node_modules` 后重新运行 `[1]` 时，用户必须直接看到与手工命令相同的 pnpm 原生 `Scope / Packages / Progress`，随后再进入工具链验证与 Rust/MSVC 阶段。
- Gate：Windows Gate 锁定 `Invoke-XmaPrepareExternal ... @('install')` 的唯一原生 install、`Out-Host` 输出边界、动作/读取分离，并禁止把 JS 安装动作函数赋值给 `$jsRuntime`。
- 验证边界：Linux 构建环境无法冒充 Windows PowerShell 5.1 实机；完成 Runtime 单测、静态 Gate、PowerShell BOM+CRLF、Source Manifest/ZIP 完整性后，仍以 Windows 删除 `node_modules` 后执行 `[1]` 为最终 E2E。

##60 · Windows pnpm 原生终端输出与乱码修复

- 实机确认：`[1]` 已能下载依赖，但上一批为避免 native stdout 被业务变量捕获，在 Bootstrap 动作层统一使用 `| Out-Host`。这会让 Windows PowerShell 5.1 接管 pnpm stdout，把 pnpm 用 carriage return (`\r`) 实现的同一行 `Progress` 刷新拆成逐行输出，同时引入额外的文本解码/再编码边界，出现 Unicode/ANSI 乱码。
- 修复：`[1]` 的唯一 Workspace 安装改为直接 `Invoke-XmaExternal -FilePath 'pnpm.cmd' -ArgumentList @('install')`，不再经过 `Invoke-XmaPrepareExternal -> Out-Host`。安装动作与 Runtime 读取仍严格分离，因此 stdout 不会被赋值捕获；pnpm 直接继承 Windows Terminal，显示行为与开发者在项目根手工执行 `pnpm install` 一致。
- Gate：Windows Gate 明确禁止 `pnpm install` 所在函数出现 `Out-Host`/`ForEach-Object`/管道式 `Write-Host`，并继续要求 `[1]` 只有一次完全原生 `pnpm install`。其它确实需要隔离返回值的非交互 Bootstrap 命令保持现有动作边界。版本仍为 `0.1.0`。


##61 · OpenTUI 根依赖收口与 Windows pnpm 链接失败修复

- 日期：2026-09-15
- 实机现象：Windows `[1]` 已能够按原生 `pnpm install` 正常显示 `Scope / Packages / Progress`，并完成 `resolved 530 / reused 427 / added ...`；最终在链接 `solid-js` 到 `apps/cli/opentui-runtime/node_modules` 时失败，报 `ENOENT ... mkdir apps\\cli\\opentui-runtime\\node_modules`。这证明下载、终端输出与 `[1]` 原生 install 边界已经正常，失败点位于项目依赖结构的最后链接阶段。
- 根因：`apps/cli` 本身已经是 Workspace package，又把其内部 `apps/cli/opentui-runtime` 注册成第二个嵌套 Workspace package。pnpm 因此需要为这个源码子目录维护独立 `node_modules` 链接岛；Windows 安装在父/子 Workspace 的链接阶段触发 ENOENT。该嵌套依赖岛本身也违背“项目根一次 `pnpm install` 统一管理 JavaScript 依赖”的目标。
- 修复：Bun `1.4.2`、OpenTUI core/solid `0.5.11`、Solid `1.9.15`、`@types/bun` `1.4.2` 全部固定声明到根 `package.json -> devDependencies`；`pnpm-workspace.yaml` 删除 `apps/cli/opentui-runtime` 显式 Workspace；该目录只保留 `app.tsx` / `build.ts` / ESM package metadata，不再拥有 dependencies/devDependencies 或独立 `node_modules`。
- Runtime：Windows/Unix 准备器、Console、`scripts/cli/bun.ts` 与 OpenTUI build 统一从根 `node_modules` 读取 Bun/OpenTUI/Solid；Bun 运行时仍以 `apps/cli/opentui-runtime` 作为源码 cwd，但依赖按标准 Node/Bun 向上解析到项目根。`[8]` 改为一次根 Workspace latest update，失败事务只恢复根 manifest/workspace/lockfile。
- `[1]` 边界不变：每次仍无条件且只在项目根执行一次完全原生 `pnpm install`；不新增 registry/reporter/timeout/purge 参数，不以 stamp/fingerprint/node_modules 存在性跳过。新结构预期 Workspace 数量从 19 降为 18，且安装过程不得再尝试创建 `apps/cli/opentui-runtime/node_modules`。
- 验证边界：当前 Linux 构建环境无法替代 Windows PowerShell 5.1/pnpm 11 实机链接 E2E；本地以 Runtime 单测、Gate 静态合同、shell/JSON/YAML、PowerShell BOM+CRLF 与最终 Source ZIP 完整性验证，Windows 最终验收仍以删除根 `node_modules` 后运行 `[1]` 为准。


##62 · Windows 公共 Probe 恢复

- 日期：2026-09-15
- 实机现象：根 `pnpm install` 已完整成功（18 Workspace、Bun postinstall、OpenTUI/Solid 根依赖均完成），随后 `[1]` 在 Runtime 验证阶段报“无法将 Invoke-XmaProbe 识别为 cmdlet/函数”。
- 根因：Bootstrap 重构时保留了 Bun、Rust/Cargo、rustfmt 与 Console 的 `Invoke-XmaProbe` 调用，但公共 `scripts/windows/xma-common.ps1` 中对应 helper 被遗漏，导致安装成功后第一次版本探测立即失败；继续执行到 Rust 也会重复触发同类错误。
- 修复：在 `xma-common.ps1` 恢复共享 `Invoke-XmaProbe`，专门捕获 `--version` / `fmt --version` 等短命令的 stdout/stderr，并返回 `{ ExitCode, Output }`；`pnpm install` 等进度型动作仍直接走 `Invoke-XmaExternal` 并继承终端，禁止经过 Probe。
- 回归：Windows Gate 锁定公共 Probe 定义、结构化返回字段和“只用于短命令静默探测”的职责边界，避免调用存在但 helper 再次丢失。版本保持 `0.1.0`。

##63 · Windows Bootstrap helper 闭包修复

- 日期：2026-09-15
- 实机现象：JavaScript 阶段已完整通过（18 Workspace、`pnpm install`、Bun/OpenTUI/Solid 与 TypeScript/Vite/tsx/tsup 验证均成功），进入 `[5/8] Rust / Cargo` 自动安装时立即报“无法将 `Test-XmaWritableDirectory` 识别为 cmdlet/函数”。
- 根因：Windows Bootstrap 多轮重构后，`xma-prepare.ps1` 仍引用 `Test-XmaWritableDirectory`、`Get-XmaNormalizedPath`、`Get-XmaPathEntries` 三个 XMA helper，但 `xma-common.ps1` 中定义已丢失。上一轮只恢复 `Invoke-XmaProbe` 没有对所有自定义 helper 做闭包检查，因此问题被推迟到 Rust 阶段才暴露。
- 修复：在 `xma-common.ps1` 恢复三项公共 helper：可写目录真实写入探针、PATH 规范化、PATH 条目解析。Rust 默认 `xma-path`/D 盘/自定义盘安装位置与开发 shim PATH 同步全部复用公共实现。
- Gate：Windows Gate 新增 `scripts/windows/*.ps1` 自定义 `*-Xma*` helper 静态闭包检查；任何被引用但没有在 Windows 脚本集合中定义的 XMA helper 都会直接失败，避免用户每推进一个阶段才发现下一个“函数不存在”。版本保持 `0.1.0`。

##64 · Rust 已验证工具链直接接管

- 日期：2026-09-15
- 实机现象：JavaScript Bootstrap 已完整成功，进入 `[5/8] Rust / Cargo` 后，脚本先通过绝对路径真实执行 `cargo --version` / `rustc --version` 并打印“目标位置已有可实际运行的 Rust/Cargo”，随后却在同一轮流程报“Rust 安装完成后仍无法恢复运行环境”。
- 根因：Rust 安装/发现路径在真实探针成功后仍执行 `Save-XmaRustEnvironmentState -> Import-XmaRustEnvironment` 的状态 round-trip，把“本次已经验证可运行”的事实再次交给状态恢复逻辑判定；状态恢复返回空时就把成功工具链误判为安装失败。
- 修复：`Install-XmaRustStable` 的 project-existing / project-repaired / project-installed 三条路径，以及系统已有 Rust/Cargo 的 external-command 路径，在绝对路径探针成功后直接构造并返回当前 Runtime `{ CargoHome, RustupHome, CargoExe, RustcExe }`。状态文件仍写入，只用于下次启动恢复，不再作为本次成功结果的二次裁判。
- Gate：Windows Gate 锁定四类 direct-runtime source，并禁止 Rust 安装成功路径重新 `return (Import-XmaRustEnvironment ...)`。版本保持 `0.1.0`。



##65 · Windows Rust 工具链标准 rustup 收口

- 日期：2026-09-15
- 实机现象：`[1]` 已完整完成 pnpm/TypeScript/Bun/OpenTUI，进入 Rust 后旧私有 `xma-path/rust` 状态链先误报“已有可运行 Rust/Cargo”，随后打印 `rustc.exe/cargo.exe 无法识别`，最后 `cargo.exe` 不在 PATH；说明项目自建 Rust Home、状态文件、盘符恢复与 Probe 误判互相叠加，复杂度已高于收益。
- 参考：对照 `AndrewNog0724/minecraft-host-agent` 的 Windows bootstrap，采用生态标准模型：已有 `cargo` 直接复用；默认 `~/.cargo/bin` 已存在则补进当前会话 PATH；缺失时 `winget install Rustlang.Rustup`，再由 rustup 初始化 stable/rustfmt。XMA 不复制其业务逻辑，只吸收“让 rustup 管 Rust、Bootstrap 只做检测/安装/PATH”的边界。
- 重构：Windows `[1]`/`[9]` 删除项目 `xma-path/rust` 安装器、D:/自定义盘符菜单、rustup-init 私有下载/镜像/checksum、checkout Rust state round-trip 与磁盘扫描。共享 `Resolve-XmaRustRuntime` 只从当前 PATH、用户显式 `CARGO_HOME`、标准 `%USERPROFILE%\.cargo\bin` 解析并真实执行 `cargo/rustc --version`；缺失时通过 winget 安装 `Rustlang.Rustup`，当前进程补 PATH，必要时执行 `rustup toolchain install stable --profile minimal` / `rustup default stable` / `rustup component add rustfmt`。
- Probe 修复：`Invoke-XmaProbe` 在执行前先确认绝对 executable/命令真实存在；不存在直接返回 `ExitCode=-1`，禁止 Windows PowerShell 5.1 把“无法识别命令”的非终止错误和残留 `$LASTEXITCODE` 误判成成功。
- 运行边界：Cargo crates 仍由 `[1]/[9]` 允许联网 `cargo fetch --locked`，`[4]/[7]` 继续 offline 校验；MSVC 缺失仍通过 winget 自动安装。旧 `xma-path/rust` 与旧 Rust state 不再参与运行，可作为历史本地目录由用户自行清理。版本保持 `0.1.0`。


##66 · Windows Rust 项目本地 Runtime 收口

- 日期：2026-09-15
- 结论：`%USERPROFILE%\.cargo` / `%USERPROFILE%\.rustup` 默认通常落在系统盘用户目录，不符合 XMA“项目在哪，开发依赖尽量跟项目走”的源码开发边界。Windows Rust 因此从用户级标准目录进一步收口为 checkout 本地 `runtime/rust/{cargo,rustup}`；`runtime/` 与 `node_modules/` 同级且已被 Git/Source Manifest 忽略。
- 安装：`[1]`/`[9]` 设置 `CARGO_HOME=<root>/runtime/rust/cargo` 与 `RUSTUP_HOME=<root>/runtime/rust/rustup`，从 Rust 官方 `static.rust-lang.org/rustup/dist/<target>/rustup-init.exe` 下载 Windows MSVC 引导程序，并同步下载官方 `.sha256` 做完整性校验；使用 `--no-modify-path --profile minimal --default-toolchain stable` 安装，rustfmt 缺失时再由项目本地 rustup 补齐。Rustup 官方明确支持在运行 rustup-init 前通过 `CARGO_HOME/RUSTUP_HOME` 自定义安装位置。
- 运行：Windows `[4]/[7]/Desktop Tauri` 只解析当前项目 `runtime/rust/cargo/bin/{cargo,rustc,rustup}.exe`，不回退系统 PATH、用户 `%USERPROFILE%\.cargo` 或旧 checkout state；Cargo crates 也进入项目本地 CARGO_HOME，构建 target 继续进入 `.cache/cargo-target`。
- 清理：删除旧 Rust 安装/恢复/盘符选择/整盘扫描/`Get-XmaLocalPathRoot` 运行逻辑；`[1]/[9]` 若发现当前项目根旧 `xma-path/rust` 与 Rust state 文件会安全删除，随后只使用 `runtime/rust`。`xma-path/` 的 Git ignore 仅用于防止历史本地目录误提交，不再承担 Rust 功能。
- 版本：保持 `0.1.0`。

##67 · Windows PowerShell 5.1 尾逗号语法修复

- 日期：2026-09-15
- 实机现象：`xma-dev.bat → [1]` 在进入任何准备步骤之前，Windows PowerShell 5.1 解析 `scripts/windows/xma-prepare.ps1` 失败，定位到旧目录清理数组末项 `(Join-Path $legacyRoot 'state\bun-environment.json'),`，报“`,` 后面缺少表达式”。
- 根因：Rust 项目本地 Runtime 收口时删除了后续旧清理项，却遗留数组最后一个元素的尾逗号。Windows PowerShell 5.1 不接受这种尾逗号，因此脚本在加载阶段直接失败，和 Git/Node/pnpm/Rust 实际安装流程无关。
- 修复：移除 `Remove-XmaLegacyLocalDirectory` 数组末项尾逗号；Windows Gate 新增所有 `scripts/windows/*.ps1` 的“逗号后直接闭合分隔符”静态检查，后续同类编辑会在封包前直接失败。
- 验证：PowerShell 源码继续保持 UTF-8 BOM + CRLF；Windows helper 闭包、Runtime 定向测试、Source Manifest/ZIP 完整性继续纳入正式包回归。版本保持 `0.1.0`。



##68 · Windows PowerShell 5.1 路径字符字面量修复

- 日期：2026-09-15
- 实机现象：`xma-dev.bat → [1]` 在打印准备说明后、进入 `[1/8] Git` 之前立即失败，报“无法将值 `\\` 转换为 `System.Char`，字符串的长度只能为一个字符”。
- 根因：`Refresh-XmaPath` 使用 `[char[]]@('\\','/')`。PowerShell 的单引号字符串不把反斜杠作为转义符，因此 `'\\'` 实际包含两个反斜杠；强制转换到 `System.Char` 时直接抛错。该函数在阶段输出前执行，所以整个 `[1]` 尚未开始就终止。
- 修复：路径尾部分隔符统一改为单字符数组 `[char[]]@('\','/')`；同时把 `xma-github.ps1` 的 `.TrimStart('./')` 改为显式 `[char[]]@('.','/')`，避免另一处多字符 Trim 参数在 Windows PowerShell 5.1 上产生绑定差异。
- Gate：Windows Gate 现在扫描全部 `scripts/windows/*.ps1` 的显式 `[char[]]` 字面量，要求每个元素恰好一个字符；并禁止 `TrimStart/TrimEnd` 直接传入长度大于 1 的单字符串。旧的用户目录 Rust Gate 同步删除，Gate 与当前 `runtime/rust` 项目本地 Rust 架构保持一致。
- 验证：在最终源码树上直接使用 Node 22 TypeScript strip-types 执行 9 项 Gate；`gate:windows` 必须真实执行并通过，不能再以人工“看起来通过”替代。当前容器没有 Windows PowerShell 5.1，因此 Windows 实机仍用于最终 E2E。

##69 · Windows Rust 路径收尾与 native Unicode 输出修复

- 日期：2026-09-15
- 实机结果：`xma-dev.bat -> [1]` 已完整通过 8/8，项目本地 Rust 正确安装到 `runtime/rust/{cargo,rustup}`，Cargo crates 也进入该项目 CARGO_HOME；旧 `xma-path/rust` 已在准备阶段被清理。
- 路径审计：Windows 运行/检查/构建统一经 `Resolve-XmaRustRuntime` 只解析当前 checkout 的 `runtime/rust/cargo/bin`，不回退 `%USERPROFILE%/.cargo/.rustup`、系统 Rust、旧 Rust state 或盘符扫描。源码中保留的 `xma-path/rust` / `rust-environment.json` 只属于一次性迁移删除路径，不参与任何发现、PATH、构建或版本判断。
- 乱码根因：`rustup-init` / `rustup component add` / `cargo fetch` 仍经 `Invoke-XmaPrepareExternal -> Out-Host` 消费 native stdout。Rustup 在连接管道时输出 UTF-8 字节，Windows PowerShell 5.1 再按本地代码页解码，中文 checkout 路径因此出现 `涓€閿...` mojibake；和真实目录内容无关。
- 修复：删除 `Invoke-XmaPrepareExternal`。Bootstrap 所有 native 动作统一直接调用 `Invoke-XmaExternal` 并继承当前终端；Rust 准备改为 void 动作 + `Resolve-XmaRustRuntime` 二阶段读取，避免为了返回 Runtime 对象再次引入 stdout pipeline。Windows Gate 禁止 `Invoke-XmaExternal ... | Out-Host/ForEach-Object/Write-Host`，并禁止 `$rustRuntime = Ensure-XmaRustToolchain`。
- 文档清理：Source Sync/Console 中 `xma-path` 文案明确标记为历史迁移对象；当前本地依赖只有 `runtime`、`node_modules`、`.cache` 与 `.git/xma-state`。版本保持 `0.1.0`。

##70 · Xiaoyu 启动链路 / Cursor / PATH / 模型就绪收口

- 日期：2026-09-15
- 实机现象：`[1]` 已完整通过后，`[4] Xiaoyu Terminal` 仍出现四类产品问题：Windows Text Cursor Indicator 的蓝色水滴会跟随星星/流星动画漂移；CLI 启动每次都无条件执行 Native `cargo build --offline` 导致进入 Workspace Trust 明显变慢；User PATH 中的 `xiaoyu/xma` 能被找到但中文 checkout 路径经旧 `cmd set /p` 读取后乱码，最终报“系统找不到指定的路径”；已配置 DeepSeek/Profile/Model/凭据仍显示“尚未就绪”，要求用户额外做连接测试。
- Cursor：Active OpenTUI 的主 Prompt、搜索框与普通输入 Dialog 全部 `showCursor=false`，Renderer 生命周期持续 `setCursorPosition(..., false)`；Workspace Trust 接受后保持 hardware cursor 隐藏再交给 OpenTUI，取消/退出才恢复。输入焦点/IME/编辑仍由 Textarea 管理，装饰帧不再拥有可见硬件 cursor 锚点。
- 启动性能：Windows `[4]` 对 `Cargo.toml/Cargo.lock/.cargo/config.toml + native/**/*.rs/Cargo.toml/build.rs + rustc --version` 形成 `cli-native.sha256`。构建产物与指纹一致时跳过 `cargo build`，直接 staging 当前 Native Runtime；只有源码/依赖/rustc 变化或产物缺失才执行一次 offline 增量构建。首次变更后仍会构建一次，后续启动不重复编译/下载。
- PATH：开发态 `.cmd` shim 改为纯 ASCII 跳板，转交 `xiaoyu-dev.ps1`；PowerShell/.NET 以 UTF-8 读取 `source-root.txt`，再调用当前 checkout 的 `xma-dev.bat cli <caller-cwd>`。`[1]` 同时清理其他 checkout 的 `.git/.cache/xma-state/dev-bin` User/Process PATH 项，中文路径不再交给 cmd 本地代码页解析。
- 模型状态：`providerReady` 改为“存在活动 Provider/Profile/Model + Credential Reference 当前可读取”。首次配置完成真实模型选择/Reasoning 后直接显示“模型已就绪”；切换已保存 Profile/Model 同样立即按凭据状态显示就绪。`Brain Ready Probe / 连接测试` 保留为 Ctrl+P/doctor 的可选真实连接诊断与发布验收证据，不再是 UI Ready 前置条件；真实请求若出现 auth/network/model 错误仍必须显式返回。
- 回归：Distribution/OpenTUI/Windows Gate 锁定 hardware cursor 隐藏、Trust→OpenTUI cursor handoff、模型 Ready 不依赖 Probe、首次配置不自动 Probe、Native 指纹缓存和 UTF-8 dev shim。版本保持 `0.1.0`。



##71 · OpenTUI 输入焦点 / Dev Shim / 首次启动性能回归修复

- 日期：2026-09-16
- 实机回归：#70 把 Active OpenTUI cursor 永久隐藏并每 50ms 强制 `setCursorPosition(0,0,false)`，Windows Terminal 下导致 Text Cursor Indicator 随动画漂移且主 Prompt 失去可用输入体验；同时 dev shim 虽改为 PowerShell 读取 UTF-8，却又回跳 `xma-dev.bat`，中文 checkout 仍可在 cmd 层报“系统找不到指定的路径”。
- Cursor：按项目固定的 OpenTUI `0.5.11` 上游实现重新对齐。`EditBufferRenderable` 的 focused Textarea 原生 `renderCursor()` 负责真实 caret/IME；主 Prompt 恢复 `promptCursorVisible` + focused Textarea，装饰动画只 `prompt.requestRender()`，禁止工作台全局定时改 terminal cursor。Workspace Trust raw 选择结束后始终恢复 cursor，再由 OpenTUI 接管。搜索框/普通输入 Dialog 同样使用原生 Textarea cursor。
- PATH：`.cmd` 继续只做 ASCII 跳板；`xiaoyu-dev.ps1` 用 .NET UTF-8 读取 `source-root.txt` 后直接调用 `scripts/windows/xma-console.ps1 -Command cli -Workspace <caller-cwd>`，彻底取消回跳 `xma-dev.bat/cmd.exe`。`[1]` 新增 `XMA_DEV_SHIM_VERIFY=1` 自检，实际执行生成的 `xiaoyu.cmd` 链路但不进入 TUI，中文路径问题在准备阶段即 fail loud。
- 启动性能：Native 指纹/构建缓存逻辑下沉到 `xma-common.ps1` 共享；`[1]` / `[9]` 在 crates offline 复检后预构建 `xma-native-runtime` 并写 `cli-native.sha256`，`[4]` 只在 Rust/Cargo 输入变化或产物缺失时离线重建，因此完成 `[1]` 后首次 `[4]` 也应直接进入 Trust/TUI。
- 模型状态：产品 Ready 仍严格等于活动 Provider/Profile/Model 已保存且 Credential Reference 当前可读取；Prompt Dock Provider 行与底部提示显式显示“模型已就绪”，连接测试继续只作为可选诊断，不参与 Ready gating。
- 回归：OpenTUI/Distribution/Windows Gate 改为锁定 Textarea cursor ownership、Trust cursor handoff、direct-PowerShell UTF-8 shim + 实际 shim 自检、`[1]` Native build cache 与模型 Ready 文案。版本保持 `0.1.0`。

##72 · Source Sync 运行入口一致性修复

- 日期：2026-09-16
- 目的：修复维护者把新源码包同步到长期 Git checkout 后，磁盘源码已经更新但全局开发态 `xiaoyu/xma` 仍可能指向旧 checkout，导致 TUI 看起来“还是老版本”的假同步问题。
- Source Manifest：复制/删除完成后新增全量 SHA-256 源/目标复核；Manifest 任一受管文件内容不一致、或应删除的上一版文件仍残留时直接失败，不再输出“同步完成”。
- Dev Shim：`Install-XmaDevelopmentCommands` 从 `xma-prepare.ps1` 收口到 `xma-common.ps1`，`[1]` 与 `XMA-Sync.bat` 复用同一 UTF-8 `source-root.txt`、ASCII `.cmd` 跳板和 User PATH 清理逻辑，禁止维护两套实现。
- Checkout 切换：Source Sync 仅在用户此前已经注册开发态 `xiaoyu/xma` 时自动重绑到本次明确选择的目标 checkout，并在完成前验证 User PATH 只保留目标 dev-bin 且 `source-root.txt` 指向目标；从未注册过开发 shim 时不擅自新增 PATH。
- 职责边界：Sync 仍不运行 `pnpm install`、Cargo fetch/build、winget 或其他环境准备；已有运行中的旧 TUI 进程不会热替换，完成提示明确要求退出后重新启动。
- Gate：Windows Gate 锁定 Source Sync 全量哈希复核、共享 shim helper、自动 checkout 重绑与不新增未注册 PATH 的合同。

##73 · Terminal 思考状态与最终回答分层

- 日期：2026-09-16
- 实机现象：底部锚定与左右消息布局已经生效，但 DeepSeek 等 Provider 返回的原始 `reasoning-delta` 被直接作为 `Xiaoyu · 思考` 正文铺进 Transcript，形成大块英文内部推理文本；这与目标交互“先显示正在思考，再直接进入最终回答”不一致。
- UI 规则：原始 `reasoning-delta` 继续完整进入 Runtime live event，用于真实活动状态与协议语义，但 Active OpenTUI 默认不展示其正文；发送后立即显示淡化的“正在思考”，reasoning 持续到达时只保持该状态。
- 回答切换：首个正式 `text-delta` 到达时由现有 `applyTerminalRunEvent` 移除 thinking placeholder，并在同一 Provider 回调帧立即投影前几个正式回答字符；后续 text delta 继续由 30ms 缓冲泵平滑吐字。Tool Call/Result 仍按真实执行链可见。
- 防泄漏：Transcript Renderer 对非 placeholder 的 `reasoning` 项额外做显示层过滤，避免未来其它投影路径把原始思维正文重新带回默认 Terminal。只有 Provider Contract 未来提供可明确区分、面向用户的 reasoning summary 时才允许单独展示摘要。
- 回归：OpenTUI Gate 锁定 reasoning 只驱动 thinking 状态、首个 text delta 即时上屏、默认 Transcript 不出现 `Xiaoyu · 思考` 原始正文；版本保持 `0.1.0`。

##74 · Terminal Assistant 槽位与 Codex 式左右对齐修复

- 日期：2026-09-16
- 实机反馈：#73 已隐藏原始 reasoning 正文，但 thinking placeholder 被绘制成空白标签列后的独立“正在思考”，视觉上仍像额外的中间状态块；用户明确要求用户消息右对齐、Xiaoyu 工作区左对齐，并让 thinking 与最终回答复用同一 Assistant 槽位。
- 布局：用户消息继续在内容区右对齐；thinking 改为左侧单行 `Xiaoyu · 正在思考`，不再预留空白 label 列、不居中。Xiaoyu 最终回答改成左侧纵向块：品牌标签在上、正文从同一左边界开始，避免回答正文被固定 14 列标签栏整体右推。
- 状态替换：thinking placeholder 仍是 Transcript 最后一项；首个正式 `text-delta` 进入 `applyTerminalRunEvent` 时直接 pop placeholder 并 push/append assistant item，因此状态在同一会话位置原位消失并立刻换成最终回答，没有“正在思考 + 最终回答”同时占两块的过渡帧。
- 上游参考：对齐 Codex TUI 的 active/in-flight cell 思路——工作中的可变状态属于当前活动单元，正式消息流开始后由同一活动位置进入最终内容，而不是额外提交一条 reasoning 正文。
- 回归：OpenTUI Gate 锁定 `Xiaoyu · 正在思考` 左对齐、用户消息右对齐、Assistant 正文左对齐及 placeholder 不再使用空 14 列缩进。版本保持 `0.1.0`。

##75 · Terminal 用时与可展开活动摘要

- 日期：2026-09-16
- 实机目标：对齐 Codex 工作台的 Turn 完成态，在用户右对齐消息与 Xiaoyu 左对齐最终回答之间增加默认折叠的 `用时 N秒 ▸`；点击后展开这一轮真实发生过的公开工作过程，收起后只保留一行，不把 Tool 日志永久铺满 Transcript。
- Runtime 数据：`TerminalRunEvent.tool-call` 继续由同一 Agent Runtime live event 驱动，但额外携带该 Tool Call 已冻结的 arguments 快照；OpenTUI 只记录公开 activity entry。`reasoning-delta` 仍只驱动“模型思考与规划”阶段标记，原始正文不会进入 activity 或 Transcript。
- 活动内容：记录模型思考阶段、Tool Call、Tool Result 成败、开始生成最终回复及各阶段相对耗时；FS 工具显示路径，写文件只显示路径/字符数，Process 显示程序与经过 Secret 脱敏的 argv，通用工具过滤 `content/apiKey/token/password/secret/authorization` 等敏感字段。Tool Result 成功默认只显示完成状态，失败仅保留截断且脱敏的错误摘要。
- 布局与生命周期：运行中仍使用同一个左侧 `Xiaoyu · 正在思考` placeholder；Turn 完成/中止/失败后才把 activity summary 插入最后一条用户消息与 Assistant 结果之间，避免工作中布局跳动。Activity 行可点击 `▸/▾` 展开收起，底部锚定和历史滚动继续生效。
- 回归：OpenTUI Gate 新增 activity contract、tool arguments 透传、默认折叠/点击展开、完成/取消/失败结算和 raw reasoning 不进入 activity 的静态合同；版本保持 `0.1.0`。



##76 · Terminal 实时 Turn 计时与活动日志修复

- 日期：2026-09-16
- 实机反馈：#75 只在 Turn 结束时插入一次静态 `用时 N秒`，虽然最终数字来自真实开始/结束时间，但运行中的长任务完全看不到计时增长，也不能在模型工作期间展开查看刚刚发生的工具动作；这不符合 Codex 式“当前 Turn 正在工作多久、已经做了什么”的交互。
- 实时计时：用户提交后立即创建当前 Turn 的 activity item，并记录 `startedAtMs`；Renderer 复用已有 1 秒 `clock` 刷新，根据 `now - startedAtMs` 实时显示 `思考了 12s / 12m 1s / 1h 2m 5s`。Provider/Agent Runtime 真正完成、中止或失败的那一刻立即冻结当前真实 elapsed（不把后续 UI 打字机缓冲时间算成模型工作时间），禁止使用示例常量或预估耗时。
- 实时活动：`reasoning-delta` 只追加一次公开的“模型思考与规划”阶段，不保存原始隐藏思维正文；Tool Call / Tool Result 到达时立刻写入同一个 activity item，展开状态下边执行边追加。首个正式 text delta 记录“开始生成最终回复”，最终回答仍沿用首帧即时 + 30ms 缓冲流式显示。
- 布局：顺序固定为用户消息（右）→ 实时 activity（左）→ Xiaoyu thinking/answer（左）。Activity 默认折叠但运行中即可点击展开；展开/收起状态在结算时保持，不因完成而重建一条静态摘要。
- 上游参考：Codex TUI 的 completion metadata 使用真实 Turn duration 生成 `Worked for ...`，XMA 对齐“真实持续时间”语义，同时保留自己的运行中实时刷新和公开 Tool 活动日志。
- 回归：OpenTUI 静态合同新增 `startedAtMs + running outcome`、实时 `nowMs - startedAtMs`、提交即插入 activity、事件到达即同步 entries、完成后冻结耗时；版本保持 `0.1.0`。

##77 · 模型自主行动 / 用户权限 / 多 Host 单 Runtime 合同

- 日期：2026-09-16
- 目的：在正式进入下一阶段 Agent Engine 开发前，锁定“顶级模型保持完整行动决策权、权限完全归用户、CLI/Desktop/Web/Server 只是一套 Runtime 的不同 UI/部署 Host”三条产品底线，避免后续为了安全或 UI 便利把 XMA 做成固定流程助手或三套平行系统。
- Model Autonomy：当前真实 Provider Model 负责理解目标、规划下一步、选择 Tool、根据 Observation 自纠、决定验证与完成条件；Skill/专业 Agent/Workflow 默认只增强知识、loadout 与能力，不得用隐藏 Planner、固定 A→B→C 或缩水 Tool Surface 取代旗舰模型智力。缺少行动能力时优先补 Tool/Plugin/Native capability，不把可自动化工作默认甩回用户。
- Permission Profile：统一三档 `ask / smart / full`，产品文案为“请求批准 / 替我审批 / 完全权限”。权限只 gate 文件/进程/网络/系统等副作用，不限制模型思考。`full` 仍受 OS 权限、Rust hard invariant、Secret 隔离和当前 Host 真实 capability 约束。
- Approval lifecycle：需要批准的 Tool Call 在同一 active Turn 中挂起；Host 收集 `allow-once / allow-session / deny` 后先 durable audit，再继续执行或把 deny 作为结构化 Observation 返回同一模型。批准后不得要求用户重新发送“继续”；拒绝也不默认结束任务，模型应先寻找缩小 scope、替代 Tool、portable/local 等可行路径。
- Multi-Host：Terminal、Desktop、Web、Server 的 Agent/Session/Provider/Tool/Permission/Approval 只允许实现一次，通过 App Protocol/Runtime Event 消费。Host 只负责输入、渲染、交互与部署环境 capability bridge。Web 连接云 Server 时 Native 副作用作用于服务器；未来控制用户本机必须使用显式 Remote Node/Device capability，浏览器不能绕过 OS 安全边界。
- 文档：同步更新 `AGENTS.md`、`PROJECT-ARCHITECTURE.md`、`AGENT-ENGINE-STRATEGY.md`、`AGENT-RUNTIME.md`、`DEVELOPMENT-RULES.md`、`DEVELOPMENT-PLAN.md`、`PROJECT-STATUS.md`、`CODEMAP.md` 与 `README.md`；大路线不变，下一步仍正式进入 Pi-first 的 Agent Engine 行为级开发，但实现必须从第一天保持 Host-neutral 与用户权限续跑语义。

##78 · Terminal 鼠标滚轮历史回看修复

- 日期：2026-09-16
- 实机现象：对话内容超过 viewport 后，`PageUp/PageDown` 可以直接驱动 Transcript `ScrollBox`，但 Windows Terminal 鼠标滚轮在部分会话空白/装饰单元上没有进入 Transcript scroll path，导致用户无法用滚轮查看更早历史；现有 OpenTUI 回归只检查键盘 `scrollBy`，没有覆盖 mouse wheel。
- 根因边界：固定 `@opentui/core@0.5.11` 的 `ScrollBoxRenderable` 自身支持 wheel + sticky/manual scroll，且手动离开 bottom 后会暂停 sticky；XMA Host 此前完全依赖 OpenTUI hit-test 把 wheel 命中 ScrollBox，没有 Host 级兜底。星空/流星与透明布局使真实终端中某些单元可能由其它 Renderable 成为 hit target，因此 wheel 不一定经过 Transcript。
- 修复：OpenTUI 根 Host 新增 Transcript wheel fallback。只有 wheel 没有从 `transcriptScroll` 子树冒泡、且鼠标 Y 坐标确实位于 Transcript viewport 时才直接调用同一 `ScrollBox.scrollBy()`；正常命中 ScrollBox 时不重复滚动。这样仍复用 OpenTUI 原生 sticky/manual state：向上滚暂停自动贴底，滚回 bottom 后恢复 follow。
- 回归：OpenTUI 静态合同新增 root `onMouseScroll`、Transcript descendant 去重、viewport 坐标限制和真实 `scrollBy` 兜底；`AGENTS.md` 新增 Terminal 历史滚动硬规则。版本保持 `0.1.0`。

##79 · Terminal 长对话 ScrollBox viewport 修复

- 日期：2026-09-16
- 实机反馈：#78 已补 mouse wheel 事件兜底，但窗口较矮、对话内容超过一屏时，历史顶部仍会被裁掉且滚轮无法回看；全屏后因为 viewport 足够高又看似正常，说明问题不在历史数据或 wheel 输入本身，而在 Transcript 的布局/scroll range。
- 根因：为实现“短对话贴近输入 Dock”，Transcript `ScrollBox` 的 internal content 被设置为 `justifyContent: flex-end`，同时 flex 链没有显式锁定可收缩 viewport。长内容时会出现负向/被裁剪的上方 overflow，ScrollBox 无法稳定得到与真实历史一致的 `scrollHeight - viewport.height`，因此 wheel/PageUp 即使改变 scroll position 也无法访问被裁掉的顶部。
- 修复：Workbench 主内容链与 Transcript ScrollBox 显式 `flexShrink=1 + minHeight=0`，输入 Dock 固定 `flexShrink=0`；ScrollBox content 恢复正常 column 流，不再使用 `justifyContent:flex-end`。短内容贴底改为 Transcript wrapper 的 `marginTop=auto`：内容不足一屏时 auto margin 吃掉剩余空间，内容超过一屏时 margin 自动归零并让内容自然增高，从而形成真实 scroll range。
- 兼容：保留 `stickyScroll + stickyStart=bottom`、#78 mouse wheel fallback、PageUp/PageDown/Ctrl+Home/Ctrl+End；用户离开底部后继续暂停自动跟随，返回底部后重新 follow。
- 回归：OpenTUI 合同新增 viewport `minHeight=0`、Dock `flexShrink=0`、auto-margin bottom anchor，并明确禁止在 Transcript ScrollBox content 上重新引入 `justifyContent:flex-end`。版本保持 `0.1.0`。

##80 · 修复 Prompt 工作流 + Terminal 模块化 / 滚动 / Cursor / 启动链收口

- 日期：2026-09-16
- 流程治理：新增 `REPAIR-WORKFLOW.md` 与 `REPAIR-PROMPTS.md`。以后非纯文案 Bug 必须先建立 `# 01/# 02/...` 修复 Prompt，再实施、验证、回填证据；完成后同步 UPDATE-LOG，状态变化同步 PROJECT-STATUS。当前 #01 记录本次 Terminal 历史滚动、caret、启动速度与全局开发命令问题，禁止再次只靠聊天上下文修补。
- 模块化：`apps/cli/opentui-runtime/app.tsx` 从约 1900 行级巨型 Host 收口到约 1050 行父级协调器；新增 `ui/transcript-viewport.tsx`、`prompt-dock.tsx`、`background-sky.tsx`、`home-logo.tsx`、`dialogs.tsx`、`activity-format.ts`、`theme.ts` 与父级 `contracts.ts`。子模块通过稳定 Host contract 连接，避免深层穿透 CLI ownership。
- Cursor：删除父级 `promptCursorVisible` 800ms 定时 toggle；PromptDock 使用 OpenTUI Textarea 原生 `showCursor=true + blinking=true`。Background/Logo 动画状态留在各自组件，删除 decoration → parent → Prompt `requestRender()` 链；进入会话后背景 motion 继续冻结。
- 历史滚动：Transcript 成为唯一 ScrollBox owner，`flexGrow=1 + flexShrink=1 + minHeight=0`；短内容使用显式正向 top spacer，长内容自然形成 `content.height > viewport.height`。删除 #78 的 root wheel fallback，回归 OpenTUI 原生 wheel/sticky/manual-scroll，避免双重滚动模型掩盖布局根因；父工作区会话态使用 `flex-start`，Prompt Dock 固定不参与压缩。
- Windows 启动：`[4]`/全局开发态 `xiaoyu/xma` 直接调用项目 `node_modules\bun\bin\bun.exe run --no-install ../src/main.ts`，不再经过 `pnpm -> tsx -> scripts/cli/bun.ts -> bun`；Native cache 先比较 fingerprint，命中即复用，只有 miss 才做 Cargo offline 校验/build。
- PATH：开发态全局入口固定 `%LOCALAPPDATA%\Xiaoyu\dev-bin` 并写 Windows User PATH；`.cmd` 为 ASCII 跳板，PowerShell UTF-8 读取 `source-root.txt`。Source Sync 切 checkout 只更新稳定入口的指针并清理旧 checkout-local dev-bin PATH。
- 回归：OpenTUI 测试调整为按子模块 ownership 验证并新增 direct-Bun / stable User PATH 防回归，当前 29/29 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate PASS；TS/TSX 语法转译 PASS。Source Manifest 现为 225 个受管源码文件；成品候选 ZIP 独立解压后 225 + manifest 内容完整、哈希差异 0、额外文件 0，并从解压树再次执行 29 个回归与 9 项 Gate 全部 PASS。Windows Terminal wheel/caret/启动耗时属于用户实机 E2E，当前 Repair #01 状态保持“验证中”，不提前宣称完成。


##81 · Terminal Prompt Dock 父子布局与 `[4]` Workspace 回归修复

- 日期：2026-09-16
- 实机反馈：#01 后 User PATH 与 Textarea caret 已通过用户 Windows 实机验证，但发送第一条消息后 Transcript 占满主工作区，输入框/Build/Provider/快捷键/提示整块消失，Xiaoyu 回答底部被裁切，用户无法继续正常聊天。
- 根因一（布局）：`PromptDock` 模块虽然已拆出，但组件返回 Fragment，输入区、快捷键栏和提示栏仍作为多个父级 Flex 兄弟参与分配；加入 `flexGrow=1` Transcript 后没有形成“可缩 Transcript + 固定 Prompt Dock”两个原子区域，实机中 ScrollBox 可把 Prompt 挤出 viewport。
- 修复一：`PromptDock` 改为单一 `id=xiaoyu-prompt-dock` 根 box，根节点固定 `flexShrink=0`，输入/状态/快捷键/提示全部收进内部；父工作区显式 `width=100% / flexGrow=1 / flexShrink=1 / minHeight=0 / overflow=hidden`，Transcript 继续是唯一 ScrollBox 并只消费剩余高度。
- 根因二（Workspace）：#01 为提速绕过 `scripts/cli/bun.ts dev` 后，主菜单 `[4]` 没有补回旧 runner 的默认项目根参数；由于进程在 `apps/cli/opentui-runtime` 下直接启动，CLI 把 runtime 目录误当 Workspace。
- 修复二：`Start-Cli` 统一计算 `$workspaceCandidate`；显式 `-Workspace` 使用调用者目录，无显式参数的 `[4]` 使用项目 `$Root`，然后始终把 resolved workspace 传给 Bun CLI。直接 Bun 快启动不回退。
- 流程：先新增 `REPAIR-PROMPTS #02` 再实施；OpenTUI 29/29 回归已更新并通过，Windows Gate 增加 `[4]` 默认 Root workspace 合同。Windows Terminal 仍需用户实机确认 Prompt Dock 可持续聊天、长回复只在 Transcript 内滚动以及 `[4]` 底部 Workspace 正确。

##82 · Terminal bounded Transcript Slot 与真实滚动范围修复

- 日期：2026-09-16
- 实机反馈：#81 把 PromptDock 收口为单一 `flexShrink=0` 节点后，Windows Terminal 仍在第一轮对话后把输入框/Build/Provider/快捷键整体挤出 viewport，且 Transcript mouse wheel 完全没有位移；说明 Fragment 只是次级问题。
- 最终根因方向：OpenTUI ScrollBox 仍直接作为 Workbench 的可增长 flex child，内部 `content` 使用 `flexShrink=0 + minHeight=100%` 并以真实消息内容形成 intrinsic height。仅给 ScrollBox root `flexGrow/flexShrink/minHeight` 未能在实机建立稳定 bounded viewport；长内容同时撑大 ScrollBox/父级，Prompt 被推出屏幕，而 `viewport.height` 又跟内容一起增长，`scrollHeight - viewport.height` 不能形成稳定正值。
- 修复：Workbench 在 Transcript 外新增 `xiaoyu-transcript-slot`，用 `height=0 + flexBasis=0 + flexGrow=1 + flexShrink=1 + minHeight=0 + overflow=hidden` 先锁定剩余高度；Transcript ScrollBox 改为 `height=100%` 只填满该 slot，不再直接以 intrinsic content height 和 PromptDock 竞争父级主轴。PromptDock 继续固定 `flexShrink=0`。
- 测试：新增 `apps/cli/tests/opentui-layout.test.ts`，使用 `@opentui/core/testing` 构造与生产同构的 bounded slot + ScrollBox + fixed dock 布局，真实添加 60 行历史并断言 Prompt 在屏内、`scrollHeight > viewport.height`、滚到底后 mock mouse wheel up 能让 `scrollTop` 下降。现有静态合同同步锁定 slot 与 `height=100%`。
- 状态：代码和文档已进入 #03 验证阶段；PATH/caret/direct-Bun/Workspace 参数保持不变。Windows Terminal 最终 wheel/多轮输入仍以用户实机为权威，不提前标完成。


##83 · Terminal #03 实机通过与 Windows Text Cursor Indicator 识别

- 日期：2026-09-16
- Windows 实机验收：#03 的四项 E2E 全部通过——PromptDock 持续可见、可连续多轮发送、长历史鼠标滚轮可自由查看、手动离底后新输出不抢回且回到底部恢复 follow。#02/#03 因此正式标记已完成。
- 新视觉现象：输入框真实 caret 上下出现蓝色水滴标记。截图与 Microsoft Windows 辅助功能语义一致，确认这是系统“文本光标指示器（Text cursor indicator）”，不是 XMA/OpenTUI 自绘第二套 cursor。
- 决策：保持 #71/#80 已验证的 focused Textarea 原生 caret ownership；禁止为了隐藏 OS 指示器重新关闭 `showCursor`、恢复 `CURSOR_MARKER`/软件假光标或全局 cursor timer。XMA 也不得静默修改 Windows 辅助功能设置。
- 用户控制：若不希望显示蓝色上下标记，由用户在 Windows“设置 → 辅助功能 → 文本光标 → 文本光标指示器”关闭或调整大小/颜色。未来若蓝色标记发生漂移而不是稳定跟随 caret，再开新的 Repair 编号调查 Host cursor ownership。

##84 · 统一 Session Runtime Metrics 与 Provider Telemetry

- 日期：2026-09-16
- 目的：把 Terminal 底部运行指标从品牌/UI 私有字符串提升为 Host-neutral `SessionRuntimeMetrics`，供 CLI/Desktop/Web/Server 后续复用同一真实数据源。
- 数据：从 durable Session events + 当时真实 Provider/Profile/Model 投影会话/本轮 tokens、请求数、轮次、cache、latency、context、API cost、余额、subscription quota、permission 与 compaction 状态；未知字段显示 `—`，禁止示例/假值。
- Provider：Telemetry Registry 区分 API/subscription/unknown；DeepSeek official 仅在官方 base URL + 可读 credential 时允许调用真实 `/user/balance`，第三方 OpenAI-compatible 不外发凭据。
- Context：占用按最近真实 Step 的 input tokens / 该 Step 模型 context window 计算，小比例保留 `<0.1%/0.x%` 精度，不再四舍五入成 0%。
- 状态：核心/Terminal 已实现，Desktop/Web 后续只消费同一 Contract，不复制统计逻辑。

##85 · Provider 配置 SecretInput 与 TUI 局部错误隔离

- 日期：2026-09-16
- 实机根因：模块化后 `SecretInput` 已迁入 `ui/dialogs.tsx`，但 `usePaste/decodePasteBytes/PasteEvent` import 仍留在父级，进入 API Key 输入即抛 `usePaste is not defined`，异常又会让当前 modal/render 链失活。
- 修复：paste hook/helper ownership 回到 Dialog 模块；Provider Setup / Model Picker / SecretInput 等 modal 增加局部 ErrorBoundary + Promise settlement，异常只关闭当前流程并恢复 Prompt focus，不允许拖死整个 TUI。
- 安全：Secret 粘贴仍只显示掩码，明文不进入画面/日志；取消/失败不破坏已成功持久化的 Profile。

##86 · 真实模型身份、Work Mode、三档权限与 Plan 交接

- 日期：2026-09-16
- Model Identity：Xiaoyu 固定为 Agent/Product identity；每个真实 Step 继续由用户选定的 Provider/Profile/Model 执行，禁止额外隐藏“小鱼模型”替代旗舰模型决策。
- Work Mode：Build/Plan/Compose 与 Permission Profile 分离。Plan ToolPlan 强制只读；Work Mode 进入 model-visible Context，让真实模型知道自己当前模式和能力边界。
- Permission：`ask/smart/full` 进入真实 Tool Policy；ask 产品 UI 使用 fail-safe `Yes/No`，Yes 仅 allow-once，No durable deny 后对应 Tool 零执行。
- Plan Handoff：新增纯 control `xma.plan.ready`；只有真实模型明确计划已就绪时才生成 durable Plan。Host 再询问 Yes/No；No 保留 Plan，Yes 记录 decision、切 Build，并让后续 Turn 读取 retained Plan 执行。

##87 · Ctrl+C 文本选择复制与中止/退出路由

- 日期：2026-09-16
- 根因：Renderer 已 `exitOnCtrlC=false`，但 XMA Root handler 未优先检查真实 Selection，空闲 Ctrl+C 直接 onExit，导致鼠标选择模型回复后无法正常复制。
- 路由：真实选区 → OpenTUI OSC52/Host Clipboard 复制；无选区+busy → Abort 当前 Turn；modal → cancel/deny；idle 首次 Ctrl+C 只提示，短时间二次 Ctrl+C 或 `/exit` 才退出。
- 兼容：Esc 有选区只清 Selection；复制失败不退出、不清 Transcript；保留 caret/IME/scroll/sticky 已验收行为。

##88 · 正在思考实时活动体验与 GitHub 原地最新同步

- 日期：2026-09-16
- Activity UX：运行中使用真实 Turn `startedAtMs` 实时显示 `已处理 N`，下一行 `Xiaoyu · 正在思考 ▸/▾` 可展开；完成/取消/失败时冻结为 `用时 N ▸/▾`。时间使用秒/分/小时真实格式，不使用固定/预估值。
- Activity 内容：展开区按真实事件顺序展示开始处理、Work Mode 公开目标、模型进入分析阶段、脱敏 Tool Call/Result、开始整理最终回答。Provider 原始 `reasoning-delta.text` 继续禁止进入 Activity/Transcript，因此这里是公开执行摘要，不是 hidden chain-of-thought。
- Terminal 结构：thinking placeholder 仍保留为内部流式槽位，但不再重复绘制第二条“Xiaoyu · 正在思考”；可点击 Activity 行是唯一运行状态展示，首个 text delta 继续原位进入最终回答。
- GitHub 更新：`xma-dev.bat -> [10]` 改为“同步 GitHub 最新源码”，真实逻辑仍归 `xma-console.ps1`。正确 clone 中先 `fetch --prune`，显示 HEAD/origin-main/ahead-behind/dirty；无远端差异直接报告已最新，有差异才 `pull --rebase --autostash`。
- 强制恢复：`YES` 后先在 `.git/xma-state/update-backups/<timestamp>/` 保存 metadata；tracked 修改写 `tracked.patch`，local ahead commit 写 `local-commits.patch`，再 `reset --hard origin/main`。禁止删除 clone、禁止自动 `git clean`，继续复用 runtime/node_modules/.cache/dist。
- 下一步提示：只有依赖 manifest 在更新前后发生变化才要求重新 `[1]`；否则可直接重启 `[4]`。自动验证：Activity 35/35 定向测试 PASS、Runtime updater 2/2 PASS、9 项 Gate PASS；Source Manifest 242 files、成品 243 entries 独立解压缺失/额外/哈希差异均为 0。Windows Terminal 点击展开与 Windows PowerShell 5.1 `[10]` 实机同步仍待用户 E2E。

##89 · Terminal 用户消息整行 band、Prompt 垂直节奏与 Metrics 全量直显

- 日期：2026-09-16
- 流程：严格按 `REPAIR-WORKFLOW.md` 先建立不可变 `REPAIR-PROMPTS #12`，再实施代码；本轮引用 #03/#04/#05/#10/#11，不覆盖旧 Repair 结论。
- 实机反馈：#11 用户消息仍是右侧浅色小块，缺少上下 padding；Home Prompt 视觉偏低，Prompt/detail/快捷区过挤；约 78 列 Home Dock 因 width 分支 + `height=1/overflow=hidden` 只剩少量 metrics，看起来像“数据被删”。
- 上游参考：固定审阅 Pi commit `71dca871bc80b6bc97be37f0ca3189399d651fff` 的 `UserMessageComponent`；只吸收“整条内容列背景 + 横向 outputPad + 纵向 1 行 padding”的布局原则，不复制 Pi Renderer/品牌/Agent 语义。
- 用户消息：`TranscriptViewport` 删除 `justifyContent=flex-end + maxWidth=72%` 小气泡，改为 content column 内 `width=100%` 的浅色 user band，左右/上下各 1 单位 padding；长消息继续完整换行，Transcript 仍只有一个 ScrollBox owner。
- Metrics：`sessionStatusItems()` 不再根据宽度删 canonical detail；新增 CJK/emoji-aware `terminalTextColumns()` 与 `sessionStatusRows()`，完整 billing/cache/session+turn tokens/compaction/turn count/真实费用/permission 只按终端列宽换行。`SessionStatusBar` 删除固定一行裁剪，改为 PromptDock 内自适应多行并保留上下 padding。
- Home/Prompt：`xiaoyu-workbench` 仅在 center/Home 模式增加受控 bottom flex padding，让 Logo+Prompt 视觉中心轻微上提；Conversation bounded Transcript slot、PromptDock `flexShrink=0`、Textarea caret/IME 与 sticky scroll 合同不变。
- 回归：formatter 测试锁定 78/100/136/220 列字段集合恒定且窄宽多行；静态 Host 合同锁定 full-width padded user band、禁止 maxWidth bubble、detail 不再 fixed-height overflow；真实 OpenTUI layout 测试新增 user band 尺寸/padding 与 multi-row metrics dock 留在 viewport 的 Renderable 断言。
- 状态：#12 进入**验证中**。`session-status` 8/8、OpenTUI 静态/快捷键 35/35、Runtime updater 2/2、修改文件 TS/TSX 语法转译与 Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate 均 PASS；Workspace node_modules 不存在且 registry DNS 失败，真实 OpenTUI Renderable layout 测试与完整 `pnpm check` 不能在沙箱冒充通过。Windows Terminal 仍需用户目视验收 user band、Home 上移、多行 metrics 与常见窗口高度。
- 版本/发行：版本仍为 `0.1.0`；Source Manifest 242 files，候选 ZIP 243 entries，独立解压 missing/extra/hash differences 均为 0，并从解压树再次通过 formatter 8/8、静态/快捷键 35/35、Runtime updater 2/2 与 9 项 Gate。正式源码包继续只使用 `xma-0.1.0.zip` + SHA-256，不引入 repair/final/v2 正式包名。


##90 · Terminal 用户消息浅灰白与右对齐微调

- 日期：2026-09-16
- 流程：继续遵守 `REPAIR-WORKFLOW.md`，先建立 `REPAIR-PROMPTS #13`，再做 UI 微调；#13 引用 #12，不改写旧结论。
- 用户反馈：#12 的整行 user band 结构基本正确，但底色“太白”，同时消息内容视觉上落在左侧；用户要求“只有有点白、浅白即可”，并恢复用户消息右对齐。
- 修复：`COLOR.userMessage` 从 `#d7d7d7` 调整为更柔和的浅灰白 `#bdbdbd`；`TranscriptViewport` 的 user row 增加右对齐布局容器，保持 full-width band + padding 不变，只把文本与内部对齐切到右侧。
- 状态：#13 进入**验证中**，等待用户 Windows Terminal 最终截图确认。PromptDock、Metrics 全量直显、Home 上移与滚动/caret ownership 未在本轮修改。

##91 · Terminal 空会话状态栏精简与左右对齐

- 日期：2026-09-16
- 流程：按 `REPAIR-WORKFLOW.md` 先建立 `REPAIR-PROMPTS #14` 再实施；#14 继承 #12 的“对话后完整 metrics 不得按宽度隐藏”结论，只增加空会话展示例外。
- 实机反馈：Home / `当前会话0轮` 时完整 detail 仍显示大量 `—` 占位，视觉过重；用户只希望保留 `API` 与 `权限 替我审批`，并一左一右。
- 修复：新增 `sessionIdleStatusItems()` 统一格式化 billing/permission。`turnCount=0` 时 `SessionStatusBar` 使用单行 `justifyContent=space-between` 投影左 billing / 右 permission；`sessionStatusItems()` 同步只返回这两个字段。`turnCount>0` 后恢复 cache hit、精确 session/turn tokens、真实 compaction、轮次、真实费用和 permission 的完整 detail，窄屏继续只换行不裁字段。
- 回归：新增“0轮只显示 billing/permission、1轮自动恢复完整 telemetry”的 formatter 测试，并在 OpenTUI 静态合同锁定 idle helper、`turnCount > 0` 边界与 `space-between` 左右布局。`node --experimental-strip-types --test apps/cli/tests/session-status.test.ts apps/cli/tests/opentui-runtime.test.ts` 43/43 PASS；Runtime updater 2/2 PASS；修改文件 TS/TSX 语法转译 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate PASS。
- 状态：#14 进入**验证中**，等待 Windows Terminal Home 截图确认；Prompt headline、Provider/model 右对齐、PromptDock 高度、Transcript/scroll/caret 本轮未改。

##92 · GitHub fetch 容错 / Provider 错误归一 / user band 降亮 / slash 命令真唤起

- 日期：2026-09-16
- 流程：按 `REPAIR-WORKFLOW.md` 先建立不可变 #15/#16/#17/#18，再实施；四个问题各自保留独立 Repair ID，不覆盖 #09/#11/#12/#13 历史。
- #15 `[10]`：GitHub fetch 对明确 transport reset 做默认重试 + 单次 command-scoped HTTP/1.1 fallback；最终失败提供不泄漏代理值的中文网络诊断。fetch 成功后改为本地 `rebase --autostash origin/main`，强制恢复仍先备份再 reset，禁止 clone/clean/global config。
- #16 Provider：新增 `insufficient_balance` 与统一 `providerErrorPresentation()`；OpenAI-compatible 抽取 wire message 并保留已脱敏 detail，Terminal 主正文只显示友好 system failure message，不再 dump JSON 为 Xiaoyu 回复。
- #17 视觉：user band 降为 `#2d2d30`，正文 `#e2e2e2`；full-width、右对齐、padding、ScrollBox ownership 不变。
- #18 命令：Active Prompt 输入单独 `/` 直接打开与 Ctrl+P/Ctrl+K 同源的真实 command palette；不维护第二套假命令。补齐 `/vivid` shortcut → `visual` 内部 action 的 alias，使直接 `/vivid` 也真实执行。
- 自动证据：OpenTUI 合同 38/38 PASS；session/activity/shortcut 12/12 PASS；legacy TUI 29/29 PASS；Provider mock 5/5 PASS；Runtime updater 2/2 PASS；修改 TS/TSX 语法转译 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate PASS。 Source Manifest 242 files；正式 ZIP 243 entries，独立解压 missing=0 / extra=0 / byte differences=0，并从解压树复跑 OpenTUI 38/38、session/activity/shortcut 12/12、legacy TUI 29/29、Provider 5/5、Runtime updater 2/2 与 9/9 Gate 全部 PASS。
- 待实机：Windows PowerShell 5.1/Git for Windows 网络链路、真实 Provider 余额错误、user band 最终亮度、Active slash 面板键盘/Esc 焦点均必须由用户 Windows Terminal 继续验收，当前不标“已完成”。

##93 · Slash inline discovery / Help / Assistant Markdown 清理

- 日期：2026-09-16
- 实机结论：#15 GitHub fetch 容错与 #17 user band 亮度由用户确认通过；#16 Provider 余额不足文案暂留验证中；#18 因“输入 `/` 立即打开 Ctrl+P modal”交互错误被用户判定不通过，按规则新建 #19，不改写旧 Repair。
- Slash UX：命令元数据收口为 `TERMINAL_COMMAND_CATALOG`；Prompt 输入 `/` 原位显示全部真实命令，prefix 输入实时过滤；`↑/↓` 选候选、`Ctrl+Space` 补全、完整 `/command` Enter 执行，Tab/Shift+Tab 继续切工作模式。Ctrl+P/Ctrl+K 保持独立 modal 入口但共享同一 catalog/action。
- `/help`：升级为真实 command action，在 Transcript 持久列出 `/help /settings /vivid /doctor /workspace /provider /model /permission /agent /clear /exit` 与用途说明，用户无需猜命令。
- Assistant 文本：新增 Host-only `transcript-text.ts` formatter，把 `- **代码开发**` 等常见 Markdown marker 转成干净终端文本，同时保留 fenced code body。
- 自动证据：OpenTUI 静态合同 + Transcript formatter 在候选 ZIP 独立解压树合并复跑 41/41 PASS；Runtime updater 2/2 PASS；修改 TS/TSX 逐文件 `transpileModule` 语法检查 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate PASS。Source Manifest 244 files，ZIP 245 entries，独立解压文件数 245。Windows Terminal inline suggestion / Ctrl+Space / exact Enter 仍待最终实机验收。

##94 · Slash prefix discovery / ghost completion 与 Prompt caret 降噪

- 日期：2026-09-16
- 实机反馈：#19 的 inline slash 已证明命令系统真实可用，但单独 `/` 立即展开全部命令过重；用户要求只有输入首个命令字母后才显示同前缀候选，并把当前候选未输入部分作为灰色 ghost suffix 紧贴 caret 后预览。
- Slash 行为：`slashCommandSuggestions('/')` 现在返回空；`/h` 只返回 `/h...`，`/he` 继续按完整 prefix 收窄。Prompt 输入 prefix 使用强调色，选中候选通过 `slashCommandCompletionSuffix()` 生成 dim ghost suffix；候选列表本身也拆成“匹配 prefix + 未输入 suffix”两段着色。`↑/↓`、`Ctrl+Space`、完整命令 Enter 与 Tab/Shift+Tab 模式切换合同保持不变。
- Caret：OpenTUI 0.5.11 的 cursor contract 只有 shape + blink on/off，没有 per-app blink interval。为遵守 #01/#04 的 native caret ownership，未恢复任何 `setInterval/showCursor` 软件闪烁；主 Prompt 改为原生 `line + blinking=false`、soft cursor color，消除高速白色 block 闪烁。
- 规则：AGENTS/DEVELOPMENT-RULES 已从“`/` 显示全部命令”更新为“单独 `/` 安静、首字母后 prefix discovery + ghost completion”；Ctrl+P/Ctrl+K 仍承担完整命令总览。
- 自动证据：修改 TS/TSX 逐文件 `transpileModule` 语法检查 PASS；OpenTUI 静态合同 39/39 PASS；Runtime updater 2/2 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate PASS。`tui.test.ts` 已增加 `/` 无候选、`/h`/`/he` prefix 与 `lp/p` ghost suffix 的行为回归；当前沙箱无 Workspace node_modules/tsx，完整行为测试留待已准备开发环境执行。
- 状态：#20 进入**验证中**。Windows Terminal 仍需实机确认 ghost text 与真实 caret 在不同字体/缩放下没有错位；若 overlay 位置有 1-cell 偏差只继续修 PromptDock 布局，不得回退 modal 或软件假 cursor。

