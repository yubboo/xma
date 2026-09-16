/**
 * 文件作用：实现 Xiaoyu Terminal 的 OpenTUI 主工作台，统一真实输入焦点、响应式布局、命令面板与模型配置交互。
 * 关联模块：main.ts、tui.ts 纯合同/Workspace Trust、brain.ts、xma-agent-loop Runtime 与 Provider/Tool 后端。
 * 当前实现：使用 @opentui/core + @opentui/solid 的 CliRenderer/Textarea 原生输入，提供平滑星空/流星、首帧即时 + 缓冲打字机流式对话、底部锚定会话区、Turn 实时计时/可展开公开活动日志、Build/Plan/Compose、命令搜索、Provider/Model/Reasoning 与 Tool Approval。
 * 职责边界：本文件只负责 Terminal Host 视觉与交互；不得复制 Agent Loop、Provider 协议、Session durable truth 或 Native 安全策略。
 */

import {
  createCliRenderer,
  decodePasteBytes,
  type KeyEvent,
  type PasteEvent,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from '@opentui/core'
import { render, useKeyboard, usePaste, useRenderer, useTerminalDimensions } from '@opentui/solid'
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { ToolApprovalDecision, ToolApprovalRequest } from 'xma-tools'
import {
  applyTerminalRunEvent,
  commandPaletteOptions,
  DEFAULT_TERMINAL_UI_SETTINGS,
  cycleTerminalAgentMode,
  loadTerminalUiSettings,
  needsInitialBrainSetup,
  saveTerminalUiSettings,
  terminalHomeTip,
  toggleTerminalVisual,
  type BrainProviderCatalogItem,
  type TerminalActivityEntry,
  type TerminalActivitySummary,
  type TerminalAgentMode,
  type TerminalBackend,
  type TerminalReasoningEffort,
  type TerminalRunEvent,
  type TerminalTranscriptItem,
  type TerminalUiSettings,
} from '../src/tui.ts'
import type { TuiMenuItem } from '../src/tui-menu.ts'
import { openTuiContentWidth } from '../src/opentui-layout.ts'
import { BackgroundSky } from './ui/background-sky.tsx'
import { TranscriptViewport } from './ui/transcript-viewport.tsx'
import { PromptDock } from './ui/prompt-dock.tsx'
import { HomeLogo } from './ui/home-logo.tsx'
import { ApprovalDialog, InputDialog, ListDialog } from './ui/dialogs.tsx'
import { toolCallActivityText, toolResultActivityText } from './ui/activity-format.ts'
import { COLOR, MODE_META } from './ui/theme.ts'

interface NoticeState {
  text: string
  until: number
}

type ActivityState = 'idle' | 'thinking' | 'streaming' | 'tool'

type DialogState =
  | {
      kind: 'list'
      title: string
      items: readonly TuiMenuItem[]
      searchable: boolean
      allowCancel: boolean
      resolve: (value: string | undefined) => void
    }
  | {
      kind: 'input'
      title: string
      description: string
      initial: string
      secret: boolean
      allowCancel: boolean
      resolve: (value: string | undefined) => void
    }
  | {
      kind: 'approval'
      request: ToolApprovalRequest
      resolve: (value: ToolApprovalDecision) => void
    }

function XiaoyuApp(props: { backend: TerminalBackend; onExit: () => void }) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [settings, setSettings] = createSignal<TerminalUiSettings>(loadTerminalUiSettings())
  const [mode, setMode] = createSignal<TerminalAgentMode>('build')
  const [transcript, setTranscript] = createSignal<TerminalTranscriptItem[]>([])
  const [busy, setBusy] = createSignal(false)
  const [activity, setActivity] = createSignal<ActivityState>('idle')
  const [notice, setNotice] = createSignal<NoticeState | undefined>()
  const [dialog, setDialog] = createSignal<DialogState | undefined>()
  const [setupFlow, setSetupFlow] = createSignal({ active: false, message: '' })
  // OpenTUI 的 focused Textarea 独占真实 terminal cursor；父级工作台不得再用定时器模拟闪烁或抢占 caret。
  const [tipIndex, setTipIndex] = createSignal(0)
  const [clock, setClock] = createSignal(Date.now())
  let prompt: TextareaRenderable | undefined
  let transcriptScroll: ScrollBoxRenderable | undefined
  let controller: AbortController | undefined
  let bufferedEvents: TerminalRunEvent[] = []
  let bufferedCharacters = 0
  let hasProjectedRunEvent = false
  let activeRunStartedAt = 0
  let activeRunActivityId = 0
  let activeRunEntries: TerminalActivityEntry[] = []
  let activeRunReasoningLogged = false
  let activeRunAnswerLogged = false
  let drainResolvers: Array<() => void> = []

  const contentWidth = createMemo(() => openTuiContentWidth(dimensions().width))
  const compactLogo = createMemo(() => settings().logo === 'compact' || dimensions().width < 82 || transcript().length > 0)
  const showLogo = createMemo(() => transcript().length === 0 && dialog() === undefined)
  const providerConfigured = createMemo(() => { clock(); return props.backend.providerConfigured })
  const providerReady = createMemo(() => { clock(); return props.backend.providerReady })
  const providerLabel = createMemo(() => { clock(); return props.backend.providerLabel })
  const reasoningEffort = createMemo(() => { clock(); return props.backend.reasoningEffort })
  const providerStatus = createMemo(() => providerConfigured()
    ? {
        dot: providerReady() ? '●' : '○',
        dotColor: providerReady() ? COLOR.green : COLOR.yellow,
        label: `${providerLabel()} · ${providerReady() ? '模型已就绪' : '凭据未就绪'}`,
      }
    : {
        dot: '○',
        dotColor: COLOR.yellow,
        label: '模型未配置 · Ctrl+P /provider',
      })
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)
  const spinnerGlyph = createMemo(() => ['✦', '✧', '·', '✧'][spinnerFrame() % 4]!)
  const tip = createMemo(() => {
    clock()
    if (busy()) {
      const state = activity()
      const label = state === 'thinking'
        ? '正在思考…'
        : state === 'streaming'
          ? '正在生成回复…'
          : state === 'tool'
            ? '正在执行工具…'
            : '正在工作…'
      return `${spinnerGlyph()} Xiaoyu ${label} · Ctrl+C 中止`
    }
    const active = notice()
    if (active && active.until > Date.now()) return active.text
    return terminalHomeTip(tipIndex(), providerConfigured(), providerReady())
  })

  const tell = (text: string, duration = 5200) => {
    setNotice({ text, until: Date.now() + duration })
    setClock(Date.now())
  }
  const refresh = () => {
    setClock(Date.now())
    renderer.requestRender()
  }
  const refocusPrompt = () => queueMicrotask(() => {
    if (setupFlow().active || dialog() !== undefined) return
    prompt?.focus()
    prompt?.requestRender()
  })
  const setSetupStage = (message: string) => {
    if (!setupFlow().active) return
    setSetupFlow({ active: true, message })
    renderer.requestRender()
  }
  const settleEventDrain = () => {
    if (bufferedEvents.length > 0) return
    const resolvers = drainResolvers
    drainResolvers = []
    for (const resolve of resolvers) resolve()
  }
  const projectRunEvent = (event: TerminalRunEvent) => {
    setTranscript(current => {
      const next = current.map(item => ({ ...item }))
      applyTerminalRunEvent(next, event)
      return next
    })
    renderer.requestRender()
  }
  const activeElapsedMs = () => activeRunStartedAt > 0 ? Math.max(0, Date.now() - activeRunStartedAt) : 0
  const activeRunId = () => `run-${activeRunActivityId}`
  const syncActiveRunActivity = () => {
    if (activeRunStartedAt <= 0) return
    const id = activeRunId()
    const elapsedMs = activeElapsedMs()
    const entries = activeRunEntries.map(entry => ({ ...entry }))
    setTranscript(current => current.map(item => item.role === 'activity' && item.activity?.id === id
      ? { ...item, activity: { ...item.activity, startedAtMs: activeRunStartedAt, elapsedMs, entries } }
      : item))
    renderer.requestRender()
  }
  const recordRunActivity = (entry: Omit<TerminalActivityEntry, 'elapsedMs'>) => {
    activeRunEntries.push({ ...entry, elapsedMs: activeElapsedMs() })
    syncActiveRunActivity()
  }
  const resetRunActivity = (): TerminalActivitySummary => {
    activeRunStartedAt = Date.now()
    activeRunActivityId += 1
    activeRunEntries = []
    activeRunReasoningLogged = false
    activeRunAnswerLogged = false
    return {
      id: activeRunId(),
      startedAtMs: activeRunStartedAt,
      elapsedMs: 0,
      outcome: 'running',
      expanded: false,
      entries: [],
    }
  }
  const finalizeRunActivity = (outcome: Exclude<TerminalActivitySummary['outcome'], 'running'>, endedAtMs = Date.now()) => {
    const id = activeRunId()
    const elapsedMs = activeRunStartedAt > 0 ? Math.max(0, endedAtMs - activeRunStartedAt) : 0
    const entries = activeRunEntries.length > 0
      ? activeRunEntries.map(entry => ({ ...entry }))
      : [{ kind: 'status' as const, text: outcome === 'completed' ? '生成回复' : outcome === 'cancelled' ? '响应已中止' : '响应失败', elapsedMs }]
    setTranscript(current => current.map(item => item.role === 'activity' && item.activity?.id === id
      ? {
          ...item,
          activity: {
            ...item.activity,
            startedAtMs: activeRunStartedAt,
            elapsedMs,
            outcome,
            entries,
          },
        }
      : item))
    activeRunStartedAt = 0
    activeRunEntries = []
    renderer.requestRender()
  }
  const toggleRunActivity = (id: string) => {
    setTranscript(current => current.map(item => item.role === 'activity' && item.activity?.id === id
      ? { ...item, activity: { ...item.activity, expanded: !item.activity.expanded, entries: item.activity.entries.map(entry => ({ ...entry })) } }
      : item))
    renderer.requestRender()
  }
  const enqueueBufferedRunEvent = (event: TerminalRunEvent) => {
    bufferedEvents.push({ ...event })
    if (event.type === 'text-delta') bufferedCharacters += Array.from(event.text).length
  }
  const enqueueRunEvent = (event: TerminalRunEvent) => {
    // 中文说明：Provider 的原始 reasoning 正文绝不进入默认 Transcript；这里只保留一个公开的活动阶段。
    // 展开的“用时”面板只能展示 Runtime 允许公开的状态、Tool Call 与 Tool Result 摘要，不能借机暴露隐藏思维链。
    if (event.type === 'reasoning-delta') {
      if (event.text.length === 0) return
      if (!activeRunReasoningLogged) {
        activeRunReasoningLogged = true
        recordRunActivity({ kind: 'status', text: '模型思考与规划' })
      }
      setActivity('thinking')
      renderer.requestRender()
      return
    }
    if (event.type === 'tool-call') {
      recordRunActivity({ kind: 'tool-call', text: toolCallActivityText(event) })
      setActivity('tool')
      renderer.requestRender()
      return
    }
    if (event.type === 'tool-result') {
      recordRunActivity({ kind: 'tool-result', text: toolResultActivityText(event), ok: event.ok })
      setActivity('tool')
      renderer.requestRender()
      return
    }
    if (event.text.length === 0) return
    if (!activeRunAnswerLogged) {
      activeRunAnswerLogged = true
      recordRunActivity({ kind: 'status', text: '开始生成最终回复' })
    }
    setActivity('streaming')

    // 中文说明：首个用户可见 text delta 必须在 Provider 回调这一帧立即投影，不能等 30ms 打字机定时器。
    if (!hasProjectedRunEvent) {
      hasProjectedRunEvent = true
      const characters = Array.from(event.text)
      const immediateCount = Math.min(3, characters.length)
      const immediate = characters.slice(0, immediateCount).join('')
      const remaining = characters.slice(immediateCount).join('')
      if (immediate) projectRunEvent({ ...event, text: immediate })
      if (remaining) enqueueBufferedRunEvent({ ...event, text: remaining })
      return
    }

    enqueueBufferedRunEvent(event)
  }
  const pumpRunEvents = () => {
    const event = bufferedEvents[0]
    if (!event) {
      settleEventDrain()
      return
    }
    let projected: TerminalRunEvent = event
    if (event.type === 'text-delta') {
      const characters = Array.from(event.text)
      const batchSize = bufferedCharacters > 360 ? 18 : bufferedCharacters > 180 ? 10 : bufferedCharacters > 80 ? 6 : 3
      const count = Math.min(batchSize, characters.length)
      const chunk = characters.slice(0, count).join('')
      const remaining = characters.slice(count).join('')
      bufferedCharacters = Math.max(0, bufferedCharacters - count)
      projected = { ...event, text: chunk }
      if (remaining) bufferedEvents[0] = { ...event, text: remaining }
      else bufferedEvents.shift()
    } else {
      bufferedEvents.shift()
    }
    projectRunEvent(projected)
    settleEventDrain()
  }
  const waitForEventDrain = () => bufferedEvents.length === 0
    ? Promise.resolve()
    : new Promise<void>(resolve => { drainResolvers.push(resolve) })
  const clearEventBuffer = () => {
    bufferedEvents = []
    bufferedCharacters = 0
    hasProjectedRunEvent = false
    settleEventDrain()
  }

  const closeDialog = () => {
    setDialog(undefined)
    refocusPrompt()
  }
  const askList = (title: string, items: readonly TuiMenuItem[], options: { searchable?: boolean; allowCancel?: boolean } = {}) => new Promise<string | undefined>(resolve => {
    prompt?.blur()
    renderer.setCursorPosition(0, 0, false)
    setDialog({
      kind: 'list',
      title,
      items,
      searchable: options.searchable === true,
      allowCancel: options.allowCancel !== false,
      resolve: value => { closeDialog(); resolve(value) },
    })
  })
  const askInput = (title: string, description: string, initial = '', options: { secret?: boolean; allowCancel?: boolean } = {}) => new Promise<string | undefined>(resolve => {
    prompt?.blur()
    renderer.setCursorPosition(0, 0, false)
    setDialog({
      kind: 'input',
      title,
      description,
      initial,
      secret: options.secret === true,
      allowCancel: options.allowCancel !== false,
      resolve: value => { closeDialog(); resolve(value) },
    })
  })
  const askApproval = (request: ToolApprovalRequest, signal: AbortSignal) => new Promise<ToolApprovalDecision>(resolve => {
    if (signal.aborted) { resolve('deny'); return }
    prompt?.blur()
    renderer.setCursorPosition(0, 0, false)
    const onAbort = () => {
      setDialog(current => current?.kind === 'approval' ? undefined : current)
      resolve('deny')
      refocusPrompt()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    setDialog({
      kind: 'approval',
      request,
      resolve: value => {
        signal.removeEventListener('abort', onAbort)
        closeDialog()
        resolve(value)
      },
    })
  })

  const profileItems = (): TuiMenuItem[] => {
    const profiles = props.backend.listBrainProfiles()
    const active = profiles.find(profile => profile.active)
    const items: TuiMenuItem[] = [
      { value: 'catalog', label: '添加提供方', description: '新增官方提供方' },
      { value: 'add-env', label: '自定义提供方', description: 'OpenAI 兼容接口' },
    ]
    if (active) {
      items.push(
        { value: 'probe', label: '连接测试', description: `${active.displayName} · ${active.model}` },
        { value: 'models', label: '选择模型', description: `当前：${active.model}` },
        ...(props.backend.reasoningSupported ? [{ value: 'reasoning', label: '推理强度', description: `当前：${props.backend.reasoningEffort}` }] : []),
      )
    }
    const providers = new Map(props.backend.listBrainProviderCatalog().map(item => [item.id, item.displayName]))
    for (const profile of profiles) {
      const providerName = providers.get(profile.providerId) ?? profile.providerId
      const profileLabel = profile.providerId === 'custom-openai-compatible' ? profile.displayName : providerName
      items.push({
        value: `select:${profile.id}`,
        label: `${profile.active ? '●' : '○'} ${profileLabel}`,
        description: profile.model,
      })
    }
    return items
  }

  const modelDescription = (providerId: string, model: string): string => {
    if (providerId !== 'deepseek') return ''
    if (model === 'deepseek-v4-pro') return 'V4 Pro 0813 · 正式版 · Agent / 复杂任务'
    if (model === 'deepseek-v4-flash') return 'V4 Flash 0731 · 正式版 · 高吞吐'
    if (model === 'deepseek-v4-flash-vision-exp') return 'V4 Flash Vision · 实验多模态 · 当前终端以文本为主'
    return 'DeepSeek API 动态发现模型'
  }

  const selectModel = async (_initialSetup = false): Promise<boolean> => {
    if (!props.backend.providerConfigured) {
      tell('模型未配置 · 请先配置模型 / 提供方')
      return false
    }
    tell('正在读取提供方的真实模型列表…', 30_000)
    if (_initialSetup) setSetupStage('API Key 已保存 · 正在读取最新模型…')
    try {
      const models = await props.backend.listBrainModels()
      if (models.length === 0) {
        tell('提供方没有返回模型列表；保留当前模型 ID。')
        return false
      }
      const active = props.backend.listBrainProfiles().find(profile => profile.active)
      const providerId = active?.providerId ?? ''
      const value = await askList('选择真实模型', models.slice(0, 100).map(model => ({
        value: model,
        label: model,
        description: modelDescription(providerId, model),
      })), { searchable: true })
      if (!value) return false
      const profile = await props.backend.selectBrainModel(value)
      tell(`模型已切换 · ${profile.displayName} · ${profile.model}`)
      refresh()
      return true
    } catch (error) {
      tell(`模型列表读取失败 · ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const selectReasoning = async (_initialSetup = false): Promise<boolean> => {
    if (!props.backend.reasoningSupported) return true
    const current = props.backend.reasoningEffort
    const value = await askList('选择推理强度', [
      { value: 'default', label: `${current === 'default' ? '● ' : ''}默认`, description: '使用提供方默认推理强度' },
      { value: 'low', label: `${current === 'low' ? '● ' : ''}低`, description: '低推理强度' },
      { value: 'high', label: `${current === 'high' ? '● ' : ''}高`, description: '高推理强度' },
      { value: 'max', label: `${current === 'max' ? '● ' : ''}最大`, description: '最大推理强度（提供方支持时）' },
    ], { allowCancel: true })
    if (!value) return false
    try {
      const profile = await props.backend.selectBrainReasoning(value as TerminalReasoningEffort)
      tell(`推理强度已切换 · ${profile.model} · ${props.backend.reasoningEffort}`)
      refresh()
      return true
    } catch (error) {
      tell(`推理强度切换失败 · ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const probe = async (): Promise<boolean> => {
    tell('正在执行连接测试…', 30_000)
    try {
      const result = await props.backend.probeBrain()
      tell(`${result.ready ? '连接测试通过' : '连接测试失败'} · ${result.latencyMs}ms · ${result.message}`, 8000)
      refresh()
      return result.ready
    } catch (error) {
      tell(`连接测试失败 · ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const configureProvider = async (providerId: string, credentialMode: 'os' | 'env', initialSetup: boolean): Promise<boolean> => {
    const provider = props.backend.listBrainProviderCatalog().find(item => item.id === providerId)
    if (!provider) { tell(`提供方目录不存在：${providerId}`); return false }
    const profiles = props.backend.listBrainProfiles().filter(item => item.providerId === providerId && item.source === 'config')
    const displayName = provider.customEndpoint && profiles.length > 0 ? `${provider.displayName} ${profiles.length + 1}` : provider.displayName
    let baseUrl: string | undefined
    let model: string | undefined
    if (provider.customEndpoint) {
      baseUrl = await askInput('Base URL', '例如：https://api.example.com/v1', '', { allowCancel: true })
      if (baseUrl === undefined) return false
      model = await askInput('默认模型 ID', '填写接口支持的 Model ID', '', { allowCancel: true })
      if (model === undefined) return false
    }
    const credential = credentialMode === 'os'
      ? await askInput('API Key', provider.credentialRequired ? '保存到系统凭据库，不回显' : '保存到系统凭据库；可留空', '', { secret: true, allowCancel: true })
      : await askInput('API Key 环境变量', '仅保存环境变量名；可留空', 'XIAOYU_API_KEY', { allowCancel: true })
    if (credential === undefined) return false
    if (credentialMode === 'os' && provider.credentialRequired && !credential.trim()) {
      tell(`${provider.displayName} 官方 API 需要 API Key。`)
      return false
    }
    try {
      const profile = await props.backend.saveBrainProfile({
        providerId,
        displayName,
        ...(baseUrl !== undefined ? { baseUrl: baseUrl.trim() } : {}),
        ...(model !== undefined ? { model: model.trim() } : {}),
        ...(credentialMode === 'os' && credential ? { apiKey: credential } : {}),
        ...(credentialMode === 'env' && credential.trim() ? { credentialEnv: credential.trim() } : {}),
      })
      tell(`提供方已保存 · ${profile.displayName} · 正在读取真实模型…`, 30_000)
      refresh()
      if (initialSetup) setSetupStage('API Key 已保存 · 下一步选择模型')
      const modelSelected = await selectModel(initialSetup)
      if (!modelSelected) return false
      if (initialSetup) setSetupStage('模型已选择 · 下一步选择推理强度')
      const reasoningSelected = await selectReasoning(initialSetup)
      if (!reasoningSelected) return false
      if (initialSetup) setSetupStage('模型已配置 · 已就绪')
      tell(`模型已就绪 · ${profile.displayName} · ${props.backend.providerLabel}`, 5200)
      refresh()
      return true
    } catch (error) {
      tell(`提供方保存失败 · ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const providerCatalog = async (initialSetup: boolean): Promise<boolean> => {
    const catalog = props.backend.listBrainProviderCatalog()
    const value = await askList(initialSetup ? '配置 Xiaoyu 模型' : '添加提供方', catalog.map((item: BrainProviderCatalogItem) => ({
      value: item.id,
      label: item.customEndpoint ? '自定义接口' : item.displayName,
      description: item.customEndpoint ? 'OpenAI 兼容 · 自定义 Base URL' : '官方 API · 自动读取模型',
      keywords: [item.id, item.displayName],
    })), { searchable: true })
    if (!value) return false
    return configureProvider(value, 'os', initialSetup)
  }

  const providerManager = async (initialSetup = false): Promise<void> => {
    while (true) {
      const value = await askList(initialSetup ? '配置 Xiaoyu 模型' : '模型 / 提供方', profileItems(), { allowCancel: true })
      if (!value) return
      try {
        if (value === 'catalog') {
          const ready = await providerCatalog(initialSetup)
          if (initialSetup && ready) return
          continue
        }
        if (value === 'add-env') {
          const ready = await configureProvider('custom-openai-compatible', 'env', initialSetup)
          if (initialSetup && ready) return
          continue
        }
        if (value === 'probe') {
          const ready = await probe()
          if (initialSetup && ready) return
          continue
        }
        if (value === 'models') { await selectModel(initialSetup); continue }
        if (value === 'reasoning') { await selectReasoning(initialSetup); continue }
        if (value.startsWith('select:')) {
          const profile = await props.backend.selectBrain(value.slice('select:'.length))
          tell(`模型配置已切换 · ${profile.displayName} · ${profile.model} · 已就绪`)
          refresh()
          if (initialSetup) return
        }
      } catch (error) {
        tell(`模型配置操作失败 · ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const commitSettings = (next: TerminalUiSettings, message: string) => {
    setSettings(next)
    saveTerminalUiSettings(next)
    tell(message, 3200)
    refresh()
  }

  const appearanceSettingsDialog = async (): Promise<void> => {
    while (true) {
      const current = settings()
      const value = await askList('设置 · 外观', [
        {
          value: 'visual',
          label: '显示模式',
          description: `当前：${current.visual === 'vivid' ? '丰富模式' : '简洁模式'} · 丰富模式允许动画特效`,
        },
        {
          value: 'logo',
          label: 'Logo 模式',
          description: `当前：${current.logo === 'auto' ? '自动' : '紧凑'} · 对话后自动收起大 Logo`,
        },
        { value: 'back', label: '返回上一级', description: '返回设置' },
      ])
      if (!value || value === 'back') return
      if (value === 'visual') {
        const next = toggleTerminalVisual(settings())
        commitSettings(next, `显示模式 · ${next.visual === 'vivid' ? '丰富模式' : '简洁模式'}`)
        continue
      }
      if (value === 'logo') {
        const next = { ...settings(), logo: settings().logo === 'auto' ? 'compact' as const : 'auto' as const }
        commitSettings(next, `Logo 模式 · ${next.logo === 'auto' ? '自动' : '紧凑'}`)
      }
    }
  }

  const effectsSettingsDialog = async (): Promise<void> => {
    while (true) {
      const current = settings()
      const enabledCount = [current.stars, current.meteors, current.logoGradient].filter(Boolean).length
      const value = await askList('设置 · 特效', [
        {
          value: 'stars',
          label: '星星闪烁',
          description: `当前：${current.stars ? '开启' : '关闭'} · 背景星点独立呼吸闪烁`,
        },
        {
          value: 'meteors',
          label: '流星坠落',
          description: `当前：${current.meteors ? '开启' : '关闭'} · 右上 → 左下的点阵长尾流星`,
        },
        {
          value: 'logo-gradient',
          label: 'Logo 颜色渐变',
          description: `当前：${current.logoGradient ? '开启' : '关闭'} · 每隔数秒扫过高亮色带`,
        },
        {
          value: 'all-effects',
          label: '全部特效',
          description: `当前：${enabledCount === 3 ? '全部开启' : enabledCount === 0 ? '全部关闭' : '部分开启'} · 一键切换`,
        },
        { value: 'back', label: '返回上一级', description: '返回设置' },
      ])
      if (!value || value === 'back') return
      if (value === 'stars') {
        const next = { ...settings(), stars: !settings().stars }
        commitSettings(next, `星星闪烁 · ${next.stars ? '开启' : '关闭'}`)
        continue
      }
      if (value === 'meteors') {
        const next = { ...settings(), meteors: !settings().meteors }
        commitSettings(next, `流星坠落 · ${next.meteors ? '开启' : '关闭'}`)
        continue
      }
      if (value === 'logo-gradient') {
        const next = { ...settings(), logoGradient: !settings().logoGradient }
        commitSettings(next, `Logo 颜色渐变 · ${next.logoGradient ? '开启' : '关闭'}`)
        continue
      }
      if (value === 'all-effects') {
        const enable = enabledCount !== 3
        const next = { ...settings(), stars: enable, meteors: enable, logoGradient: enable }
        commitSettings(next, `全部特效 · ${enable ? '开启' : '关闭'}`)
      }
    }
  }

  const systemSettingsDialog = async (): Promise<void> => {
    while (true) {
      const current = settings()
      const value = await askList('设置 · 系统', [
        {
          value: 'tips',
          label: '提示信息',
          description: `当前：${current.tips ? '开启' : '关闭'} · 首页底部轮播快捷提示`,
        },
        {
          value: 'reset',
          label: '恢复默认设置',
          description: '恢复丰富模式、星星、流星、Logo 渐变与提示',
        },
        { value: 'back', label: '返回上一级', description: '返回设置' },
      ])
      if (!value || value === 'back') return
      if (value === 'tips') {
        const next = { ...settings(), tips: !settings().tips }
        commitSettings(next, `提示信息 · ${next.tips ? '开启' : '关闭'}`)
        continue
      }
      if (value === 'reset') {
        commitSettings({ ...DEFAULT_TERMINAL_UI_SETTINGS }, '终端设置 · 已恢复默认值')
      }
    }
  }

  const settingsDialog = async (): Promise<void> => {
    while (true) {
      const current = settings()
      const value = await askList('设置', [
        {
          value: 'appearance',
          label: '外观',
          description: `${current.visual === 'vivid' ? '丰富' : '简洁'} · Logo ${current.logo === 'auto' ? '自动' : '紧凑'} · 进入子菜单`,
        },
        {
          value: 'effects',
          label: '特效',
          description: `星星 ${current.stars ? '开' : '关'} · 流星 ${current.meteors ? '开' : '关'} · Logo 渐变 ${current.logoGradient ? '开' : '关'}`,
        },
        {
          value: 'system',
          label: '系统',
          description: `提示 ${current.tips ? '开' : '关'} · 默认设置 · 进入子菜单`,
        },
        { value: 'back', label: '返回命令面板', description: '返回 Ctrl+P 命令' },
      ])
      if (!value || value === 'back') return
      if (value === 'appearance') { await appearanceSettingsDialog(); continue }
      if (value === 'effects') { await effectsSettingsDialog(); continue }
      if (value === 'system') { await systemSettingsDialog() }
    }
  }

  const runCommand = async (command: string): Promise<boolean> => {
    if (command === 'settings') { await settingsDialog(); return true }
    if (command === 'visual') {
      const next = toggleTerminalVisual(settings())
      commitSettings(next, `终端视觉 · ${next.visual === 'vivid' ? '丰富显示' : '简洁显示'}`)
      return true
    }
    if (command === 'doctor') {
      const items = await props.backend.doctor()
      tell(items.map(item => `${item.ok ? '●' : '○'} ${item.label}: ${item.detail}`).join('  ·  '), 12_000)
      return true
    }
    if (command === 'workspace') { tell(`工作区 · ${props.backend.workspace}`, 9000); return true }
    if (command === 'provider') { await providerManager(false); return true }
    if (command === 'model') { await selectModel(false); return true }
    if (command === 'agent') { tell(`智能体 · ${props.backend.agentLabel}`); return true }
    if (command === 'clear') { setTranscript([]); tell('已清空当前显示'); return true }
    if (command === 'exit') { props.onExit(); return true }
    return false
  }

  const commandPalette = async () => {
    while (true) {
      const value = await askList('命令', commandPaletteOptions(), { searchable: true })
      if (!value) return
      if (value === 'settings') {
        await settingsDialog()
        continue
      }
      await runCommand(value)
      return
    }
  }

  const submit = async (raw: string) => {
    const line = raw.trim()
    if (!line || busy() || dialog()) return
    prompt?.clear()
    if (line === '/' || line === '/help') {
      tell('/settings · /vivid · /doctor · /workspace · /provider · /model · /agent · /clear · /exit', 9000)
      return
    }
    if (line.startsWith('/')) {
      const command = line.slice(1).trim()
      if (await runCommand(command)) return
      tell(`未知命令 ${line} · 输入 /help 查看可用命令`)
      return
    }
    if (!providerConfigured()) {
      tell('模型未配置 · Ctrl+P → 模型 / 提供方 添加真实提供方')
      return
    }

    const placeholder: TerminalTranscriptItem = { role: 'reasoning', text: '', placeholder: true }
    clearEventBuffer()
    const runActivity = resetRunActivity()
    setActivity('thinking')
    setTranscript(current => [
      ...current,
      { role: 'user', text: line },
      { role: 'activity', text: '', activity: runActivity },
      placeholder,
    ])
    recordRunActivity({ kind: 'status', text: '开始处理请求' })
    setBusy(true)
    controller = new AbortController()
    refresh()
    try {
      await props.backend.sendMessage(
        line,
        mode(),
        event => enqueueRunEvent(event),
        controller.signal,
        (request, signal) => askApproval(request, signal),
      )
      const completedAtMs = Date.now()
      finalizeRunActivity('completed', completedAtMs)
      await waitForEventDrain()
      setTranscript(current => current.map(item => item.placeholder
        ? { role: 'assistant' as const, text: '(没有文本输出)', placeholder: false }
        : item))
      tell('完成', 2600)
    } catch (error) {
      const aborted = controller.signal.aborted
      const endedAtMs = Date.now()
      clearEventBuffer()
      finalizeRunActivity(aborted ? 'cancelled' : 'failed', endedAtMs)
      const message = `${aborted ? '已中止当前响应' : '请求失败'} · ${error instanceof Error ? error.message : String(error)}`
      setTranscript(current => {
        const next = current.filter(item => !item.placeholder)
        next.push({ role: 'assistant', text: message })
        return next
      })
      tell(aborted ? '已中止当前响应' : '请求失败')
    } finally {
      setActivity('idle')
      setBusy(false)
      controller = undefined
      refocusPrompt()
      refresh()
    }
  }

  const cancel = () => {
    if (busy() && controller) {
      controller.abort()
      return true
    }
    return false
  }

  useKeyboard(event => {
    if (event.defaultPrevented) return
    const modal = dialog()
    if (modal) {
      if (event.ctrl && event.name === 'c') {
        event.preventDefault(); event.stopPropagation(); props.onExit()
      }
      return
    }
    if ((event.ctrl && event.name === 'p') || (event.ctrl && event.name === 'k')) {
      event.preventDefault(); event.stopPropagation(); void commandPalette(); return
    }
    if (transcript().length > 0 && transcriptScroll) {
      if (event.name === 'pageup') {
        event.preventDefault(); event.stopPropagation(); transcriptScroll.scrollBy(-8); return
      }
      if (event.name === 'pagedown') {
        event.preventDefault(); event.stopPropagation(); transcriptScroll.scrollBy(8); return
      }
      if (event.name === 'home' && event.ctrl) {
        event.preventDefault(); event.stopPropagation(); transcriptScroll.scrollTo(0); return
      }
      if (event.name === 'end' && event.ctrl) {
        event.preventDefault(); event.stopPropagation(); transcriptScroll.scrollTo(1_000_000); return
      }
    }
    if (event.ctrl && event.name === 'c') {
      event.preventDefault(); event.stopPropagation()
      if (!cancel()) props.onExit()
      return
    }
    if (event.name === 'escape') {
      event.preventDefault(); event.stopPropagation()
      if (cancel()) return
      if (transcript().length > 0) {
        setTranscript([])
        tell('已返回首页', 2400)
      }
    }
  })

  const runInitialSetup = async () => {
    setSetupFlow({ active: true, message: '首次使用 · 配置提供方与模型' })
    try {
      await providerManager(true)
    } finally {
      setSetupFlow({ active: false, message: '' })
      refocusPrompt()
      renderer.requestRender()
    }
  }

  onMount(() => {
    process.title = 'Xiaoyu'
    const spinnerTimer = setInterval(() => {
      if (busy()) setSpinnerFrame(value => value + 1)
    }, 240)
    const streamPump = setInterval(pumpRunEvents, 30)
    const tips = setInterval(() => setTipIndex(value => value + 1), 5500)
    const clockTimer = setInterval(() => setClock(Date.now()), 1000)
    onCleanup(() => {
      clearInterval(spinnerTimer)
      clearInterval(streamPump)
      clearInterval(tips)
      clearInterval(clockTimer)
      clearEventBuffer()
      controller?.abort()
    })
    refocusPrompt()
    if (needsInitialBrainSetup(providerConfigured())) queueMicrotask(() => { void runInitialSetup() })
  })

  const hintItems = createMemo(() => {
    const wide = contentWidth() >= 82
    return [
      wide ? 'tab / shift+tab  切换模式' : 'tab  模式',
      'ctrl+p  命令',
      'ctrl+k  搜索',
      ...(wide ? ['/  快捷命令'] : []),
      'ctrl+c  中止',
      ...(transcript().length > 0 ? ['esc  返回'] : []),
    ]
  })

  const currentDialog = createMemo(() => dialog())
  const homeDockWidth = createMemo(() => Math.min(contentWidth(), 78))
  const dockWidth = createMemo(() => transcript().length > 0 ? contentWidth() : homeDockWidth())
  const centerMode = createMemo(() => showLogo() && transcript().length === 0)

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={COLOR.background}
    >
      <BackgroundSky
        width={dimensions().width}
        height={dimensions().height}
        vivid={settings().visual === 'vivid'}
        stars={settings().stars}
        meteors={settings().meteors}
        motion={transcript().length === 0 && dialog() === undefined && !setupFlow().active}
      />
      <box
        id="xiaoyu-workbench"
        position="relative"
        zIndex={10}
        width="100%"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        overflow="hidden"
        flexDirection="column"
        alignItems="center"
        justifyContent={centerMode() ? 'center' : 'flex-start'}
        paddingTop={1}
      >
        <Show when={showLogo()}>
          <box width={dockWidth()} flexDirection="column" alignItems="center" paddingBottom={2}>
            <HomeLogo
              compact={compactLogo()}
              gradient={settings().visual === 'vivid' && settings().logoGradient}
            />
          </box>
        </Show>

        <Show when={transcript().length > 0}>
          <box
            id="xiaoyu-transcript-slot"
            width="100%"
            height={0}
            flexBasis={0}
            flexGrow={1}
            flexShrink={1}
            minHeight={0}
            overflow="hidden"
          >
            <TranscriptViewport
              width={dimensions().width}
              contentWidth={contentWidth()}
              items={transcript()}
              nowMs={clock()}
              onToggleActivity={toggleRunActivity}
              onScrollReady={value => { transcriptScroll = value }}
            />
          </box>
        </Show>

        <PromptDock
          width={dockWidth()}
          panel={showLogo()}
          mode={mode()}
          providerStatus={providerStatus()}
          providerConfigured={providerConfigured()}
          reasoningEffort={reasoningEffort()}
          focused={dialog() === undefined && !setupFlow().active}
          hintItems={hintItems()}
          tipsEnabled={settings().tips}
          tip={tip()}
          onPromptReady={value => {
            prompt = value
            queueMicrotask(() => {
              if (setupFlow().active || dialog() !== undefined) return
              value.focus()
              value.requestRender()
            })
          }}
          onPromptFocus={() => prompt?.focus()}
          onSubmit={text => { void submit(text) }}
          onCycleMode={direction => {
            const next = cycleTerminalAgentMode(mode(), direction)
            setMode(next)
            tell(`模式已切换 · ${MODE_META[next].label} · ${MODE_META[next].description}`, 2600)
            refocusPrompt()
          }}
        />

      </box>

      <box position="relative" zIndex={10} flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg={COLOR.faint}>{props.backend.workspace}</text>
        <text fg={COLOR.faint}>{props.backend.version}</text>
      </box>

      <Show when={setupFlow().active && currentDialog() === undefined}>
        <box
          position="absolute"
          zIndex={2800}
          width={dimensions().width}
          height={dimensions().height}
          left={0}
          top={0}
          alignItems="center"
          justifyContent="center"
          backgroundColor={COLOR.background}
        >
          <box width={Math.min(66, dimensions().width - 6)} flexDirection="column" gap={1} padding={2} backgroundColor={COLOR.background}>
            <text fg={COLOR.text}><strong>配置 Xiaoyu 模型</strong></text>
            <text fg={COLOR.soft}>{setupFlow().message}</text>
            <text fg={COLOR.faint}>完成模型选择后进入主工作台</text>
          </box>
        </box>
      </Show>

      <Show when={currentDialog()} keyed>{state => {
        if (state.kind === 'list') {
          return <ListDialog title={state.title} items={state.items} searchable={state.searchable} allowCancel={state.allowCancel} onDone={state.resolve} />
        }
        if (state.kind === 'input') {
          return <InputDialog title={state.title} description={state.description} initial={state.initial} secret={state.secret} allowCancel={state.allowCancel} onDone={state.resolve} />
        }
        return <ApprovalDialog request={state.request} onDone={state.resolve} />
      }}</Show>
    </box>
  )
}

export async function runOpenTui(backend: TerminalBackend): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Xiaoyu interactive TUI requires a TTY. Use `xiaoyu --help` for non-interactive usage.')
  }

  const renderer = await createCliRenderer({
    externalOutputMode: 'passthrough',
    targetFps: 30,
    maxFps: 30,
    gatherStats: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    autoFocus: false,
    openConsoleOnError: false,
    enableMouseMovement: false,
    useMouse: true,
  })

  await new Promise<void>((resolve, reject) => {
    let closing = false
    const close = () => {
      if (closing) return
      closing = true
      void backend.close().then(() => {
        renderer.destroy()
        resolve()
      }).catch(error => {
        try { renderer.destroy() } catch { /* best effort */ }
        reject(error)
      })
    }

    void render(() => <XiaoyuApp backend={backend} onExit={close} />, renderer).catch(error => {
      if (!closing) {
        closing = true
        void backend.close().finally(() => {
          try { renderer.destroy() } catch { /* best effort */ }
          reject(error)
        })
      }
    })
  })
}
