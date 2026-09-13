/**
 * 文件作用：XMA Electron 41.2.0 主桌面端入口，负责创建安全 BrowserWindow、中文桌面菜单并加载共享 Web UI。
 * 关联模块：apps/web、apps/desktop/electron-builder.json、apps/desktop/scripts/electron/dev.ts、core/。
 * 当前实现：开发环境加载本地 Vite 地址；发布环境通过 file:// 加载打包后的相对资源 Web UI，并对空白渲染做显式报错。
 * 职责边界：Electron 只是桌面 Shell，不承担 Agent 推理、Provider 选择或 Workspace 业务逻辑。
 */

import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = fileURLToPath(new URL('.', import.meta.url))

function installChineseApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { type: 'separator' },
        { label: '恢复实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切换全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭窗口', role: 'close' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于小鱼管理智能体',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: '关于小鱼管理智能体',
              message: '小鱼管理智能体（XMA）',
              detail: `版本 ${app.getVersion()}\nModel is replaceable. Agent is ours.\n模型可以更换，小鱼始终属于用户。`,
            })
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function reportRendererFailure(message: string): void {
  console.error(`[XMA Desktop] ${message}`)
  dialog.showErrorBox('XMA 桌面界面加载失败', `${message}\n\n请重新构建桌面发布包；如果问题持续存在，请保存终端日志。`)
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'XMA · 小鱼管理智能体',
    backgroundColor: '#0b0d10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // 中文说明：开发时由启动器提供本地 Vite URL；发布包只加载本地静态文件，避免桌面壳依赖外部网页。
  // 发布 Web 必须使用 Vite `--base ./`，否则 file:// 下的 `/assets/...` 会错误解析到磁盘根目录并形成空白窗口。
  const devUrl = process.env.XMA_DESKTOP_DEV_URL
  if (devUrl) {
    void window.loadURL(devUrl).catch(error => reportRendererFailure(`无法加载开发界面 ${devUrl}：${String(error)}`))
  } else {
    const entry = join(currentDir, '..', 'web', 'index.html')
    void window.loadFile(entry).catch(error => reportRendererFailure(`无法加载发布界面 ${entry}：${String(error)}`))
  }

  window.once('ready-to-show', () => window.show())

  // 中文说明：主文档加载完成后检查共享 Web Shell 是否真的渲染出内容，避免资源路径错误时只给用户一个无提示黑屏。
  window.webContents.on('did-finish-load', () => {
    void window.webContents
      .executeJavaScript("Boolean(document.querySelector('#app')?.childElementCount)")
      .then(rendered => {
        if (!rendered) reportRendererFailure('共享 Web UI 没有渲染出任何内容。')
      })
      .catch(error => reportRendererFailure(`无法验证共享 Web UI：${String(error)}`))
  })

  // 中文说明：外部链接交给系统默认浏览器，避免在拥有桌面权限的 Electron 窗口里直接打开陌生站点。
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  return window
}

void app.whenReady().then(() => {
  installChineseApplicationMenu()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
