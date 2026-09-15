#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.env.XMA_RUNTIME_ROOT || process.cwd());
const managedFiles = [
  'package.json',
  'apps/cli/opentui-runtime/package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
];

function parseArgs(argv) {
  const result = { registry: '', pnpm: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--registry') result.registry = argv[++index] || '';
    else if (value === '--pnpm') result.pnpm = argv[++index] || result.pnpm;
    else if (value === '--root') result.root = argv[++index] || '';
    else if (value === '--help' || value === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function snapshotFiles(baseRoot) {
  const snapshots = new Map();
  for (const relative of managedFiles) {
    const path = resolve(baseRoot, relative);
    if (await exists(path)) snapshots.set(relative, { exists: true, content: await readFile(path) });
    else snapshots.set(relative, { exists: false, content: null });
  }
  return snapshots;
}

async function restoreFiles(baseRoot, snapshots) {
  for (const relative of managedFiles) {
    const snapshot = snapshots.get(relative);
    const path = resolve(baseRoot, relative);
    if (snapshot?.exists) await writeFile(path, snapshot.content);
    else if (await exists(path)) await unlink(path);
  }
}

async function validateLifecyclePolicy(baseRoot) {
  const workspacePath = resolve(baseRoot, 'pnpm-workspace.yaml');
  const workspace = await readFile(workspacePath, 'utf8');
  if (/set this to true or false/i.test(workspace)) {
    throw new Error('pnpm-workspace.yaml contains unresolved allowBuilds decisions. Resolve every lifecycle package explicitly before updating runtime.');
  }
  const required = [
    /^\s*strictDepBuilds:\s*true\s*$/m,
    /^\s*bun:\s*true\s*$/m,
    /^\s*esbuild:\s*true\s*$/m,
    /^\s*electron:\s*false\s*$/m,
    /^\s*electron-winstaller:\s*false\s*$/m,
    /^\s*koffi:\s*false\s*$/m,
  ];
  if (required.some((pattern) => !pattern.test(workspace))) {
    throw new Error('pnpm lifecycle policy is incomplete. Expected strictDepBuilds=true, bun/esbuild=true, electron/electron-winstaller/koffi=false.');
  }
}

function extractLifecyclePackages(output) {
  const packages = new Set();
  const ignored = output.match(/Ignored build scripts:\s*([^\n\r]+)/gi) || [];
  for (const line of ignored) {
    const tail = line.replace(/^.*Ignored build scripts:\s*/i, '');
    for (const item of tail.split(',')) {
      const name = item.trim().replace(/@\d[^\s,]*/g, '').trim();
      if (name) packages.add(name);
    }
  }
  const decisions = output.match(/^\s*([^:\n\r]+):\s*set this to true or false\s*$/gim) || [];
  for (const line of decisions) {
    const name = line.replace(/:\s*set this to true or false\s*$/i, '').trim();
    if (name) packages.add(name);
  }
  return [...packages];
}

async function unresolvedLifecyclePolicyPackages(baseRoot) {
  const workspace = await readFile(resolve(baseRoot, 'pnpm-workspace.yaml'), 'utf8');
  const packages = [];
  for (const line of workspace.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:#]+):\s*set this to true or false\s*$/i);
    if (match) packages.push(match[1].trim());
  }
  return packages;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const isWindowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
    const executable = isWindowsBatch ? (process.env.ComSpec || 'cmd.exe') : command;
    const executableArgs = isWindowsBatch ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let output = '';
    const tee = (stream, target) => {
      stream.on('data', (chunk) => {
        output += chunk.toString();
        target.write(chunk);
      });
    };
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => resolvePromise({ code: code ?? 1, signal, output }));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/runtime/update.mjs [--registry <url>] [--pnpm <path>] [--root <path>]\n');
    return;
  }
  const baseRoot = resolve(args.root || root);
  await validateLifecyclePolicy(baseRoot);
  const snapshots = await snapshotFiles(baseRoot);
  const env = { ...process.env };
  if (args.registry) env.npm_config_registry = args.registry;

  const stages = [
    ['1/5', 'baseline install', ['install', '--no-frozen-lockfile', '--reporter=append-only']],
    ['2/5', 'Bun latest', ['--workspace-root', 'update', '--latest', 'bun', '--reporter=append-only']],
    ['3/5', 'OpenTUI / Solid latest', ['--filter', '@xma/cli-opentui-runtime', 'update', '--latest', '@opentui/core', '@opentui/solid', 'solid-js', '@types/bun', '--reporter=append-only']],
    ['4/5', 'consistency install', ['install', '--no-frozen-lockfile', '--reporter=append-only']],
    ['5/5', 'esbuild rebuild', ['rebuild', 'esbuild']],
  ];

  try {
    for (const [position, label, commandArgs] of stages) {
      process.stdout.write(`[runtime ${position}] ${label}\n`);
      const result = await runCommand(args.pnpm, commandArgs, { cwd: baseRoot, env });
      const lifecyclePackages = [...new Set([
        ...extractLifecyclePackages(result.output),
        ...await unresolvedLifecyclePolicyPackages(baseRoot),
      ])];
      if (lifecyclePackages.length > 0) {
        process.stderr.write(`[runtime policy] lifecycle packages requiring an explicit decision: ${lifecyclePackages.join(', ')}\n`);
      }
      if (result.code !== 0 || lifecyclePackages.length > 0) {
        const suffix = lifecyclePackages.length > 0 ? `; lifecycle packages: ${lifecyclePackages.join(', ')}` : '';
        throw new Error(`${args.pnpm} ${commandArgs.join(' ')} failed with exit code ${result.code}${suffix}`);
      }
      if (/ERR_PNPM_IGNORED_BUILDS/i.test(result.output)) {
        throw new Error(`pnpm reported ERR_PNPM_IGNORED_BUILDS${lifecyclePackages.length ? `: ${lifecyclePackages.join(', ')}` : ''}`);
      }
    }
    process.stdout.write('[runtime] JavaScript Runtime update completed successfully.\n');
  } catch (error) {
    await restoreFiles(baseRoot, snapshots);
    process.stderr.write('[runtime] update failed; restored package/runtime/workspace/lockfile transaction snapshot.\n');
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`[runtime] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
