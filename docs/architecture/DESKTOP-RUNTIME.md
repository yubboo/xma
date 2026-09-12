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

- `XMA.bat -> [1] 一键准备开发环境` 不下载 Electron Chromium Runtime；
- Web / CLI 不下载 Electron；
- 只有用户明确进入 `Desktop -> Electron` 或构建 Electron 发布包时，才执行 Electron postinstall 下载 Chromium Runtime；
- XMA 使用 Electron 官方 `@electron/get` 下载并显示实时进度，直接使用其返回的、已经 checksum 校验的 ZIP 路径；
- 下载与安装必须完整等待并验证：`@electron/get` 负责下载和 checksum；Windows 使用系统 PowerShell `Expand-Archive` 解压到 staging，先校验 `dist/version` 与平台可执行文件，再原子替换正式 `dist` 并写 `path.txt`；非 Windows 可使用 Electron package 的 `extract-zip`，但必须受 `yauzl >= 3.3.1` override 保护；
- 禁止再采用“先 `@electron/get` 下载、再另起 `electron/install.js` 子进程”的双阶段安装。该方式曾出现子进程返回 0 但 `dist/path.txt` 未落地的假成功，且难以证明安装真正完成；
- `electron` 不进入 pnpm `allowBuilds`，避免任何普通 `pnpm install` 意外触发 Chromium 下载；
- 官方源连续 45 秒无新数据时可切换到 Electron 官方安装文档示例镜像，并继续使用 package 内 `checksums.json` 校验；
- 检测到 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` 时允许 `@electron/get` 使用用户已有代理。

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
