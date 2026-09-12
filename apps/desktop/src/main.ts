/**
 * 文件作用：XMA Electron Desktop 的最小主进程入口。
 * 关联模块：apps/web、未来 App Server/Core。
 * 当前实现：打开 XMA Web 开发页或本地静态页。
 * 职责边界：Desktop 只是 Shell，不在 Electron Main 中实现 Agent 推理。
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 620, title: 'XMA · Xiaoyu Management Agent' })
  const devUrl = process.env.XMA_WEB_URL
  if (devUrl) await window.loadURL(devUrl)
  else await window.loadFile(join(app.getAppPath(), 'web/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
