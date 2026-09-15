import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const updater = fileURLToPath(new URL('./update.mjs', import.meta.url));

async function makeRepo(mode) {
  const root = await mkdtemp(join(tmpdir(), 'xma-runtime-test-'));
  await mkdir(join(root, 'bin'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"name":"xma","devDependencies":{"bun":"1.4.2","@opentui/core":"0.5.11","@opentui/solid":"0.5.11","solid-js":"1.9.15","@types/bun":"1.4.2"}}\n');
  await writeFile(join(root, 'pnpm-workspace.yaml'), `packages:
  - "apps/*"
allowBuilds:
  bun: true
  electron: false
  electron-winstaller: false
  esbuild: true
  koffi: false
strictDepBuilds: true
`);
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\ninitial: true\n');

  const fakeScript = join(root, 'bin', 'fake-pnpm.mjs');
  await writeFile(fakeScript, `import fs from 'node:fs'; import path from 'node:path';
const root=process.cwd(); const log=path.join(root,'calls.log'); fs.appendFileSync(log, process.argv.slice(2).join(' ')+'\\n');
const calls=fs.readFileSync(log,'utf8').trim().split(/\\n/).length;
fs.writeFileSync(path.join(root,'pnpm-lock.yaml'),'lockfileVersion: 9.0\\ncall: '+calls+'\\n');
if (${JSON.stringify(mode)} === 'fail' && calls === 1) {
  fs.writeFileSync(path.join(root,'package.json'),'README changed\\n');
  console.error('[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: mystery-native@1.2.3');
  process.exit(1);
}
`);

  let fake;
  if (process.platform === 'win32') {
    fake = join(root, 'bin', 'pnpm.cmd');
    const node = process.execPath.replaceAll('"', '""');
    await writeFile(fake, `@echo off\r\n"${node}" "%~dp0fake-pnpm.mjs" %*\r\n`);
  } else {
    fake = join(root, 'bin', 'pnpm');
    const node = process.execPath.replaceAll("'", "'\\''");
    await writeFile(fake, `#!/bin/sh\nexec '${node}' "$(dirname "$0")/fake-pnpm.mjs" "$@"\n`);
    await chmod(fake, 0o755);
  }
  return { root, fake };
}

function run(root, fake) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [updater, '--root', root, '--pnpm', fake, '--registry', 'https://registry.example.invalid'], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

test('refreshes Bun and OpenTUI/Solid together from the root workspace', async () => {
  const { root, fake } = await makeRepo('success');
  const result = await run(root, fake);
  assert.equal(result.code, 0, result.stderr);
  const calls = (await readFile(join(root, 'calls.log'), 'utf8')).trim().split(/\n/);
  assert.deepEqual(calls, [
    '--workspace-root update --latest bun @opentui/core @opentui/solid solid-js @types/bun --reporter=append-only',
  ]);
  assert.match(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8'), /call: 1/);
});

test('restores managed files when explicit runtime refresh fails', async () => {
  const { root, fake } = await makeRepo('fail');
  const before = {};
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    before[file] = await readFile(join(root, file), 'utf8');
  }
  const result = await run(root, fake);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ERR_PNPM_IGNORED_BUILDS/);
  assert.match(result.stderr, /mystery-native/);
  assert.match(result.stderr, /restored .* transaction snapshot/i);
  for (const [file, content] of Object.entries(before)) {
    assert.equal(await readFile(join(root, file), 'utf8'), content, file);
  }
});
