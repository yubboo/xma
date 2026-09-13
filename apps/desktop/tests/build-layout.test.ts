/**
 * 文件作用：锁定 XMA Desktop 构建目录合同，避免中间产物重新散落到 apps/desktop 或仓库根 build/target。
 * 关联模块：apps/desktop/package.json、scripts/electron/build.ts、tauri.conf.json、electron-builder.json。
 * 当前实现：验证 Electron/Tauri staging 全部进入 .cache/desktop，最终 Electron 发布物进入 dist/release/electron。
 * 职责边界：这里只验证目录/脚本 Contract，不实际启动 Electron/Tauri 或下载 Runtime。
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

test('Desktop build scripts use .cache for staging and never app-local dist/web/release', async () => {
  const pkg = await readJson<{ scripts: Record<string, string> }>('apps/desktop/package.json')
  const allScripts = Object.values(pkg.scripts).join('\n').replaceAll('\\', '/')

  assert.match(pkg.scripts['main:build:dev'] ?? '', /\.cache\/desktop\/electron\/dev\/main/)
  assert.match(pkg.scripts['web:build:tauri'] ?? '', /\.cache\/desktop\/tauri\/web/)
  assert.doesNotMatch(allScripts, /apps\/desktop\/(dist|web|release|native)(?:\/|\b)/)
})

test('Electron build stages in .cache and publishes only to dist/release/electron', async () => {
  const source = await readFile('apps/desktop/scripts/electron/build.ts', 'utf8')
  assert.match(source, /'\.cache', 'desktop', 'electron', 'app'/)
  assert.match(source, /'dist', 'release', 'electron'/)
  assert.match(source, /'--base', '\.\/'/)
  assert.match(source, /'--emptyOutDir'/)
  assert.match(source, /ELECTRON_CACHE: electronCache/)
  assert.match(source, /ELECTRON_BUILDER_CACHE: builderCache/)

  const config = await readJson<{ files: string[]; electronVersion: string }>('apps/desktop/electron-builder.json')
  assert.equal(config.electronVersion, '41.2.0')
  assert.deepEqual(config.files, ['main/**', 'web/**', 'package.json'])
})

test('Tauri frontend staging uses the shared .cache desktop area', async () => {
  const config = await readJson<{ build: { beforeBuildCommand: string; frontendDist: string } }>('apps/desktop/src-tauri/tauri.conf.json')
  assert.equal(config.build.beforeBuildCommand, 'pnpm run web:build:tauri')
  assert.equal(config.build.frontendDist, '../../../.cache/desktop/tauri/web')
})
