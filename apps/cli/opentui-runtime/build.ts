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

fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })

const parserWorker = fs.realpathSync(Bun.resolveSync('@opentui/core/parser.worker.js', scriptDir))
const workerRelativePath = path.relative(root, parserWorker).replaceAll('\\', '/')
const bunfsRoot = process.platform === 'win32' ? 'B:/~BUN/root/' : '/$bunfs/root/'
const platformName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
const target = `bun-${platformName}-${process.arch}` as const

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
