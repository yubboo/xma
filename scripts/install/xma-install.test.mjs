/**
 * 文件作用：对 Linux/macOS 普通用户 bootstrap 做行为级安装、覆盖升级与卸载回归，避免发行合同只剩静态字符串检查。
 * 关联模块：scripts/install/xma-install.sh、scripts/gates/distribution.ts、GitHub Release portable assets。
 * 当前实现：使用临时本地 Release 服务器和最小 portable fixture，真实执行 SHA-256 校验、原子替换、命令链接与卸载清理。
 * 职责边界：fixture 不冒充真实平台二进制；真实 `xiaoyu --version/doctor/TUI` 仍由原生 Runner 的 Release E2E 验证。
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..', '..')
const installer = path.join(root, 'scripts', 'install', 'xma-install.sh')

function platformTuple() {
  const osName = process.platform === 'linux' ? 'linux' : process.platform === 'darwin' ? 'macos' : null
  const archName = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null
  return { osName, archName }
}

async function executable(file, body = '#!/bin/sh\nexit 0\n') {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  await chmod(file, 0o755)
}

async function buildFixture(releaseRoot, version = '0.1.0-test') {
  const { osName, archName } = platformTuple()
  assert.ok(osName && archName)
  const bundle = path.join(releaseRoot, 'bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(path.join(bundle, 'VERSION'), `${version}\n`)
  await executable(path.join(bundle, 'bin', 'xiaoyu'))
  await executable(path.join(bundle, 'bin', 'xma'))
  await executable(path.join(bundle, 'runtime', 'node'))
  await executable(path.join(bundle, 'app', 'xiaoyu'))
  await executable(path.join(bundle, 'native', 'xma-native-runtime'))

  const artifact = `xiaoyu-${osName}-${archName}.tar.gz`
  const archive = path.join(releaseRoot, artifact)
  const tar = spawnSync('tar', ['-czf', archive, '-C', bundle, '.'], { encoding: 'utf8' })
  assert.equal(tar.status, 0, tar.stderr)
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
  await writeFile(path.join(releaseRoot, 'checksums.txt'), `${digest}  ${artifact}\n`)
  return artifact
}

async function runInstaller(args, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn('sh', [installer, ...args], { cwd: root, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

async function exists(file) {
  try { await lstat(file); return true } catch { return false }
}

test('Unix bootstrap installs, atomically replaces, and uninstalls managed commands', { skip: process.platform === 'win32' }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'xiaoyu-installer-test-'))
  const releaseRoot = path.join(temp, 'release')
  const installRoot = path.join(temp, 'data', 'xiaoyu')
  const binHome = path.join(temp, 'bin')
  await mkdir(releaseRoot, { recursive: true })
  await buildFixture(releaseRoot)

  const server = createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname.slice(1))
      const file = path.join(releaseRoot, name)
      const body = await readFile(file)
      response.writeHead(200, { 'content-length': String(body.length) })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end('not found')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const env = {
    ...process.env,
    HOME: temp,
    XDG_DATA_HOME: path.join(temp, 'data'),
    XDG_BIN_HOME: binHome,
    XIAOYU_INSTALL_DIR: installRoot,
    XIAOYU_RELEASE_BASE: `http://127.0.0.1:${address.port}`,
    XIAOYU_ALLOW_INSECURE_TEST_BASE: '1',
  }

  try {
    const first = await runInstaller([], env)
    assert.equal(first.code, 0, first.stderr)
    assert.match(first.stdout, /Xiaoyu 0\.1\.0-test 已安装/)
    assert.equal(await readlink(path.join(binHome, 'xiaoyu')), path.join(installRoot, 'bin', 'xiaoyu'))
    assert.equal(await readlink(path.join(binHome, 'xma')), path.join(installRoot, 'bin', 'xma'))

    await writeFile(path.join(installRoot, 'stale-marker'), 'old')
    const second = await runInstaller([], env)
    assert.equal(second.code, 0, second.stderr)
    assert.equal(await exists(path.join(installRoot, 'stale-marker')), false, 'upgrade must replace the previous program directory')

    const uninstall = await runInstaller(['--uninstall'], env)
    assert.equal(uninstall.code, 0, uninstall.stderr)
    assert.match(uninstall.stdout, /已从当前用户卸载/)
    assert.equal(await exists(installRoot), false)
    assert.equal(await exists(path.join(binHome, 'xiaoyu')), false)
    assert.equal(await exists(path.join(binHome, 'xma')), false)
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(temp, { recursive: true, force: true })
  }
})

test('Unix bootstrap refuses to overwrite an unrelated command entry', { skip: process.platform === 'win32' }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'xiaoyu-installer-slot-test-'))
  const binHome = path.join(temp, 'bin')
  await mkdir(binHome, { recursive: true })
  const foreignTarget = path.join(temp, 'foreign-xiaoyu')
  await writeFile(foreignTarget, 'foreign')
  await symlink(foreignTarget, path.join(binHome, 'xiaoyu'))
  const env = {
    ...process.env,
    HOME: temp,
    XDG_BIN_HOME: binHome,
    XIAOYU_INSTALL_DIR: path.join(temp, 'install'),
    XIAOYU_RELEASE_BASE: 'http://127.0.0.1:9',
    XIAOYU_ALLOW_INSECURE_TEST_BASE: '1',
  }
  try {
    const result = await runInstaller([], env)
    assert.equal(result.code, 6)
    assert.match(result.stderr, /命令入口已被其他程序占用/)
    assert.equal(await readlink(path.join(binHome, 'xiaoyu')), foreignTarget)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
