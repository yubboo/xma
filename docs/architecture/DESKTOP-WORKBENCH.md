# XMA Desktop Workbench 目标布局（后置实现）

## 1. 当前决策

Desktop UI **不是当前开发主线**。0.1.x 先把 Agent Runtime、真实 Model Provider、Session、Tool/Permission、Workspace、Plugin/Skill 和 Native Kernel 做到可用，再进入完整 Workbench 实现。

本文只把已经确认的产品布局和 Host Contract 锁住，避免后续“先画页面再倒逼内核”。界面体验参考现代 Codex/ChatGPT Work 类桌面工作台的空间组织，但不复制第三方品牌、图标、受版权保护的视觉资产或产品文案。

## 2. 桌面总布局：三栏 + 底部面板

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Native title/menu / global controls                                        │
├───────────────┬───────────────────────────────────────┬────────────────────┤
│ 左侧 Sidebar   │ 中央 Workspace                        │ 右侧 Inspector      │
│ 默认展开       │ 主工作区                              │ 默认收起            │
│ 可吸附/拉伸    │ Chat / Work                          │ 可吸附/拉伸         │
│                │                                       │                    │
│ Sessions       │ Conversation / Work artifacts        │ Code / Browser      │
│ Workspaces     │ Summary / Approval / Tool cards      │ Sources / Env       │
│ Agents         │                                       │ Git / Diff / Meta   │
│ Plugins        │                                       │                    │
│ ...            ├───────────────────────────────────────┤                    │
│                │ Bottom Panel: Terminal / Problems... │                    │
│ User/Settings  │ 可展开、可拉伸、默认收起              │                    │
└───────────────┴───────────────────────────────────────┴────────────────────┘
```

## 3. 左侧 Sidebar

默认展开，承担全局导航与会话入口：

- 新会话；
- Chat / Work 入口；
- Session / Workspace / Agent 列表；
- Plugin / Skill / Automation 后续入口；
- 最近项目/最近会话；
- 左下角固定用户身份、Provider/plan 可见状态、设置、帮助。

行为要求：

- 一键折叠/展开；
- 拖动改变宽度，有合理 min/max；
- 宽度按设备/Workspace 持久化；
- 折叠不销毁 Session 状态；
- 只是 App Protocol 的视图，不拥有业务状态。

## 4. 中央 Workspace

中央是面积最大的主区，支持两个顶层模式：

- **Chat**：常规多轮对话、工具卡片、审批、附件；
- **Work**：围绕一个 Workspace / 项目执行持续任务，展示 Summary、Changed Files、任务状态、来源和产物。

中央内容不固定成单一聊天列表。根据 Agent / Workspace 能力，可挂载：

- 会话时间线；
- 工作摘要；
- Tool execution cards；
- Approval cards；
- 文件修改摘要 / diff；
- 长任务状态；
- 结构化结果；
- 错误/恢复提示。

Composer 底部显示实际 Provider / Model / reasoning mode / permission mode，不显示伪造状态。

## 5. 右侧 Inspector

默认收起，用户需要时展开。它是**当前选中对象的详情面板**，不是另一套主应用：

- Code/file viewer；
- Browser/Web result；
- Git branch / diff / environment summary；
- Tool details；
- Sources / citations；
- Workspace metadata；
- Plugin/Agent debug 信息（开发模式）。

右栏：

- 可拖动改变宽度；
- 支持关闭、重新打开；
- 不同 Inspector tab 可切换；
- 当前 tab/宽度可持久化；
- 右栏关闭时中央自动占满空间。

## 6. Bottom Panel

Bottom Panel 位于**中央 Workspace 内部底部**，不是独立窗口。默认收起，支持：

- Terminal / PTY；
- Problems / diagnostics；
- Logs（只展示允许给用户看的应用日志）；
- 后续 Tasks / Ports 等。

Terminal 必须走 App Protocol → Tool/Native Capability → Rust PTY/Process，不允许 Web renderer 直接获得 Node shell 权限。

面板支持：

- 一键展开/收起；
- 上下拖动高度；
- Terminal tabs；
- 与当前 Workspace 绑定；
- Agent 运行和用户手动终端有明确 ownership；
- Session 中只记录需要审计的命令/结果，不把所有终端字符流当模型历史。

## 7. Pane Layout Contract

三栏与底板必须由统一 Layout Store 管理，而不是各组件自己存尺寸：

```text
left:   open=true,  width, min, max
right:  open=false, width, min, max
bottom: open=false, height, min, max
```

拖动使用 pointer capture；达到阈值可吸附到关闭/默认尺寸；窗口 resize 时优先保证中央最小工作宽度。布局状态只属于 UI preferences，不进入模型 Context。

## 8. Summary

“摘要”有两种完全不同的语义，禁止混淆：

- **UI Work Summary**：面向用户，对本轮/项目的变更、产物、待办做结构化投影；
- **Context Compaction Summary**：面向模型，是 Session Runtime 的显式持久化上下文压缩事实。

UI Summary 可以从 durable Session events 生成，但不能偷偷替代模型历史；Context Compaction 必须由 Core 控制并记录。

## 9. Desktop Host 安全边界

Electron：

- `contextIsolation=true`；
- `nodeIntegration=false`；
- `sandbox=true`；
- renderer 不持有 Provider Secret；
- file/process/pty/network 必须经过受限 IPC/App Protocol；
- 禁止把 `child_process`、任意 filesystem API 直接暴露给页面；
- 外部网页不复用具有特权 preload 的同一 renderer context。

Tauri 备用壳遵循同一 App Protocol 与 Capability Contract，不出现第二套 Agent Runtime。

## 10. 实现前置条件

只有以下底层达到出口后，才进入完整 Desktop Workbench 实现：

- Session/Turn/Step durable Runtime；
- 至少两个不同协议族真实 Provider；
- ToolPlan/ToolRouter + Approval + Native Capability；
- Workspace persistence；
- App Protocol/Event Stream；
- PTY/Process Native 能力；
- Code Agent 最小真实闭环。

在此之前，Desktop 只维持能启动、能验证 Host/Runtime 通路的开发壳，不投入大量 UI 细节。
