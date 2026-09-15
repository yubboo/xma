# XMA Development Skill

## 作用

给参与 XMA 开发的 Coding Agent 一套短而强制的执行清单。完整规则以根 `AGENTS.md` 和 `docs/` 为准；本 Skill 不能覆盖它们。

## 开工前

1. 阅读 `AGENTS.md`。
2. 阅读根 `CODEMAP.md` 与 `docs/development/UPDATE-LOG.md`，先确认能力位置、最新工程批次和未完成边界。
3. 阅读 `docs/architecture/PROJECT-ARCHITECTURE.md`、`AGENT-ENGINE-STRATEGY.md`、`AGENT-RUNTIME.md`、`MODEL-PROVIDER.md`、`PLUGIN-SYSTEM.md`。
4. 阅读 `docs/development/DEVELOPMENT-RULES.md`、`DEVELOPMENT-PLAN.md`、`PROJECT-STATUS.md`、`UPSTREAM-REFERENCE.md`。
5. 若涉及 Terminal/安装/发布，额外阅读 `docs/architecture/DISTRIBUTION.md`、`WINDOWS-WORKFLOW.md` 与 `VERSIONING-AND-RELEASES.md`。
6. 先判断修改属于 TypeScript Agent/业务层还是 Rust Native/Security 层；不允许语言职责漂移。

## 实施纪律

- Provider Model 是推理核心，不写关键词路由/固定 Planner 替代模型。
- Agent 基础能力遵循 Upstream-first / No Blind Reinvention：先读 `UPSTREAM-REFERENCE.md` 固定 commit 下对应源码、测试、协议和失败处理，再设计 XMA 实现；“我们自己能写”不是跳过上游研究的理由。
- 稳定平台能力使用 `xma-*` package family；`xma-*` 表示 XMA 接口/源码/测试/发布所有权，不表示必须从零发明实现。
- Everything is a Plugin，但插件真实副作用必须走 Tool/Capability → Approval/Policy → Native → Rust Kernel，不能用 Node `child_process` / 无约束 `fs` 绕过安全边界。
- Model Intelligence Preservation：强模型负责判断下一步、选工具和根据 Observation 修正；Skill 增强知识/规程，不用固定流程或缩水 Tool Surface 代替模型思考。
- Model-visible 动态内容必须可从 Session/Context source 重建。
- 新行为优先通过 Provider/Tool/Context/Session/Plugin extension point；不要给 Agent Loop 加业务特例。
- Tool 必须有 Schema、权限/Capability、structured result、取消语义和测试；模型 Schema 与 Runtime 必须来自同一个 frozen ToolPlan。
- 需要 Approval 的副作用先 durable 记录最终决策再执行；allow-session 没有稳定 scope key 时禁止复用。
- Rust 只执行 Native/Security/Performance，不实现专业 Agent 决策；Native 先锁 Host Policy，真实 FS/Process 再由 Rust capability 二次 enforcement。
- UI 是 Runtime 客户端；当前优先底层，不为“看起来完成”堆假 UI。
- Terminal 主命令固定为 `xiaoyu`，`xma` 仅兼容；普通用户只安装预构建资产，installer 不得 clone 源码或要求 pnpm/cargo/MSVC。
- 不提交 Secret、node_modules、target、dist、根 runtime、用户 Workspace 或发布包。
- Windows 外部命令统一走 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`。
- Windows PowerShell 5.1 源码在正式封包前必须通过静态语法合同；数组/参数列表最后一项禁止遗留尾逗号（逗号后直接闭合 `)`/`]`/`}`），避免脚本加载阶段直接失败。
- Windows 短命令版本/能力探测统一复用 `xma-common.ps1 -> Invoke-XmaProbe` 返回 `{ ExitCode, Output }`；只允许用于 `--version`/`fmt --version` 等静默探测，禁止拿它执行 `pnpm install`/下载/构建等需要实时终端输出的动作。
- 公共源码开发和维护者 Source Sync 都必须支持任意本地目录/盘符：Windows canonical 流程固定 `git clone https://github.com/yubboo/xma.git` → `cd xma` → `.\xma-dev.bat`，Linux/macOS 同一 clone 后使用 `./xma-dev`；`XMA-Sync.bat` 只复用已存在、origin 正确的 XMA Git 工作目录；唯一候选可自动复用，多候选/无候选必须让维护者选择或输入已 clone 仓库路径，禁止自动创建 `xma/xma-worktree-*`，`XMA_TARGET_ROOT` 只用于显式指定现有仓库；源码开发入口与安装后的正式 `xma` 产品命令必须严格区分。
- 命名遵循 XMA 统一规则：目录/TS 用小写 kebab-case，Rust 用 snake_case，`.` 只用于 test/config/d 等语义角色；普通名字 1～3 个核心词，父目录去重，同逻辑不碎拆，完成前运行 `pnpm gate:naming`。
- 目录遵循 Feature Cluster / Predictable Location / Plugin Cohesion：适度分层、按真实功能聚合；能力 ownership 变化同步 `CODEMAP.md`。
- 跨 `apps/agents/packages/plugins/core` ownership 只走稳定公共 package 入口，禁止 `../../` 及更深路径穿越，也禁止 `xma-*/src/...` 内部导入；workspace 依赖显式写 `workspace:*`。

