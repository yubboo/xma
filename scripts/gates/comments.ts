/**
 * 文件作用：检查核心 TypeScript/Rust 源码是否存在中文文件头说明。
 * 关联模块：docs/development/CODE-COMMENT-STANDARD.md。
 * 当前实现：扫描核心源码并检查中文字符与“文件作用/关联模块”标记。
 * 职责边界：只检查最低格式，不评价注释质量。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['core/src', 'packages', 'agents', 'plugins', 'apps/cli/src', 'apps/cli/opentui-runtime', 'apps/server/src', 'apps/desktop/src', 'apps/desktop/scripts', 'apps/desktop/src-tauri', 'native/protocol/src', 'native/runtime/src']
const ignoredDirectories = new Set(['node_modules', '.git', '.cache', 'dist', 'build', 'target', 'coverage'])
const files: string[] = []

function hasIgnoredSegment(path: string): boolean {
  return path.split(/[\\/]+/).some(segment => ignoredDirectories.has(segment))
}

function walk(dir: string): void {
  if (!existsSync(dir) || hasIgnoredSegment(dir)) return
  for (const name of readdirSync(dir)) {
    if (ignoredDirectories.has(name)) continue
    const path = join(dir, name)
    if (hasIgnoredSegment(path)) continue
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(ts|tsx|rs)$/.test(name)) files.push(path)
  }
}
for (const root of roots) walk(root)

const failures: string[] = []
for (const file of files) {
  const source = readFileSync(file, 'utf8').slice(0, 800)
  const hasChinese = /[\u4e00-\u9fff]/.test(source)
  const hasPurpose = source.includes('文件作用') || source.includes('文件作用：')
  if (!hasChinese || !hasPurpose) failures.push(file)
}
if (failures.length) throw new Error(`Chinese comment header missing:\n${failures.join('\n')}`)
console.log(`XMA Chinese Comment Gate PASS (${files.length} source files)`) 
