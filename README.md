# XMA · Xiaoyu Management Agent

**小鱼管理智能体**

> **Model is replaceable. Agent is ours.**  
> **模型可以更换，小鱼始终属于用户。**

XMA 是一个 TypeScript-first + Rust Native 的用户自有 Agent 平台。你可以接入 GPT、Claude、Gemini、DeepSeek、MiMo 或未来任何顶级模型，让这些模型服务于属于你的 Xiaoyu Agent。

XMA 不把某一个领域写死在内核里。Minecraft、Coding、Writer 等都作为专业 Agent 存在，并拥有自己的 Workspace、Skills、Knowledge、Tools、Memory 和权限范围。

## 当前 0.1.0 骨架

- Platform Skeleton v1：`xma-ai / xma-agent-loop / xma-plugin / xma-tools / xma-session / xma-context / xma-native` 稳定 workspace packages；
- Rust Native/Security Kernel 骨架；
- Everything is a Plugin 基础 Host + 自包含 `deepseek / native-tools / dsh-compat` 插件；
- DeepSeek Harness / Cordis 插件兼容适配骨架；
- Agent/Skill Platform Foundation：主 `Xiaoyu` Manager + `Xiaoyu Code` Specialist；未来专业 Agent 不提前创建空骨架；
- 产品级 `skills/`：首批 Task Planning / Verification / Bug Fixing / Code Testing；
- `xiaoyu` Terminal CLI/TUI、Desktop、Web、Server 四种 Shell；
- Desktop：Electron 41.2.0 主运行时 + Tauri 2 备用运行时；
- Windows/Linux/macOS 源码开发入口 + Windows 维护者同步/GitHub/构建辅助；
- Architecture / Naming / Comment / Documentation Gates；
- 版本规则与开发文档。

> 0.1.0 是平台骨架，不代表 Minecraft、Code、Writer 已经产品完成。

## 快速开始

普通用户不需要 clone 源码，也不需要安装 Node.js、pnpm、Rust、Cargo 或 MSVC。XMA 正式 Release 使用预构建 portable runtime。

### Windows

```powershell
powershell -ep Bypass -c "irm https://github.com/yubboo/xma/releases/latest/download/xma-install.ps1 | iex"
```

### Linux / macOS

```bash
curl -fsSL https://github.com/yubboo/xma/releases/latest/download/xma-install.sh | sh
```

安装完成后，三个平台统一使用：

```text
xiaoyu
```

`xma` 保留为兼容短别名。Windows 发行包内部对应 `xiaoyu.cmd / xma.cmd`，Linux/macOS 对应 `xiaoyu / xma`；它们与源码开发入口完全分开。

> `releases/latest` 只有在真实 GitHub Release 已发布并包含对应资产后才可使用；未发布 Release 时不得把上面的公网命令描述为已可用。

## 源码开发

源码开发入口固定使用 **`xma-dev`** 命名，避免与安装后的正式 `xma` 产品命令混淆。仓库可以 clone 到任意本地目录或盘符，不依赖维护者机器的 `H:`。

Windows：

```powershell
git clone https://github.com/yubboo/xma.git
cd xma
.\xma-dev.bat
```

首次进入菜单选择 `[1] 一键准备开发环境`。准备完成后会为**当前源码 checkout**生成开发态 `xiaoyu / xma` 命令并写入当前用户 `User PATH`；新开 PowerShell / Windows Terminal 后，可以在任意 Workspace 目录直接输入 `xiaoyu` 或 `xma` 启动这份源码。菜单 `[4]` 仍保留用于从开发控制台启动 CLI。

开发态命令使用仓库内被忽略的 `.xma\dev-bin` shim，而不是把整个 Git 仓库加入 PATH；这样不会把 `XMA-Sync.bat`、构建脚本等维护文件暴露成全局命令。移动/重命名仓库后重新运行 `xma-dev.bat → [1]` 即会刷新。

Linux / macOS：

```bash
git clone https://github.com/yubboo/xma.git
cd xma
./xma-dev
```

Unix 源码控制台支持 `prepare / web / desktop / cli / check`，也可以直接运行例如 `./xma-dev cli`。普通用户安装不走这套源码开发工具链。

> **Git clone 用户不需要运行 `XMA-Sync.bat`。** `XMA-Sync.bat` / `XMA-GitHub.bat` 是维护者 Source Manifest 工作流；`H:\一键部署\xma` 只是当前维护者默认目标，可通过 `XMA_TARGET_ROOT` 覆盖。

## 目录

```text
apps/       用户入口：CLI / Desktop / Web / Server
agents/     Xiaoyu Manager / 已实现专业 Agent
packages/   稳定 xma-* Agent Platform 能力
plugins/    具体 Provider / Tool / Compatibility / 领域插件（一个插件一个目录）
skills/     XMA 产品级专业 Skill
native/     Rust Native / Security Kernel
core/       0.1.x Compatibility Facade only
scripts/    开发控制台、安装、同步、GitHub、构建、Gates
docs/       架构、规则、计划、安全文档
```

源码采用“适度分层、功能聚合、位置可预测”的规则；跨 package/plugin/agent 只走稳定公共入口，禁止 `../../..` 穿越物理目录。找代码先看根 `CODEMAP.md`；最近工程变更与下一步看 `docs/development/UPDATE-LOG.md`。完整规则见 `AGENTS.md`、`docs/architecture/DIRECTORY-STRUCTURE.md` 和 `docs/development/DEVELOPMENT-RULES.md`。

