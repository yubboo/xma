/**
 * 文件作用：回归验证 Xiaoyu OpenTUI Active Renderer 的响应式布局、原生输入依赖边界与禁止旧 ANSI 光标控制合同。
 * 关联模块：apps/cli/opentui-runtime、apps/cli/src/opentui-layout.ts、scripts/gates/distribution.ts。
 * 当前实现：纯 Node 环境检查布局函数、根 package Runtime 声明、动态加载入口与 Active Renderer 源码静态合同，不要求本机安装 OpenTUI Native Runtime。
 * 职责边界：本测试不替代 Windows Terminal 的真实光标、IME、鼠标与动画 E2E；这些仍需由 `[1]` 实际解析出的 Bun/OpenTUI 版本在实机验收。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { openTuiContentWidth, openTuiSidePadding } from '../src/opentui-layout.ts'

test('OpenTUI content grid uses a wide centered body with symmetric side padding', () => {
  assert.equal(openTuiContentWidth(40), 40)
  assert.equal(openTuiContentWidth(64), 56)
  assert.equal(openTuiContentWidth(112), 92)
  assert.equal(openTuiContentWidth(160), 132)
  assert.equal(openTuiSidePadding(112), 10)
  assert.equal(openTuiSidePadding(160), 14)
})

test('Bun and OpenTUI runtime dependencies live in the root package and avoid a nested dependency island', () => {
  const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const runtimePackage = JSON.parse(readFileSync('apps/cli/opentui-runtime/package.json', 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  assert.equal(rootPackage.devDependencies?.bun, '1.4.2')
  assert.equal(rootPackage.devDependencies?.['@opentui/core'], '0.5.11')
  assert.equal(rootPackage.devDependencies?.['@opentui/solid'], '0.5.11')
  assert.equal(rootPackage.devDependencies?.['solid-js'], '1.9.15')
  assert.equal(rootPackage.devDependencies?.['@types/bun'], '1.4.2')
  assert.equal(runtimePackage.dependencies, undefined)
  assert.equal(runtimePackage.devDependencies, undefined)
  const workspace = readFileSync('pnpm-workspace.yaml', 'utf8')
  assert.doesNotMatch(workspace, /apps\/cli\/opentui-runtime/)
  assert.equal(rootPackage.scripts?.['runtime:update'], 'node scripts/runtime/update.mjs')
})

test('Workspace Trust hides the cursor only during raw selection and restores it before OpenTUI handoff', () => {
  const source = readFileSync('apps/cli/src/tui.ts', 'utf8')
  const start = source.indexOf('export async function confirmWorkspaceTrust(')
  const end = source.indexOf('export function approvalDecision(', start)
  const trustSource = source.slice(start, end)
  assert.match(trustSource, /terminalMouseCaptureSequence\}\$\{hideHardwareCursor/)
  assert.match(trustSource, /terminalMouseReleaseSequence\}\$\{reset\}\$\{clearScreen\}\$\{showHardwareCursor/)
  assert.doesNotMatch(trustSource, /accepted \? hideHardwareCursor : showHardwareCursor/)
})

test('Active OpenTUI source uses native textarea focus and never reintroduces legacy manual cursor control', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /createCliRenderer/)
  assert.match(source, /<textarea/)
  assert.match(source, /cursorColor=\{COLOR\.text\}/)
  assert.match(source, /event\.name === 'tab'/)
  assert.match(source, /prompt\?\.focus\(\)/)
  assert.doesNotMatch(source, /CURSOR_MARKER/)
  assert.doesNotMatch(source, /terminalMouseCaptureSequence/)
  assert.doesNotMatch(source, /\\u001b\[\?25[hl]/)
})


test('OpenTUI build uses an explicit supported Bun compile target map', () => {
  const source = readFileSync('apps/cli/opentui-runtime/build.ts', 'utf8')
  for (const target of [
    'bun-windows-x64',
    'bun-windows-arm64',
    'bun-darwin-x64',
    'bun-darwin-arm64',
    'bun-linux-x64',
    'bun-linux-arm64',
  ]) assert.match(source, new RegExp(target))
  assert.doesNotMatch(source, /`bun-\$\{platformName\}-\$\{process\.arch\}`/)
})

test('OpenTUI build embeds the parser worker from the prepared root dependency instead of package export resolution', () => {
  const source = readFileSync('apps/cli/opentui-runtime/build.ts', 'utf8')
  assert.match(source, /node_modules', '@opentui', 'core', 'parser\.worker\.js'/)
  assert.match(source, /process\.chdir\(scriptDir\)/)
  assert.match(source, /path\.relative\(scriptDir, parserWorker\)/)
  assert.match(source, /entrypoints: \[path\.join\(cliRoot, 'src', 'main\.ts'\), parserWorker\]/)
  assert.doesNotMatch(source, /Bun\.resolveSync\('@opentui\/core\/parser\.worker\.js'/)
})


test('Bun CLI build keeps real staging in project .cache and uses a temporary ASCII alias for Windows Unicode paths', () => {
  const runner = readFileSync('scripts/cli/bun.ts', 'utf8')
  const build = readFileSync('apps/cli/opentui-runtime/build.ts', 'utf8')
  assert.match(runner, /function resolveBunCompileCache/)
  assert.match(runner, /path\.join\(root, 'node_modules', 'bun'\)/)
  assert.match(runner, /path\.join\(packageRoot, 'package\.json'\)/)
  assert.match(runner, /fileURLToPath\(import\.meta\.url\)/)
  assert.doesNotMatch(runner, /XMA_BUN_HOME/)
  assert.doesNotMatch(runner, /bun-environment\.json/)
  assert.doesNotMatch(runner, /xma-path['"]?,?\s*['"]bun/)
  assert.match(runner, /path\.join\(root, '\.cache', 'bun-compile', version\)/)
  assert.match(runner, /function createWindowsCompileAlias/)
  assert.match(runner, /containsNonAscii\(realCache\)/)
  assert.match(runner, /spawnSync\(subst, \[drive, realCache\]/)
  assert.match(runner, /spawnSync\(subst, \[drive, '\/D'\]/)
  assert.match(runner, /const compileTemp = path\.join\(alias\.root, 'tmp'\)/)
  assert.match(runner, /const compileRuntime = path\.join\(alias\.root, 'runtime'\)/)
  assert.match(runner, /bunExecutable = stageBunForCompile\(bun, compileRuntime\)/)
  assert.match(runner, /childEnv\.BUN_TMPDIR = compileTemp/)
  assert.match(runner, /childEnv\.TMPDIR = compileTemp/)
  assert.match(runner, /childEnv\.TEMP = compileTemp/)
  assert.match(runner, /childEnv\.TMP = compileTemp/)
  assert.match(runner, /finally \{\s*disposeCompileAlias\(\)/)
  assert.doesNotMatch(runner, /process\.env\.LOCALAPPDATA/)
  assert.doesNotMatch(runner, /process\.env\.TEMP \? path\.join/)
  assert.doesNotMatch(runner, /process\.env\.TMP \? path\.join/)
  assert.doesNotMatch(runner, /['"](?:C|D|H):\\\\/i)
  assert.match(build, /const stagedOutfile = path\.join\(compileStageRoot/)
  assert.match(build, /outfile: stagedOutfile/)
  assert.match(build, /fs\.copyFileSync\(stagedOutfile, outfile\)/)
  assert.match(build, /minify: false/)
})

test('OpenTUI visual migration preserves the existing Xiaoyu prompt rail instead of redesigning the workbench', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /placeholder="输入消息…（输入 \/ 唤起命令）"/)
  assert.ok((source.match(/<text fg=\{MODE_META\[mode\(\)\]\.color\}>▌<\/text>/g) ?? []).length >= 3)
  assert.doesNotMatch(source, /borderColor=\{COLOR\.faint\}/)
})

test('CLI loads OpenTUI only for the interactive workbench so doctor/help remain Node-loadable', () => {
  const source = readFileSync('apps/cli/src/main.ts', 'utf8')
  assert.match(source, /await import\('\.\.\/opentui-runtime\/app\.tsx'\)/)
  assert.doesNotMatch(source, /^import .*opentui-runtime\/app\.tsx/m)
})


test('Bun OpenTUI runner consumes pnpm node_modules and forbids implicit dependency downloads', () => {
  const source = readFileSync('scripts/cli/bun.ts', 'utf8')
  assert.match(source, /const scriptDir = path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/)
  assert.match(source, /const root = path\.resolve\(scriptDir, '\.\.', '\.\.'\)/)
  assert.match(source, /const runtimeRoot = path\.join\(root, 'apps', 'cli', 'opentui-runtime'\)/)
  assert.match(source, /path\.join\(root, 'node_modules', 'bun'\)/)
  assert.match(source, /path\.join\(root, 'node_modules'/)
  assert.match(source, /\[1\]\/\[8\]/)
  assert.doesNotMatch(source, /XMA_BUN_HOME/)
  assert.doesNotMatch(source, /bun-environment\.json/)
  assert.doesNotMatch(source, /xma-path', 'bun'/)
  assert.match(source, /const devArguments = forwarded\.length > 0 \? forwarded : \[root\]/)
  assert.match(source, /\['run', '--no-install', '\.\.\/src\/main\.ts', \.\.\.devArguments\]/)
  assert.match(source, /cwd: runtimeRoot/)
  assert.doesNotMatch(source, /\['--cwd'/)
})

test('OpenTUI logo keeps five glyph rows contiguous instead of inserting a blank row between every line', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  const logoStart = source.indexOf('function Logo(')
  const listStart = source.indexOf('function ListDialog(')
  const logoSource = source.slice(logoStart, listStart)
  assert.match(logoSource, /<box flexDirection="column" alignItems="center" backgroundColor=\{COLOR\.background\}>/)
  assert.match(logoSource, /<box flexDirection="column" backgroundColor=\{COLOR\.background\}>\s*<For each=\{LOGO_XIAO\}>/)
  assert.doesNotMatch(logoSource, /alignItems="center" gap=\{1\}/)
})

test('OpenTUI command palette backdrop never treats ordinary mouse clicks as Esc/back', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  const listStart = source.indexOf('function ListDialog(')
  const inputStart = source.indexOf('function SecretInput(')
  const listSource = source.slice(listStart, inputStart)
  assert.match(listSource, /event\.name === 'escape'/)
  assert.match(listSource, /onMouseUp=\{event => event\.stopPropagation\(\)\}/)
  assert.doesNotMatch(listSource, /onMouseUp=\{\(\) => finish\(undefined\)\}/)
})

test('OpenTUI vivid home uses sparse MiMo-style Braille meteors without repainting blank cells over the workbench', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /const SKY_STARS = \[/)
  assert.match(source, /const METEOR_INTERVAL_FRAMES = 160/)
  assert.match(source, /const METEOR_DURATION_FRAMES = 72/)
  assert.match(source, /const METEOR_FRAME_MS = 50/)
  assert.match(source, /const METEOR_ANGLE = 0\.36/)
  assert.match(source, /const METEOR_TAIL = 32/)
  assert.match(source, /const METEOR_STEP = 0\.15/)
  assert.match(source, /function brailleBit/)
  assert.match(source, /const dx = -Math\.cos\(METEOR_ANGLE\)/)
  assert.match(source, /const dy = Math\.sin\(METEOR_ANGLE\)/)
  assert.match(source, /String\.fromCharCode\(0x2800 \+ value\.dots\)/)
  assert.match(source, /function meteorGlyphs/)
  assert.match(source, /<For each=\{meteorItems\(\)\}>/)
  // 中文说明：性能优化后星星使用低频 starFrame，流星继续使用 50ms meteorFrame；
  // 回归测试必须验证拆帧后的真实接口，不能继续锁定已经废弃的单一 frame={phase()} 调用。
  assert.match(source, /const starFrame = createMemo\(\(\) => Math\.floor\(phase\(\) \/ 4\)\)/)
  assert.match(source, /starFrame=\{starFrame\(\)\}/)
  assert.match(source, /meteorFrame=\{phase\(\)\}/)
  assert.doesNotMatch(source, /return new StyledText\(chunks\)/)
  assert.doesNotMatch(source, /appendSkyChunk/)
  assert.doesNotMatch(source, /type TextRenderable/)
  assert.match(source, /justifyContent=\{centerMode\(\) \? 'center' : 'flex-end'\}/)
})

test('OpenTUI settings expose hierarchical appearance, effects and system menus with persistent effect toggles', () => {
  const runtime = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  const contract = readFileSync('apps/cli/src/tui.ts', 'utf8')
  assert.match(runtime, /设置 · 外观/)
  assert.match(runtime, /设置 · 特效/)
  assert.match(runtime, /设置 · 系统/)
  assert.match(runtime, /星星闪烁/)
  assert.match(runtime, /流星坠落/)
  assert.match(runtime, /Logo 颜色渐变/)
  assert.match(runtime, /while \(true\)[\s\S]*askList\('命令'/)
  assert.match(contract, /stars: boolean/)
  assert.match(contract, /meteors: boolean/)
  assert.match(contract, /logoGradient: boolean/)
  assert.match(contract, /stars: raw\.stars !== false/)
  assert.match(contract, /meteors: raw\.meteors !== false/)
  assert.match(contract, /logoGradient: raw\.logoGradient !== false/)
})

test('Xiaoyu logo gradient sweeps a highlight band across the original orange and gray logo every few seconds', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /const LOGO_HIGHLIGHT = \[/)
  assert.match(source, /function logoGlyphColor/)
  assert.match(source, /function LogoLine/)
  assert.match(source, /logoGradient/)
  assert.match(source, /const logoFrame = createMemo\(\(\) => Math\.floor\(phase\(\) \/ 2\)\)/)
})

test('Chinese comment gate keeps OpenTUI source files explicit without recursively scanning generated node_modules', () => {
  const source = readFileSync('scripts/gates/comments.ts', 'utf8')
  assert.match(source, /ignoredDirectories/)
  assert.match(source, /'node_modules'/)
  assert.match(source, /function hasIgnoredSegment/)
  assert.match(source, /const explicitFiles = \['apps\/cli\/opentui-runtime\/app\.tsx', 'apps\/cli\/opentui-runtime\/build\.ts'\]/)
  const rootsLine = source.split('\n').find(line => line.startsWith('const roots = ')) ?? ''
  assert.doesNotMatch(rootsLine, /apps\/cli\/opentui-runtime/)
})

test('OpenTUI live response projects the first Provider event immediately, then keeps the buffered typewriter', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /let hasProjectedRunEvent = false/)
  assert.match(source, /if \(!hasProjectedRunEvent\)[\s\S]{0,900}projectRunEvent\(\{ \.\.\.event, text: immediate \}\)/)
  assert.match(source, /const streamPump = setInterval\(pumpRunEvents, 30\)/)
  assert.match(source, /event => enqueueRunEvent\(event\)/)
  assert.match(source, /await waitForEventDrain\(\)/)
  assert.match(source, /role: 'reasoning', text: '', placeholder: true/)
  assert.match(source, /正在思考…/)
  assert.match(source, /正在生成回复…/)
})

test('OpenTUI transcript is bottom anchored, keeps user messages right aligned, and preserves manual scrollback', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  const transcriptStart = source.indexOf('<Show when={transcript().length > 0}>')
  const dockStart = source.indexOf('<box width={dockWidth()} flexDirection="column"', transcriptStart)
  const transcriptSource = source.slice(transcriptStart, dockStart)
  assert.match(source, /type ScrollBoxRenderable/)
  assert.match(transcriptSource, /<scrollbox/)
  assert.match(transcriptSource, /stickyScroll=\{true\}/)
  assert.match(transcriptSource, /stickyStart="bottom"/)
  assert.match(transcriptSource, /contentOptions=\{\{ flexGrow: 1, justifyContent: 'flex-end' \}\}/)
  assert.match(transcriptSource, /when=\{item\.role === 'user'\}/)
  assert.match(transcriptSource, /justifyContent="flex-end"/)
  assert.match(source, /Xiaoyu · 思考/)
  assert.match(transcriptSource, /scrollbarOptions=\{\{ visible: false \}\}/)
  assert.match(transcriptSource, /<For each=\{transcript\(\)\}>/)
  assert.doesNotMatch(source, /transcript\(\)\.slice\(-18\)/)
  assert.match(source, /transcriptScroll\.scrollBy\(-8\)/)
  assert.match(source, /transcriptScroll\.scrollTo\(1_000_000\)/)
})

test('Windows prepare labels pnpm native English prompts without piping or rewriting pnpm output', () => {
  const source = readFileSync('scripts/windows/xma-prepare.ps1', 'utf8')
  assert.match(source, /\[提示\] pnpm 自身的 Scope \/ Progress \/ 确认提示属于第三方 CLI 原生输出，可能显示英文/)
  assert.match(source, /Invoke-XmaExternal -FilePath 'pnpm\.cmd' -ArgumentList @\('install'\)/)
  assert.doesNotMatch(source, /pnpm\.cmd.*\|/)
})

test('OpenTUI model setup centers dialogs, releases the workbench cursor, and keeps Esc active during first-run setup', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  const listStart = source.indexOf('function ListDialog(')
  const secretStart = source.indexOf('function SecretInput(')
  const listSource = source.slice(listStart, secretStart)
  assert.match(listSource, /justifyContent="center"/)
  assert.match(listSource, /renderer\.setCursorPosition\(0, 0, false\)/)
  assert.match(source, /prompt\?\.blur\(\)/)
  assert.doesNotMatch(source, /allowCancel: !initialSetup/)
  assert.match(source, /label: item\.customEndpoint \? '自定义接口' : item\.displayName/)
  assert.match(source, /description: item\.customEndpoint \? 'OpenAI 兼容 · 自定义 Base URL' : '官方 API · 自动读取模型'/)
  assert.doesNotMatch(source, /<textarea[\s\S]{0,160}focused\n\s+minHeight=\{1\}[\s\S]{0,200}placeholder="输入消息…（输入 \/ 唤起命令）"/)
})


test('OpenTUI first-run provider wizard stays modal from API Key through model selection before entering the workbench', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /const \[setupFlow, setSetupFlow\]/)
  assert.match(source, /API Key 已保存 · 正在读取最新模型/)
  assert.match(source, /const modelSelected = await selectModel\(initialSetup\)/)
  assert.match(source, /if \(!modelSelected\) return false/)
  assert.match(source, /const reasoningSelected = await selectReasoning\(initialSetup\)/)
  assert.match(source, /模型已配置 · 已就绪/)
  assert.doesNotMatch(source, /const modelSelected = await selectModel\(initialSetup\)[\s\S]{0,900}await probe\(\)/)
  assert.match(source, /完成模型选择后进入主工作台/)
  assert.match(source, /void runInitialSetup\(\)/)
})

test('DeepSeek model picker prefers the current V4 API names and excludes retired aliases', () => {
  const main = readFileSync('apps/cli/src/main.ts', 'utf8')
  const catalog = readFileSync('plugins/deepseek/catalog.ts', 'utf8')
  const runtime = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(catalog, /deepseek-v4-pro/)
  assert.match(catalog, /deepseek-v4-flash/)
  assert.match(catalog, /deepseek-v4-flash-vision-exp/)
  assert.match(catalog, /deepseek-flash/)
  assert.match(main, /DEEPSEEK_DEPRECATED_MODEL_IDS/)
  assert.match(main, /return \[\.\.\.DEEPSEEK_CURRENT_MODELS, \.\.\.extras\]/)
  assert.match(runtime, /V4 Pro 0813/)
  assert.match(runtime, /V4 Flash 0731/)
  assert.match(runtime, /V4 Flash Vision/)
})

test('official Provider UI never renders DeepSeek plus DeepSeek 2 as stacked provider identities', () => {
  const runtime = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  const main = readFileSync('apps/cli/src/main.ts', 'utf8')
  const brain = readFileSync('apps/cli/src/brain.ts', 'utf8')
  assert.match(runtime, /provider\.customEndpoint && profiles\.length > 0 \? `\$\{provider\.displayName\} \$\{profiles\.length \+ 1\}` : provider\.displayName/)
  assert.match(runtime, /const profileLabel = profile\.providerId === 'custom-openai-compatible' \? profile\.displayName : providerName/)
  assert.match(runtime, /description: profile\.model/)
  assert.match(main, /const label = profile\.providerId === CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID \? profile\.displayName : providerName/)
  assert.match(main, /brainStore\.consolidateProvider\(preset\.id, preset\.displayName\)/)
  assert.match(brain, /consolidateProvider\(providerId: string, displayName: string\)/)
})


test('OpenTUI Textarea owns the active cursor and animated decoration re-renders the prompt instead of moving the terminal cursor', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /const \[promptCursorVisible, setPromptCursorVisible\] = createSignal\(true\)/)
  assert.match(source, /focused=\{dialog\(\) === undefined && !setupFlow\(\)\.active\}/)
  assert.match(source, /showCursor=\{promptCursorVisible\(\)\}/)
  assert.match(source, /setPromptCursorVisible\(value => !value\)/)
  assert.match(source, /setPhase\(value => value \+ 1\)[\s\S]{0,700}prompt\?\.requestRender\(\)/)
  assert.match(source, /showCursor=\{true\}/)
  const mountStart = source.indexOf("onMount(() => {\n    process.title = 'Xiaoyu'")
  const mountEnd = source.indexOf('  return (', mountStart)
  const activeMount = source.slice(mountStart, mountEnd)
  assert.doesNotMatch(activeMount, /renderer\.setCursorPosition\(0, 0, false\)/)
  assert.match(source, /targetFps: 30/)
  assert.match(source, /maxFps: 30/)
  assert.match(source, /enableMouseMovement: false/)
  assert.match(source, /const clockTimer = setInterval\(\(\) => setClock\(Date\.now\(\)\), 1000\)/)
})

test('meteor frame path reuses tail samples and numeric cell keys to reduce per-frame allocations', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /const METEOR_TAIL_POINTS = Array\.from/)
  assert.match(source, /new Map<number, \{ dots: number; nearestTailPoint: number \}>\(\)/)
  assert.match(source, /const key = cellY \* width \+ cellX/)
  assert.doesNotMatch(source, /key\.split\(','\)/)
})


test('OpenTUI prompt status keeps Build left aligned and provider truth right aligned', () => {
  const source = readFileSync('apps/cli/opentui-runtime/app.tsx', 'utf8')
  assert.match(source, /const providerStatus = createMemo/)
  assert.match(source, /label: '模型未配置 · Ctrl\+P \/provider'/)
  assert.match(source, /flexGrow=\{1\} flexDirection="row" justifyContent="space-between" paddingLeft=\{1\}/)
  assert.match(source, /<text fg=\{MODE_META\[mode\(\)\]\.color\}><strong>\{MODE_META\[mode\(\)\]\.label\}<\/strong><\/text>/)
  assert.match(source, /<text fg=\{providerStatus\(\)\.dotColor\}>\{providerStatus\(\)\.dot\}<\/text>/)
  assert.match(source, /<Show when=\{providerConfigured\(\)\}>/)
})
