/**
 * 文件作用：强制 XMA 的版本格式、百补丁进位规则和多包版本一致性。
 * 关联模块：package.json、apps/<app>/package.json、native/<crate>/Cargo.toml、版本发布文档。
 * 当前实现：验证 major.minor.patch、patch<=100，并要求第一阶段所有内置应用/Native crate 与根版本一致。
 * 职责边界：Gate 不自动升级版本，版本升级必须由开发计划明确决定。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: string }
const version = rootPackage.version ?? ''
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
if (!match) throw new Error(`XMA version must be plain major.minor.patch: ${version}`)
const patch = Number(match[3])
if (patch < 0 || patch > 100) throw new Error(`XMA patch must stay in 0..100 before minor rollover: ${version}`)

for (const app of readdirSync('apps')) {
  const packagePath = join('apps', app, 'package.json')
  try {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string }
    if (pkg.version !== version) throw new Error(`${packagePath} version ${pkg.version} != root ${version}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
    throw error
  }
}

for (const crate of ['native/protocol/Cargo.toml', 'native/runtime/Cargo.toml']) {
  const source = readFileSync(crate, 'utf8')
  const crateVersion = /^version\s*=\s*"([^"]+)"/m.exec(source)?.[1]
  if (crateVersion !== version) throw new Error(`${crate} version ${crateVersion} != root ${version}`)
}

console.log(`XMA Version Gate PASS (${version})`)
