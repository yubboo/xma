/**
 * 文件作用：阻止 XMA 核心架构在后续开发中回退或被业务污染。
 * 关联模块：AGENTS.md、core/、agents/、native/。
 * 当前实现：检查关键目录、TypeScript/Rust 边界、Runtime/Context/Provider 分层、上游优先/xma-* 换轨、Desktop 工程约束和 DeepSeek Harness 兼容层。
 * 职责边界：Gate 只做静态契约检查，不能替代真实测试。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const required = [
  'AGENTS.md',
  'CODEMAP.md',
  'docs/development/UPDATE-LOG.md',
  'packages/xma-ai/package.json',
  'packages/xma-agent-loop/package.json',
  'packages/xma-plugin/package.json',
  'packages/xma-tools/package.json',
  'packages/xma-session/package.json',
  'packages/xma-context/package.json',
  'packages/xma-native/package.json',
  'core/package.json',
  'plugins/deepseek/package.json',
  'plugins/native-tools/package.json',
  'plugins/dsh-compat/package.json',
  'agents/xiaoyu/package.json',
  'agents/code/package.json',
  '.cargo/config.toml',
  'core/src/agent.ts',
  'packages/xma-agent-loop/src/agent/contract.ts',
  'packages/xma-agent-loop/src/agent/registry.ts',
  'packages/xma-agent-loop/src/agent/delegation.ts',
  'core/src/skill/contract.ts',
  'core/src/skill/registry.ts',
  'core/src/skill/loader.ts',
  'packages/xma-plugin/src/plugin.ts',
  'packages/xma-agent-loop/src/runtime.ts',
  'packages/xma-session/src/contract.ts',
  'packages/xma-session/src/export.ts',
  'packages/xma-context/src/assembly/context.ts',
  'core/src/workspace.ts',
  'packages/xma-ai/src/provider/provider.ts',
  'packages/xma-tools/src/schema.ts',
  'packages/xma-tools/src/policy.ts',
  'packages/xma-tools/src/router.ts',
  'packages/xma-native/src/client.ts',
  'plugins/deepseek/plugin.ts',
  'plugins/deepseek/catalog.ts',
  'packages/xma-ai/src/openai-compatible.ts',
  'plugins/native-tools/contract.ts',
  'plugins/native-tools/filesystem.ts',
  'plugins/native-tools/process.ts',
  'plugins/native-tools/plugin.ts',
  'apps/desktop/scripts/electron/build.ts',
  'apps/desktop/electron-builder.json',
  'apps/desktop/src-tauri/tauri.conf.json',
  'plugins/dsh-compat/index.ts',
  'native/protocol/src/lib.rs',
  'native/runtime/src/main.rs',
  'docs/architecture/PROJECT-ARCHITECTURE.md',
  'docs/architecture/AGENT-ENGINE-STRATEGY.md',
  'docs/architecture/DIRECTORY-STRUCTURE.md',
  'docs/architecture/AGENT-RUNTIME.md',
  'docs/architecture/AGENT-PLATFORM.md',
  'docs/architecture/WORKSPACE.md',
  'docs/architecture/MODEL-PROVIDER.md',
  'docs/architecture/PLUGIN-SYSTEM.md',
  'docs/development/DEVELOPMENT-RULES.md',
  'docs/development/UPSTREAM-REFERENCE.md',
  'scripts/gates/naming.ts',
  'docs/security/NATIVE-CAPABILITIES.md',
  'agents/xiaoyu/runtime/agent.ts',
  'agents/code/runtime/agent.ts',
  'skills/common/task-planning/SKILL.md',
  'skills/common/task-planning/skill.json',
  'skills/common/verification/SKILL.md',
  'skills/common/verification/skill.json',
  'skills/code/bug-fixing/SKILL.md',
  'skills/code/bug-fixing/skill.json',
  'skills/code/testing/SKILL.md',
  'skills/code/testing/skill.json',
]
for (const path of required) if (!existsSync(path)) throw new Error(`XMA Architecture Gate: missing ${path}`)


const rootAllowedDirectories = new Set([
  '.agents', '.cargo', '.claude', '.codex', '.github',
  'agents', 'apps', 'core', 'docs', 'native', 'packages', 'plugins', 'scripts', 'skills',
])
const rootAllowedFiles = new Set([
  '.gitattributes', '.gitignore',
  'AGENTS.md', 'CLAUDE.md', 'CODEMAP.md', 'README.md',
  'Cargo.lock', 'Cargo.toml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
  'xma-dev', 'xma-dev.bat', 'XMA-GitHub.bat', 'XMA-Sync.bat',
  'LICENSE', 'LICENSE.md', 'SECURITY.md', 'CONTRIBUTING.md',
])
const rootLocalState = new Set(['.git', '.cache', '.xma', '.xma-package', 'node_modules', 'dist', 'target'])
for (const name of readdirSync('.')) {
  if (rootLocalState.has(name)) continue
  const stat = statSync(name)
  const allowed = stat.isDirectory() ? rootAllowedDirectories.has(name) : rootAllowedFiles.has(name)
  if (!allowed) throw new Error(`XMA Root Hygiene Rule: unexpected repository-root entry: ${name}`)
}

const engineStrategy = readFileSync('docs/architecture/AGENT-ENGINE-STRATEGY.md', 'utf8')
for (const marker of [
  'Upstream-first',
  'No Blind Reinvention',
  'xma-agent-loop',
  'xma-ai',
  'xma-plugin',
  'Everything is a Plugin',
  'Model Intelligence Preservation Contract',
  'Pi',
  'DeepSeek Harness',
  'OpenAI Codex',
  'MiMo Code',
  'Minecraft 专业 Agent',
]) {
  if (!engineStrategy.includes(marker)) throw new Error(`XMA Agent Engine Strategy marker missing: ${marker}`)
}


const directoryDoc = readFileSync('docs/architecture/DIRECTORY-STRUCTURE.md', 'utf8')
for (const marker of ['kebab-case', 'snake_case', '父目录去重', 'Feature Cluster Rule', 'Predictable Location Rule', 'Stable Import Rule', 'Root Hygiene Rule', 'plugins/deepseek/', 'packages/xma-agent-loop/', 'CODEMAP.md', 'UPDATE-LOG.md']) {
  if (!directoryDoc.includes(marker)) throw new Error(`XMA naming/directory architecture marker missing: ${marker}`)
}
const developmentRules = readFileSync('docs/development/DEVELOPMENT-RULES.md', 'utf8')
for (const marker of ['pnpm gate:naming', '同一逻辑的 types/constants/helpers', '父目录已经表达领域时去掉重复前缀', 'Provider Truth Contract', '隐藏降级', 'Upstream-first', 'No Blind Reinvention', 'xma-agent-loop']) {
  if (!developmentRules.includes(marker)) throw new Error(`XMA development naming rule missing: ${marker}`)
}

const runtimeDoc = readFileSync('docs/architecture/AGENT-RUNTIME.md', 'utf8')
for (const marker of ['AgentDefinition', 'Skill Context', 'Session', 'Turn', 'Step', 'Model-visible', 'ToolPlan', 'Tool Pipeline', 'xma-agent-loop', 'Model Intelligence Preservation']) {
  if (!runtimeDoc.includes(marker)) throw new Error(`XMA Agent Runtime architecture marker missing: ${marker}`)
}
const agentPlatformDoc = readFileSync('docs/architecture/AGENT-PLATFORM.md', 'utf8')
for (const marker of ['Xiaoyu Manager', 'AgentDefinition', 'Skill', 'AgentTask', 'Host']) {
  if (!agentPlatformDoc.includes(marker)) throw new Error(`XMA Agent Platform architecture marker missing: ${marker}`)
}
const agentContract = readFileSync('packages/xma-agent-loop/src/agent/contract.ts', 'utf8')
for (const marker of ['AgentDefinition', 'AgentBrainCapability', 'AgentDelegationPolicy', 'AgentDeliveryPolicy']) {
  if (!agentContract.includes(marker)) throw new Error(`XMA Agent Platform core marker missing: ${marker}`)
}
const skillRegistry = readFileSync('core/src/skill/registry.ts', 'utf8')
for (const marker of ['class SkillRegistry', 'resolveForAgent', 'createAgentSkillContextSource', "id: 'agent/skills'", 'Canonical Chinese self-name: 小鱼']) {
  if (!skillRegistry.includes(marker)) throw new Error(`XMA Skill Platform core marker missing: ${marker}`)
}
const delegationSource = readFileSync('packages/xma-agent-loop/src/agent/delegation.ts', 'utf8')
for (const marker of ['AgentTask', 'AgentDelegationService', 'cannot delegate tasks']) {
  if (!delegationSource.includes(marker)) throw new Error(`XMA Agent delegation marker missing: ${marker}`)
}
for (const forbidden of ['agents/minecraft/agent.ts', 'agents/writer/agent.ts', 'core/src/agent-registry.ts']) {
  if (existsSync(forbidden)) throw new Error(`XMA Agent Platform must not keep obsolete empty/legacy skeleton: ${forbidden}`)
}

const workspaceDoc = readFileSync('docs/architecture/WORKSPACE.md', 'utf8')
for (const marker of ['WorkspaceBinding', 'descriptorDigest', 'workspace/access-granted', 'workspace/access-revoked', 'workspace/access-used', '其他 Agent → 目标 Workspace → deny']) {
  if (!workspaceDoc.includes(marker)) throw new Error(`XMA Workspace architecture marker missing: ${marker}`)
}
const providerDoc = readFileSync('docs/architecture/MODEL-PROVIDER.md', 'utf8')
for (const marker of ['Provider Capabilities', 'Model Catalog', 'Brain Ready Probe', 'Conformance Tests', 'Provider / Model Truth Contract', 'providerId', 'adapterId', 'DeepSeek Official', 'xma-ai', 'Pi AI']) {
  if (!providerDoc.includes(marker)) throw new Error(`XMA Model Provider architecture marker missing: ${marker}`)
}


const contextSource = readFileSync('packages/xma-context/src/assembly/context.ts', 'utf8')
for (const marker of ['class ContextRegistry', 'maxCharacters', 'sha256', 'sourceId', 'workspaceAccess', 'authorizeWorkspaceAccess']) {
  if (!contextSource.includes(marker)) throw new Error(`XMA Context architecture marker missing: ${marker}`)
}
const sessionSource = readFileSync('packages/xma-session/src/contract.ts', 'utf8')
for (const marker of ["type: 'context/snapshot'", 'contextDigest', 'requestContextForStep', 'requestMessagesForStep', 'providerContinuation', "type: 'workspace/access-granted'", "type: 'workspace/access-revoked'", "type: 'workspace/access-used'"]) {
  if (!sessionSource.includes(marker)) throw new Error(`XMA Session reconstruction marker missing: ${marker}`)
}
const workspaceSource = readFileSync('packages/xma-context/src/workspace/workspace.ts', 'utf8')
for (const marker of ['class WorkspaceRegistry', 'WorkspaceBinding', 'descriptorDigest', 'bindOwned', 'verifyBinding']) {
  if (!workspaceSource.includes(marker)) throw new Error(`XMA Workspace core marker missing: ${marker}`)
}
const workspaceGuardSource = readFileSync('packages/xma-tools/src/workspace-guard.ts', 'utf8')
if (!workspaceGuardSource.includes('class WorkspaceToolSecurityGuard')) throw new Error('XMA Workspace Tool Guard marker missing')
const exportSource = readFileSync('packages/xma-session/src/export.ts', 'utf8')
for (const marker of ['SessionExportEnvelope', 'redacted: boolean', 'SessionMigrationRegistry', 'delete clone.providerContinuation']) {
  if (!exportSource.includes(marker)) throw new Error(`XMA Session export/migration marker missing: ${marker}`)
}
const providerSource = readFileSync('packages/xma-ai/src/provider/provider.ts', 'utf8')
for (const marker of ['ProviderRegistry', 'ProviderCapabilities', 'CredentialReference', 'BrainReadyProbeResult', 'ProviderRequestError', 'providerId']) {
  if (!providerSource.includes(marker)) throw new Error(`XMA Provider architecture marker missing: ${marker}`)
}
const providerAdapter = readFileSync('packages/xma-ai/src/openai-compatible.ts', 'utf8')
for (const marker of ["OPENAI_COMPATIBLE_ADAPTER_ID", "chat/completions", 'sseData', 'probe(', 'provider-continuation', 'reasoning_content', 'reasoningContentToolContinuation', 'createToolWireCodec', 'TOOL_WIRE_NAME_PATTERN']) {
  if (!providerAdapter.includes(marker)) throw new Error(`XMA OpenAI-compatible adapter marker missing: ${marker}`)
}
const providerCatalog = readFileSync('plugins/deepseek/catalog.ts', 'utf8')
for (const marker of ['DEEPSEEK_PROVIDER_ID', 'CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID', 'https://api.deepseek.com', 'modelCatalogDiscovery', 'thinkingMode', 'reasoningContentToolContinuation', 'toolProbeThinkingMode']) {
  if (!providerCatalog.includes(marker)) throw new Error(`XMA Provider Catalog marker missing: ${marker}`)
}
const toolsSource = readFileSync('packages/xma-tools/src/router.ts', 'utf8')
for (const marker of ['class ToolPlan', 'class ToolRouter', 'createPlan()', 'validateToolArguments', 'dispatchMany', 'Workspace-scoped tool requires a bound Session Workspace', 'Cross-workspace tool access requires durable Workspace access auditing']) {
  if (!toolsSource.includes(marker)) throw new Error(`XMA ToolPlan architecture marker missing: ${marker}`)
}
const policySource = readFileSync('packages/xma-tools/src/policy.ts', 'utf8')
for (const marker of ['DefaultToolPolicy', 'ToolSecurityGuard', 'ToolApprovalProvider', 'allow-session']) {
  if (!policySource.includes(marker)) throw new Error(`XMA Tool Policy architecture marker missing: ${marker}`)
}
const cliMainSource = readFileSync('apps/cli/src/main.ts', 'utf8')
for (const marker of ['assertCliNativeRuntimeStatus', 'credential.status', '提供方已写入但没有成为当前模型配置', 'model/reasoning-delta', "type: 'tool-call'", "type: 'tool-result'"]) {
  if (!cliMainSource.includes(marker)) throw new Error(`XMA CLI Provider/Native readiness marker missing: ${marker}`)
}
const cliTuiSource = readFileSync('apps/cli/src/tui.ts', 'utf8')
for (const marker of ['模型未配置 · 请先在 Ctrl+P → 模型 / 提供方 添加并保存提供方。', '模型列表读取失败', '提供方已保存并设为当前模型配置', '选择推理强度', 'cycleTerminalAgentMode', '命令执行失败', 'applyTerminalRunEvent', 'requestLiveRender', 'requestRender(true)']) {
  if (!cliTuiSource.includes(marker)) throw new Error(`XMA CLI Provider failure-containment marker missing: ${marker}`)
}

const nativeBridge = readFileSync('packages/xma-native/src/client.ts', 'utf8')
for (const marker of ['NativeCapabilityKind', 'NativeHostPolicy', 'issueCapability', 'runProcess', 'shell: false', '绝对可执行文件身份白名单']) {
  if (!nativeBridge.includes(marker)) throw new Error(`XMA Native bridge marker missing: ${marker}`)
}
const nativeTools = [
  'plugins/native-tools/contract.ts',
  'plugins/native-tools/filesystem.ts',
  'plugins/native-tools/process.ts',
  'plugins/native-tools/plugin.ts',
].map(path => readFileSync(path, 'utf8')).join('\n')
for (const marker of ['native.fs.read_text', 'native.fs.write_text', 'native.process.run', 'issueCapability', 'programs: [program]', 'workspaceAccess', 'workspaceId']) {
  if (!nativeTools.includes(marker)) throw new Error(`XMA Native tool marker missing: ${marker}`)
}
const nativeProtocol = readFileSync('native/protocol/src/lib.rs', 'utf8')
for (const marker of ['filesystem.read', 'filesystem.write', 'process.spawn']) {
  if (!nativeProtocol.includes(marker)) throw new Error(`XMA Native protocol capability marker missing: ${marker}`)
}
const nativeRuntime = readFileSync('native/runtime/src/main.rs', 'utf8')
for (const marker of ['configure_policy', 'take_capability', 'fs::canonicalize', 'canonicalize_program', 'Command::new', 'process/run', 'absolute executable path']) {
  if (!nativeRuntime.includes(marker)) throw new Error(`XMA Native runtime security marker missing: ${marker}`)
}
const runtimeSource = readFileSync('packages/xma-agent-loop/src/runtime.ts', 'utf8')
if (runtimeSource.includes('chat/completions') || runtimeSource.includes('Authorization')) {
  throw new Error('XMA Core Runtime must not contain provider-specific HTTP/auth protocol details')
}
const modelSource = readFileSync('packages/xma-ai/src/model/model.ts', 'utf8')
for (const marker of ['providerContinuation', "type: 'provider-continuation'"]) {
  if (!modelSource.includes(marker)) throw new Error(`XMA Model provider-continuation marker missing: ${marker}`)
}
if (modelSource.includes('chat/completions') || modelSource.includes('x-api-key')) {
  throw new Error('XMA model Contract must remain provider-neutral')
}

const agents = readFileSync('packages/xma-agent-loop/src/legacy-run-agent.ts', 'utf8')
if (!agents.includes('provider.stream') || !agents.includes('createPlan()') || !agents.includes('createRouter()')) {
  throw new Error('XMA Agent Loop must remain Model -> frozen ToolPlan/Router -> Observation -> Model')
}
if (!runtimeSource.includes('toolPlanId: toolPlan.id') || !runtimeSource.includes('toolRouter.dispatchMany')) {
  throw new Error('XMA Runtime must bind each Step to one frozen ToolPlan and execute through its ToolRouter')
}
for (const marker of ['new WorkspaceToolSecurityGuard', 'grantWorkspaceAccess', 'revokeWorkspaceAccess', "type: 'workspace/access-used'", 'verifyBinding(handle.header.workspace)', 'Workspace header identity is inconsistent']) {
  if (!runtimeSource.includes(marker)) throw new Error(`XMA Runtime Workspace boundary marker missing: ${marker}`)
}
const pluginDoc = readFileSync('docs/architecture/PLUGIN-SYSTEM.md', 'utf8')
for (const marker of ['Everything is a Plugin', 'xma-plugin', 'xma-plugin-dsh', 'Contract Compatible', 'Behavior Compatible', 'Rust Security Kernel']) {
  if (!pluginDoc.includes(marker)) throw new Error(`XMA Plugin architecture marker missing: ${marker}`)
}

const compat = readFileSync('plugins/dsh-compat/index.ts', 'utf8')
for (const marker of ['inject', 'apply(context']) if (!compat.includes(marker)) throw new Error(`DeepSeek Harness compatibility marker missing: ${marker}`)



const platformPackages = [
  'xma-ai',
  'xma-agent-loop',
  'xma-plugin',
  'xma-tools',
  'xma-session',
  'xma-context',
  'xma-native',
] as const
for (const name of platformPackages) {
  const packageFile = `packages/${name}/package.json`
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8')) as { name?: string; exports?: Record<string, string> }
  if (manifest.name !== name) throw new Error(`XMA platform package name mismatch: ${packageFile}`)
  if (!manifest.exports?.['.']) throw new Error(`XMA platform package must expose a public root entry: ${packageFile}`)
}

const workspaceManifests = [
  ...platformPackages.map(name => `packages/${name}/package.json`),
  'core/package.json',
  'agents/xiaoyu/package.json',
  'agents/code/package.json',
  'plugins/deepseek/package.json',
  'plugins/native-tools/package.json',
  'plugins/dsh-compat/package.json',
  'apps/cli/package.json',
]
for (const packageFile of workspaceManifests) {
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8')) as {
    name?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  const declared = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  }
  for (const [dependency, version] of Object.entries(declared)) {
    if ((dependency.startsWith('xma-') || dependency.startsWith('@xma/')) && version !== 'workspace:*') {
      throw new Error(`XMA workspace dependency must use workspace:*: ${packageFile} -> ${dependency}=${version}`)
    }
  }
}

const workspaceRoots = [
  ...platformPackages.map(name => `packages/${name}`),
  'core',
  'agents/xiaoyu',
  'agents/code',
  'plugins/deepseek',
  'plugins/native-tools',
  'plugins/dsh-compat',
  'apps/cli',
]
for (const root of workspaceRoots) {
  const packageFile = `${root}/package.json`
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8')) as {
    name?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  for (const path of walkTypeScript(root)) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1]!
      const dependency = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
      if (!(dependency.startsWith('xma-') || dependency.startsWith('@xma/'))) continue
      if (dependency === manifest.name) continue
      if (!declared.has(dependency)) {
        throw new Error(`XMA workspace ghost dependency: ${packageFile} imports ${dependency} in ${path} but does not declare it`)
      }
    }
  }
}

const forbiddenLegacyDirectories = [
  'plugins/providers',
  'plugins/tools',
  'plugins/compat',
  'plugins/examples',
]
for (const path of forbiddenLegacyDirectories) {
  if (existsSync(path)) throw new Error(`XMA plugin ownership regression: legacy directory must stay removed: ${path}`)
}

const coreFacadeChecks: readonly [string, string][] = [
  ['core/src/model.ts', "from 'xma-ai'"],
  ['core/src/provider.ts', "from 'xma-ai'"],
  ['core/src/plugin.ts', "from 'xma-plugin'"],
  ['core/src/runtime.ts', "from 'xma-agent-loop'"],
  ['core/src/context.ts', "from 'xma-context'"],
  ['core/src/native.ts', "from 'xma-native'"],
  ['core/src/session/contract.ts', "from 'xma-session'"],
  ['core/src/tool/router.ts', "from 'xma-tools'"],
]
for (const [path, marker] of coreFacadeChecks) {
  const source = readFileSync(path, 'utf8')
  if (!source.includes(marker) || source.split('\n').length > 12) {
    throw new Error(`XMA core compatibility facade must remain thin: ${path}`)
  }
}

function walkTypeScript(dir: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (['node_modules', '.cache', 'dist', 'build'].includes(name)) continue
      files.push(...walkTypeScript(path))
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) files.push(path)
  }
  return files
}
for (const root of ['apps', 'agents', 'core', 'packages', 'plugins']) {
  for (const path of walkTypeScript(root)) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1]!
      if (specifier.startsWith('../../')) {
        throw new Error(`XMA Stable Import Rule: deep relative import is forbidden: ${path} -> ${specifier}`)
      }
      if (/^xma-[^/]+\/src\//.test(specifier)) {
        throw new Error(`XMA Stable Import Rule: package internal src import is forbidden: ${path} -> ${specifier}`)
      }
    }
  }
}

const codeMap = readFileSync('CODEMAP.md', 'utf8')
for (const marker of ['packages/xma-agent-loop/', 'plugins/deepseek/', 'plugins/native-tools/', 'docs/development/UPDATE-LOG.md']) {
  if (!codeMap.includes(marker)) throw new Error(`XMA CODEMAP marker missing: ${marker}`)
}
const updateLog = readFileSync('docs/development/UPDATE-LOG.md', 'utf8')
for (const marker of ['##01', '##02', '##03', '##04', '##08', 'Platform Skeleton v1', 'Stable Imports', 'Platform Skeleton 源码归位', 'Root Hygiene 与 Terminal 启动契约']) {
  if (!updateLog.includes(marker)) throw new Error(`XMA UPDATE-LOG marker missing: ${marker}`)
}

const cargoConfig = readFileSync('.cargo/config.toml', 'utf8')
if (!cargoConfig.includes('target-dir = ".cache/cargo-target"')) {
  throw new Error('XMA Cargo build cache must live under .cache/cargo-target instead of root target/')
}

function assertRustDirectDependencies(manifestPath: string, sourcePaths: string[]): void {
  const manifest = readFileSync(manifestPath, 'utf8')
  const section = manifest.match(/\[dependencies\]\s*([\s\S]*?)(?=\n\[|$)/)?.[1] ?? ''
  const dependencyCrates = new Set(
    [...section.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map(match => match[1]!.replaceAll('-', '_')),
  )
  const importedCrates = new Set<string>()
  for (const sourcePath of sourcePaths) {
    const source = readFileSync(sourcePath, 'utf8')
    for (const match of source.matchAll(/^\s*use\s+([A-Za-z_][A-Za-z0-9_]*)::/gm)) {
      const crate = match[1]!
      if (!['std', 'core', 'alloc', 'crate', 'super', 'self'].includes(crate)) importedCrates.add(crate)
    }
  }
  for (const crate of importedCrates) {
    if (!dependencyCrates.has(crate)) {
      throw new Error(`XMA Rust direct dependency missing: ${manifestPath} imports ${crate} but does not declare it`)
    }
  }
}
assertRustDirectDependencies('native/runtime/Cargo.toml', ['native/runtime/src/main.rs'])
assertRustDirectDependencies('native/protocol/Cargo.toml', ['native/protocol/src/lib.rs'])

const cargoLock = readFileSync('Cargo.lock', 'utf8')
const nativeRuntimeLock = cargoLock.match(/name = "xma-native-runtime"\nversion = "0\.1\.0"\ndependencies = \[([\s\S]*?)\n\]/)?.[1] ?? ''
if (!nativeRuntimeLock.includes('"serde"')) {
  throw new Error('XMA Cargo.lock must record serde as a direct xma-native-runtime dependency')
}

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
const webBuild = rootPackage.scripts?.['build:web'] ?? ''
if (!webBuild.includes('--emptyOutDir')) throw new Error('XMA Web build must explicitly empty the external dist/web output directory')
const cliBuild = rootPackage.scripts?.['build:cli'] ?? ''
if (cliBuild.includes('--banner')) throw new Error('XMA CLI build must not use unsupported tsup --banner CLI flags')
const cliSource = readFileSync('apps/cli/src/main.ts', 'utf8')
if (!cliSource.startsWith('#!/usr/bin/env node')) throw new Error('XMA CLI entry must carry its own Node hashbang')

const desktopPackage = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')) as { scripts?: Record<string, string> }
const desktopScripts = Object.values(desktopPackage.scripts ?? {}).join('\n').replaceAll('\\', '/')
for (const legacy of ['apps/desktop/dist', 'apps/desktop/web', 'apps/desktop/release', 'apps/desktop/native']) {
  if (desktopScripts.includes(legacy)) throw new Error(`XMA Desktop must not emit app-local build output: ${legacy}`)
}
const desktopTauriWebBuild = desktopPackage.scripts?.['web:build:tauri'] ?? ''
for (const marker of ['.cache/desktop/tauri/web', '--emptyOutDir', '--base ./']) {
  if (!desktopTauriWebBuild.includes(marker)) throw new Error(`XMA Tauri Web staging contract missing: ${marker}`)
}
const desktopDevMainBuild = desktopPackage.scripts?.['main:build:dev'] ?? ''
if (!desktopDevMainBuild.includes('.cache/desktop/electron/dev/main')) throw new Error('XMA Electron dev Main Process must build under .cache/desktop')
const desktopElectronBuild = desktopPackage.scripts?.['build:electron'] ?? ''
if (!desktopElectronBuild.includes('apps/desktop/scripts/electron/build.ts')) throw new Error('XMA Electron release build must use the unified build orchestrator')
const desktopWebDev = desktopPackage.scripts?.['web:dev'] ?? ''
if (!desktopWebDev.includes('exec vite apps/web --host 127.0.0.1 --port 1420 --strictPort')) {
  throw new Error('XMA Desktop web:dev must bind Vite to 127.0.0.1:1420 without forwarding a literal -- argument')
}
if (desktopWebDev.includes(' -- --host')) throw new Error('XMA Desktop web:dev must not pass a literal -- to Vite')
const electronBuildSource = readFileSync('apps/desktop/scripts/electron/build.ts', 'utf8')
for (const marker of ["'.cache', 'desktop', 'electron', 'app'", "'dist', 'release', 'electron'", "'--base', './'", "'--emptyOutDir'", 'ELECTRON_CACHE: electronCache', 'ELECTRON_BUILDER_CACHE: builderCache']) {
  if (!electronBuildSource.includes(marker)) throw new Error(`XMA Electron unified output contract missing: ${marker}`)
}
const electronBuilder = JSON.parse(readFileSync('apps/desktop/electron-builder.json', 'utf8')) as { electronVersion?: string; files?: string[] }
if (electronBuilder.electronVersion !== '41.2.0') throw new Error('XMA Electron builder template must pin Electron 41.2.0')
if (JSON.stringify(electronBuilder.files) !== JSON.stringify(['main/**', 'web/**', 'package.json'])) throw new Error('XMA Electron builder must package only staged main/web/package.json')
const tauriConfig = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8')) as { build?: { frontendDist?: string; beforeBuildCommand?: string } }
if (tauriConfig.build?.frontendDist !== '../../../.cache/desktop/tauri/web') throw new Error('XMA Tauri frontendDist must use .cache/desktop/tauri/web')
if (tauriConfig.build?.beforeBuildCommand !== 'pnpm run web:build:tauri') throw new Error('XMA Tauri build must use the dedicated cache-staging Web build')
const desktopLauncher = readFileSync('apps/desktop/scripts/electron/dev.ts', 'utf8')
if (desktopLauncher.includes('shell: true') || desktopLauncher.includes("shell: process.platform === 'win32'")) {
  throw new Error('XMA Desktop launcher must not use shell:true with child-process arguments (Node DEP0190)')
}
const desktopMain = readFileSync('apps/desktop/src/main.ts', 'utf8')
for (const marker of ["label: '文件'", "label: '编辑'", "label: '视图'", "label: '窗口'", "label: '帮助'"]) {
  if (!desktopMain.includes(marker)) throw new Error(`XMA Desktop Chinese menu regression: missing ${marker}`)
}
const webIndex = readFileSync('apps/web/index.html', 'utf8')
if (!webIndex.includes('lang="zh-CN"') || !webIndex.includes('<title>XMA · 小鱼管理智能体</title>')) {
  throw new Error('XMA Web/Desktop shell must declare the Chinese UI locale and title')
}

console.log('XMA Architecture Gate PASS (TypeScript Agent + Rust Native + plugin compatibility)')
