# XMA 开发规则

## 1. 每次开发前

必须先读 `AGENTS.md`，再根据任务阅读架构、插件、版本和 Windows Workflow 文档。

## 2. 代码规则

- 新核心代码优先 TypeScript；Native/Security 边界使用 Rust。
- 不新增 Go Core。
- Python 只能作为可选插件生态，不得成为 XMA 基础运行依赖。
- 核心源码文件必须有中文文件头注释。
- 复杂安全判断、兼容层和协议转换必须写中文解释。
- 不为了“架构漂亮”过度拆目录和 package。
- Windows PowerShell 5.1 读取 UTF-8 JSON/文本时必须显式指定 `-Encoding UTF8`；禁止依赖系统默认代码页读取 `package.json`、配置文件或包含中文的源码元数据。
- pnpm 11 依赖构建脚本必须使用 `pnpm-workspace.yaml -> allowBuilds` 显式白名单；禁止 `dangerouslyAllowAllBuilds`，固定工作流不得依赖人工 `pnpm approve-builds`。
- Windows 环境准备器必须在依赖检查、下载、安装、验证等阶段输出中文状态提醒。

## 3. Agent 规则

- Provider Model 是推理核心。
- Agent Runtime 不写固定业务决策树替代模型。
- Skill 是指导，不是脚本化思考。
- 实时可查询事实必须走 Tool/API，不写进 Prompt 当永久事实。

## 4. Plugin 规则

- XMA 原生插件和 DeepSeek Harness 兼容插件统一由 Plugin Host 管理生命周期。
- Plugin mount 必须能 teardown；注册行为必须可逆。
- 插件不得绕过 Workspace/Permission/Capability 直接执行危险副作用。

## 5. UI 规则

CLI、Desktop、Web 只是同一个 Core 的不同 Shell。禁止复制 Agent Loop。

## 6. 完成标准

“代码存在”不等于“功能完成”。必须至少满足对应的 typecheck、test、Gate；跨平台 Native 能力必须在目标 Runner 真编译/运行后才宣称验证完成。

- Windows PowerShell 外部命令包装函数禁止使用 `$args` / `$Args` 作为自定义参数名；统一使用 `ArgumentList` 并通过命名参数转发，避免 PowerShell 5.1 自动变量吞掉命令参数。

### Windows 外部命令统一执行规则

- `scripts/windows/xma-common.ps1` 是 Windows 外部命令执行的唯一公共入口。
- `xma-prepare.ps1`、`xma-github.ps1`、`xma-console.ps1`、`xma-build-release.ps1` 必须复用 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`。
- 禁止自行定义 `Run(..., $Args)`、`Invoke-External(..., $Args)` 或任何 `$Args/@Args` 参数转发。PowerShell 的 `$args` 是自动变量且大小写不敏感，曾导致 `pnpm check` 和 `rustup` 参数丢失。
- 新增 Git、pnpm、cargo、rustup、winget 等外部命令时，必须使用命名参数 `-FilePath` 与 `-ArgumentList`。


- Windows PowerShell 所有外部命令必须统一复用 `scripts/windows/xma-common.ps1` 的 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`；禁止私自实现 `Run(..., $Args)`、`Invoke-External(..., $Args)` 等包装器。

## 7. GitHub 推送与仓库内容规则

### 7.1 推送助手是纯 Git 工具

`XMA-GitHub.bat` 只负责 Git 安全检查、远端同步、提交和 Push。它不得安装或更新 Node.js、pnpm、Rust、Electron/Tauri、项目依赖，也不得执行 `pnpm install`、`cargo fetch` 等会下载依赖的命令。

只有以下流程允许下载/安装依赖：

- `XMA.bat → [1] 一键准备开发环境`：准备通用 Workspace JavaScript 依赖、esbuild 与 XMA Native Rust crates；
- 用户明确选择 Electron/Tauri Desktop：只补齐对应 Desktop Runtime；
- 用户明确执行构建/发布：允许补齐所选 Desktop Runtime 与构建依赖。

### 7.2 GitHub 允许提交的内容

应提交：源码、文档、测试、脚本、配置模板、CI、`pnpm-lock.yaml`、`Cargo.lock` 等可复现构建资产。

禁止提交：`node_modules/`、Rust `target/`、`dist/`、`build/`、`runtime/`、`.xma/`、用户 Workspace、覆盖率、缓存、日志、`.env`、Secret/私钥、Desktop 安装包以及 ZIP/7z 等发布归档。

`.gitignore` 是第一层保护；`XMA-GitHub` 的 Safety Check 是第二层保护。第二层必须检查 Git 实际可提交文件和暂存区，不能仅相信 `.gitignore`。

### Windows 项目依赖准备规则

- `XMA.bat -> [1] 一键准备开发环境` 必须一次完成系统工具 + Workspace JavaScript 依赖元数据 + esbuild Native Binary + XMA Native Rust crates。
- `[1]` 必须使用 `pnpm install --ignore-scripts`，禁止在准备阶段触发 Electron Chromium Runtime postinstall。
- Web / XiaoYu CLI 启动时只能检查依赖并直接启动；缺依赖时提示先运行 `[1]`，不得自行安装。
- Electron 41.2.0 package 元数据可以在 `[1]` 中准备；Chromium Runtime 只有用户明确进入 Desktop -> Electron 或构建 Electron 时才允许 `rebuild electron` 下载。
- Tauri 2 JavaScript package 可以在 `[1]` 中准备；Tauri Rust crates 只有用户明确选择 Tauri 2 或对应构建时才预取。
- `esbuild` 为 Vite/tsx/tsup 的内部依赖，禁止要求根 `node_modules/.bin/esbuild` 或使用 `pnpm exec esbuild` 作为验证；使用 `tsx` 最小执行、Vite/tsup 版本等真实链路验证。
- `[7] 全量检查` 不偷偷下载依赖；缺依赖时提示先运行 `[1]`，Rust 使用 `--offline` 检查。
- Electron/Tauri 下载不得默认切换第三方镜像。Electron 使用官方 `@electron/get` 缓存与进度；检测到用户已有 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` 时允许使用官方代理支持。

> **重要：** 仓库根 `/runtime/` 是用户运行数据，禁止提交；`native/runtime/` 是 XMA Rust Native Runtime 源码，必须同步、提交并进入 CI。任何 ignore/sync/safety 规则都不得把两者混为一谈。
