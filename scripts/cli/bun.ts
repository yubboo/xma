/**
 * 文件作用：为 XMA OpenTUI CLI 恢复 `[1]` 用户选择的固定 Bun Runtime，并统一源码运行与 CLI 构建入口。
 * 关联模块：xma-prepare.ps1、xma-common.ps1、package.json、apps/cli/opentui-runtime/build.ts。
 * 当前实现：Windows 优先读取 XMA_BUN_HOME / 项目恢复状态并真实校验 Bun 1.3.14；中文/特殊字符源码路径构建时，用动态 SUBST 别名把项目 `.cache` 暂时暴露为 ASCII 路径。
 * 职责边界：只恢复并启动已经准备好的 Bun/OpenTUI 前端，不安装依赖、不下载 Bun；SUBST 只在单次 build 生命周期存在，最终 dist/cli/xiaoyu.exe 不依赖它。
 */

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BUN_VERSION = '1.3.14'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '..', '..')
const runtimeRoot = path.join(root, 'apps', 'cli', 'opentui-runtime')
const command = process.argv[2]
const forwarded = process.argv.slice(3).filter(value => value !== '--')

interface BunRuntime {
  executable: string
  home?: string
  source: 'env' | 'project-state' | 'path'
}

function bunExecutableFromHome(home: string): string {
  const name = process.platform === 'win32' ? 'bun.exe' : 'bun'
  return path.join(path.resolve(home), BUN_VERSION, name)
}

function isExpectedBun(executable: string): boolean {
  const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', shell: false })
  return probe.status === 0 && probe.stdout.trim() === BUN_VERSION
}

function readProjectBunHome(): string | undefined {
  const stateFile = path.join(root, '.xma', 'state', 'bun-environment.json')
  if (!existsSync(stateFile)) return undefined
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { formatVersion?: number; bunHome?: string; version?: string }
    if (state.formatVersion !== 1 || state.version !== BUN_VERSION || !state.bunHome) return undefined
    return state.bunHome
  } catch {
    return undefined
  }
}

function resolveBun(): BunRuntime {
  const homes = [process.env.XMA_BUN_HOME, readProjectBunHome()].filter((value): value is string => Boolean(value?.trim()))
  const seen = new Set<string>()
  for (const rawHome of homes) {
    const home = path.resolve(rawHome)
    const key = process.platform === 'win32' ? home.toLowerCase() : home
    if (seen.has(key)) continue
    seen.add(key)
    const executable = bunExecutableFromHome(home)
    if (existsSync(executable) && isExpectedBun(executable)) {
      return { executable, home, source: rawHome === process.env.XMA_BUN_HOME ? 'env' : 'project-state' }
    }
  }

  // Windows 必须使用 `[1]` 记录的安装位置，不能因为 PATH 里碰巧有另一个 Bun 就绕过用户选择。
  // 非 Windows 开发/CI 仍允许使用 PATH 中完全匹配的固定版本。
  if (process.platform !== 'win32' && isExpectedBun('bun')) return { executable: 'bun', source: 'path' }
  throw new Error(`未找到 [1] 已配置的 Bun ${BUN_VERSION} Runtime。请运行 xma-dev → [1] 一键准备开发环境并选择 Bun 安装位置。`)
}

function ensureWritableDirectory(candidate: string): string | undefined {
  try {
    mkdirSync(candidate, { recursive: true })
    const probe = path.join(candidate, `.xma-probe-${process.pid}`)
    const fd = openSync(probe, 'w')
    closeSync(fd)
    rmSync(probe, { force: true })
    return candidate
  } catch {
    return undefined
  }
}

function resolveWindowsExecutable(source: string): string {
  if (path.isAbsolute(source) && existsSync(source)) return source
  const where = spawnSync('where.exe', [source], { encoding: 'utf8', shell: false })
  const first = where.status === 0 ? where.stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean) : undefined
  if (first && existsSync(first)) return first
  return source
}

function stageBunForCompile(source: string, runtimeDir: string): string {
  if (process.platform !== 'win32') return source
  mkdirSync(runtimeDir, { recursive: true })
  const resolvedSource = resolveWindowsExecutable(source)
  const staged = path.join(runtimeDir, 'bun.exe')
  try {
    const sourceSize = statSync(resolvedSource).size
    const stagedSize = existsSync(staged) ? statSync(staged).size : -1
    if (sourceSize !== stagedSize) copyFileSync(resolvedSource, staged)
  } catch (error) {
    throw new Error(`无法把 Bun Runtime 暂存到项目级编译缓存：${staged}。${error instanceof Error ? error.message : String(error)}`)
  }
  return staged
}

function resolveBunCompileCache(): string {
  // 中文说明：XMA 自己控制的真实编译数据始终进入当前 checkout 的 `.cache/`；删除它只会丢构建缓存，不影响已生成的 xiaoyu.exe。
  const candidate = path.join(root, '.cache', 'bun-compile', BUN_VERSION)
  const ready = ensureWritableDirectory(candidate)
  if (ready) return ready
  throw new Error(`无法创建项目级 Bun 编译缓存：${candidate}。请检查 XMA 项目目录是否可写。`)
}

