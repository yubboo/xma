/**
 * 文件作用：检查 Xiaoyu 终端发行层、跨平台安装脚本与 portable bundle 合同，防止普通用户安装流程退回源码开发模式。
 * 关联模块：apps/cli、scripts/install、scripts/release、xma-build-release.ps1、docs/architecture/DISTRIBUTION.md。
 * 当前实现：锁定 xiaoyu 主命令、xma 兼容别名、预构建 Runtime bundle、SHA-256 安装、每用户路径和禁止 pnpm/cargo 源码安装。
 * 职责边界：Gate 只验证静态发行合同；真实签名、公证、GitHub Release 上传与跨 OS 安装仍必须由对应平台 E2E 验证。
 */

import { existsSync, readFileSync } from 'node:fs'

function text(file: string): string {
  if (!existsSync(file)) throw new Error(`XMA Distribution Gate missing file: ${file}`)
  return readFileSync(file, 'utf8')
}

const rootPackage = JSON.parse(text('package.json')) as { scripts?: Record<string, string> }
const cliPackage = JSON.parse(text('apps/cli/package.json')) as { dependencies?: Record<string, string> }
const openTuiPackage = JSON.parse(text('apps/cli/opentui-runtime/package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
if (openTuiPackage.dependencies?.['@opentui/core'] !== '0.1.101') throw new Error('Xiaoyu OpenTUI core must stay pinned to the MiMo-validated 0.1.101 baseline.')
if (openTuiPackage.dependencies?.['@opentui/solid'] !== '0.1.101') throw new Error('Xiaoyu OpenTUI Solid binding must stay pinned to 0.1.101.')
if (openTuiPackage.dependencies?.['solid-js'] !== '1.9.10') throw new Error('Xiaoyu OpenTUI Solid runtime must stay pinned to solid-js 1.9.10.')
if (cliPackage.dependencies?.['@earendil-works/pi-tui'] !== '0.74.0') throw new Error('Legacy Workspace Trust/test compatibility still pins Pi TUI until the compatibility layer is retired.')
if (rootPackage.scripts?.['build:cli'] !== 'tsx scripts/cli/bun.ts build') throw new Error('Xiaoyu portable CLI must build through the pinned Bun/OpenTUI runner.')
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
const openTuiLayout = text('apps/cli/src/opentui-layout.ts')
for (const marker of ['openTuiContentWidth', 'openTuiSidePadding']) {
  if (!openTuiLayout.includes(marker)) throw new Error(`XMA OpenTUI responsive layout marker missing: ${marker}`)
}
for (const marker of [
  'createCliRenderer', 'TextareaRenderable', 'useKeyboard', 'useTerminalDimensions', 'cursorColor={COLOR.text}',
  "event.name === 'tab'", "event.name === 'escape'", "event.ctrl && event.name === 'p'", "event.ctrl && event.name === 'k'",
  'commandPaletteOptions()', '模型 / 提供方', '模型就绪测试', '选择真实模型', '终端设置', 'Tool Approval',
  'placeholder="输入消息…（输入 / 唤起命令）"', 'enableMouseMovement: true', 'useMouse: true',
]) {
  if (!openTui.includes(marker)) throw new Error(`XMA active OpenTUI marker missing: ${marker}`)
}
for (const forbidden of ['CURSOR_MARKER', 'terminalMouseCaptureSequence', 'terminalMouseReleaseSequence', 'new toolkit.TUI(', '\u001b[?25l']) {
  if (openTui.includes(forbidden)) throw new Error(`XMA active OpenTUI renderer must not reintroduce legacy manual terminal cursor/mouse control: ${forbidden}`)
}
const openTuiBuild = text('apps/cli/opentui-runtime/build.ts')
for (const marker of ['createSolidTransformPlugin', 'parser.worker.js', 'OTUI_TREE_SITTER_WORKER_PATH', "outfile", "xiaoyu.exe"]) {
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
]) {
  if (!unix.includes(marker)) throw new Error(`XMA Unix installer marker missing: ${marker}`)
}
for (const forbidden of ['pnpm ', 'cargo ', 'git clone']) {
  if (unix.toLowerCase().includes(forbidden)) throw new Error(`XMA Unix end-user installer must not require development dependency: ${forbidden}`)
}

const release = text('scripts/windows/xma-build-release.ps1')
for (const marker of ['scripts/release/cli.ts', 'scripts/release/manifest.ts', 'xma-install.ps1', 'xma-install.sh']) {
  if (!release.includes(marker)) throw new Error(`XMA Windows release distribution marker missing: ${marker}`)
}
const manifestSource = text('scripts/release/manifest.ts')
for (const marker of ["argument('directory', 'dist/release')", "'release-manifest.json'", "'checksums.txt'"]) {
  if (!manifestSource.includes(marker)) throw new Error(`XMA release manifest output contract missing: ${marker}`)
}


const workflow = text('.github/workflows/release.yml')
for (const marker of ['ubuntu-latest', 'windows-latest', 'macos-latest', 'oven-sh/setup-bun@v2', 'bun install --cwd apps/cli/opentui-runtime --no-save', 'pnpm release:cli-stage', 'cargo build --workspace --release', 'xma-install.ps1', 'xma-install.sh', 'actions/upload-artifact@v4', 'actions/download-artifact@v4', 'gh release']) {
  if (!workflow.includes(marker)) throw new Error(`XMA cross-platform release workflow marker missing: ${marker}`)
}

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
for (const marker of ['xiaoyu', '%LOCALAPPDATA%\\Programs\\Xiaoyu', '~/.local/share/xiaoyu', '.cache', 'dist/release', 'Build/Plan/Compose(legacy)', 'API Key → 真实远程模型选择 → 推理强度 → Brain Ready']) {
  if (!architecture.includes(marker)) throw new Error(`XMA Distribution architecture doc marker missing: ${marker}`)
}

console.log('XMA Distribution Gate PASS (xiaoyu CLI + portable runtime + verified per-user installers)')
