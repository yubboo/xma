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
- 首次启动：Workspace Trust 仍发生在进入 TUI 之前；进入 TUI 后仅当当前没有已配置 Brain/Profile 时自动打开“首次配置 Xiaoyu Brain”，沿用现有 API Key → 真实模型目录 → Reasoning → Brain Ready 流程。已有 Profile 的后续启动不再重复弹出。 Workspace 风险识别同时覆盖 Windows 系统目录（例如 `C:\Windows\System32`），默认仍为退出。
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
- Brain Setup：Trust 通过后，仅当当前没有已配置 Brain/Profile 时，在**同一个 Xiaoyu TUI** 中以居中 modal 启动 Provider → API Key → 真实 Model Catalog → Reasoning → Brain Ready 流程；已有 Profile 后续启动跳过第二层。
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
- Upstream 依据：按 MiMo Code 已验证组合锁定 `Bun 1.3.14 + @opentui/core@0.1.101 + @opentui/solid@0.1.101 + solid-js@1.9.10`，只吸收 `createCliRenderer`、原生 `TextareaRenderable`、Solid key/focus、Dialog/Flex layout 与 Bun build/plugin 用法；不复制 MiMo 的 Agent、Provider、Session、命令体系或品牌视觉。
- Active Renderer：新增 `apps/cli/opentui-runtime/` 作为独立 Bun/OpenTUI 前端域，主工作台改用原生 `<textarea>` 管理 caret/IME/selection/paste，多行输入、Tab/Shift+Tab 模式切换、Ctrl+P/Ctrl+K、Esc、Provider/Model/Reasoning、Tool Approval、鼠标与 resize 统一进入同一 Renderer 生命周期；`apps/cli/src/tui.ts` 暂只保留 Workspace Trust、纯合同与历史回归兼容，不再承担主工作台。
- 布局：新增 `apps/cli/src/opentui-layout.ts` 纯函数，Home/Transcript/Prompt/Shortcut/Notice 使用同一居中响应式宽度；112 列终端内容宽度为 102 cell、左右各 5 cell，避免之前正文过窄或一侧留黑明显更多。
- 依赖边界：OpenTUI 依赖固定放 `apps/cli/opentui-runtime/package.json`，由 Bun 独立安装，不进入根 pnpm Workspace lock；根 Node/pnpm 继续负责 XMA 业务、Server/Web/脚本，portable CLI 则由 Bun + Solid transform plugin 编译为 `xiaoyu[.exe]`，Server 仍使用随包 Node Runtime。
- 环境/发行：Windows `[1]` 与 Unix prepare 新增固定 Bun/OpenTUI 准备，CI/Release 同样独立 `bun install --cwd apps/cli/opentui-runtime --no-save`；`build:cli` 经 `scripts/cli/bun.ts` 构建，portable staging/installer 改为分发编译后的 `app/xiaoyu.exe` 或 `app/xiaoyu`。
- 回归合同：Active OpenTUI 源码静态禁止 `CURSOR_MARKER`、手写 DECTCEM、手写 mouse capture/release 与 `new toolkit.TUI`；新增离线测试验证固定版本、原生 Textarea/focus、动态加载边界及响应式左右对称布局，并把 OpenTUI runtime 纳入中文文件头 Gate。
- 当前验证：本沙箱已完成变更文件 TypeScript/TSX 语法转译、OpenTUI 纯合同测试 4/4、Unix Shell `sh -n` 与 9 项静态 Gate；Source Manifest 已在本批重新生成。另新增 `scripts/cli/smoke.ts`，Windows/Unix `[7]`、CI 与 Release 在依赖已准备环境中都会先编译 `xiaoyu[.exe]`，再执行 `--version` / `--help` 无交互烟测，避免“静态 Gate 通过但 OpenTUI Native CLI 实际不能启动”。当前沙箱没有 Bun/OpenTUI node_modules 且无法访问 npm registry，因此不冒充执行本机 OpenTUI Native build 或完整 `pnpm typecheck`。Windows Terminal 最终仍必须实机验收原生 caret/IME、Tab/Shift+Tab 后焦点不漂移、蓝色 Text Cursor Indicator 不再跑到屏幕其他位置、Ctrl+P/Ctrl+K/Esc、鼠标拖动、resize 与退出状态恢复。
- 交付：未冻结 `0.1.0` 继续只生成正式 `xma-0.1.0.zip` + `xma-0.1.0.sha256.txt`，禁止临时 OpenTUI/fixed/hotfix 包名。

