/**
 * 文件作用：为 XMA OpenTUI CLI 定位固定 Bun Runtime，并统一源码运行与 CLI 构建入口。
 * 关联模块：xma-prepare.ps1、scripts/unix/xma-console.sh、package.json、apps/cli/opentui-runtime/build.ts。
 * 当前实现：优先使用仓库 `.xma/tools/bun/1.3.14` 的固定 Bun；CI/高级开发环境允许回退到 PATH 中同版本 Bun。
 * 职责边界：只启动 Bun/OpenTUI 前端，不安装依赖、不下载 Bun，也不改变 Agent/Native Runtime 业务行为。
 */

import { existsSync } from 'node:fs'
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
const result = spawnSync(bun, args, { cwd: runtimeRoot, stdio: 'inherit', shell: false, env: process.env })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
