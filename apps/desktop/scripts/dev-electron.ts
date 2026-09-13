/**
 * 文件作用：XMA Electron 主桌面端开发启动器，先构建 Main Process，再启动共享 Vite UI 和 Electron。
 * 关联模块：apps/desktop/src/main.ts、apps/web、apps/desktop/package.json。
 * 当前实现：等待 Vite 1420 端口可访问后启动 Electron，并在退出时清理子进程。
 * 职责边界：这里只做开发进程编排，不安装依赖、不修改 Provider/Agent 逻辑。
 */

import { spawn, type ChildProcess } from 'node:child_process'

const devUrl = 'http://127.0.0.1:1420'

function run(args: string[], env = process.env): ChildProcess {
  // Node 24+ 会对 shell:true + 参数数组发出 DEP0190，并提示参数拼接存在注入风险。
  // Windows 显式调用 cmd.exe 执行 pnpm.cmd；其他平台直接执行 pnpm，不使用 shell:true。
  const file = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'pnpm'
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm.cmd', ...args] : args
  const child = spawn(file, commandArgs, { stdio: 'inherit', env, windowsHide: true })
  child.on('error', error => {
    console.error('[XMA Desktop] 子进程启动失败：', error)
  })
  return child
}

async function waitForWeb(timeoutMs = 30_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(devUrl)
      if (response.ok) return
    } catch {
      // 中文说明：Vite 尚未监听时继续等待，不把正常启动过程误报为错误。
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error('等待 XMA Web 开发服务器超时（30 秒）')
}

async function main(): Promise<void> {
  const build = run(['--dir', 'apps/desktop', 'run', 'main:build'])
  const buildCode = await new Promise<number | null>(resolve => build.once('exit', resolve))
  if (buildCode !== 0) process.exit(buildCode ?? 1)

  const web = run(['--dir', 'apps/desktop', 'run', 'web:dev'])
  try {
    await waitForWeb()
    const electron = run(
      ['--dir', 'apps/desktop', 'exec', 'electron', 'dist/main.js'],
      { ...process.env, XMA_DESKTOP_DEV_URL: devUrl },
    )
    const code = await new Promise<number | null>(resolve => electron.once('exit', resolve))
    process.exitCode = code ?? 0
  } finally {
    web.kill()
  }
}

void main().catch(error => {
  console.error('[XMA Desktop] 启动失败：', error)
  process.exitCode = 1
})
