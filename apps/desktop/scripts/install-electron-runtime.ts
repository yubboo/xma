/**
 * 文件作用：按需下载并安装 XMA Electron 41.2.0 主桌面 Runtime，并显示真实下载进度。
 * 关联模块：electron-runtime-core.ts、apps/desktop/package.json、scripts/windows/xma-expand-archive.ps1、xma-console.ps1。
 * 当前实现：使用 Electron 官方 @electron/get 下载并校验 ZIP；Windows 固定使用系统 PowerShell Expand-Archive 解压，避免把安装成功与 Node ZIP 流实现绑定；其余平台使用 Electron package 自带 extract-zip。
 * 职责边界：只负责 Electron Runtime 的下载与落地，不执行 pnpm install/rebuild，不参与 Agent/Core 业务逻辑。
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installElectronRuntimeArchive, resolveElectronCacheRoot, type ElectronArchiveExtractor } from './electron-runtime-core.ts'

interface DownloadProgress {
  transferred?: number
  total?: number
  percent?: number
}

type DownloadArtifact = (options: Record<string, unknown>) => Promise<string>

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '../../..')
const desktopPackageJson = path.join(root, 'apps/desktop/package.json')
const desktopRequire = createRequire(desktopPackageJson)
const electronPackageJson = desktopRequire.resolve('electron/package.json')
const electronDir = path.dirname(electronPackageJson)
const electronRequire = createRequire(electronPackageJson)
const electronPackage = JSON.parse(readFileSync(electronPackageJson, 'utf8')) as { version: string }
const checksums = JSON.parse(readFileSync(path.join(electronDir, 'checksums.json'), 'utf8')) as Record<string, string>
const electronGet = electronRequire('@electron/get') as { downloadArtifact?: DownloadArtifact }
const downloadArtifact: DownloadArtifact = requireDownloadArtifact(electronGet.downloadArtifact)

const version = electronPackage.version
const platform = process.env.npm_config_platform || process.platform
const arch = process.env.npm_config_arch || process.arch
const platformPath = getPlatformPath(platform)
const distDir = path.join(electronDir, 'dist')
const executable = path.join(distDir, platformPath)
const versionFile = path.join(distDir, 'version')
const pathFile = path.join(electronDir, 'path.txt')
const extractArchive = createArchiveExtractor()
const electronCacheRoot = resolveElectronCacheRoot(root, process.env.electron_config_cache)

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(`\n[失败] Electron Runtime 安装失败：${message}`)
  process.exitCode = 1
})

function requireDownloadArtifact(candidate: DownloadArtifact | undefined): DownloadArtifact {
  if (typeof candidate !== 'function') throw new Error('无法加载 Electron 官方下载器 @electron/get。')
  return candidate
}

async function main(): Promise<void> {
  if (isInstalled()) {
    console.log(`[通过] Electron ${version} Runtime 已存在：${executable}`)
    return
  }

  if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY) {
    process.env.ELECTRON_GET_USE_PROXY = '1'
    console.log('[代理] 检测到系统代理环境变量，Electron 下载器将使用现有代理。')
  }

  console.log(`[缓存] Electron 下载缓存目录：${electronCacheRoot}`)

  const configuredMirror = process.env.ELECTRON_MIRROR?.trim()
  const attempts: Array<{ name: string; mirror?: string }> = configuredMirror
    ? [{ name: '用户配置的 ELECTRON_MIRROR', mirror: configuredMirror }]
    : [
        { name: 'Electron 官方 GitHub Releases' },
        { name: 'Electron 文档示例备用镜像 npmmirror', mirror: 'https://npmmirror.com/mirrors/electron/' },
      ]

  let zipPath: string | undefined
  let lastError: unknown

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]!
    try {
      zipPath = await downloadOnce(attempt.name, attempt.mirror)
      break
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      console.log(`\n[下载失败] ${attempt.name}：${message}`)
      if (index + 1 < attempts.length) {
        console.log('[切换] 当前源停滞或连接失败，正在切换备用源；仍使用 Electron package checksums.json 校验 SHA-256。')
      }
    }
  }

  if (!zipPath) {
    throw lastError instanceof Error ? lastError : new Error('Electron Runtime 下载失败。')
  }

  console.log(`[缓存] 已取得并校验 Electron ${version} ZIP：${zipPath}`)
  console.log(`[解压] ${platform === 'win32' ? 'Windows 使用系统 PowerShell Expand-Archive' : '使用 Electron package extract-zip'}，正在写入 staging 并校验...`)
  const installed = await installElectronRuntimeArchive({
    zipPath,
    electronDir,
    version,
    platformPath,
    extractArchive,
  })

  if (!isInstalled()) {
    throw new Error(`Electron Runtime 安装函数返回后最终校验仍失败：${installed.executable}`)
  }
  console.log(`[通过] Electron ${version} Runtime 已安装：${installed.executable}`)
}

function createArchiveExtractor(): ElectronArchiveExtractor {
  if (platform === 'win32') {
    const helper = path.join(root, 'scripts/windows/xma-expand-archive.ps1')
    if (!existsSync(helper)) throw new Error(`缺少 Windows Electron 解压 helper：${helper}`)
    return async (zipPath, { dir }) => {
      await runProcess('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helper,
        '-Archive',
        zipPath,
        '-Destination',
        dir,
      ])
    }
  }

  // 非 Windows 暂时复用 Electron 41.2.0 自带 extract-zip。
  // Windows 不依赖 Node 24.16+ 的 ZIP 流实现；pnpm-workspace.yaml 的 yauzl >= 3.3.1 override 只保护非 Windows Electron ZIP 链。
  return electronRequire('extract-zip') as ElectronArchiveExtractor
}

async function runProcess(file: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${file} 解压进程失败：exit=${String(code)} signal=${String(signal)}`))
    })
  })
}

async function downloadOnce(sourceName: string, mirror?: string): Promise<string> {
  console.log(`[源] ${sourceName}`)
  const controller = new AbortController()
  let stalledTimer: NodeJS.Timeout | undefined
  let heartbeatTimer: NodeJS.Timeout | undefined
  const startedAt = Date.now()
  let lastPrintedAt = 0
  let hasProgress = false

  const resetStallTimer = (): void => {
    if (stalledTimer) clearTimeout(stalledTimer)
    stalledTimer = setTimeout(() => controller.abort(), 45_000)
  }

  const stopTimers = (): void => {
    if (stalledTimer) clearTimeout(stalledTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
  }

  resetStallTimer()
  heartbeatTimer = setInterval(() => {
    if (!hasProgress) {
      const seconds = Math.floor((Date.now() - startedAt) / 1000)
      console.log(`[等待] 正在连接下载源 / 等待首个数据包... ${seconds}s`)
    }
  }, 5_000)

  try {
    const downloadedZip = await downloadArtifact({
      version,
      artifactName: 'electron',
      force: process.env.force_no_cache === 'true',
      cacheRoot: electronCacheRoot,
      checksums: process.env.electron_use_remote_checksums || process.env.npm_config_electron_use_remote_checksums ? undefined : checksums,
      platform,
      arch,
      ...(mirror ? { mirrorOptions: { mirror } } : {}),
      downloadOptions: {
        signal: controller.signal,
        getProgressCallback: (progress: DownloadProgress) => {
          hasProgress = true
          resetStallTimer()
          const now = Date.now()
          if (now - lastPrintedAt < 400) return
          lastPrintedAt = now
          const transferred = progress.transferred ?? 0
          const total = progress.total ?? 0
          const rawPercent = progress.percent ?? (total > 0 ? transferred / total : 0)
          const percent = rawPercent <= 1 ? rawPercent * 100 : rawPercent
          const size = total > 0 ? `${formatMb(transferred)} / ${formatMb(total)}` : `${formatMb(transferred)}`
          process.stdout.write(`\r[下载] Electron ${version}  ${percent.toFixed(1).padStart(6)}%  ${size.padEnd(24)}`)
        },
      },
    })
    if (hasProgress) process.stdout.write('\n')
    return downloadedZip
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('45 秒没有收到新的下载数据，已主动中止本次连接，避免界面无限“卡住”。')
    }
    throw error
  } finally {
    stopTimers()
  }
}

function isInstalled(): boolean {
  try {
    const installedVersion = readFileSync(versionFile, 'utf8').trim().replace(/^v/, '')
    const installedPath = readFileSync(pathFile, 'utf8').trim()
    return installedVersion === version && installedPath === platformPath && existsSync(executable)
  } catch {
    return false
  }
}

function getPlatformPath(targetPlatform: string): string {
  switch (targetPlatform) {
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      throw new Error(`Electron 不支持当前平台：${targetPlatform} (${os.platform()})`)
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
