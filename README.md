# XMA · Xiaoyu Management Agent

**小鱼管理智能体**

> **Model is replaceable. Agent is ours.**  
> **模型可以更换，小鱼始终属于用户。**

XMA 是一个 TypeScript-first + Rust Native 的用户自有 Agent 平台。你可以接入 GPT、Claude、Gemini、DeepSeek、MiMo 或未来任何顶级模型，让这些模型服务于属于你的 Xiaoyu Agent。

XMA 不把某一个领域写死在内核里。Minecraft、Coding、Writer 等都作为专业 Agent 存在，并拥有自己的 Workspace、Skills、Knowledge、Tools、Memory 和权限范围。

## 当前 0.1.0 骨架

- TypeScript Agent/Core 基础 Contract；
- Rust Native/Security Kernel 骨架；
- XMA Native Plugin Host；
- DeepSeek Harness / Cordis 插件兼容适配骨架；
- Minecraft / Code / Writer 三个 Agent 定义，其中 Minecraft 是第一条优先实现线；
- `xiaoyu` Terminal CLI/TUI、Desktop、Web、Server 四种 Shell；
- Desktop：Electron 41.2.0 主运行时 + Tauri 2 备用运行时；
- Windows 一键环境、同步、GitHub 推送、构建发布入口；
- Architecture / Naming / Comment / Documentation Gates；
- 版本规则与开发文档。

> 0.1.0 是平台骨架，不代表 Minecraft、Code、Writer 已经产品完成。

## 目录

```text
apps/       用户入口：CLI / Desktop / Web / Server
core/       XMA TypeScript 核心
agents/     专业 Agent
plugins/    跨 Agent 插件、Provider、Tool、Integration、兼容层
native/     Rust Native / Security Kernel
scripts/    Windows 控制台、同步、GitHub、构建、Gates
docs/       架构、规则、计划、安全文档
```

源码命名固定为：目录/TypeScript 使用小写 kebab-case，Rust 模块使用 snake_case，`.` 只表达 test/config/d 等角色；普通名字优先 1～3 个核心词，并按“同逻辑聚合、不同职责才拆分”的原则组织。详细规则见 `AGENTS.md`、`docs/architecture/DIRECTORY-STRUCTURE.md` 和 `docs/development/DEVELOPMENT-RULES.md`。

## Windows 固定流程

开发源码包解压后：

```text
XMA-Sync.bat
   ↓
H:\一键部署\xma
   ↓
XMA-GitHub.bat
   ↓
1. 一键推送
```

开发运行和构建：

```text
XMA.bat
```

菜单提供：一键准备开发环境、Web、Desktop、Xiaoyu CLI、构建发布、全量检查。首次运行 `[1]` 会一次准备通用 Workspace 依赖；Electron Chromium Runtime / Tauri Rust crates 仍在明确选择对应 Desktop 时才准备。Electron 下载由 XMA 直接显示百分比/MB，并在官方源长时间无数据时做校验后的备用源容错；Windows 下载后的 ZIP 使用系统 PowerShell `Expand-Archive` 做 staging 解压与原子安装，绕开 Node 24.16+ 的旧 ZIP 依赖问题。


## Terminal / Distribution 第一批

XMA 的终端主命令固定为 `xiaoyu`，`xma` 仅保留兼容别名。开发源码继续通过 `XMA.bat` 准备依赖；普通用户发行则使用预构建 portable runtime，不要求安装 Node/pnpm/Rust/MSVC。

```text
xiaoyu [workspace]   持续 Terminal Workbench
xiaoyu doctor        环境检查
xiaoyu server        Headless Server（发行包）
xiaoyu web           本地 Web + Server（发行包）
```

第一批 TUI 已接正式 Workspace/Session Runtime，并可通过 `XIAOYU_BASE_URL`、`XIAOYU_MODEL`、`XIAOYU_API_KEY` 使用 OpenAI-compatible Brain；未配置 Brain 时明确显示未就绪，不伪造回复。Home/文件系统根目录默认触发“仅本次信任”风险确认。若 Native Kernel 可用，Terminal 会注册 Rust-backed `native.fs.read_text/write_text`；文件写入必须在 TUI 进行 deny / allow-once / allow-session Approval。进程工具默认不开放，直到 Host 明确配置 absolute executable allowlist。

发行架构、Windows `%LOCALAPPDATA%\Programs\Xiaoyu`、Linux/macOS `~/.local` 合同与一键安装 bootstrap 见 `docs/architecture/DISTRIBUTION.md`。公网 `irm/curl` 安装命令只有在 Release/域名真实部署后才算可用。

## 仓库

`https://github.com/yubboo/xma.git`

## 当前开发优先级

XMA 0.1.x 当前采用 **Backend/Agent Runtime First**：先完成 Session/Turn/Step、真实 Model Provider、Tool/Permission/Native、Workspace、Plugin/Skill 和 Code/Minecraft 真闭环，再进入完整 Desktop Workbench。Desktop 最终目标是左侧导航 + 中央 Chat/Work 主工作区 + 右侧 Inspector + 中央底部 Terminal 的可吸附三栏布局，但 UI 不拥有 Agent 状态。

上游实现参考固定记录在 `docs/development/UPSTREAM-REFERENCE.md`；项目级 AI 开发入口为根 `AGENTS.md`，并提供 `.agents/`、`.codex/`、`.claude/` 适配目录。


## Stage D 当前进展

0.1.0 未冻结开发线已加入 Workspace Binding/ownership、Session durable cross-workspace grant、Tool Workspace Security Guard 与 Context Source workspace read scope。详细边界见 `docs/architecture/WORKSPACE.md`；Workspace persistence、instructions discovery、compaction/fork 仍在后续批次。
