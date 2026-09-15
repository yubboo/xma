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
