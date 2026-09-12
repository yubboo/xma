/**
 * 文件作用：XMA Electron 41.2.0 主桌面端入口，负责创建安全 BrowserWindow 并加载共享 Web UI。
 * 关联模块：apps/web、apps/desktop/electron-builder.yml、apps/desktop/scripts/dev-electron.ts、core/。
 * 当前实现：开发环境加载本地 Vite 地址；发布环境加载打包后的 apps/desktop/web/index.html。
 * 职责边界：Electron 只是桌面 Shell，不承担 Agent 推理、Provider 选择或 Workspace 业务逻辑。
 */

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#101114',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // 中文说明：开发时由启动器提供本地 Vite URL；发布包只加载本地静态文件，避免桌面壳依赖外部网页。
  const devUrl = process.env.XMA_DESKTOP_DEV_URL
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(currentDir, '..', 'web', 'index.html'))
  }

  window.once('ready-to-show', () => window.show())

  // 中文说明：外部链接交给系统默认浏览器，避免在拥有桌面权限的 Electron 窗口里直接打开陌生站点。
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  return window
}

void app.whenReady().then(() => {
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
