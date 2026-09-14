/**
 * 文件作用：构建 XMA Electron 桌面端，把所有中间 staging 收敛到 .cache/desktop/electron，并只把最终安装包写入 dist/release/electron。
 * 关联模块：apps/desktop/src/main.ts、apps/web、apps/desktop/electron-builder.json、scripts/windows/xma-build-release.ps1。
 * 当前实现：构建相对路径 Web UI、Electron Main Process，校验并复用 XMA 已准备的 Electron Runtime，再生成最小打包清单交给 electron-builder。
 * 职责边界：这里只负责桌面构建编排；不安装 Workspace 依赖、不下载 Electron Runtime、不修改 Agent/Provider，不把 .cache 当发布目录。
 */

import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface DesktopPackage {
  name: string
  version: string
  description?: string
}

interface ElectronPackage {
  version: string
}

interface ElectronBuilderTemplate {
  electronVersion?: string
  directories?: Record<string, string>
  [key: string]: unknown
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '..', '..', '..', '..')
const desktopRoot = join(root, 'apps', 'desktop')
const stageRoot = join(root, '.cache', 'desktop', 'electron', 'app')
const webStage = join(stageRoot, 'web')
const mainStage = join(stageRoot, 'main')
const releaseRoot = join(root, 'dist', 'release', 'electron')
const electronPackageRoot = join(desktopRoot, 'node_modules', 'electron')
const electronRuntimeDist = join(electronPackageRoot, 'dist')
const builderCache = join(root, '.cache', 'electron-builder')

function run(args: readonly string[], cwd = root, extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  const file = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'pnpm'
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm.cmd', ...args]
    : [...args]

  return new Promise((resolveRun, reject) => {
    const child = spawn(file, commandArgs, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolveRun()
      else reject(new Error(`XMA Electron build command failed (${code ?? 'signal'}): pnpm ${args.join(' ')}`))
    })
  })
}

async function requirePreparedElectronRuntime(expectedVersion: string | undefined): Promise<string> {
  if (!expectedVersion) throw new Error('electron-builder.json 缺少 electronVersion，无法验证本地 Electron Runtime。')

  try {
    const [packageSource, runtimeVersionSource, platformPathSource] = await Promise.all([
      readFile(join(electronPackageRoot, 'package.json'), 'utf8'),
      readFile(join(electronRuntimeDist, 'version'), 'utf8'),
      readFile(join(electronPackageRoot, 'path.txt'), 'utf8'),
    ])
    const electronPackage = JSON.parse(packageSource) as ElectronPackage
    const packageVersion = electronPackage.version.trim().replace(/^v/, '')
    const runtimeVersion = runtimeVersionSource.trim().replace(/^v/, '')
    const platformPath = platformPathSource.trim()

    if (packageVersion !== expectedVersion) {
      throw new Error(`Electron package 版本不一致：期望 ${expectedVersion}，实际 ${packageVersion}。`)
    }
    if (runtimeVersion !== expectedVersion) {
      throw new Error(`Electron Runtime 版本不一致：期望 ${expectedVersion}，实际 ${runtimeVersion}。`)
    }
    if (!platformPath) throw new Error('Electron path.txt 为空。')
    await access(join(electronRuntimeDist, platformPath))
    return electronRuntimeDist
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Electron ${expectedVersion} Runtime 未准备完整。请先运行 xma-dev.bat → [3] Desktop → Electron，或菜单 [5]/[6] 让 XMA 显式准备 Runtime；electron-builder 不允许在打包阶段二次下载 Electron。原因：${reason}`,
    )
  }
}

async function prepareStagePackage(): Promise<string> {
  const desktopPackage = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8')) as DesktopPackage
  const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { description?: string }
  const stagePackage = {
    name: desktopPackage.name,
    version: desktopPackage.version,
    private: true,
    type: 'module',
    main: 'main/main.js',
    description: desktopPackage.description ?? rootPackage.description ?? 'Xiaoyu Management Agent',
  }
  await writeFile(join(stageRoot, 'package.json'), `${JSON.stringify(stagePackage, null, 2)}\n`, 'utf8')

  const template = JSON.parse(await readFile(join(desktopRoot, 'electron-builder.json'), 'utf8')) as ElectronBuilderTemplate
  const preparedElectronDist = await requirePreparedElectronRuntime(template.electronVersion)
  const generatedConfig: ElectronBuilderTemplate = {
    ...template,
    electronDist: preparedElectronDist,
    directories: {
      ...(template.directories ?? {}),
      output: releaseRoot,
    },
  }
  const generatedConfigPath = join(stageRoot, 'electron-builder.json')
  await writeFile(generatedConfigPath, `${JSON.stringify(generatedConfig, null, 2)}\n`, 'utf8')
  console.log(`[XMA Desktop] 复用已准备 Electron Runtime：${preparedElectronDist}`)
  return generatedConfigPath
}

async function main(): Promise<void> {
  await rm(stageRoot, { recursive: true, force: true })
  await rm(releaseRoot, { recursive: true, force: true })
  await mkdir(stageRoot, { recursive: true })
  await mkdir(builderCache, { recursive: true })

  console.log(`[XMA Desktop] Electron 中间产物：${stageRoot}`)
  console.log(`[XMA Desktop] Electron 正式发布物：${releaseRoot}`)

  await run(['exec', 'vite', 'build', 'apps/web', '--base', './', '--outDir', webStage, '--emptyOutDir'])
  await run(['exec', 'tsup', 'apps/desktop/src/main.ts', '--format', 'esm', '--platform', 'node', '--external', 'electron', '--out-dir', mainStage])
  const generatedConfigPath = await prepareStagePackage()

  await run(
    ['--dir', 'apps/desktop', 'exec', 'electron-builder', '--projectDir', stageRoot, '--config', generatedConfigPath],
    root,
    { ELECTRON_BUILDER_CACHE: builderCache },
  )
}

void main().catch(error => {
  console.error('[XMA Desktop] Electron 构建失败：', error)
  process.exitCode = 1
})
