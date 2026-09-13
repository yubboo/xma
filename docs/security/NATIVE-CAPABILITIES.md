# Native Capability 与副作用安全边界

## 1. 目的

本文定义 XMA TypeScript Tool Platform 到 Rust Native/Security Kernel 的第一条真实副作用安全链。它回答的不是“模型想做什么”，而是：**模型提出动作以后，哪些条件必须同时成立，操作系统副作用才允许发生。**

当前 0.1.0 已落地文件读、文件写和无 shell 进程执行的最小链；PTY/ConPTY、网络 capability、进程树/Job Object、Hash/Archive 仍未完成，禁止把本文写成完整 Sandbox 已完成。

## 2. 权限层级

一条 Native Tool Call 依次经过：

```text
Model Tool Call
  → Frozen ToolPlan / ToolRouter
  → JSON Schema Validation
  → Permission Policy
  → monotonic Security Guard
  → User Approval（需要时）
  → TypeScript 申请最小 Native Capability
  → Rust Kernel 再验证 Capability scope
  → OS side effect
  → structured ToolResult
  → durable tool/approval + tool/result
```

任何一层 deny 都不能被后面的层恢复为 allow。TypeScript Approval 不是 Rust 权限；Rust Capability 也不能替代用户 Approval。

## 3. 当前 Capability

| Capability | 当前方法 | 关键约束 |
|---|---|---|
| `filesystem.read` | `fs/read_text` | 允许根目录、真实路径 canonicalize、UTF-8、读取上限 |
| `filesystem.write` | `fs/write_text` | 允许根目录、父目录真实路径验证、写入上限、可选建父目录 |
| `process.spawn` | `process/run` | 绝对 executable allowlist、canonical identity、cwd confinement、argv 分离、无 shell/PATH、超时、stdout/stderr 上限 |

Native Runtime 启动后必须先由 Host 配置一次不可重复提升的 **Host Policy**：允许根目录、最大程序白名单和 read/write/process 的资源上限。`capability.issue` 只能申请 Host Policy 的子集；没有 Host Policy 时 Runtime `ready=false` 且拒绝发 lease。这样 Rust 不会把 TypeScript 随手传来的任意 `C:\` / `/` 当成可信根。

Capability lease 当前是 **Native Runtime 进程内的一次性 opaque handle**。一次执行路径取走 lease 后即消费，同一个 token 不能重放。它不是跨机器认证凭据，也不是持久 Secret；Runtime 重启后全部失效。

## 4. 文件路径规则

Rust Kernel 不接受“TypeScript 已经检查过路径”作为安全依据。每次实际文件调用都重新处理允许根目录和目标路径：

- 已存在路径通过 `fs::canonicalize` 获取真实路径，再做 root containment；
- 写入不存在的新文件时，先找到最近存在祖先并 canonicalize，确认没有经 symlink/junction 越界后再创建父目录；
- 相对路径只相对 capability 的第一个允许根解析；
- 空路径、根外路径、不能 canonicalize 的目标直接失败；
- root 本身必须真实存在并可 canonicalize；
- capability root 自身还必须位于进程启动时锁定的 Host Policy root 内。

这比只做 `..` 词法消解更强；词法 normalize 只用于新写路径的前置处理，不是最终安全判断。

## 5. 进程规则与当前限制

`process/run` 使用 `Command::new(program).args(argv)`，不经过 `cmd /c`、PowerShell 或 `shell:true`。当前还必须满足：

- Host Policy 的 `programs[]` 必须是绝对可执行文件路径；Host 配置、Capability 申请、真实执行三个阶段都会 `canonicalize`，按 canonical path identity 精确匹配（Windows 比较大小写不敏感）；
- Tool 每次执行只给一次性 lease 申请本次真正选择的单个 program，不把整个 Host allowlist 下放给一个调用；
- `Command::new` 接收已经 canonicalize 的绝对路径，因此不会通过 `PATH` 或当前工作目录重新解析同名程序；
- `cwd` 的真实路径必须位于允许根内；
- Runtime 有全局硬超时和输出硬上限，Tool 只能申请更小范围；
- 超时会 kill 并 reap 当前直接 child。

**尚未完成的安全项：**Windows Job Object / Unix process group 级进程树所有权、PTY/ConPTY、运行中 RPC cancel、可执行文件内容哈希/已打开句柄级 TOCTOU identity、网络隔离。因此当前 `process.run` 是 Stage C 最小安全链，不是最终的 Coding Sandbox。

## 6. Approval 规则

当前默认 `standard` policy：

- `read` / `control`：默认允许进入下一安全层；
- `write` / `execute` / `network`：必须 Approval；
- 没有 Approval Provider 时 fail closed；
- `allow-session` 只保存在当前 `AgentSession` 进程生命周期内，不写进 Session 持久授权；Session 恢复后默认重新询问；
- Approval 决策作为 durable `tool/approval` 事件先于 `tool/result` 写入，用于审计。

未来 UI 的“完整访问/请求批准/帮我批准”等交互只能映射到这些 Contract，不能让 UI 直接执行 Node fs/child_process 绕过 ToolRouter。

## 7. 下一步

Stage C 剩余安全工作按以下顺序推进：

1. process-tree ownership + cancellation（Windows Job Object / Unix process group）；
2. PTY/ConPTY capability；
3. network capability 与 host/port/domain scope；
4. Native hash/archive；
5. executable content/handle identity 与 TOCTOU hardening；
6. App Protocol Approval request/decision，使 CLI/Desktop 都走同一授权流。
