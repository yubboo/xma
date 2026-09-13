#!/usr/bin/env node
/**
 * 文件作用：XMA `xiaoyu` 命令的产品入口，解析参数并把 Terminal Shell 接到正式 Agent Runtime。
 * 关联模块：tui.ts、core Runtime/Workspace/Session、OpenAI-compatible Provider、Server/Web 发行入口。
 * 当前实现：xiaoyu TUI、Workspace 安全确认、持久 Session、Xiaoyu Code Agent/Skill Context、真实 Provider Catalog/多 Profile/OS Credentials/Brain Ready、Rust-backed 文件 ToolSet/Approval 与 bundled server/web 启动。
 * 职责边界：本文件只做 Product Launcher；Agent 推理、Tool 安全、Provider 协议和 Native 权限必须继续由 Core/Plugin/Rust 层实现。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import {
  AgentRegistry,
  AgentRuntime,
  ContextRegistry,
  CompositeCredentialResolver,
  EnvironmentCredentialResolver,
  JsonlSessionStore,
  ProviderRegistry,
  SkillLoader,
  SkillRegistry,
  StdioNativeClient,
  ToolRegistry,
  WorkspaceRegistry,
  createAgentSkillContextSource,
  type CredentialStoreStatus,
  type Disposer,
  type NativeRuntimeStatus,
  type RuntimeLiveEvent,
  type ToolApprovalProvider,
} from '../../../core/src/index.ts'
import { NativeCredentialStore } from '../../../plugins/providers/credentials.ts'
import {
  CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID,
  builtinProviderCatalogEntry,
  listBuiltinProviderCatalog,
  providerCatalogDisplayName,
} from '../../../plugins/providers/catalog.ts'
import { OpenAiCompatibleAdapter } from '../../../plugins/providers/openai-compatible.ts'
import { registerNativeTools } from '../../../plugins/tools/native.ts'
import { codeAgent } from '../../../agents/code/agent.ts'
import { xiaoyuAgent } from '../../../agents/xiaoyu/agent.ts'
import { confirmWorkspaceTrust, runTui, type BrainProbeView, type DoctorItem, type TerminalAgentMode, type TerminalBackend, type TerminalReasoningEffort } from './tui.ts'
import { TerminalBrainStore, osCredentialKey, profileToProvider, type TerminalBrainProfile } from './brain.ts'

const AGENT_ID = codeAgent.id
const moduleDir = path.dirname(fileURLToPath(import.meta.url))


export function assertCliNativeRuntimeStatus(status: NativeRuntimeStatus): void {
  if (!status.ready || !status.policyConfigured) throw new Error('Native Runtime 未进入 ready/policyConfigured 状态。')
  const requiredCapabilities = ['credential.status', 'credential.read', 'credential.write', 'credential.delete'] as const
  const missingCapabilities = requiredCapabilities.filter(capability => !status.capabilities.includes(capability))
  if (missingCapabilities.length > 0) {
    throw new Error(`XMA Native Runtime 与当前源码不匹配，缺少能力：${missingCapabilities.join(', ')}。请通过 XMA.bat → [4] 重新启动，启动器会先执行 Cargo 离线增量构建。`)
  }
}

export interface ParsedArgs {
  command: 'tui' | 'doctor' | 'server' | 'web' | 'help' | 'version'
  workspace: string
}

function version(): string {
  const versionFile = path.resolve(moduleDir, '..', 'VERSION')
  if (existsSync(versionFile)) return readFileSync(versionFile, 'utf8').trim()
  const packageFile = path.resolve(moduleDir, '../../..', 'package.json')
  if (existsSync(packageFile)) {
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8')) as { version?: string }
    if (pkg.version) return pkg.version
  }
  return '0.1.0'
}

function helpText(currentVersion: string): string {
  return [
    `Xiaoyu Management Agent ${currentVersion}`,
    '',
    '用法：',
    '  xiaoyu [workspace]       打开 Terminal Workbench',
    '  xiaoyu doctor [path]     检查运行环境',
    '  xiaoyu server            启动 Headless Server（发行包）',
    '  xiaoyu web               启动本地 Web + Server（发行包）',
    '  xiaoyu --version',
    '  xiaoyu --help',
    '',
    'Brain：',
    '  在 Terminal 内按 Ctrl+P → Brain / Provider 添加真实 Provider Profile（首批：DeepSeek 官方 API）。',
    '  使用 /model 可从当前 Provider 的真实模型目录切换模型。',
    '  默认把 API Key 安全保存到 OS Credentials；Profile 只保存引用，不保存 Secret。',
    '  自定义 API Key 环境变量仍作为兼容配置方式保留。',
    '  XIAOYU_BASE_URL / XIAOYU_MODEL / XIAOYU_API_KEY 继续作为兼容配置。',
    '',
    '说明：xiaoyu/xma 是同一入口；Desktop、Web、Server 都复用同一个 Core Runtime。',
  ].join('\n')
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv
  const first = normalized[0]
  if (first === '--help' || first === '-h' || first === 'help') return { command: 'help', workspace: process.cwd() }
  if (first === '--version' || first === '-v' || first === 'version') return { command: 'version', workspace: process.cwd() }
  if (first === 'doctor') return { command: 'doctor', workspace: path.resolve(normalized[1] ?? process.cwd()) }
  if (first === 'server') return { command: 'server', workspace: process.cwd() }
  if (first === 'web') return { command: 'web', workspace: process.cwd() }
  return { command: 'tui', workspace: path.resolve(first ?? process.cwd()) }
}

function assertWorkspace(workspace: string): void {
  if (!existsSync(workspace)) throw new Error(`Workspace 不存在：${workspace}`)
  if (!statSync(workspace).isDirectory()) throw new Error(`Workspace 必须是目录：${workspace}`)
}

function workspaceId(workspace: string): string {
  const normalized = platform() === 'win32' ? path.resolve(workspace).toLowerCase() : path.resolve(workspace)
  return `ws-${createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 20)}`
}

function stateRoot(): string {
  if (process.env.XIAOYU_STATE_HOME) return path.resolve(process.env.XIAOYU_STATE_HOME)
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local')
    return path.join(local, 'Xiaoyu', 'state')
  }
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Xiaoyu', 'state')
  return path.join(process.env.XDG_STATE_HOME ?? path.join(homedir(), '.local', 'state'), 'xiaoyu')
}

function skillsRoot(): string {
  const configured = process.env.XIAOYU_SKILLS_HOME?.trim()
  if (configured) return path.resolve(configured)
  return path.resolve(moduleDir, '../../../skills')
}

async function createProductContext(): Promise<ContextRegistry> {
  const agents = new AgentRegistry()
  agents.register(xiaoyuAgent)
  agents.register(codeAgent)
  agents.validateDelegationTargets()

  const loader = new SkillLoader(skillsRoot())
  const skills = new SkillRegistry()
  const ids = [...new Set([...xiaoyuAgent.skills, ...codeAgent.skills])]
  for (const id of ids) skills.register(await loader.load(id))

  const context = new ContextRegistry()
  context.register(createAgentSkillContextSource(agents, skills))
  return context
}

function nativeExecutable(): string | undefined {
  const configured = process.env.XIAOYU_NATIVE_RUNTIME?.trim()
  if (configured) return path.resolve(configured)

  // 源码开发模式允许复用 `[1]/[7]` 已编译的 Kernel；正式 portable launcher 会显式注入 XIAOYU_NATIVE_RUNTIME。
  const nativeName = process.platform === 'win32' ? 'xma-native-runtime.exe' : 'xma-native-runtime'
  const projectRoot = path.resolve(moduleDir, '../../..')
  for (const profile of ['release', 'debug']) {
    const candidate = path.join(projectRoot, '.cache', 'cargo-target', profile, nativeName)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function brainLabel(profile: TerminalBrainProfile | undefined): string {
  if (!profile) return 'Brain 未配置'
  const providerName = providerCatalogDisplayName(profile.providerId)
  const profileName = profile.displayName === providerName ? '' : ` · ${profile.displayName}`
  return `${providerName}${profileName} · ${profile.model}`
}

function doctorItems(
  workspace: string,
  brainStore: TerminalBrainStore,
  osCredentialReadiness: ReadonlyMap<string, boolean> = new Map(),
  credentialStatus?: CredentialStoreStatus,
  brainProbeReady = false,
): readonly DoctorItem[] {
  const active = brainStore.active()
  const activeView = brainStore.list(osCredentialReadiness).find(profile => profile.id === active?.id)
  const native = nativeExecutable()
  const nativeExists = native !== undefined && existsSync(native)
  const credentialReady = active !== undefined && (activeView?.credentialReady ?? true)
  const brainReady = credentialReady && brainProbeReady
  const brainDetail = active
    ? `${brainLabel(active)}${activeView?.credentialReady === false ? ' · 凭据未就绪' : brainProbeReady ? ' · Brain Ready 已验证' : ' · Brain Ready 未验证/未通过'}`
    : '未配置 Provider'
  const skillHome = skillsRoot()
  const skillReady = [
    'common/task-planning/SKILL.md',
    'common/verification/SKILL.md',
    'code/bug-fixing/SKILL.md',
    'code/testing/SKILL.md',
  ].every(relative => existsSync(path.join(skillHome, ...relative.split('/'))))
  return [
    { label: 'Node Runtime', ok: Number(process.versions.node.split('.')[0]) >= 22, detail: `v${process.versions.node}` },
    { label: 'Workspace', ok: true, detail: workspace },
    { label: 'Agent Skills', ok: skillReady, detail: skillReady ? skillHome : `缺少内置 Skill：${skillHome}` },
    { label: 'Session Store', ok: true, detail: path.join(stateRoot(), 'sessions') },
    { label: 'Brain', ok: brainReady, detail: brainDetail },
    {
      label: 'OS Credentials',
      ok: credentialStatus?.available === true,
      detail: credentialStatus
        ? `${credentialStatus.backend}${credentialStatus.detail ? ` · ${credentialStatus.detail}` : ''}`
        : '尚未初始化 Credentials Service',
    },
    { label: 'Native Kernel', ok: nativeExists, detail: nativeExists ? native : '未找到 Native Runtime；文件 Tool 将保持不可用' },
  ]
}

async function createBackend(workspace: string, currentVersion: string): Promise<TerminalBackend> {
  const id = workspaceId(workspace)
  const workspaces = new WorkspaceRegistry()
  workspaces.register({ id, ownerAgentId: AGENT_ID, name: path.basename(workspace) || workspace, root: workspace })

  const sessions = path.join(stateRoot(), 'sessions')
  await mkdir(sessions, { recursive: true })
  const context = await createProductContext()
  const runtime = new AgentRuntime(new JsonlSessionStore(sessions), { context, workspaces, requireWorkspace: true })
  const session = await runtime.createSession({ agentId: AGENT_ID, workspaceId: id })
  const buildTools = new ToolRegistry()
  const planTools = new ToolRegistry()
  const composeTools = new ToolRegistry()
  const brainStore = new TerminalBrainStore()
  const nativePath = nativeExecutable()
  let nativeClient: StdioNativeClient | undefined
  let disposeNativeTools: Disposer | undefined

  if (nativePath !== undefined) {
    if (!existsSync(nativePath)) {
      await runtime.closeAll()
      throw new Error(`XIAOYU_NATIVE_RUNTIME 指向不存在的文件：${nativePath}`)
    }
    nativeClient = new StdioNativeClient({
      executable: nativePath,
      cwd: workspace,
      policy: {
        roots: [workspace],
        programs: [],
        maxReadBytes: 1024 * 1024,
        maxWriteBytes: 1024 * 1024,
        maxProcessOutputBytes: 256 * 1024,
        maxProcessTimeoutMs: 60_000,
      },
    })
    try {
      const status = await nativeClient.status()
      assertCliNativeRuntimeStatus(status)
      // Build 暴露读写；Plan 只暴露只读工具；Compose legacy 不暴露 Workspace 工具。
      // 三种模式仍使用同一个真实 Provider/Model，只改变冻结 ToolPlan 的权限面，不引入隐藏 Planner。
      const buildDisposer = registerNativeTools(buildTools, {
        client: nativeClient,
        workspaceId: id,
        allowedRoots: [workspace],
        defaultCwd: workspace,
        allowedPrograms: [],
      })
      const planDisposer = registerNativeTools(planTools, {
        client: nativeClient,
        workspaceId: id,
        allowedRoots: [workspace],
        defaultCwd: workspace,
        allowedPrograms: [],
        allowWrite: false,
      })
      disposeNativeTools = async () => {
        await planDisposer()
        await buildDisposer()
      }
    } catch (error) {
      await nativeClient.close()
      await runtime.closeAll()
      throw error
    }
  }

  const osCredentials = nativeClient ? new NativeCredentialStore(nativeClient) : undefined
  const providerRegistry = new ProviderRegistry(new CompositeCredentialResolver([
    ...(osCredentials ? [osCredentials] : []),
    new EnvironmentCredentialResolver(),
  ]))
  providerRegistry.registerAdapter(new OpenAiCompatibleAdapter())

  const osCredentialReadiness = new Map<string, boolean>()
  const brainProbeReadiness = new Map<string, boolean>()
  let credentialStatus: CredentialStoreStatus | undefined
  let activeProfile: TerminalBrainProfile | undefined
  let model: ReturnType<ProviderRegistry['createModel']> | undefined

  const refreshCredentialState = async (): Promise<void> => {
    osCredentialReadiness.clear()
    if (osCredentials) {
      try {
        credentialStatus = await osCredentials.status(AbortSignal.timeout(5_000))
      } catch (error) {
        credentialStatus = {
          source: 'os',
          backend: 'native-error',
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    } else {
      credentialStatus = {
        source: 'os',
        backend: 'native-unavailable',
        available: false,
        detail: '未找到 XMA Native Runtime；OS Credentials 不可用。',
      }
    }

    if (!credentialStatus.available || !osCredentials) return
    for (const profile of brainStore.list()) {
      if (profile.credential?.source !== 'os') continue
      try {
        osCredentialReadiness.set(profile.id, await osCredentials.has(profile.credential.key, AbortSignal.timeout(5_000)))
      } catch {
        osCredentialReadiness.set(profile.id, false)
      }
    }
  }

  const refreshBrain = async (): Promise<void> => {
    await refreshCredentialState()
    for (const profile of brainStore.list(osCredentialReadiness)) providerRegistry.saveProfile(profileToProvider(profile))
    activeProfile = brainStore.active()
    model = activeProfile ? providerRegistry.createModel(activeProfile.id) : undefined
  }

  const activeView = () => brainStore.list(osCredentialReadiness).find(profile => profile.id === activeProfile?.id)
  const activeProbeKey = () => activeProfile ? `${activeProfile.id}\u0000${activeProfile.model}` : undefined
  const requireActiveProfile = (): TerminalBrainProfile => {
    if (!activeProfile) throw new Error('Brain 未配置。请在 Ctrl+P → Brain / Provider 中添加 Provider。')
    return activeProfile
  }
  const credentialMissingMessage = (profile: TerminalBrainProfile): string => {
    if (profile.credential?.source === 'env') return `凭据环境变量 ${profile.credential.key} 尚未设置。`
    if (profile.credential?.source === 'os') return 'OS Credentials 中没有此 Provider 的 API Key。'
    return 'Provider 凭据未就绪。'
  }
  const ensureCredentialReady = async (profile: TerminalBrainProfile): Promise<boolean> => {
    if (!profile.credential) return true
    if (profile.credential.source === 'env') return Boolean(process.env[profile.credential.key])
    if (!osCredentials) {
      osCredentialReadiness.set(profile.id, false)
      return false
    }
    try {
      const ready = await osCredentials.has(profile.credential.key, AbortSignal.timeout(5_000))
      osCredentialReadiness.set(profile.id, ready)
      return ready
    } catch {
      osCredentialReadiness.set(profile.id, false)
      return false
    }
  }

  await refreshBrain()

  const doctor = async (): Promise<readonly DoctorItem[]> => {
    await refreshCredentialState()
    const key = activeProbeKey()
    return doctorItems(workspace, brainStore, osCredentialReadiness, credentialStatus, key ? brainProbeReadiness.get(key) === true : false)
  }

  return {
    version: currentVersion,
    workspace,
    agentLabel: 'Xiaoyu Code',
    get providerLabel() {
      return brainLabel(activeProfile)
    },
    get providerConfigured() {
      return Boolean(activeProfile)
    },
    get providerReady() {
      const key = activeProbeKey()
      return Boolean(activeProfile) && (activeView()?.credentialReady ?? true) && Boolean(key && brainProbeReadiness.get(key) === true)
    },
    get reasoningSupported() {
      return activeProfile?.options?.reasoning === true
    },
    get reasoningEffort(): TerminalReasoningEffort {
      const value = activeProfile?.options?.reasoningEffort
      return value === 'low' || value === 'high' || value === 'max' ? value : 'default'
    },
    listBrainProviderCatalog() {
      return listBuiltinProviderCatalog().map(item => ({
        id: item.id,
        displayName: item.displayName,
        description: item.description,
        credentialRequired: item.credentialRequired,
        customEndpoint: item.id === CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID,
      }))
    },
    listBrainProfiles() {
      return brainStore.list(osCredentialReadiness)
    },
    async saveBrainProfile(input) {
      if (input.apiKey && input.credentialEnv) throw new Error('API Key 只能选择 OS Credentials 或环境变量其中一种来源。')
      const preset = builtinProviderCatalogEntry(input.providerId)
      if (!preset) throw new Error(`Provider Catalog 不存在：${input.providerId}`)
      const displayName = input.displayName?.trim() || preset.displayName
      const baseUrl = input.baseUrl?.trim() || preset.baseUrl
      const selectedModel = input.model?.trim() || preset.defaultModel
      if (!baseUrl) throw new Error(`${preset.displayName} 需要 Base URL。`)
      if (!selectedModel) throw new Error(`${preset.displayName} 需要默认模型 ID。`)
      if (preset.credentialRequired && !input.apiKey && !input.credentialEnv?.trim()) {
        throw new Error(`${preset.displayName} 官方 API 需要 API Key。`)
      }

      // 用户可能在启动后才完成 Native rebuild/系统凭据后端恢复；保存前重新读取一次真实状态，禁止使用陈旧 readiness。
      if (input.apiKey) await refreshCredentialState()

      const id = brainStore.allocateId(displayName)
      let storedCredentialKey: string | undefined
      const credential = input.apiKey
          ? (() => {
              if (!osCredentials || credentialStatus?.available !== true) {
                throw new Error(credentialStatus?.detail || 'OS Credentials 当前不可用。')
              }
              const key = osCredentialKey(id)
              storedCredentialKey = key
              return { source: 'os' as const, key }
            })()
          : input.credentialEnv?.trim()
            ? { source: 'env' as const, key: input.credentialEnv.trim() }
            : undefined

      let profile: TerminalBrainProfile
      try {
        if (storedCredentialKey && input.apiKey) {
          await osCredentials!.set(storedCredentialKey, input.apiKey, AbortSignal.timeout(10_000))
          const persisted = await osCredentials!.has(storedCredentialKey, AbortSignal.timeout(5_000))
          if (!persisted) throw new Error('API Key 写入 OS Credentials 后无法读回确认；Provider 未保存。')
        }
        profile = brainStore.upsert({
          id,
          providerId: preset.id,
          adapterId: preset.adapterId,
          displayName,
          baseUrl,
          model: selectedModel,
          ...(credential ? { credential } : {}),
          ...(preset.options ? { options: preset.options } : {}),
        })
      } catch (error) {
        if (storedCredentialKey && osCredentials) {
          try { await osCredentials.delete(storedCredentialKey, AbortSignal.timeout(5_000)) } catch { /* rollback best effort */ }
        }
        throw error
      }
      await refreshBrain()
      const saved = brainStore.list(osCredentialReadiness).find(item => item.id === profile.id)
      if (!saved || !saved.active) throw new Error('Provider 已写入但没有成为当前 Brain；配置状态不一致。')
      return saved
    },
    async selectBrain(profileId) {
      const profile = brainStore.select(profileId)
      await refreshBrain()
      return brainStore.list(osCredentialReadiness).find(item => item.id === profile.id)!
    },
    async listBrainModels() {
      const profile = requireActiveProfile()
      if (!await ensureCredentialReady(profile)) throw new Error(credentialMissingMessage(profile))
      const models = await providerRegistry.listModels(profile.id, AbortSignal.timeout(20_000))
      return models.map(item => item.id)
    },
    async selectBrainModel(modelId) {
      const profile = requireActiveProfile()
      const updated = brainStore.updateModel(profile.id, modelId)
      await refreshBrain()
      return brainStore.list(osCredentialReadiness).find(item => item.id === updated.id)!
    },
    async selectBrainReasoning(effort: TerminalReasoningEffort) {
      const profile = requireActiveProfile()
      const updated = brainStore.updateReasoningEffort(profile.id, effort)
      await refreshBrain()
      return brainStore.list(osCredentialReadiness).find(item => item.id === updated.id)!
    },
    async probeBrain(): Promise<BrainProbeView> {
      const profile = requireActiveProfile()
      const probeKey = `${profile.id}\u0000${profile.model}`
      if (!await ensureCredentialReady(profile)) {
        brainProbeReadiness.set(probeKey, false)
        return { ready: false, latencyMs: 0, message: credentialMissingMessage(profile) }
      }
      const result = await providerRegistry.probe(profile.id, profile.model, AbortSignal.timeout(20_000))
      brainProbeReadiness.set(probeKey, result.ready)
      return {
        ready: result.ready,
        latencyMs: result.latencyMs,
        message: result.ready ? `${profile.displayName} · ${profile.model} 已就绪` : `${result.error?.code ?? 'unknown'} · ${result.error?.message ?? 'Brain Ready 失败'}`,
      }
    },
    async sendMessage(message, mode: TerminalAgentMode, write, signal, approve) {
      const profile = requireActiveProfile()
      if (!model || !await ensureCredentialReady(profile)) throw new Error(`Brain 未配置或凭据未就绪：${credentialMissingMessage(profile)}`)
      const probeKey = `${profile.id}\u0000${profile.model}`
      if (brainProbeReadiness.get(probeKey) !== true) {
        const probe = await providerRegistry.probe(profile.id, profile.model, AbortSignal.timeout(20_000))
        brainProbeReadiness.set(probeKey, probe.ready)
        if (!probe.ready) {
          throw new Error(`Brain Ready 失败：${probe.error?.code ?? 'unknown'} · ${probe.error?.message ?? '真实 Provider Probe 未通过'}`)
        }
      }
      const listener = (event: RuntimeLiveEvent): void => {
        if (event.type === 'model/text-delta' && event.sessionId === session.id) write(event.text)
      }
      const approvals: ToolApprovalProvider = { request: approve }
      const dispose = runtime.subscribe(listener)
      try {
        const modeTools = mode === 'build' ? buildTools : mode === 'plan' ? planTools : composeTools
        await session.runTurn({ provider: model, tools: modeTools, input: message, signal, approvals })
      } finally {
        dispose()
      }
    },
    doctor,
    async close() {
      await disposeNativeTools?.()
      await nativeClient?.close()
      await runtime.closeAll()
    },
  }
}

