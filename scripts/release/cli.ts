/**
 * 文件作用：生成 XMA `xiaoyu` 跨平台 CLI/Server/Web portable staging，供平台发布脚本压缩成最终安装资产。
 * 关联模块：dist/cli、dist/server、dist/web、native/runtime、scripts/install、release manifest。
 * 当前实现：复制内置 Node Runtime、CLI/Server/Web、Rust Native Kernel、xiaoyu/xma launcher 与 VERSION 到 `.cache/release/cli`。
 * 职责边界：本文件只生成当前平台 staging；ZIP/tar.gz、签名、公证和各平台安装包必须由对应平台发布流程完成。
 */

import { chmod, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { arch, platform } from 'node:process'
import path from 'node:path'

const root = process.cwd()
const version = String((JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version)

function productOs(): 'windows' | 'linux' | 'macos' {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'
  throw new Error(`Unsupported XMA release platform: ${platform}`)
}

function productArch(): 'x64' | 'arm64' {
  if (arch === 'x64' || arch === 'arm64') return arch
  throw new Error(`Unsupported XMA release architecture: ${arch}`)
}

const os = productOs()
const cpu = productArch()
const artifactStem = `xiaoyu-${os}-${cpu}`
const stageRoot = path.join(root, '.cache', 'release', 'cli', artifactStem)
const cliBuild = path.join(root, 'dist', 'cli', 'main.js')
const serverBuild = path.join(root, 'dist', 'server', 'main.js')
const webBuild = path.join(root, 'dist', 'web')
const nativeName = os === 'windows' ? 'xma-native-runtime.exe' : 'xma-native-runtime'
const nativeBuild = path.join(root, '.cache', 'cargo-target', 'release', nativeName)
const nodeName = os === 'windows' ? 'node.exe' : 'node'

for (const required of [cliBuild, serverBuild, webBuild, nativeBuild, process.execPath]) {
  if (!existsSync(required)) throw new Error(`XMA portable release input missing: ${required}`)
}

await rm(stageRoot, { recursive: true, force: true })
for (const dir of ['bin', 'runtime', 'app', 'web', 'native']) await mkdir(path.join(stageRoot, dir), { recursive: true })

await cp(cliBuild, path.join(stageRoot, 'app', 'cli.js'))
await cp(serverBuild, path.join(stageRoot, 'app', 'server.js'))
await cp(webBuild, path.join(stageRoot, 'web'), { recursive: true })
await cp(process.execPath, path.join(stageRoot, 'runtime', nodeName))
await cp(nativeBuild, path.join(stageRoot, 'native', nativeName))
await writeFile(path.join(stageRoot, 'VERSION'), `${version}\n`, 'utf8')
await writeFile(path.join(stageRoot, 'bundle.json'), `${JSON.stringify({ schemaVersion: 1, product: 'xiaoyu', version, os, arch: cpu }, null, 2)}\n`, 'utf8')

if (os === 'windows') {
  const launcher = '@echo off\r\nset "XIAOYU_HOME=%~dp0.."\r\nset "XIAOYU_NATIVE_RUNTIME=%XIAOYU_HOME%\\native\\xma-native-runtime.exe"\r\n"%XIAOYU_HOME%\\runtime\\node.exe" "%XIAOYU_HOME%\\app\\cli.js" %*\r\n'
  await writeFile(path.join(stageRoot, 'bin', 'xiaoyu.cmd'), launcher, 'utf8')
  await writeFile(path.join(stageRoot, 'bin', 'xma.cmd'), launcher, 'utf8')
} else {
  const launcher = '#!/bin/sh\nset -eu\nXIAOYU_HOME="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexport XIAOYU_HOME\nexport XIAOYU_NATIVE_RUNTIME="$XIAOYU_HOME/native/xma-native-runtime"\nexec "$XIAOYU_HOME/runtime/node" "$XIAOYU_HOME/app/cli.js" "$@"\n'
  for (const name of ['xiaoyu', 'xma']) {
    const launcherPath = path.join(stageRoot, 'bin', name)
    await writeFile(launcherPath, launcher, 'utf8')
    await chmod(launcherPath, 0o755)
  }
  await chmod(path.join(stageRoot, 'runtime', nodeName), 0o755)
  await chmod(path.join(stageRoot, 'native', nativeName), 0o755)
}

const stageInfo = {
  schemaVersion: 1,
  product: 'xiaoyu',
  version,
  os,
  arch: cpu,
  artifactStem,
  stageRoot,
  archiveName: `${artifactStem}.${os === 'windows' ? 'zip' : 'tar.gz'}`,
}
const infoPath = path.join(root, '.cache', 'release', 'cli', 'stage.json')
await writeFile(infoPath, `${JSON.stringify(stageInfo, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(stageInfo))
