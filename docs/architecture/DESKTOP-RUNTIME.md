# XMA Desktop Runtime（桌面运行时）

## 结论

XMA Desktop 采用 **Electron 41.2.0 主运行时 + Tauri 2 备用运行时**。

两套桌面壳必须复用同一套 `apps/web/` TypeScript UI 与 `core/` Agent Runtime。Desktop Runtime 只负责窗口、系统桥接和打包，不能拥有独立 Agent 逻辑。

## 主运行时：Electron 41.2.0

Electron 是 XMA 默认 Desktop Runtime。项目将版本**精确锁定为 `41.2.0`**，不得使用 `^41.2.0` 自动漂移；升级必须经过单独开发任务、测试和文档更新。

选择 Electron 的原因：

- Chromium 行为一致，复杂 Web UI/终端/编辑器能力兼容性更稳定；
- 市面上成熟桌面 AI / 开发工具大量采用 Electron 体系，生态和排错资料完善；
- TypeScript UI、Node/Electron 桥接和现有前端工具链契合；
- Electron Builder 可以直接生成 Windows NSIS Setup 与 Portable。

代价是 Electron Runtime 较大。因此 XMA 必须遵守**惰性下载**：

- `XMA.bat -> [1] 一键准备基础环境` 不下载 Electron；
- Web / CLI 不下载 Electron；
- 只有用户明确进入 `Desktop -> Electron` 或构建 Electron 发布包时，才执行 Electron postinstall 下载 Chromium Runtime；
- 下载器使用 Electron 官方 `@electron/get` 缓存；超过约 30 秒时保留官方进度输出，并开启诊断日志，避免用户误以为程序卡死；
- 检测到 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` 时允许 `@electron/get` 使用用户已有代理；不得默认切换第三方镜像。

## 备用运行时：Tauri 2

Tauri 2 作为轻量备用 Desktop Runtime。Electron 下载失败、网络受限，或者未来某些部署场景更适合系统 WebView2 时，可以从 XMA Desktop 菜单直接切换。

Tauri 2：

- 继续复用 `apps/web/`；
- Windows 使用系统 WebView2；
- Rust Shell 只负责窗口和原生桥接；
- 需要时可生成 NSIS/MSI。

Tauri 2 不是另一套 XMA，也不得复制 Agent Runtime。

## 统一结构

```text
                     apps/web UI
                         │
               ┌─────────┴─────────┐
               │                   │
      Electron 41.2.0           Tauri 2
         主 / 默认              副 / 备用
               │                   │
               └─────────┬─────────┘
                         ▼
                      XMA Core
                         │
                   Rust Native
```

## 运行与构建命令

```text
pnpm dev:desktop              # Electron 主桌面端
pnpm dev:desktop:electron     # Electron 主桌面端
pnpm dev:desktop:tauri        # Tauri 2 备用桌面端

pnpm build:desktop            # Electron 主桌面端
pnpm build:desktop:electron   # Electron 主桌面端
pnpm build:desktop:tauri      # Tauri 2 备用桌面端
```

## 安全边界

Electron BrowserWindow 默认：`contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。外部链接交给系统浏览器。后续新增 preload/IPC 时必须按最小权限原则逐项暴露，不能把 Node/Rust 原生能力直接暴露给任意页面。