function bundledEntry(name: 'server.js'): string | undefined {
  const bundled = path.resolve(moduleDir, name)
  if (existsSync(bundled)) return bundled
  const development = path.resolve(moduleDir, '../../../dist/server/main.js')
  return existsSync(development) ? development : undefined
}

async function runServer(mode: 'server' | 'web'): Promise<number> {
  const entry = bundledEntry('server.js')
  if (!entry) {
    process.stderr.write(`当前源码树尚未构建 Server。请先运行构建发布；发行包中的 \`xiaoyu ${mode}\` 会直接使用 bundled Server。\n`)
    return 2
  }
  const env = { ...process.env }
  if (mode === 'web') {
    const bundledWeb = path.resolve(moduleDir, '..', 'web')
    const devWeb = path.resolve(moduleDir, '../../../dist/web')
    env.XIAOYU_WEB_ROOT = existsSync(bundledWeb) ? bundledWeb : devWeb
  }
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { stdio: 'inherit', env, shell: false })
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
}

async function main(): Promise<number> {
  const currentVersion = version()
  const args = parseArgs(process.argv.slice(2))
  if (args.command === 'help') {
    process.stdout.write(`${helpText(currentVersion)}\n`)
    return 0
  }
  if (args.command === 'version') {
    process.stdout.write(`${currentVersion}\n`)
    return 0
  }
  if (args.command === 'server' || args.command === 'web') return runServer(args.command)

  assertWorkspace(args.workspace)
  if (args.command === 'doctor') {
    for (const item of doctorItems(args.workspace, new TerminalBrainStore())) {
      process.stdout.write(`${item.ok ? 'OK' : 'WARN'}\t${item.label}\t${item.detail}\n`)
    }
    return 0
  }

  if (!await confirmWorkspaceTrust(args.workspace)) {
    process.stderr.write('已取消：未授权高风险 Workspace。\n')
    return 3
  }
  const backend = await createBackend(args.workspace, currentVersion)
  await runTui(backend)
  return 0
}

const isDirectEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectEntry) {
  main().then(
    code => { process.exitCode = code },
    error => {
      process.stderr.write(`[xiaoyu] ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
