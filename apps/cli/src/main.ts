#!/usr/bin/env node
/**
 * 文件作用：XMA `xiaoyu` 命令的产品入口，解析参数并把 Terminal Shell 接到正式 Agent Runtime。
 * 关联模块：tui.ts、core Runtime/Workspace/Session、OpenAI-compatible Provider、Server/Web 发行入口。
 * 当前实现：xiaoyu TUI、Workspace 安全确认、持久 Session、Xiaoyu Code Agent/Skill Context、用户级非 Secret Brain Profile/环境兼容 Provider、Rust-backed 文件 ToolSet/Approval 与 bundled server/web 启动。
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
  EnvironmentCredentialResolver,
  JsonlSessionStore,
  ProviderRegistry,
  SkillLoader,
  SkillRegistry,
  StdioNativeClient,
  ToolRegistry,
  WorkspaceRegistry,
  createAgentSkillContextSource,
  type Disposer,
  type RuntimeLiveEvent,
  type ToolApprovalProvider,
} from '../../../core/src/index.ts'
import { OpenAiCompatibleAdapter } from '../../../plugins/providers/openai-compatible.ts'
import { registerNativeTools } from '../../../plugins/tools/native.ts'
import { codeAgent } from '../../../agents/code/agent.ts'
import { xiaoyuAgent } from '../../../agents/xiaoyu/agent.ts'
import { confirmWorkspaceTrust, runTui, type BrainProbeView, type DoctorItem, type TerminalBackend } from './tui.ts'
import { TerminalBrainStore, profileToProvider, type TerminalBrainProfile } from './brain.ts'

const AGENT_ID = codeAgent.id
const moduleDir = path.dirname(fileURLToPath(import.meta.url))

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
    '  在 Terminal 内按 Ctrl+P → Brain / Provider 添加 OpenAI-compatible Profile。',
    '  Profile 只保存 Base URL / Model / API Key 环境变量名，不保存 Secret。',
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
  return profile ? `${profile.displayName} · ${profile.model}` : 'Brain 未配置'
}

function doctorItems(workspace: string, brainStore: TerminalBrainStore): readonly DoctorItem[] {
  const active = brainStore.active()
  const activeView = brainStore.list().find(profile => profile.id === active?.id)
  const native = nativeExecutable()
  const nativeExists = native !== undefined && existsSync(native)
  const brainReady = active !== undefined && (activeView?.credentialReady ?? true)
  const brainDetail = active
    ? `${brainLabel(active)}${activeView?.credentialReady === false ? ' · 凭据环境变量未设置' : ''}`
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
  const tools = new ToolRegistry()
  const brainStore = new TerminalBrainStore()
  const providerRegistry = new ProviderRegistry(new EnvironmentCredentialResolver())
  providerRegistry.registerAdapter(new OpenAiCompatibleAdapter())
  const nativePath = nativeExecutable()
  let nativeClient: StdioNativeClient | undefined
  let disposeNativeTools: Disposer | undefined
  let activeProfile: TerminalBrainProfile | undefined
  let model: ReturnType<ProviderRegistry['createModel']> | undefined

  const refreshBrain = (): void => {
    for (const profile of brainStore.list()) providerRegistry.saveProfile(profileToProvider(profile))
    activeProfile = brainStore.active()
    model = activeProfile ? providerRegistry.createModel(activeProfile.id) : undefined
  }

  const activeView = () => brainStore.list().find(profile => profile.id === activeProfile?.id)
  const requireActiveProfile = (): TerminalBrainProfile => {
    if (!activeProfile) throw new Error('Brain 未配置。请在 Ctrl+P → Brain / Provider 中添加 Provider。')
    return activeProfile
  }

  refreshBrain()

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
      if (!status.ready || !status.policyConfigured) throw new Error('Native Runtime 未进入 ready/policyConfigured 状态。')
      // Terminal 当前只开放文件读写；process.run 在绝对程序白名单配置面完成前保持不注册。
      disposeNativeTools = registerNativeTools(tools, {
        client: nativeClient,
        workspaceId: id,
        allowedRoots: [workspace],
        defaultCwd: workspace,
        allowedPrograms: [],
      })
    } catch (error) {
      await nativeClient.close()
      await runtime.closeAll()
      throw error
    }
  }

  const doctor = async (): Promise<readonly DoctorItem[]> => doctorItems(workspace, brainStore)

  return {
    version: currentVersion,
    workspace,
    agentLabel: 'Xiaoyu Code',
    get providerLabel() {
      return brainLabel(activeProfile)
    },
    get providerReady() {
      return Boolean(activeProfile) && (activeView()?.credentialReady ?? true)
    },
    listBrainProfiles() {
      return brainStore.list()
    },
    async saveBrainProfile(input) {
      const profile = brainStore.upsert(input)
      refreshBrain()
      return brainStore.list().find(item => item.id === profile.id)!
    },
    async selectBrain(profileId) {
      const profile = brainStore.select(profileId)
      refreshBrain()
      return brainStore.list().find(item => item.id === profile.id)!
    },
    async listBrainModels() {
      const profile = requireActiveProfile()
      if (activeView()?.credentialReady === false) throw new Error(`凭据环境变量 ${profile.credentialEnv} 尚未设置。`)
      const models = await providerRegistry.listModels(profile.id, AbortSignal.timeout(20_000))
      return models.map(item => item.id)
    },
    async selectBrainModel(modelId) {
      const profile = requireActiveProfile()
      const updated = brainStore.updateModel(profile.id, modelId)
      refreshBrain()
      return brainStore.list().find(item => item.id === updated.id)!
    },
    async probeBrain(): Promise<BrainProbeView> {
      const profile = requireActiveProfile()
      if (activeView()?.credentialReady === false) {
        return { ready: false, latencyMs: 0, message: `凭据环境变量 ${profile.credentialEnv} 尚未设置。` }
      }
      const result = await providerRegistry.probe(profile.id, profile.model, AbortSignal.timeout(20_000))
      return {
        ready: result.ready,
        latencyMs: result.latencyMs,
        message: result.ready ? `${profile.displayName} · ${profile.model} 已就绪` : `${result.error?.code ?? 'unknown'} · ${result.error?.message ?? 'Brain Ready 失败'}`,
      }
    },
    async sendMessage(message, write, signal, approve) {
      if (!model || activeView()?.credentialReady === false) throw new Error('Brain 未配置或凭据未就绪。')
      const listener = (event: RuntimeLiveEvent): void => {
        if (event.type === 'model/text-delta' && event.sessionId === session.id) write(event.text)
      }
      const approvals: ToolApprovalProvider = { request: approve }
      const dispose = runtime.subscribe(listener)
      try {
        await session.runTurn({ provider: model, tools, input: message, signal, approvals })
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
