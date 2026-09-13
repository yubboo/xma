# XMA Workspace 架构

## 1. 目的

Workspace 是 XMA Agent 的**稳定工作领地、安全边界和持久身份**，不是一次命令的 cwd 字符串。Stage D 第一批把 Workspace 从早期 `id + root` 元数据升级为正式 Core Contract，并把 Session、Context、Tool Policy 与跨 Agent 授权接到同一条链上。

真实文件路径、进程 cwd、符号链接、canonical path 等 OS 级限制仍由 Rust Native Kernel 强制；TypeScript Workspace Policy 负责决定“哪个 Agent 原则上能访问哪个 Workspace”。两层缺一不可。

## 2. Workspace Descriptor

当前 `core/src/workspace.ts` 的稳定 Descriptor 包含：

- `id`：稳定 Workspace ID；
- `ownerAgentId`：拥有该 Workspace 的 Agent；
- `name`：用户可读名称；
- `root`：主绝对根；
- `allowedRoots`：附加允许根。

TypeScript 只做绝对路径语义与稳定身份归一化，不把 lexical normalize 写成“真实文件安全已完成”。真正的 filesystem confinement 继续由 Rust `canonicalize + root containment` 执行。

## 3. Session Workspace Binding

Stage D 新建的 Workspace Session 会把 `WorkspaceBinding` 冻结到 `SessionHeader`：

```text
workspaceId
ownerAgentId
name
root
allowedRoots
descriptorDigest
```

`descriptorDigest` 覆盖 owner/root/allowed roots 等安全相关字段。Resume 时 Runtime 用当前 `WorkspaceRegistry` 重新计算 Binding；如果安全身份发生漂移，Session **fail loud**，不能悄悄把旧 Session 迁到另一套 root/owner 上。

当前 `SESSION_FORMAT_VERSION` 仍保持 1，因为这是未冻结 0.1.0 内的向后兼容可选字段扩展。已有 workspace-less Session 继续作为 legacy 兼容；Product Host 可以用 `requireWorkspace: true` 强制所有新 Session 必须绑定 Workspace。

## 4. Ownership

新 Session 默认只能绑定 `ownerAgentId === agentId` 的 Workspace。

禁止通过“创建一个别人的 Workspace Session”绕过 ownership。跨 Agent 工作必须从自己的 Session 出发，走显式授权。

默认规则：

```text
Owner Agent → 自己 Workspace → allow
其他 Agent → 目标 Workspace → deny
其他 Agent + durable explicit grant → 仅授予的 permission allow
```

当前 permission 为：

- `read`；
- `write`；
- `execute`。

后续 network/PTY/外部 integration 仍通过更具体的 Tool/Native Capability 控制，不把 Workspace permission 扩成万能机器权限。

## 5. Cross-Workspace Grant

跨 Workspace 权限必须由用户显式授予，并写入 Session durable history：

- `workspace/access-granted`；
- `workspace/access-revoked`；
- `workspace/access-used`。

Grant 包含：

- stable `grantId`；
- target `workspaceId`；
- `granteeAgentId`；
- permissions；
- `grantedBy: user`；
- reason。

`workspace/access-used` 只在跨 Agent grant 真正进入 Tool execute 前记录；Owner 正常访问不制造额外日志噪音。

当前 Grant 是**当前 Session durable 权限**，不是全局永久 ACL。未来如果引入持久用户 ACL，必须是单独的 Product/Settings Contract，不能把当前 Session grant 偷偷升级成永久权限。

## 6. Tool Pipeline 集成

Tool 可以用 `workspaceAccess(arguments, context)` 声明当前调用访问哪个 Workspace、需要何种 permission。

Runtime 自动在 ToolRouter 中加入 `WorkspaceToolSecurityGuard`：

```text
Schema
  ↓
Policy
  ↓
Workspace Security Guard
  ↓
其他 Security Guard
  ↓
Approval
  ↓
workspace/access-used durable audit（跨 Workspace grant）
  ↓
Tool execute
  ↓
Native Capability / Rust enforcement（如需要）
```

Workspace Guard 的拒绝是单调的；Approval 不能把“没有 Workspace 权限”变成允许。ToolRouter 本身也会 fail closed：Workspace-scoped Tool 没有 Session Workspace 时拒绝，跨 Workspace 调用缺少 Workspace Guard 或 durable access audit hook 时也拒绝，避免绕开 AgentRuntime 直接调 Router 获得越权路径。

Native Tool Adapter 现在必须绑定稳定 `workspaceId`，并分别声明：

- `native.fs.read_text` → `read`；
- `native.fs.write_text` → `write`；
- `native.process.run` → `execute`。

这层只阻止“把 A Workspace 的 ToolPlan 拿到 B Session 使用”等逻辑越权；Rust 仍按 Host Policy/Capability roots 二次 enforcement。

## 7. Context Source 集成

Context Source 可声明 `workspaceAccess`：

- 不指定 `workspaceId`：读取当前 Session Workspace；
- 指定其他 `workspaceId`：需要 `read` 权限。

未经授权的跨 Workspace Context 在 `render()` 前直接失败，不能先把内容读进内存再决定是否显示。

Durable `context/snapshot.sources[]` 会记录该 Source 的 `workspaceId`，因此模型看到的跨 Workspace Context 可以追溯来源。

需要强调：Context Source 的 TypeScript scope 不是 OS Sandbox。真正读取文件的 Context Provider 后续必须复用受限 filesystem capability，不能直接用 Node `fs` 绕过 Native 边界。

## 8. Resume 与漂移

Resume 规则：

- Workspace-bound Session + 相同 Descriptor digest → 允许；
- Workspace-bound Session + Runtime 无 Workspace Registry → 拒绝；
- Workspace-bound Session + `workspaceId` 与冻结 Binding 身份不一致 → 拒绝；
- Workspace-bound Session + Session `agentId` 不是当前 Workspace Owner → 拒绝；
- Workspace-bound Session + owner/root/allowed roots 漂移 → 拒绝；
- `requireWorkspace=true` + legacy unbound Session → 拒绝。

未来 root relocation/repo move 需要显式 rebind/migration Contract，并形成 durable fact；不能把“路径变化”当成无害配置覆盖。

## 9. 当前完成与后续

Stage D 第一批已完成：

- stable Workspace Descriptor/Binding digest；
- Owner-only Session binding；
- resume drift detection；
- Session durable cross-workspace grant/revoke/use；
- Workspace Tool Security Guard；
- Native Tool stable workspace identity；
- Workspace-scoped Context Source read gate；
- App Protocol workspace list/grant/revoke 类型面；
- 相关单元/集成测试。

仍未完成：

- Workspace 持久 Registry/配置文件；
- repo/project metadata discovery；
- AGENTS.md/CLAUDE.md 等产品 Workspace instruction discovery；
- root relocation/rebind migration；
- large tool output attachment；
- Session fork；
- compaction durable event；
- App Protocol 实际 Handler/UI Approval；
- Workspace filesystem Context Provider 的 Native capability 实链。
