/**
 * 文件作用：验证 Electron Runtime 原子安装核心，避免再次把 Windows 真机当作安装器的唯一测试环境。
 * 关联模块：apps/desktop/scripts/electron-runtime-core.ts、install-electron-runtime.ts。
 * 当前实现：覆盖成功安装、解压失败清理、版本不一致三条关键路径。
 * 职责边界：测试不联网、不下载真实 Electron，只验证安装状态机与文件落地语义。
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { installElectronRuntimeArchive, resolveElectronCacheRoot, type ElectronArchiveExtractor } from '../scripts/electron-runtime-core.ts'

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'xma-electron-test-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function fakeExtractor(version: string, executableName = 'electron.exe'): ElectronArchiveExtractor {
  return async (_zipPath, { dir }) => {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'version'), version, 'utf8')
    await writeFile(path.join(dir, executableName), 'fake-binary', 'utf8')
    await writeFile(path.join(dir, 'electron.d.ts'), 'export {}', 'utf8')
  }
}

test('Electron Runtime uses verified staging then writes dist/path.txt', async () => {
  await withTempDir(async electronDir => {
    const result = await installElectronRuntimeArchive({
      zipPath: path.join(electronDir, 'electron.zip'),
      electronDir,
      version: '41.2.0',
      platformPath: 'electron.exe',
      extractArchive: fakeExtractor('41.2.0'),
    })

    assert.equal(await readFile(result.versionFile, 'utf8'), '41.2.0')
    assert.equal(await readFile(result.pathFile, 'utf8'), 'electron.exe')
    assert.ok(existsSync(result.executable))
    assert.ok(existsSync(path.join(electronDir, 'electron.d.ts')))
  })
})

test('Electron Runtime extraction failure leaves no fake installed state', async () => {
  await withTempDir(async electronDir => {
    const pathFile = path.join(electronDir, 'path.txt')
    const extractor: ElectronArchiveExtractor = async () => {
      throw new Error('simulated extraction failure')
    }

    await assert.rejects(
      installElectronRuntimeArchive({
        zipPath: path.join(electronDir, 'electron.zip'),
        electronDir,
        version: '41.2.0',
        platformPath: 'electron.exe',
        extractArchive: extractor,
      }),
      /simulated extraction failure/,
    )

    assert.equal(existsSync(path.join(electronDir, 'dist')), false)
    assert.equal(existsSync(pathFile), false)
  })
})

test('Electron Runtime replaces a stale partial dist only after staging passes validation', async () => {
  await withTempDir(async electronDir => {
    const staleDist = path.join(electronDir, 'dist')
    await mkdir(staleDist, { recursive: true })
    await writeFile(path.join(staleDist, 'version'), '40.0.0', 'utf8')
    await writeFile(path.join(electronDir, 'path.txt'), 'old-electron.exe', 'utf8')

    const result = await installElectronRuntimeArchive({
      zipPath: path.join(electronDir, 'electron.zip'),
      electronDir,
      version: '41.2.0',
      platformPath: 'electron.exe',
      extractArchive: fakeExtractor('41.2.0'),
    })

    assert.equal(await readFile(result.versionFile, 'utf8'), '41.2.0')
    assert.equal(await readFile(result.pathFile, 'utf8'), 'electron.exe')
    assert.ok(existsSync(result.executable))
    assert.equal(existsSync(path.join(staleDist, 'old-electron.exe')), false)
  })
})

test('Electron Runtime rejects a ZIP with the wrong version', async () => {
  await withTempDir(async electronDir => {
    await assert.rejects(
      installElectronRuntimeArchive({
        zipPath: path.join(electronDir, 'electron.zip'),
        electronDir,
        version: '41.2.0',
        platformPath: 'electron.exe',
        extractArchive: fakeExtractor('41.2.1'),
      }),
      /版本不一致/,
    )

    assert.equal(existsSync(path.join(electronDir, 'dist')), false)
    assert.equal(existsSync(path.join(electronDir, 'path.txt')), false)
  })
})

test('Electron download cache defaults to the XMA project instead of the user profile', async () => {
  await withTempDir(async projectRoot => {
    assert.equal(resolveElectronCacheRoot(projectRoot), path.join(projectRoot, '.cache', 'electron'))
    assert.equal(resolveElectronCacheRoot(projectRoot, 'runtime-cache'), path.join(projectRoot, 'runtime-cache'))
    assert.equal(resolveElectronCacheRoot(projectRoot, path.join(projectRoot, 'custom-cache')), path.join(projectRoot, 'custom-cache'))
  })
})