function containsNonAscii(value: string): boolean {
  return /[^\x20-\x7e]/.test(value)
}

function resolveSubstExecutable(): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR
  if (systemRoot) {
    const candidate = path.join(systemRoot, 'System32', 'subst.exe')
    if (existsSync(candidate)) return candidate
  }
  return 'subst.exe'
}

interface CompilePathAlias {
  root: string
  description?: string
  dispose: () => void
}

function createWindowsCompileAlias(realCache: string): CompilePathAlias {
  // 中文说明：Bun 1.3.14 Windows `--compile` 在包含中文/部分特殊字符的 TEMP 路径上会在内部复制 bun.exe 时返回 ENOENT。
  // 不把缓存退回 C:\Users\...\Temp；只给当前项目 `.cache` 建立单次 ASCII 路径别名，真实文件仍在项目缓存中。
  if (process.platform !== 'win32' || !containsNonAscii(realCache)) {
    return { root: realCache, dispose: () => undefined }
  }

  const subst = resolveSubstExecutable()
  const candidates: string[] = []
  for (let code = 'Z'.charCodeAt(0); code >= 'D'.charCodeAt(0); code -= 1) {
    const letter = String.fromCharCode(code)
    const driveRoot = `${letter}:\\`
    if (!existsSync(driveRoot)) candidates.push(`${letter}:`)
  }
  if (candidates.length === 0) {
    throw new Error('Bun Windows 编译需要一个临时空闲盘符来兼容中文项目路径，但当前没有可用盘符。请释放一个盘符后重试。')
  }

  let lastError = ''
  for (const drive of candidates) {
    const mapped = spawnSync(subst, [drive, realCache], { encoding: 'utf8', shell: false })
    if (mapped.status !== 0) {
      lastError = (mapped.stderr || mapped.stdout || `exit ${mapped.status}`).trim()
      continue
    }
    const aliasRoot = `${drive}\\`
    if (!existsSync(aliasRoot)) {
      spawnSync(subst, [drive, '/D'], { stdio: 'ignore', shell: false })
      lastError = `SUBST ${drive} 创建后不可访问`
      continue
    }
    return {
      root: aliasRoot,
      description: `${aliasRoot} -> ${realCache}`,
      dispose: () => {
        const removed = spawnSync(subst, [drive, '/D'], { encoding: 'utf8', shell: false })
        if (removed.status !== 0) {
          console.warn(`[xma] 警告：临时 Bun 路径别名 ${drive} 未能自动解除；可执行 \`subst ${drive} /D\` 手动清理。`)
        }
      },
    }
  }

  throw new Error(`无法为 Bun Windows 编译创建项目缓存的 ASCII 路径别名。${lastError ? `最后错误：${lastError}` : ''}`)
}

const bunRuntime = resolveBun()
const bun = bunRuntime.executable
const devArguments = forwarded.length > 0 ? forwarded : [root]
const args = command === 'dev'
  ? ['run', '--no-install', '../src/main.ts', ...devArguments]
  : command === 'build'
    ? ['run', '--no-install', './build.ts', ...forwarded]
    : undefined

if (!args) throw new Error('Usage: tsx scripts/cli/bun.ts <dev|build> [args...]')
// 中文说明：Bun 的 --cwd 不是这里的进程工作目录替代品；直接把 cwd 固定到独立 Runtime，
// 既能让 bunfig.toml/preload 正常生效，也避免 `bun run` 把入口误判为 package script。
// --no-install 锁死运行/构建阶段不得偷偷联网补依赖；缺依赖必须回到 xma-dev → [1] 显式准备。
const childEnv = { ...process.env }
if (bunRuntime.home) childEnv.XMA_BUN_HOME = bunRuntime.home
let bunExecutable = bun
let disposeCompileAlias = () => undefined

if (command === 'build') {
  const compileCache = resolveBunCompileCache()
  const alias = createWindowsCompileAlias(compileCache)
  disposeCompileAlias = alias.dispose
  const compileTemp = path.join(alias.root, 'tmp')
  const compileRuntime = path.join(alias.root, 'runtime')
  ensureWritableDirectory(compileTemp)
  ensureWritableDirectory(compileRuntime)

  childEnv.BUN_TMPDIR = compileTemp
  childEnv.TMPDIR = compileTemp
  childEnv.TEMP = compileTemp
  childEnv.TMP = compileTemp
  bunExecutable = stageBunForCompile(bun, compileRuntime)

  console.log(`[xma] Bun source runtime: ${bun}`)
  console.log(`[xma] Bun compile cache: ${compileCache}`)
  if (alias.description) console.log(`[xma] Bun Windows path alias: ${alias.description}`)
  console.log(`[xma] Bun compile temp: ${compileTemp}`)
  console.log(`[xma] Bun compile runtime: ${bunExecutable}`)
}

let result: ReturnType<typeof spawnSync> | undefined
try {
  result = spawnSync(bunExecutable, args, { cwd: runtimeRoot, stdio: 'inherit', shell: false, env: childEnv })
} finally {
  disposeCompileAlias()
}
if (!result) throw new Error('Bun 子进程未能启动。')
if (result.error) throw result.error
process.exitCode = result.status ?? 1
