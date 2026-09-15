/**
 * 文件作用：从 pnpm Workspace 的 node_modules 恢复 Xiaoyu OpenTUI CLI 使用的 Bun Runtime，并统一源码运行与 CLI 构建入口。
 * 关联模块：package.json、pnpm-workspace.yaml、apps/cli/opentui-runtime/package.json、apps/cli/opentui-runtime/build.ts。
 * 当前实现：Bun/OpenTUI 作为普通 Workspace 依赖由 `pnpm install` 管理；运行/构建直接读取 node_modules 中已安装版本，不再维护 xma-path Bun Home、独立下载器或固定 Bun 版本。Windows 中文/特殊字符源码路径构建时，仍用动态 SUBST 别名把项目 `.cache` 暂时暴露为 ASCII 路径。
 * 职责边界：只启动已经由 `[1]`/`[8]` 准备好的 node_modules，不安装依赖、不联网；SUBST 只在单次 build 生命周期存在，最终 dist/cli/xiaoyu.exe 不依赖它。
 */

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '..', '..')
const runtimeRoot = path.join(root, 'apps', 'cli', 'opentui-runtime')
const command = process.argv[2]
const forwarded = process.argv.slice(3).filter(value => value !== '--')

interface BunRuntime {
  executable: string
  version: string
  packageRoot: string
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

function isExpectedBun(executable: string, expectedVersion: string): boolean {
  const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', shell: false })
  return probe.status === 0 && probe.stdout.trim() === expectedVersion
}

function resolveBun(): BunRuntime {
  const packageRoot = path.join(root, 'node_modules', 'bun')
  const packageJson = path.join(packageRoot, 'package.json')
  if (!existsSync(packageJson)) {
    throw new Error('未检测到 Workspace Bun Runtime。请运行 xma-dev → [1]，或主菜单 [8] 刷新 JavaScript Runtime。')
  }
  const pkg = readJson<{ version?: string }>(packageJson)
  const version = pkg.version?.trim()
  if (!version) throw new Error(`Bun package 缺少版本信息：${packageJson}`)

  const candidates = process.platform === 'win32'
    ? [path.join(packageRoot, 'bin', 'bun.exe')]
    : [path.join(root, 'node_modules', '.bin', 'bun'), path.join(packageRoot, 'bin', 'bun.exe')]
  for (const executable of candidates) {
    if (existsSync(executable) && isExpectedBun(executable, version)) return { executable, version, packageRoot }
  }
  throw new Error(`node_modules 中的 Bun Runtime 不完整或版本探针失败（package=${version}）。请运行 xma-dev → [1]/[8] 重新执行 pnpm 安装。`)
}

function ensureOpenTuiDependencies(): void {
  const required = [
    ['@opentui', 'core', 'package.json'],
    ['@opentui', 'solid', 'package.json'],
    ['solid-js', 'package.json'],
    ['@types', 'bun', 'package.json'],
  ]
  const missing = required
    .map(parts => path.join(runtimeRoot, 'node_modules', ...parts))
    .filter(file => !existsSync(file))
  if (missing.length > 0) {
    throw new Error(`OpenTUI Workspace 依赖不完整：${missing.join('；')}。请运行 xma-dev → [1]，或主菜单 [8] 刷新 JavaScript Runtime。`)
  }
}

function ensureWritableDirectory(candidate: string): string | undefined {
  try {
    mkdirSync(candidate, { recursive: true })
    const probe = path.join(candidate, `xma-probe-${process.pid}`)
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

function resolveBunCompileCache(version: string): string {
  // 中文说明：XMA 自己控制的真实编译数据始终进入当前 checkout 的 `.cache/`；删除它只会丢构建缓存，不影响 node_modules Runtime 或已生成的 xiaoyu.exe。
  const candidate = path.join(root, '.cache', 'bun-compile', version)
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
  // 中文说明：部分 Bun Windows 版本在包含中文/特殊字符的 TEMP 路径上可能在内部复制自身时返回 ENOENT。
  // 不把缓存退回系统 TEMP；只给当前项目 `.cache` 建立单次 ASCII 路径别名，真实文件仍在项目缓存中。
  if (process.platform !== 'win32' || !containsNonAscii(realCache)) return { root: realCache, dispose: () => undefined }

  const subst = resolveSubstExecutable()
  const candidates: string[] = []
  for (let code = 'Z'.charCodeAt(0); code >= 'D'.charCodeAt(0); code -= 1) {
    const letter = String.fromCharCode(code)
    const driveRoot = `${letter}:\\`
    if (!existsSync(driveRoot)) candidates.push(`${letter}:`)
  }
  if (candidates.length === 0) throw new Error('Bun Windows 编译需要一个临时空闲盘符来兼容中文项目路径，但当前没有可用盘符。请释放一个盘符后重试。')

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
        if (removed.status !== 0) console.warn(`[xma] 警告：临时 Bun 路径别名 ${drive} 未能自动解除；可执行 \`subst ${drive} /D\` 手动清理。`)
      },
    }
  }
  throw new Error(`无法为 Bun Windows 编译创建项目缓存的 ASCII 路径别名。${lastError ? `最后错误：${lastError}` : ''}`)
}

const bunRuntime = resolveBun()
ensureOpenTuiDependencies()
const bun = bunRuntime.executable
const devArguments = forwarded.length > 0 ? forwarded : [root]
const args = command === 'dev'
  ? ['run', '--no-install', '../src/main.ts', ...devArguments]
  : command === 'build'
    ? ['run', '--no-install', './build.ts', ...forwarded]
    : undefined

if (!args) throw new Error('Usage: tsx scripts/cli/bun.ts <dev|build> [args...]')
// 中文说明：运行/构建都使用 pnpm 已安装的 Bun；--no-install 锁死此阶段不得偷偷联网补依赖，缺包必须回到 xma-dev → [1]/[8]。
const childEnv = { ...process.env }
let bunExecutable = bun
let disposeCompileAlias: () => void = () => {}

if (command === 'build') {
  const compileCache = resolveBunCompileCache(bunRuntime.version)
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

  console.log(`[xma] Bun workspace runtime: ${bun} (${bunRuntime.version})`)
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
