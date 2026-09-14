/**
 * 文件作用：对 Bun/OpenTUI 编译后的 Xiaoyu CLI 做无交互发布烟测，确认可执行文件能在当前平台启动并返回正确版本。
 * 关联模块：apps/cli/opentui-runtime/build.ts、package.json、Windows/Unix 全量检查、CI/Release。
 * 当前实现：定位 dist/cli/xiaoyu[.exe]，执行 --version 与 --help，并校验退出码、项目版本和产品入口文本。
 * 职责边界：本脚本只验证编译产物可启动；Windows Terminal caret/IME、鼠标、Dialog 与真实 Provider 仍必须做交互式实机验收。
 */

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const executable = path.join(root, 'dist', 'cli', process.platform === 'win32' ? 'xiaoyu.exe' : 'xiaoyu')
const version = String((JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version)

if (!existsSync(executable)) throw new Error(`Xiaoyu CLI build missing: ${executable}`)

function run(args: string[]): string {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Xiaoyu CLI smoke failed (${args.join(' ')}): exit=${String(result.status)} stderr=${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

const reportedVersion = run(['--version'])
if (reportedVersion !== version) throw new Error(`Xiaoyu CLI version mismatch: expected ${version}, got ${reportedVersion}`)

const help = run(['--help'])
if (!help.includes(`Xiaoyu Management Agent ${version}`) || !help.includes('xiaoyu [workspace]')) {
  throw new Error('Xiaoyu CLI help smoke failed: canonical product markers are missing.')
}

console.log(`XMA OpenTUI CLI smoke PASS (${path.basename(executable)} · ${version})`)
