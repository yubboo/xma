/**
 * 文件作用：为 XMA 源码包生成精确的 Source Manifest，供 XMA-Sync 自动识别新增、删除与重命名源码。
 * 关联模块：scripts/windows/xma-sync.ps1、源码 ZIP 打包流程、xma-path/state/source-sync.json。
 * 当前实现：扫描当前源码树，按路径职责排除依赖/缓存/构建/运行数据，并输出 .xma-package/source-manifest.json。
 * 职责边界：Manifest 只描述源码包受管文件，不包含 .git、runtime、node_modules、.cache、dist 等本地状态，也不负责生成 ZIP。
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'

interface SourceManifest {
  formatVersion: 1
  project: 'xma'
  version: string
  files: string[]
}

const root = resolve(process.cwd())
const outputDir = join(root, '.xma-package')
const outputFile = join(outputDir, 'source-manifest.json')

const ignoredAny = new Set(['.git', 'node_modules', '.cache', 'target', '__pycache__', '.turbo'])
const ignoredRoot = new Set(['runtime', 'dist', 'build', 'release', 'xma-path', '.xma', '.xma-package', 'coverage', 'tmp', 'temp'])
const ignoredSuffixes = ['.log', '.tmp', '.bak', '.tsbuildinfo']
const allowedRootHiddenDirectories = new Set(['.agents', '.cargo', '.claude', '.codex', '.github'])

function normalize(path: string): string {
  return path.split(sep).join('/')
}

function shouldIgnore(relativePath: string, directory: boolean): boolean {
  const normalized = normalize(relativePath)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return false

  if (ignoredRoot.has(parts[0]!)) return true
  if (directory && parts.length === 1 && parts[0]!.startsWith('.') && !allowedRootHiddenDirectories.has(parts[0]!)) return true
  if (parts.some(part => ignoredAny.has(part))) return true
  if (parts.slice(0, 4).join('/') === 'apps/desktop/src-tauri/gen') return true
  if (directory && parts.some(part => part === 'dist' || part === 'build')) return true
  if (directory && parts.some((part, index) => part === 'release' && !(index === 1 && parts[0] === 'scripts'))) return true
  if (!directory && ignoredSuffixes.some(suffix => normalized.toLowerCase().endsWith(suffix))) return true
  if (basename(normalized) === 'xma-0.1.0.zip' || basename(normalized) === 'xma-0.1.0.sha256.txt') return true
  return false
}

async function collect(dir: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))

  for (const entry of entries) {
    const absolute = join(dir, entry.name)
    const rel = relative(root, absolute)
    if (shouldIgnore(rel, entry.isDirectory())) continue
    if (entry.isDirectory()) {
      await collect(absolute, files)
      continue
    }
    if (entry.isFile()) files.push(normalize(rel))
  }
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version?: string }
if (!packageJson.version) throw new Error('package.json missing version')

const files: string[] = []
await collect(root, files)
files.sort((a, b) => a.localeCompare(b, 'en'))

const manifest: SourceManifest = {
  formatVersion: 1,
  project: 'xma',
  version: packageJson.version,
  files,
}

await mkdir(outputDir, { recursive: true })
await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`XMA Source Manifest generated: ${files.length} files -> ${normalize(relative(root, outputFile))}`)
