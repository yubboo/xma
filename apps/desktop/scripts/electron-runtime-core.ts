/**
 * 文件作用：实现 Electron Runtime 从已校验 ZIP 到本地 package dist 的原子安装逻辑。
 * 关联模块：install-electron-runtime.ts、Electron 41.2.0 npm package、Desktop Windows 流程。
 * 当前实现：临时 staging 解压、版本/可执行文件校验、dist 原子替换、path.txt 写入与失败清理。
 * 职责边界：这里只安装一个已经由 @electron/get 下载并校验过的 ZIP；不联网、不选择镜像、不参与 Agent 业务逻辑。
 */

import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export type ElectronArchiveExtractor = (zipPath: string, options: { dir: string }) => Promise<void>

/**
 * 默认把 Electron 下载缓存放在 XMA 项目自己的 .cache/electron 下，避免写入用户 C 盘配置目录。
 * 用户显式设置 electron_config_cache 时仍允许覆盖；相对路径按项目根目录解析。
 */
export function resolveElectronCacheRoot(projectRoot: string, configuredCache?: string): string {
  const configured = configuredCache?.trim()
  if (!configured) return path.join(projectRoot, '.cache', 'electron')
  return path.isAbsolute(configured) ? configured : path.resolve(projectRoot, configured)
}

export interface ElectronRuntimeInstallOptions {
  zipPath: string
  electronDir: string
  version: string
  platformPath: string
  extractArchive: ElectronArchiveExtractor
}

export interface ElectronRuntimeInstallResult {
  executable: string
  versionFile: string
  pathFile: string
}

export async function installElectronRuntimeArchive(options: ElectronRuntimeInstallOptions): Promise<ElectronRuntimeInstallResult> {
  const distDir = path.join(options.electronDir, 'dist')
  const pathFile = path.join(options.electronDir, 'path.txt')
  const stagingDir = path.join(options.electronDir, `.xma-electron-dist-${process.pid}-${Date.now()}`)
  const stagingVersionFile = path.join(stagingDir, 'version')
  const stagingExecutable = path.join(stagingDir, options.platformPath)
  const stagingTypeDef = path.join(stagingDir, 'electron.d.ts')
  const targetTypeDef = path.join(options.electronDir, 'electron.d.ts')
  const pathTemp = `${pathFile}.xma-${process.pid}.tmp`

  await removeTree(stagingDir)
  await rm(pathTemp, { force: true })
  await mkdir(stagingDir, { recursive: true })

  try {
    await options.extractArchive(options.zipPath, { dir: stagingDir })

    const extractedVersion = (await readFile(stagingVersionFile, 'utf8')).trim().replace(/^v/, '')
    if (extractedVersion !== options.version) {
      throw new Error(`Electron ZIP 版本不一致：期望 ${options.version}，实际 ${extractedVersion}。`)
    }
    if (!existsSync(stagingExecutable)) {
      throw new Error(`Electron ZIP 解压完成，但缺少可执行文件：${stagingExecutable}`)
    }

    // Electron 官方 install.js 会把 ZIP 内的 electron.d.ts 提升到 package 根目录。
    // 使用 copy 而不是直接 rename，避免 Windows 上目标文件已存在时产生不必要的安装失败。
    if (existsSync(stagingTypeDef)) {
      if (!existsSync(targetTypeDef)) await copyFile(stagingTypeDef, targetTypeDef)
      await rm(stagingTypeDef, { force: true })
    }

    // 只有 staging 已通过完整验证后才替换正式 dist，避免失败时留下“看起来像装了一半”的目录。
    await removeTree(distDir)
    await renameWithRetry(stagingDir, distDir)

    await writeFile(pathTemp, options.platformPath, 'utf8')
    await rm(pathFile, { force: true })
    await rename(pathTemp, pathFile)

    const executable = path.join(distDir, options.platformPath)
    const versionFile = path.join(distDir, 'version')
    const installedVersion = (await readFile(versionFile, 'utf8')).trim().replace(/^v/, '')
    const installedPath = (await readFile(pathFile, 'utf8')).trim()
    if (installedVersion !== options.version || installedPath !== options.platformPath || !existsSync(executable)) {
      throw new Error('Electron Runtime 原子安装后的最终校验失败。')
    }

    return { executable, versionFile, pathFile }
  } catch (error) {
    await removeTree(stagingDir).catch(() => undefined)
    await rm(pathTemp, { force: true }).catch(() => undefined)
    throw error
  }
}

async function removeTree(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      lastError = error
      const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : ''
      if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(code) || attempt === 5) throw error
      await new Promise(resolve => setTimeout(resolve, attempt * 200))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Electron dist 原子替换失败。')
}
