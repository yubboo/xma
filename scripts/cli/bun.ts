/**
 * 文件作用：为 XMA OpenTUI CLI 定位固定 Bun Runtime，并统一源码运行与 CLI 构建入口。
 * 关联模块：xma-prepare.ps1、scripts/unix/xma-console.sh、package.json、apps/cli/opentui-runtime/build.ts。
 * 当前实现：优先使用仓库 `.xma/tools/bun/1.3.14` 的固定 Bun；CI/高级开发环境允许回退到 PATH 中同版本 Bun。
 * 职责边界：只启动 Bun/OpenTUI 前端，不安装依赖、不下载 Bun，也不改变 Agent/Native Runtime 业务行为。
 */

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const BUN_VERSION = '1.3.14'
const root = process.cwd()
const runtimeRoot = path.join(root, 'apps', 'cli', 'opentui-runtime')
const command = process.argv[2]
const forwarded = process.argv.slice(3).filter(value => value !== '--')

function localBun(): string {
  const name = process.platform === 'win32' ? 'bun.exe' : 'bun'
  return path.join(root, '.xma', 'tools', 'bun', BUN_VERSION, name)
}

function resolveBun(): string {
  const local = localBun()
  if (existsSync(local)) return local
  const probe = spawnSync(process.platform === 'win32' ? 'bun.exe' : 'bun', ['--version'], { encoding: 'utf8', shell: false })
  if (probe.status === 0 && probe.stdout.trim() === BUN_VERSION) return process.platform === 'win32' ? 'bun.exe' : 'bun'
  throw new Error(`未找到 Bun ${BUN_VERSION}。请先运行 xma-dev → [1] 一键准备开发环境。`)
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

function stageBunForCompile(source: string, compileTemp: string): string {
  if (process.platform !== 'win32') return source
  const staged = path.join(compileTemp, 'bun.exe')
  try {
    const sourceSize = statSync(source).size
    const stagedSize = existsSync(staged) ? statSync(staged).size : -1
    if (sourceSize !== stagedSize) copyFileSync(source, staged)
  } catch (error) {
    throw new Error(`无法把 Bun Runtime 暂存到编译临时目录：${staged}。${error instanceof Error ? error.message : String(error)}`)
  }
  return staged
}

function resolveBunCompileTemp(): string {
  const candidates = [
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Temp', 'xma-bun-compile', BUN_VERSION)
      : undefined,
    process.env.TEMP ? path.join(process.env.TEMP, 'xma-bun-compile', BUN_VERSION) : undefined,
    process.env.TMP ? path.join(process.env.TMP, 'xma-bun-compile', BUN_VERSION) : undefined,
    path.join(root, '.cache', 'bun-compile-tmp', BUN_VERSION),
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    const ready = ensureWritableDirectory(candidate)
    if (ready) return ready
  }
  throw new Error('无法创建 Bun 编译临时目录。请检查 LOCALAPPDATA/TEMP/TMP 是否存在且当前用户可写。')
}

const bun = resolveBun()
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
let bunExecutable = bun
if (command === 'build') {
  // 中文说明：Bun 1.3.x 的 Windows `--compile` 会先把 bun.exe 复制到临时文件。
  // 不继承可能失效的 TEMP/TMP/BUN_TMPDIR，而是先创建并探测一个确定可写目录，再同时写入四个临时目录变量。
  // 这样项目位于中文路径、用户环境残留了不存在的临时目录时，也不会在 compile 阶段报 FileNotFound。
  const compileTemp = resolveBunCompileTemp()
  childEnv.BUN_TMPDIR = compileTemp
  childEnv.TMPDIR = compileTemp
  childEnv.TEMP = compileTemp
  childEnv.TMP = compileTemp
  // 中文说明：Windows compile 会读取并复制 `process.execPath` 对应的 bun.exe。
  // 开发环境的 Bun 固定在项目 `.xma/tools` 下，而用户项目目录可能包含中文；先复制到系统临时目录再启动，避免 Bun 1.3.14 在自复制阶段把 CJK 路径误判为 ENOENT。
  bunExecutable = stageBunForCompile(bun, compileTemp)
  console.log(`[xma] Bun compile temp: ${compileTemp}`)
  console.log(`[xma] Bun compile runtime: ${bunExecutable}`)
}
const result = spawnSync(bunExecutable, args, { cwd: runtimeRoot, stdio: 'inherit', shell: false, env: childEnv })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