## Agent / Skill Platform Foundation

XMA 运行时的专业 Agent 与产品 Skill 现在有正式 canonical Contract：

```text
Xiaoyu Manager
  ↓ Task / Delegation
Xiaoyu Code
  ↓
Skills
  ├─ common/task-planning
  ├─ common/verification
  ├─ code/bug-fixing
  └─ code/testing
  ↓
AgentRuntime / Context / Tool / Workspace / Native
```

Skill 内容通过标准 Context Assembly 进入模型，并由 durable Context Snapshot 保存实际 model-visible 文本；Skill 需要的 Tool/Brain capability 与 Agent 声明不一致时 fail loud。详细见 `docs/architecture/AGENT-PLATFORM.md`。

源码 Terminal 与 portable `xiaoyu` 都会加载同一套 canonical Skills；portable 发行包自带 `skills/`，不会依赖用户机器上的源码仓库。


未来 Codex、Claude Code、DeepSeek Harness、Zcode 属于外部 **Host**，Provider 属于模型 **Brain**；二者不会混进 Core Agent 定义。

## 维护者源码包同步流程（Windows）

下面是维护者从正式源码包同步到长期 Git 工作区的流程；普通 Git clone 用户跳过这一节。

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
xma-dev.bat
```

菜单提供：一键准备开发环境、Web、Desktop、Xiaoyu CLI、构建发布、全量检查。首次运行 `[1]` 会一次准备通用 Workspace 依赖；Electron Chromium Runtime / Tauri Rust crates 仍在明确选择对应 Desktop 时才准备。Electron 下载由 XMA 直接显示百分比/MB，并在官方源长时间无数据时做校验后的备用源容错；Windows 下载后的 ZIP 使用系统 PowerShell `Expand-Archive` 做 staging 解压与原子安装，绕开 Node 24.16+ 的旧 ZIP 依赖问题。


## Terminal / Distribution 第一批

XMA 的终端主命令固定为 `xiaoyu`，`xma` 仅保留兼容别名。源码开发使用 Windows `xma-dev.bat` 或 Linux/macOS `./xma-dev`；普通用户安装使用 `xma-install.ps1 / xma-install.sh` 获取预构建 portable runtime，不要求安装 Node/pnpm/Rust/MSVC。

```text
xiaoyu [workspace]   持续 Terminal Workbench
xiaoyu doctor        环境检查
xiaoyu server        Headless Server（发行包）
xiaoyu web           本地 Web + Server（发行包）
```

Terminal 已接正式 Workspace/Session Runtime。每次启动 `xiaoyu / xma` 都会先解析**当前调用目录**并显示 Workspace Trust；这一步每次启动都出现，授权只对本次运行有效。通过后，**仅当当前没有任何已配置 Brain/Profile 时**，同一 Xiaoyu TUI 会自动在中央打开“模型 / 提供方”配置；配置完成后以后启动跳过第二步，但 `Ctrl+P → 模型 / 提供方` 始终保留，用于后续新增账号/Profile、切换提供方/模型、修改推理强度或重新执行模型就绪测试。当前首个品牌入口是 DeepSeek Official，自定义 OpenAI-compatible 继续保留。Secret 默认通过 OS Credentials 稳定别名保存，环境变量路径继续兼容；`brain.json` 只保存引用，不写 Secret。Brain Ready 会做真实 catalog/text/tool round trip Probe。Home/文件系统根目录/Windows 系统目录会在每次工作区信任确认上追加高风险警告并默认选择退出；主动选择“否，退出”属于正常用户取消，不会再被开发启动器当作运行错误。若 Native Kernel 可用，Terminal 会注册 Rust-backed `native.fs.read_text/write_text`；文件写入必须在 TUI 进行 deny / allow-once / allow-session Approval。进程工具默认不开放，直到 Host 明确配置 absolute executable allowlist。

发行架构、Windows `%LOCALAPPDATA%\Programs\Xiaoyu`、Linux/macOS `~/.local` 合同与一键安装 bootstrap 见 `docs/architecture/DISTRIBUTION.md`。公网 `irm/curl` 安装命令只有在 Release/域名真实部署后才算可用。

## 仓库

`https://github.com/yubboo/xma.git`

## 当前开发优先级

XMA 0.1.x 当前采用 **Backend/Agent Runtime First + Upstream-first**：Platform Skeleton v1 已完成，下一步先按固定 Pi commit 做 Agent Engine 行为级研究并吸收进 `xma-agent-loop/xma-ai`，随后推进 DSH Plugin conformance、完整 Process/Shell Tool Surface、Session/Context/Memory、Task/Subagent/Workflow 与 Xiaoyu Code 真闭环；Minecraft/Writer/GameDev/Art 等在通用平台闭环后再增加真实专业 Agent。Desktop 最终目标是左侧导航 + 中央 Chat/Work 主工作区 + 右侧 Inspector + 中央底部 Terminal 的可吸附三栏布局，但 UI 不拥有 Agent 状态。

上游实现参考固定记录在 `docs/development/UPSTREAM-REFERENCE.md`；项目级 AI 开发入口为根 `AGENTS.md`，并提供 `.agents/`、`.codex/`、`.claude/` 适配目录。


## Stage D 当前进展

0.1.0 未冻结开发线已加入 Workspace Binding/ownership、Session durable cross-workspace grant、Tool Workspace Security Guard 与 Context Source workspace read scope。详细边界见 `docs/architecture/WORKSPACE.md`；Workspace persistence、instructions discovery、compaction/fork 仍在后续批次。
