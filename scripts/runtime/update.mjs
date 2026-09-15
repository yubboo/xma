import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const managedFiles = [
  'package.json',
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
  const workspace = await readFile(resolve(baseRoot, 'pnpm-workspace.yaml'), 'utf8');
  if (/set this to true or false/i.test(workspace)) {
    throw new Error('pnpm-workspace.yaml contains unresolved allowBuilds decisions.');
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
    throw new Error('pnpm lifecycle policy is incomplete.');
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
    ['1/1', 'Bun / OpenTUI / Solid latest', ['--workspace-root', 'update', '--latest', 'bun', '@opentui/core', '@opentui/solid', 'solid-js', '@types/bun', '--reporter=append-only']],
  ];

  process.stdout.write('[runtime] Refreshing XMA managed JavaScript Runtime packages from the root workspace. Workspace install belongs to [1].\n');
  try {
    for (const [position, label, commandArgs] of stages) {
      process.stdout.write(`[runtime ${position}] ${label}\n`);
      const result = await runCommand(args.pnpm, commandArgs, { cwd: baseRoot, env });
      const lifecyclePackages = extractLifecyclePackages(result.output);
      if (lifecyclePackages.length > 0) {
        process.stderr.write(`[runtime policy] lifecycle packages requiring an explicit decision: ${lifecyclePackages.join(', ')}\n`);
      }
      if (result.code !== 0 || lifecyclePackages.length > 0 || /ERR_PNPM_IGNORED_BUILDS/i.test(result.output)) {
        throw new Error(`${args.pnpm} ${commandArgs.join(' ')} failed with exit code ${result.code}${lifecyclePackages.length ? `; lifecycle packages: ${lifecyclePackages.join(', ')}` : ''}`);
      }
    }
    process.stdout.write('[runtime] Managed JavaScript Runtime refresh completed successfully.\n');
  } catch (error) {
    await restoreFiles(baseRoot, snapshots);
    process.stderr.write('[runtime] refresh failed; restored package/workspace/lockfile transaction snapshot.\n');
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`[runtime] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
