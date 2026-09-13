# XMA Distribution / Launcher 架构

## 1. 目标

XMA 不是“只有 Desktop 安装包”的应用。正式产品必须保持**一套 Core / Agent Runtime，多种入口与部署方式**：

- `xiaoyu`：Windows / Linux / macOS Terminal CLI/TUI 主入口；
- `xma`：兼容别名，不作为对外主品牌命令；
- Desktop：Windows/macOS/Linux 图形壳，Electron 主、Tauri 备用；
- Server：本地或云服务器 Headless 入口；
- Web：浏览器 Shell，连接本地/远程 Server；
- 所有入口都复用 Core/App Protocol，不得各自复制 Agent Loop。

## 2. 开发环境与普通用户安装必须分开

开发者使用干净 Git clone 后运行 XMA `[1]`，由 lockfile 恢复 `node_modules`、Cargo crates 与本机 `.cache`。普通用户安装**绝对不能** clone 源码或要求安装 pnpm、Rust、Cargo、MSVC。

普通用户收到的是预构建 portable runtime：

```text
xiaoyu-<os>-<arch>/
├─ bin/            xiaoyu + xma launcher
├─ runtime/        XMA 自带 Node Runtime
├─ app/            bundled CLI / Server JavaScript
├─ web/            已构建 Web Shell
├─ native/         Rust Native Kernel
├─ VERSION
└─ bundle.json
```

Node 在 0.1.x 第一批作为私有 Runtime 一起分发；未来可以评估 Node SEA，但不得为了“单文件”牺牲可验证升级、Native 边界或调试证据。

## 3. Windows 安装合同

默认采用**每用户安装**，不要求管理员权限：

```text
%LOCALAPPDATA%\Programs\Xiaoyu\
├─ bin\
├─ runtime\
├─ app\
├─ web\
└─ native\
```

只把 `%LOCALAPPDATA%\Programs\Xiaoyu\bin` 加入 **User PATH**。程序文件和用户数据必须分开；Session/状态默认进入 `%LOCALAPPDATA%\Xiaoyu\state`，配置/凭据后续由专门 Config/Credentials Service 管理。

Bootstrap `scripts/install/windows.ps1` 必须执行：Release Manifest → 选择 OS/arch → HTTPS 下载 → SHA-256 校验 → staging 文件验证 → 原子替换 → User PATH。禁止在普通用户安装器里执行 `pnpm install`、`cargo build`、`winget` 开发环境安装。

最终网站可暴露类似：

```powershell
irm https://<xiaoyu-domain>/install.ps1 | iex
```

在正式域名/Release 资产部署前，文档不得宣称该公网命令已经可用。仓库已经提供 tag-triggered `.github/workflows/release.yml`，冻结版本打 `v<version>` tag 后会在 Windows/Linux/macOS 原生 Runner 构建 portable 资产并发布统一 Manifest。

在正式 Release 存在后，可先使用 GitHub Release bootstrap 做 E2E：

```powershell
irm https://github.com/yubboo/xma/releases/latest/download/install.ps1 | iex
```

```bash
curl -fsSL https://github.com/yubboo/xma/releases/latest/download/install.sh | sh
```

后续官方网站只托管/转发同一 bootstrap 合同，不另造安装逻辑。

## 4. Linux / macOS 安装合同

普通用户目录遵循每用户安装，不默认写 `/usr/local`：

```text
~/.local/bin/xiaoyu
~/.local/bin/xma
~/.local/share/xiaoyu/
```

Linux 状态目录优先使用 `$XDG_STATE_HOME/xiaoyu`，否则 `~/.local/state/xiaoyu`。macOS 产品状态使用 `~/Library/Application Support/Xiaoyu/state`。

Bootstrap `scripts/install/unix.sh` 下载当前 OS/arch 的 `tar.gz` 和 `checksums.txt`，必须在解压/替换前完成 SHA-256 校验。若 `~/.local/bin` 不在 PATH，只提示用户加入 shell profile；安装脚本不擅自修改任意 shell 配置文件。

## 5. Terminal Runtime

`xiaoyu [workspace]` 是正式 Terminal Workbench。第一批必须具备：

- 持续 TUI 输入循环，而不是打印欢迎页后退出；
- `xiaoyu --help / --version / doctor`；
- `xiaoyu server / web` 发行入口；
- Home / 文件系统根目录风险确认，只允许“退出”或“仅本次信任”；
- Workspace Session 绑定到正式 Agent Runtime；
- 第一批允许通过 `XIAOYU_BASE_URL / XIAOYU_MODEL / XIAOYU_API_KEY` 接入 OpenAI-compatible Brain，Secret 只从环境变量读取，不写入 Session；
- 未配置 Provider 时明确显示未就绪，禁止伪造模型回复；
- 如果 bundled/development Native Kernel 可用，Terminal 注册 `native.fs.read_text` / `native.fs.write_text`：读取按 standard policy 直接允许，写入必须在 TUI 显示 Tool Approval，并支持 deny / allow-once / allow-session；
- Terminal 第一批 **不注册 `native.process.run`**。只有 Host 明确给出 absolute executable allowlist 后才允许把进程工具加入 ToolPlan，不能为了终端方便退回 PATH/shell 执行。

后续把 Provider Settings、OS Keychain、process allowlist 管理、PTY/ConPTY 接入同一个 Terminal Host；不能重新实现一套 CLI Agent。

## 6. Release 输出

XMA 自己控制的中间 staging 继续只进入 `.cache/`：

```text
.cache/release/cli/
```

用户真正可下载的资产只进入：

```text
dist/release/
├─ xiaoyu-windows-x64.zip
├─ xiaoyu-linux-x64.tar.gz
├─ xiaoyu-macos-*.tar.gz
├─ release-manifest.json
├─ checksums.txt
├─ install.ps1
├─ install.sh
├─ electron/
└─ tauri/
```

源码仓库继续不提交 `dist/`、安装包、Node Runtime、Native build output 或缓存。GitHub Release/官方网站负责分发构建资产。

## 7. 跨平台发布原则

Windows 资产在 Windows 构建，Linux 资产在 Linux 构建，macOS 资产在 macOS 构建。禁止在一个 OS 上伪造另一个 OS 的已验证发行包。

每个平台最低 E2E：安装 → 新终端解析 `xiaoyu` → `xiaoyu --version` → `xiaoyu doctor` → 打开安全 Workspace → 升级覆盖 → 卸载/PATH 清理。Desktop 安装验证是另一条独立 E2E，不能替代 Terminal 安装验证。
