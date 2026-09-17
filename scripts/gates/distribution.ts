/**
 * 文件作用：检查 Xiaoyu 终端发行层、跨平台安装脚本与 portable bundle 合同，防止普通用户安装流程退回源码开发模式。
 * 关联模块：apps/cli、scripts/install、scripts/release、xma-build-release.ps1、docs/architecture/DISTRIBUTION.md。
 * 当前实现：锁定 xiaoyu 主命令、xma 兼容别名、预构建 Runtime bundle、SHA-256 安装、每用户路径和禁止 pnpm/cargo 源码安装。
 * 职责边界：Gate 只验证静态发行合同；真实签名、公证、GitHub Release 上传与跨 OS 安装仍必须由对应平台 E2E 验证。
 */

import { existsSync, readFileSync } from 'node:fs'

function text(file: string): string {
  if (!existsSync(file)) throw new Error(`XMA Distribution Gate missing file: ${file}`)
  return readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
}

const rootPackage = JSON.parse(text('package.json')) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> }
const cliPackage = JSON.parse(text('apps/cli/package.json')) as { dependencies?: Record<string, string> }
const openTuiSourcePackage = JSON.parse(text('apps/cli/opentui-runtime/package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
const expectedRuntimeVersions: Record<string, string> = {
  bun: '1.4.2',
  '@opentui/core': '0.5.11',
  '@opentui/solid': '0.5.11',
  'solid-js': '1.9.15',
  '@types/bun': '1.4.2',
}
for (const [name, version] of Object.entries(expectedRuntimeVersions)) {
  if (rootPackage.devDependencies?.[name] !== version) throw new Error(`Xiaoyu root JavaScript Runtime version mismatch: ${name} must be ${version}.`)
}
if (openTuiSourcePackage.dependencies || openTuiSourcePackage.devDependencies) throw new Error('apps/cli/opentui-runtime is source-only and must not own a nested dependency island.')
const workspaceSource = text('pnpm-workspace.yaml')
if (workspaceSource.includes('apps/cli/opentui-runtime')) throw new Error('OpenTUI source folder must not be a nested pnpm workspace package; dependencies belong to the root package.json/node_modules.')
if (rootPackage.scripts?.['runtime:update'] !== 'node scripts/runtime/update.mjs') throw new Error('Managed JS Runtime must use the single transactional updater entry.')
if (!(rootPackage.scripts?.check ?? '').includes('pnpm test:runtime')) throw new Error('pnpm check must include Runtime updater transaction tests.')
if (rootPackage.scripts?.['test:install'] !== 'node --test scripts/install/xma-install.test.mjs') throw new Error('XMA Unix installer behavior test entry is missing.')
if (!(rootPackage.scripts?.check ?? '').includes('pnpm test:install')) throw new Error('pnpm check must include Unix installer behavior tests.')
if (rootPackage.scripts?.['test:opentui-renderer'] !== 'bun test apps/cli/opentui-runtime/tests') throw new Error('OpenTUI native Renderer tests must run through the project-pinned Bun runtime.')
if (!(rootPackage.scripts?.check ?? '').includes('pnpm test:opentui-renderer')) throw new Error('pnpm check must include Bun-native OpenTUI Renderer tests.')
if ((rootPackage.scripts?.test ?? '').includes('opentui-renderer')) throw new Error('Node/tsx generic tests must not execute Bun-native OpenTUI Renderer tests.')
const runtimeUpdater = text('scripts/runtime/update.mjs')
for (const marker of ['Bun / OpenTUI / Solid latest', '--workspace-root', 'Workspace install belongs to [1]', 'restored package/workspace/lockfile transaction snapshot', 'ERR_PNPM_IGNORED_BUILDS']) {
  if (!runtimeUpdater.includes(marker)) throw new Error(`Managed JS Runtime updater contract missing: ${marker}`)
}
for (const marker of ['strictDepBuilds: true', 'electron: false', 'electron-winstaller: false', 'koffi: false']) {
  if (!workspaceSource.includes(marker)) throw new Error(`pnpm lifecycle policy marker missing: ${marker}`)
}
if (cliPackage.dependencies?.['@earendil-works/pi-tui'] !== '0.74.0') throw new Error('Legacy Workspace Trust/test compatibility still pins Pi TUI until the compatibility layer is retired.')
if (rootPackage.scripts?.['build:cli'] !== 'tsx scripts/cli/bun.ts build') throw new Error('Xiaoyu portable CLI must build through the pnpm-managed Bun/OpenTUI runner.')
if (rootPackage.scripts?.['smoke:cli'] !== 'tsx scripts/cli/smoke.ts') throw new Error('Xiaoyu compiled OpenTUI CLI must keep a canonical no-TTY smoke test.')
if (!(rootPackage.scripts?.test ?? '').includes('apps/cli/tests/*.test.ts')) throw new Error('XMA tests must include apps/cli/tests.')
if (rootPackage.scripts?.['release:cli-stage'] !== 'tsx scripts/release/cli.ts') throw new Error('XMA portable CLI staging script is missing.')
if (!(rootPackage.scripts?.check ?? '').includes('pnpm gate:distribution')) throw new Error('pnpm check must include Distribution Gate.')

const cli = text('apps/cli/src/main.ts')
for (const marker of [
  'const AGENT_ID = codeAgent.id',
  'confirmWorkspaceTrust',
  'JsonlSessionStore',
  'AgentRegistry',
  'SkillLoader',
  'SkillRegistry',
  'createAgentSkillContextSource',
  'XIAOYU_SKILLS_HOME',
  'WorkspaceRegistry',
  'StdioNativeClient',
  'registerNativeTools',
  'allowedPrograms: []',
  'ToolApprovalProvider',
  "command: 'server'",
  "command: 'web'",
]) {
  if (!cli.includes(marker)) throw new Error(`XMA terminal runtime marker missing: ${marker}`)
}

const tui = text('apps/cli/src/tui.ts')
for (const marker of ['访问工作区：', '安全确认：', '是的，我信任此目录', '本次授权不会跳过下次启动确认', '高风险工作区', 'confirmWorkspaceTrust', 'SafePromptInput']) {
  if (!tui.includes(marker)) throw new Error(`XMA Workspace Trust / legacy TUI contract missing: ${marker}`)
}
const openTui = text('apps/cli/opentui-runtime/app.tsx')
const openTuiPrompt = text('apps/cli/opentui-runtime/ui/prompt-dock.tsx')
const openTuiDialogs = text('apps/cli/opentui-runtime/ui/dialogs.tsx')
const openTuiBackground = text('apps/cli/opentui-runtime/ui/background-sky.tsx')
const openTuiTranscript = text('apps/cli/opentui-runtime/ui/transcript-viewport.tsx')
const openTuiLayout = text('apps/cli/src/opentui-layout.ts')
for (const marker of ['openTuiContentWidth', 'openTuiSidePadding']) {
  if (!openTuiLayout.includes(marker)) throw new Error(`XMA OpenTUI responsive layout marker missing: ${marker}`)
}
for (const marker of [
  'createCliRenderer', 'useKeyboard', 'useTerminalDimensions',
  "event.name === 'escape'", "event.ctrl && event.name === 'p'", "event.ctrl && event.name === 'k'",
  'commandPaletteOptions()', '模型 / 提供方', '连接测试', '选择真实模型', '终端设置',
  'enableMouseMovement: false', 'useMouse: true',
]) {
  if (!openTui.includes(marker)) throw new Error(`XMA active OpenTUI parent marker missing: ${marker}`)
}
for (const marker of ['TextareaRenderable', 'cursorColor={COLOR.text}', "cursorStyle={{ style: 'block', blinking: true }}", 'showCursor={true}', "event.name !== 'tab'", 'placeholder="输入消息…（/ + 字母 查找命令）"']) {
  if (!openTuiPrompt.includes(marker)) throw new Error(`XMA PromptDock marker missing: ${marker}`)
}
for (const marker of ['Tool Approval', "event.name === 'escape'"]) {
  if (!openTuiDialogs.includes(marker)) throw new Error(`XMA OpenTUI dialog marker missing: ${marker}`)
}
for (const marker of ['stickyScroll={true}', 'stickyStart="bottom"', 'height="100%"', 'minHeight={0}']) {
  if (!openTuiTranscript.includes(marker)) throw new Error(`XMA Transcript viewport marker missing: ${marker}`)
}
for (const marker of ['id="xiaoyu-transcript-slot"', 'height={0}', 'flexBasis={0}', 'flexGrow={1}', 'flexShrink={1}', 'overflow="hidden"']) {
  if (!openTui.includes(marker)) throw new Error(`XMA bounded Transcript slot marker missing: ${marker}`)
}
if (!text('apps/cli/opentui-runtime/tests/opentui-layout.test.ts').includes('scrollHeight > scroll.viewport.height')) {
  throw new Error('XMA must keep a behavior-level OpenTUI layout test that proves long Transcript content creates a real scroll range.')
}
for (const forbidden of ['CURSOR_MARKER', 'terminalMouseCaptureSequence', 'terminalMouseReleaseSequence', 'new toolkit.TUI(', '\u001b[?25l']) {
  if (openTui.includes(forbidden)) throw new Error(`XMA active OpenTUI renderer must not reintroduce legacy manual terminal cursor/mouse control: ${forbidden}`)
}
if (!openTui.includes('focused={dialog() === undefined && !setupFlow().active}') ||
    !openTuiPrompt.includes('cursorColor={COLOR.text}') ||
    !openTuiPrompt.includes("cursorStyle={{ style: 'block', blinking: true }}") ||
    !openTuiPrompt.includes('showCursor={true}')) {
  throw new Error('XMA active OpenTUI must let the focused PromptDock Textarea own the native terminal cursor.')
}
if (/promptCursorVisible|setPromptCursorVisible/.test(openTui) || /onAnimationFrame/.test(openTuiBackground) || /onAnimationFrame=/.test(openTui)) {
  throw new Error('Decoration animation must not drive parent Prompt cursor visibility/render state.')
}
const activeMountStart = openTui.indexOf("onMount(() => {\n    process.title = 'Xiaoyu'")
const activeMountEnd = openTui.indexOf('  return (', activeMountStart)
if (activeMountStart < 0 || /renderer\.setCursorPosition\(0, 0, false\)/.test(openTui.slice(activeMountStart, activeMountEnd))) {
  throw new Error('XMA active workbench animation must never globally force the terminal cursor to (0,0); the focused editor owns cursor position.')
}
if (!/terminalMouseReleaseSequence\}\$\{reset\}\$\{clearScreen\}\$\{showHardwareCursor/.test(tui) || /accepted \? hideHardwareCursor : showHardwareCursor/.test(tui)) {
  throw new Error('Workspace Trust must restore the terminal cursor before handing control to OpenTUI so Textarea can own focus/IME.')
}
if (!cli.includes('return Boolean(activeProfile) && (activeView()?.credentialReady ?? true)')) {
  throw new Error('Terminal model readiness must be based on configured active profile + credential readiness, not a mandatory connection probe.')
}
if (/get providerReady\(\) \{[\s\S]{0,320}brainProbeReadiness/.test(cli)) {
  throw new Error('Connection probe state must not gate the user-facing model-ready status.')
}
if (/const modelSelected = await selectModel\(initialSetup\)[\s\S]{0,900}await probe\(\)/.test(openTui)) {
  throw new Error('First-run Provider setup must not require a connection probe after model selection.')
}
const bunRunner = text('scripts/cli/bun.ts')
for (const marker of [
  "const runtimeRoot = path.join(root, 'apps', 'cli', 'opentui-runtime')",
  "['run', '--no-install', '../src/main.ts'",
  'cwd: runtimeRoot',
]) {
  if (!bunRunner.includes(marker)) throw new Error(`XMA Bun/OpenTUI runner contract missing: ${marker}`)
}
if (bunRunner.includes("['--cwd'")) throw new Error('XMA Bun/OpenTUI runner must use process cwd instead of the broken bun --cwd argument ordering.')

const openTuiBuild = text('apps/cli/opentui-runtime/build.ts')
for (const marker of ['createSolidTransformPlugin', 'parser.worker.js', 'OTUI_TREE_SITTER_WORKER_PATH', "'process.env.OPENTUI_LIBC'", "JSON.stringify('glibc')", "outfile", "xiaoyu.exe"]) {
  if (!openTuiBuild.includes(marker)) throw new Error(`XMA OpenTUI Bun build marker missing: ${marker}`)
}
const tuiMenu = text('apps/cli/src/tui-menu.ts')
for (const marker of ['filterTuiMenuItems', 'moveTuiMenuSelection', 'projectTuiMenu', 'labelWidth', 'descriptionWidth', 'shortcutWidth']) {
  if (!tuiMenu.includes(marker)) throw new Error(`XMA TUI menu grid marker missing: ${marker}`)
}

for (const marker of ['USER_CANCEL_EXIT_CODE = 0', '已取消：未授权当前工作区。', "await import('../opentui-runtime/app.tsx')"]) {
  if (!cli.includes(marker)) throw new Error(`XMA terminal clean-cancel/OpenTUI load contract missing: ${marker}`)
}

const brain = text('apps/cli/src/brain.ts')
for (const marker of ['TerminalBrainStore', "'brain.json'", 'credentialEnv', 'profileToProvider', 'XIAOYU_BASE_URL', 'XIAOYU_MODEL', 'XIAOYU_API_KEY']) {
  if (!brain.includes(marker)) throw new Error(`XMA Terminal Brain config marker missing: ${marker}`)
}
if (brain.includes('apiKey:') || brain.includes('api_key:')) throw new Error('XMA Terminal Brain config must persist credential references, never API Key Secret fields.')

const stage = text('scripts/release/cli.ts')
for (const marker of [
  "'.cache', 'release', 'cli'",
  "'runtime', nodeName",
  "'app', cliName",
  "'app', 'server.js'",
  "'native', nativeName",
  "path.join(root, 'skills')",
  "'skills'",
  'XIAOYU_SKILLS_HOME',
  "'web'",
  "'bin', 'xiaoyu.cmd'",
  "'bin', 'xma.cmd'",
  "for (const name of ['xiaoyu', 'xma'])",
]) {
  if (!stage.includes(marker)) throw new Error(`XMA portable bundle marker missing: ${marker}`)
}


const sourceDevWindows = text('xma-dev.bat')
for (const marker of ['%~dp0', 'scripts\\windows\\xma-console.ps1']) {
  if (!sourceDevWindows.includes(marker)) throw new Error(`XMA Windows source-development launcher marker missing: ${marker}`)
}
const sourceDevUnix = text('xma-dev')
for (const marker of ['dirname -- "$0"', 'scripts/unix/xma-console.sh']) {
  if (!sourceDevUnix.includes(marker)) throw new Error(`XMA Unix source-development launcher marker missing: ${marker}`)
}
const unixDevConsole = text('scripts/unix/xma-console.sh')
for (const marker of ['prepare_environment', 'start_web', 'start_desktop', 'start_cli', 'full_check', './xma-dev [prepare|web|desktop|cli|check]']) {
  if (!unixDevConsole.includes(marker)) throw new Error(`XMA Unix source-development console marker missing: ${marker}`)
}
if (!unixDevConsole.includes('pnpm install')) throw new Error('Unix prepare must delegate Workspace dependency sync to pnpm install.')
if (!unixDevConsole.includes('node scripts/runtime/update.mjs')) throw new Error('Unix explicit Runtime refresh helper must use scripts/runtime/update.mjs.')
if (existsSync('XMA.bat') || existsSync('xma.bat')) throw new Error('XMA source-development launcher must not occupy xma.bat/XMA.bat; installed product owns the xma command name.')

const windowsBytes = readFileSync('scripts/install/xma-install.ps1')
if (!(windowsBytes[0] === 0xef && windowsBytes[1] === 0xbb && windowsBytes[2] === 0xbf)) throw new Error('XMA Windows bootstrap must use UTF-8 BOM for PowerShell 5.1.')
if (!windowsBytes.toString('utf8').includes('\r\n')) throw new Error('XMA Windows bootstrap must use CRLF.')
const windows = text('scripts/install/xma-install.ps1')
for (const marker of [
  "Programs\\Xiaoyu",
  "SetEnvironmentVariable('Path'",
  'Get-FileHash -Algorithm SHA256',
  'Expand-Archive',
  'LOCALAPPDATA',
  'cli-portable',
]) {
  if (!windows.includes(marker)) throw new Error(`XMA Windows installer marker missing: ${marker}`)
}
for (const forbidden of ['pnpm ', 'cargo ', 'winget ', 'git clone']) {
  if (windows.toLowerCase().includes(forbidden)) throw new Error(`XMA Windows end-user installer must not require development dependency: ${forbidden}`)
}

const unix = text('scripts/install/xma-install.sh')
for (const marker of [
  '$HOME/.local/share',
  '$HOME/.local/bin',
  'sha256sum',
  'shasum -a 256',
  'xiaoyu-$os-$arch.tar.gz',
  'xma-install.sh --uninstall',
  'uninstall_xiaoyu',
  'assert_command_slot',
  'assert_safe_paths',
  'assert_release_transport',
]) {
  if (!unix.includes(marker)) throw new Error(`XMA Unix installer marker missing: ${marker}`)
}
for (const forbidden of ['pnpm ', 'cargo ', 'git clone']) {
  if (unix.toLowerCase().includes(forbidden)) throw new Error(`XMA Unix end-user installer must not require development dependency: ${forbidden}`)
}

const release = text('scripts/windows/xma-build-release.ps1')
for (const marker of [
  'Desktop 专用测试',
  'build:desktop:electron',
  'build:desktop:tauri',
  '不会构建或打包 Xiaoyu Terminal / CLI / Server',
  'dist\\release\\electron',
]) {
  if (!release.includes(marker)) throw new Error(`XMA Windows Desktop release marker missing: ${marker}`)
}
for (const forbidden of ['scripts/release/cli.ts', "@('run','build')", 'build:cli', 'build:server', "@('build','--workspace','--release')"]) {
  if (release.includes(forbidden)) throw new Error(`Desktop release must stay isolated from CLI/Server/full workspace release: ${forbidden}`)
}
const manifestSource = text('scripts/release/manifest.ts')
for (const marker of ["argument('directory', 'dist/release')", "'release-manifest.json'", "'checksums.txt'"]) {
  if (!manifestSource.includes(marker)) throw new Error(`XMA release manifest output contract missing: ${marker}`)
}


const workflow = text('.github/workflows/release.yml')
for (const marker of ['ubuntu-latest', 'windows-latest', 'macos-latest', 'pnpm install --no-frozen-lockfile --prefer-offline --reporter=append-only', 'pnpm release:cli-stage', 'cargo build --workspace --release', 'xma-install.ps1', 'xma-install.sh', 'actions/upload-artifact@v4', 'actions/download-artifact@v4', 'gh release']) {
  if (!workflow.includes(marker)) throw new Error(`XMA cross-platform release workflow marker missing: ${marker}`)
}

const ciWorkflow = text('.github/workflows/ci.yml')
for (const marker of ['JavaScript Runtime · Windows PowerShell 5.1', 'shell: powershell', '.\\scripts\\windows\\xma-prepare.ps1 -Component js', 'pnpm build:cli', 'pnpm smoke:cli']) {
  if (!ciWorkflow.includes(marker)) throw new Error(`XMA Windows JavaScript Runtime CI marker missing: ${marker}`)
}
if (ciWorkflow.includes('pnpm run runtime:update')) throw new Error('CI must install the current Workspace; it must not refresh Runtime latest.')

const readme = text('README.md')
for (const marker of [
  'powershell -ep Bypass -c "irm https://github.com/yubboo/xma/releases/latest/download/xma-install.ps1 | iex"',
  'curl -fsSL https://github.com/yubboo/xma/releases/latest/download/xma-install.sh | sh',
  '.\\xma-dev.bat',
  './xma-dev',
  'xiaoyu.cmd / xma.cmd',
]) {
  if (!readme.includes(marker)) throw new Error(`XMA README install/development entrypoint marker missing: ${marker}`)
}

const architecture = text('docs/architecture/DISTRIBUTION.md')
for (const marker of ['xiaoyu', '%LOCALAPPDATA%\\Programs\\Xiaoyu', '~/.local/share/xiaoyu', '.cache', 'dist/release', 'Build/Plan/Compose(legacy)', 'API Key → 真实远程模型选择 → 推理强度 → 已就绪']) {
  if (!architecture.includes(marker)) throw new Error(`XMA Distribution architecture doc marker missing: ${marker}`)
}

console.log('XMA Distribution Gate PASS (xiaoyu CLI + portable runtime + verified per-user installers)')