## 完成前

- 运行与变更面匹配的 typecheck/test/Gate；不能运行的检查要明确说明原因。
- Provider/Native/跨平台能力没有真实 E2E 就不能宣称完成。
- 修改架构时同步文档和 Gate；目录/公共 package/Stable Import/阶段变化还必须追加 `UPDATE-LOG.md` 下一个 `##NN` 编号并更新 `CODEMAP.md`。
- 未冻结 0.1.0 修正仍交付 `xma-0.1.0.zip` + `xma-0.1.0.sha256.txt`，禁止 fixed/hotfix/final/v2/new。

- Windows `[1]` 是一键完整 Bootstrap：Git、Node、兼容 pnpm、Workspace JavaScript、Rust/Cargo、rustfmt、MSVC 与 Native crates 必须真实探测并确保可用；缺失或低于项目硬要求时自动安装/修正，满足要求就复用，不为追新强制升级。Workspace JavaScript 每次运行 `[1]` 都必须在项目根无条件执行一次**完全原生** `pnpm install`，不允许用 `node_modules` 存在性、prepare stamp、依赖 fingerprint 或自定义 registry/reporter/timeout 参数替代或跳过安装；pnpm 自己负责复用 store、恢复被删除的 `node_modules`、补齐新增依赖并显示原生进度。Bun/OpenTUI/Solid/@types-bun 统一声明在根 `package.json` 并安装到根 `node_modules`；`apps/cli/opentui-runtime/` 只保留源码，禁止作为嵌套 Workspace/独立 `node_modules`。`[8]` 才负责显式刷新 latest。项目新增/调整依赖后重跑 `[1]` 即同步。Rust/Cargo 使用项目本地 `runtime/rust/{cargo,rustup}`：`[1]`/`[9]` 固定设置 checkout 内 `CARGO_HOME/RUSTUP_HOME`，缺失时下载 Rust 官方 `rustup-init.exe` 与 `.sha256`，安装 stable/minimal + rustfmt；禁止写 `%USERPROFILE%\.cargo/.rustup`，禁止再维护 `xma-path/rust`、盘符选择、Rust 状态文件或整盘扫描。`[4]/[7]/build:cli` 只解析并真实校验当前项目 Rust Runtime；旧 `xma-path/rust` 只允许作为一次性清理对象。
- Windows Bootstrap 的 native 命令输出必须保持实时可见：任何会执行 `pnpm/cargo/npm/winget` 的动作函数不得被当作业务返回值捕获。特别是 `pnpm install` 必须直接继承当前 Windows Terminal 的 stdout/stderr，禁止接 `Out-Host`、`ForEach-Object` 或其他 PowerShell pipeline；否则会把 pnpm 的 `\r` 同行进度刷新拆成逐行输出，并可能造成 Unicode/ANSI 乱码。动作函数保持 void，`Get-*`/状态读取函数才返回对象。
- Windows `xma-dev.bat → [1]` 会把当前 checkout 的 `.git/xma-state/dev-bin` 注册到 User PATH；之后可在任意 Workspace 用 `xiaoyu` / `xma` 启动开发态 CLI。不得把整个仓库加入 PATH。
- Terminal 没有已配置 Brain/Profile 时只在首次进入时自动打开 Provider 配置；已有 Profile 后不重复弹出，`Ctrl+P → Brain / Provider` 始终保留。
