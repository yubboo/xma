/**
 * 文件作用：为 `xiaoyu` 一键安装器生成跨平台 Release Manifest 与 checksums.txt。
 * 关联模块：scripts/release/cli.ts、scripts/install/windows.ps1、scripts/install/unix.sh、GitHub Releases。
 * 当前实现：扫描 `dist/release` 的 xiaoyu-<os>-<arch> 归档，计算 SHA-256，并生成统一可下载资产目录。
 * 职责边界：Manifest 只描述已生成资产；不能替代平台签名、公证，也不能把源码包伪装成用户安装包。
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function argument(name: string, fallback?: string): string {
  const prefix = `--${name}=`
  const value = process.argv.slice(2).find(item => item.startsWith(prefix))?.slice(prefix.length)
  if (value) return value
  if (fallback !== undefined) return fallback
  throw new Error(`Missing ${prefix}<value>`)
}

const directory = path.resolve(argument('directory', 'dist/release'))
const version = argument('version')
const baseUrl = argument('base-url').replace(/\/+$/, '')
const matcher = /^xiaoyu-(windows|linux|macos)-(x64|arm64)\.(zip|tar\.gz)$/

const artifacts = readdirSync(directory)
  .map(file => ({ file, match: file.match(matcher) }))
  .filter((item): item is { file: string; match: RegExpMatchArray } => item.match !== null)
  .map(({ file, match }) => {
    const bytes = readFileSync(path.join(directory, file))
    return {
      kind: 'cli-portable' as const,
      os: match[1]!,
      arch: match[2]!,
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      url: `${baseUrl}/${file}`,
    }
  })
  .sort((a, b) => a.file.localeCompare(b.file))

if (artifacts.length === 0) throw new Error(`No Xiaoyu portable release archives found in ${directory}`)

const manifest = { schemaVersion: 1, product: 'xiaoyu', version, artifacts }
writeFileSync(path.join(directory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
writeFileSync(path.join(directory, 'checksums.txt'), `${artifacts.map(item => `${item.sha256}  ${item.file}`).join('\n')}\n`, 'utf8')
console.log(`Xiaoyu release manifest: ${path.join(directory, 'release-manifest.json')}`)
for (const artifact of artifacts) console.log(`SHA-256 ${artifact.file}: ${artifact.sha256}`)
