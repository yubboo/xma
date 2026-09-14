#!/usr/bin/env bun
/**
 * 文件作用：把 Xiaoyu OpenTUI CLI 编译为当前平台的 Bun 单文件可执行程序。
 * 关联模块：apps/cli/src/main.ts、@opentui/solid/bun-plugin、scripts/release/cli.ts。
 * 当前实现：固定使用 OpenTUI Solid transform plugin，并把 parser worker 一并嵌入 BunFS，输出到 dist/cli/xiaoyu[.exe]。
 * 职责边界：本脚本只构建当前平台 CLI；Server/Web 仍由根 Node/tsup/Vite 构建链负责，不伪造跨平台二进制。
 */

/// <reference types="bun" />

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSolidTransformPlugin } from '@opentui/solid/bun-plugin'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const cliRoot = path.resolve(scriptDir, '..')
const root = path.resolve(cliRoot, '..', '..')
const outputDir = path.join(root, 'dist', 'cli')
const executableName = process.platform === 'win32' ? 'xiaoyu.exe' : 'xiaoyu'
const outfile = path.join(outputDir, executableName)

// 中文说明：与 MiMo Code 的 OpenTUI 构建方式保持一致，以依赖岛目录作为 Bun.build 的 cwd。
// parser.worker.js 需要按这个 cwd 的相对路径写入 BunFS，否则单文件程序启动后无法定位 worker。
process.chdir(scriptDir)

fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })

const localParserWorker = path.join(scriptDir, 'node_modules', '@opentui', 'core', 'parser.worker.js')
const rootParserWorker = path.join(root, 'node_modules', '@opentui', 'core', 'parser.worker.js')
const parserWorkerCandidate = fs.existsSync(localParserWorker) ? localParserWorker : rootParserWorker
if (!fs.existsSync(parserWorkerCandidate)) {
  throw new Error(`OpenTUI parser worker missing: ${parserWorkerCandidate}. Run xma-dev -> [1] to prepare the pinned OpenTUI runtime first.`)
}
const parserWorker = fs.realpathSync(parserWorkerCandidate)
const workerRelativePath = path.relative(scriptDir, parserWorker).replaceAll('\\', '/')
const bunfsRoot = process.platform === 'win32' ? 'B:/~BUN/root/' : '/$bunfs/root/'
function currentCompileTarget() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'bun-windows-x64' as const
  if (process.platform === 'win32' && process.arch === 'arm64') return 'bun-windows-arm64' as const
  if (process.platform === 'darwin' && process.arch === 'x64') return 'bun-darwin-x64' as const
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'bun-darwin-arm64' as const
  if (process.platform === 'linux' && process.arch === 'x64') return 'bun-linux-x64' as const
  if (process.platform === 'linux' && process.arch === 'arm64') return 'bun-linux-arm64' as const
  throw new Error(`Unsupported Bun compile target: ${process.platform}/${process.arch}`)
}

const target = currentCompileTarget()

const result = await Bun.build({
  conditions: ['browser'],
  tsconfig: path.join(root, 'tsconfig.json'),
  plugins: [createSolidTransformPlugin()],
  format: 'esm',
  minify: true,
  splitting: true,
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target,
    outfile,
    windows: {},
  },
  entrypoints: [path.join(cliRoot, 'src', 'main.ts'), parserWorker],
  define: {
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(`${bunfsRoot}${workerRelativePath}`),
  },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`[xma] OpenTUI CLI built: ${outfile}`)
