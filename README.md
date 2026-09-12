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
- CLI、Desktop、Web、Server 四种 Shell；
- Desktop：Electron 41.2.0 主运行时 + Tauri 2 备用运行时；
- Windows 一键环境、同步、GitHub 推送、构建发布入口；
- Architecture / Comment / Documentation Gates；
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

菜单提供：一键准备环境、Web、Desktop、Xiaoyu CLI、构建发布、全量检查。

## 仓库

`https://github.com/yubboo/xma.git`
