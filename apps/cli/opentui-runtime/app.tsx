/**
 * 文件作用：实现 Xiaoyu Terminal 的 OpenTUI 主工作台，统一真实输入焦点、响应式布局、命令面板与模型配置交互。
 * 关联模块：main.ts、tui.ts 纯合同/Workspace Trust、brain.ts、xma-agent-loop Runtime 与 Provider/Tool 后端。
 * 当前实现：使用 @opentui/core + @opentui/solid 的 CliRenderer/Textarea 原生输入，提供 Build/Plan/Compose、流式对话、命令搜索、Provider/Model/Reasoning 配置、动态提示与 Tool Approval。
 * 职责边界：本文件只负责 Terminal Host 视觉与交互；不得复制 Agent Loop、Provider 协议、Session durable truth 或 Native 安全策略。
 */

import {
  createCliRenderer,
  decodePasteBytes,
  RGBA,
  type KeyEvent,
  type PasteEvent,
  type TextareaRenderable,
} from '@opentui/core'
import { render, useKeyboard, usePaste, useRenderer, useTerminalDimensions } from '@opentui/solid'
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { ToolApprovalDecision, ToolApprovalRequest } from 'xma-tools'
import type { TerminalBrainProfileView } from '../src/brain.ts'
import {
  applyTerminalRunEvent,
  commandPaletteOptions,
  cycleTerminalAgentMode,
  loadTerminalUiSettings,
  needsInitialBrainSetup,
  saveTerminalUiSettings,
  terminalHomeTip,
  toggleTerminalVisual,
  type BrainProviderCatalogItem,
  type TerminalAgentMode,
  type TerminalBackend,
  type TerminalReasoningEffort,
  type TerminalTranscriptItem,
  type TerminalUiSettings,
} from '../src/tui.ts'
import { filterTuiMenuItems, type TuiMenuItem } from '../src/tui-menu.ts'
import { openTuiContentWidth } from '../src/opentui-layout.ts'

const COLOR = {
  background: '#0b0c0c',
  panel: '#111313',
  panelSelected: '#261911',
  orange: '#ff7e3f',
  text: '#e2e2e2',
  soft: '#a4a4a4',
  faint: '#626262',
  green: '#62ca84',
  blue: '#6faeff',
  yellow: '#e0be48',
  red: '#ee5e5e',
} as const

const LOGO_XIAO = [
  '█   █  █████   ███    ███ ',
  ' █ █     █    █   █  █   █',
  '  █      █    █████  █   █',
  ' █ █     █    █   █  █   █',
  '█   █  █████  █   █   ███ ',
] as const

const LOGO_YU = [
  '█   █  █   █',
  ' █ █   █   █',
  '  █    █   █',
  '  █    █   █',
  '  █     ███ ',
] as const

const MODE_META: Record<TerminalAgentMode, { label: string; color: string; description: string }> = {
  build: { label: 'Build', color: COLOR.orange, description: '完整工具模式' },
  plan: { label: 'Plan', color: COLOR.green, description: '只读规划模式' },
  compose: { label: 'Compose', color: COLOR.blue, description: '纯模型对话 · legacy' },
}

interface NoticeState {
  text: string
  until: number
}

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

function providerCredential(profile: TerminalBrainProfileView): string {
  if (profile.credential?.source === 'os') return profile.credentialReady ? '系统凭据' : '缺少系统凭据'
  if (profile.credential?.source === 'env') return profile.credentialReady ? `环境变量 ${profile.credential.key}` : `缺少 ${profile.credential.key}`
  return '无需密钥'
}

function reasoningColor(effort: TerminalReasoningEffort): string {
  if (effort === 'max') return COLOR.red
  if (effort === 'high') return COLOR.yellow
  if (effort === 'low') return COLOR.green
  return COLOR.soft
}

function roleMeta(role: TerminalTranscriptItem['role']): { label: string; color: string } {
  if (role === 'user') return { label: 'You', color: COLOR.orange }
  if (role === 'assistant') return { label: 'Xiaoyu', color: COLOR.orange }
  if (role === 'reasoning') return { label: 'Think', color: COLOR.yellow }
  if (role === 'tool') return { label: 'Tool', color: COLOR.blue }
  return { label: 'System', color: COLOR.soft }
}

function Logo(props: { compact: boolean; vivid: boolean; phase: number }) {
  const stars = createMemo(() => {
    if (!props.vivid) return ''
    const frames = [
      '✧           ·                    ✦                          ✧               ·',
      '·                  ✧                   ·                         ✦          ✧',
      '        ✦                    ·                          ✧              ·     ',
    ]
    return frames[props.phase % frames.length]!
  })
  return (
    <box flexDirection="column" alignItems="center" gap={1}>
      <Show when={props.vivid}>
        <text fg={COLOR.faint}>{stars()}</text>
      </Show>
      <Show
        when={!props.compact}
        fallback={
          <box flexDirection="column" alignItems="center">
            <text fg={COLOR.orange}><strong>✦  XIAOYU</strong></text>
            <text fg={COLOR.soft}>Xiaoyu Management Agent</text>
          </box>
        }
      >
        <text fg={COLOR.faint}>XIAOYU</text>
        <For each={LOGO_XIAO}>{(left, index) => (
          <box flexDirection="row">
            <text fg={COLOR.orange}>{left}</text>
            <text>   </text>
            <text fg={COLOR.soft}>{LOGO_YU[index()]}</text>
          </box>
        )}</For>
        <text fg={COLOR.faint}>Model is replaceable. Agent is ours.</text>
      </Show>
    </box>
  )
}

function ListDialog(props: {
  title: string
  items: readonly TuiMenuItem[]
  searchable: boolean
  allowCancel: boolean
  onDone: (value: string | undefined) => void
}) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [selected, setSelected] = createSignal(0)
  let searchInput: TextareaRenderable | undefined

  const filtered = createMemo(() => filterTuiMenuItems(props.items, query()))
  const selectedItem = createMemo(() => filtered()[Math.min(selected(), Math.max(0, filtered().length - 1))])
  const hasShortcut = createMemo(() => props.items.some(item => Boolean(item.shortcut)))

  const move = (delta: number) => {
    const count = filtered().length
    if (count === 0) return
    setSelected(current => (current + delta + count) % count)
  }
  const finish = (value: string | undefined) => {
    if (value === undefined && !props.allowCancel) return
    props.onDone(value)
  }
  const key = (event: KeyEvent) => {
    if (event.name === 'escape') {
      event.preventDefault()
      event.stopPropagation()
      finish(undefined)
      return true
    }
    if (event.name === 'up') {
      event.preventDefault()
      event.stopPropagation()
      move(-1)
      return true
    }
    if (event.name === 'down' || event.name === 'tab') {
      event.preventDefault()
      event.stopPropagation()
      move(1)
      return true
    }
    if (event.name === 'return' || event.name === 'enter') {
      event.preventDefault()
      event.stopPropagation()
      const item = selectedItem()
      if (item) finish(item.value)
      return true
    }
    return false
  }

  useKeyboard(event => {
    if (props.searchable) return
    key(event)
  })

  onMount(() => {
    if (props.searchable) queueMicrotask(() => searchInput?.focus())
  })

  return (
    <box
      position="absolute"
      zIndex={3000}
      width={dimensions().width}
      height={dimensions().height}
      left={0}
      top={0}
      alignItems="center"
      paddingTop={Math.max(2, Math.floor(dimensions().height * 0.16))}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      onMouseUp={() => finish(undefined)}
    >
      <box
        width={Math.min(86, dimensions().width - 4)}
        maxHeight={Math.max(12, dimensions().height - 8)}
        flexDirection="column"
        backgroundColor={COLOR.panel}
        border
        borderColor={COLOR.faint}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        gap={1}
        onMouseUp={event => event.stopPropagation()}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={COLOR.text}><strong>{props.title}</strong></text>
          <text fg={COLOR.faint}>esc</text>
        </box>
        <Show when={props.searchable}>
          <box flexDirection="row" gap={1}>
            <text fg={COLOR.faint}>搜索</text>
            <textarea
              ref={(value: TextareaRenderable) => { searchInput = value }}
              focused
              flexGrow={1}
              minHeight={1}
              maxHeight={1}
              wrapMode="none"
              placeholder="输入关键词…"
              placeholderColor={COLOR.faint}
              textColor={COLOR.text}
              focusedTextColor={COLOR.text}
              cursorColor={COLOR.orange}
              onContentChange={() => {
                setQuery(searchInput?.plainText ?? '')
                setSelected(0)
              }}
              onKeyDown={(event: KeyEvent) => { key(event) }}
              keyBindings={[]}
            />
          </box>
        </Show>
        <box flexDirection="column">
          <Show when={filtered().length > 0} fallback={<text fg={COLOR.faint}>没有匹配项</text>}>
            <For each={filtered().slice(Math.max(0, selected() - 7), Math.max(0, selected() - 7) + 10)}>{(item) => {
              const active = createMemo(() => item === selectedItem())
              return (
                <box
                  flexDirection="row"
                  backgroundColor={active() ? COLOR.panelSelected : COLOR.panel}
                  paddingLeft={1}
                  paddingRight={1}
                  onMouseUp={(event) => { event.stopPropagation(); finish(item.value) }}
                >
                  <text fg={active() ? COLOR.orange : COLOR.faint}>{active() ? '→' : ' '}</text>
                  <Show when={hasShortcut()}>
                    <box width={16} paddingLeft={1}><text fg={COLOR.faint}>{item.shortcut ?? ''}</text></box>
                  </Show>
                  <box width={24} paddingLeft={1}><text fg={active() ? COLOR.orange : COLOR.text}>{item.label}</text></box>
                  <box flexGrow={1} paddingLeft={1}><text fg={COLOR.soft}>{item.description ?? ''}</text></box>
                </box>
              )
            }}</For>
          </Show>
        </box>
        <text fg={COLOR.faint}>{props.searchable ? '输入搜索 · ↑↓ 选择 · Enter 执行 · Esc 返回' : '↑↓ 选择 · Enter 确认 · Esc 返回'}</text>
      </box>
    </box>
  )
}

function SecretInput(props: { initial: string; onDone: (value: string | undefined) => void; allowCancel: boolean }) {
  const [value, setValue] = createSignal(props.initial)
  const append = (text: string) => setValue(current => `${current}${text}`)

  usePaste((event: PasteEvent) => {
    event.preventDefault()
    append(decodePasteBytes(event.bytes).replace(/\r?\n/g, ''))
  })
  useKeyboard(event => {
    if (event.name === 'escape') {
      event.preventDefault()
      event.stopPropagation()
      if (props.allowCancel) props.onDone(undefined)
      return
    }
    if (event.name === 'backspace') {
      event.preventDefault()
      setValue(current => Array.from(current).slice(0, -1).join(''))
      return
    }
    if (event.name === 'return' || event.name === 'enter') {
      event.preventDefault()
      event.stopPropagation()
      props.onDone(value())
      return
    }
    if (event.ctrl || event.meta) return
    const candidate = event.sequence && event.sequence.length > 0 ? event.sequence : event.name
    if (!candidate || candidate === 'tab') return
    if (candidate.length <= 8 && !candidate.includes('\u001b') && !/[\u0000-\u001f\u007f]/.test(candidate)) {
      event.preventDefault()
      append(candidate)
    }
  })

  return (
    <box flexDirection="row">
      <text fg={COLOR.text}>{'•'.repeat(Math.min(48, Array.from(value()).length))}</text>
      <text fg={COLOR.orange}>█</text>
    </box>
  )
}

function InputDialog(props: {
  title: string
  description: string
  initial: string
  secret: boolean
  allowCancel: boolean
  onDone: (value: string | undefined) => void
}) {
  const dimensions = useTerminalDimensions()
  let field: TextareaRenderable | undefined
  onMount(() => {
    if (!props.secret) queueMicrotask(() => field?.focus())
  })
  return (
    <box
      position="absolute"
      zIndex={3000}
      width={dimensions().width}
      height={dimensions().height}
      left={0}
      top={0}
      alignItems="center"
      paddingTop={Math.max(3, Math.floor(dimensions().height * 0.24))}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        width={Math.min(74, dimensions().width - 4)}
        flexDirection="column"
        backgroundColor={COLOR.panel}
        border
        borderColor={COLOR.faint}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        gap={1}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={COLOR.text}><strong>{props.title}</strong></text>
          <text fg={COLOR.faint}>esc</text>
        </box>
        <text fg={COLOR.soft}>{props.description}</text>
        <Show
          when={!props.secret}
          fallback={<SecretInput initial={props.initial} allowCancel={props.allowCancel} onDone={props.onDone} />}
        >
          <textarea
            ref={(value: TextareaRenderable) => { field = value }}
            focused
            initialValue={props.initial}
            minHeight={1}
            maxHeight={4}
            wrapMode="word"
            placeholder="输入内容…"
            placeholderColor={COLOR.faint}
            textColor={COLOR.text}
            focusedTextColor={COLOR.text}
            cursorColor={COLOR.orange}
            onSubmit={() => props.onDone(field?.plainText ?? '')}
            onKeyDown={(event: KeyEvent) => {
              if (event.name !== 'escape') return
              event.preventDefault()
              event.stopPropagation()
              if (props.allowCancel) props.onDone(undefined)
            }}
            keyBindings={[
              { name: 'return', action: 'submit' },
              { name: 'return', shift: true, action: 'newline' },
            ]}
          />
        </Show>
        <text fg={COLOR.faint}>Enter 确认 · Esc 取消</text>
      </box>
    </box>
  )
}

function ApprovalDialog(props: { request: ToolApprovalRequest; onDone: (value: ToolApprovalDecision) => void }) {
  const dimensions = useTerminalDimensions()
  const [selected, setSelected] = createSignal(0)
  const choices: readonly { label: string; value: ToolApprovalDecision }[] = [
    { label: '拒绝', value: 'deny' },
    { label: '仅允许本次', value: 'allow-once' },
    { label: '本会话允许', value: 'allow-session' },
  ]
  useKeyboard(event => {
    if (event.name === 'escape') {
      event.preventDefault(); event.stopPropagation(); props.onDone('deny'); return
    }
    if (event.name === 'up') { event.preventDefault(); setSelected(v => (v + choices.length - 1) % choices.length); return }
    if (event.name === 'down' || event.name === 'tab') { event.preventDefault(); setSelected(v => (v + 1) % choices.length); return }
    if (event.name === 'return' || event.name === 'enter') {
      event.preventDefault(); event.stopPropagation(); props.onDone(choices[selected()]!.value)
    }
  })
  return (
    <box position="absolute" zIndex={3200} width={dimensions().width} height={dimensions().height} left={0} top={0} alignItems="center" paddingTop={Math.max(3, Math.floor(dimensions().height * 0.25))} backgroundColor={RGBA.fromInts(0, 0, 0, 170)}>
      <box width={Math.min(72, dimensions().width - 4)} flexDirection="column" backgroundColor={COLOR.panel} border borderColor={COLOR.yellow} padding={2} gap={1}>
        <text fg={COLOR.yellow}><strong>◆ Tool Approval</strong></text>
        <text fg={COLOR.text}>{props.request.toolName} · {props.request.effect}</text>
        <For each={props.request.summary.slice(0, 3)}>{line => <text fg={COLOR.soft}>{line}</text>}</For>
        <For each={choices}>{(choice, index) => (
          <box flexDirection="row" backgroundColor={selected() === index() ? COLOR.panelSelected : COLOR.panel}>
            <text fg={selected() === index() ? COLOR.orange : COLOR.faint}>{selected() === index() ? '→ ' : '  '}</text>
            <text fg={selected() === index() ? COLOR.orange : COLOR.text}>{choice.label}</text>
          </box>
        )}</For>
        <text fg={COLOR.faint}>↑↓ 选择 · Enter 确认 · Esc 拒绝</text>
      </box>
    </box>
  )
}

function XiaoyuApp(props: { backend: TerminalBackend; onExit: () => void }) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [settings, setSettings] = createSignal<TerminalUiSettings>(loadTerminalUiSettings())
  const [mode, setMode] = createSignal<TerminalAgentMode>('build')
  const [transcript, setTranscript] = createSignal<TerminalTranscriptItem[]>([])
  const [busy, setBusy] = createSignal(false)
  const [notice, setNotice] = createSignal<NoticeState | undefined>()
  const [dialog, setDialog] = createSignal<DialogState | undefined>()
  const [phase, setPhase] = createSignal(0)
  const [tipIndex, setTipIndex] = createSignal(0)
  const [clock, setClock] = createSignal(Date.now())
  let prompt: TextareaRenderable | undefined
  let controller: AbortController | undefined

  const contentWidth = createMemo(() => openTuiContentWidth(dimensions().width))
  const compactLogo = createMemo(() => settings().logo === 'compact' || dimensions().width < 82 || transcript().length > 0)
  const showLogo = createMemo(() => transcript().length === 0 && dialog() === undefined)
  const providerConfigured = createMemo(() => { clock(); return props.backend.providerConfigured })
  const providerReady = createMemo(() => { clock(); return props.backend.providerReady })
  const providerLabel = createMemo(() => { clock(); return props.backend.providerLabel })
  const reasoningEffort = createMemo(() => { clock(); return props.backend.reasoningEffort })
  const tip = createMemo(() => {
    clock()
    const active = notice()
    if (active && active.until > Date.now()) return active.text
    if (busy()) return 'Xiaoyu 正在工作 · Ctrl+C 中止'
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
  const refocusPrompt = () => queueMicrotask(() => prompt?.focus())

  const closeDialog = () => {
    setDialog(undefined)
    refocusPrompt()
  }
  const askList = (title: string, items: readonly TuiMenuItem[], options: { searchable?: boolean; allowCancel?: boolean } = {}) => new Promise<string | undefined>(resolve => {
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
      { value: 'catalog', label: '添加提供方', description: '配置新的模型提供方' },
      { value: 'add-env', label: '自定义提供方', description: 'OpenAI 兼容接口 · 环境变量' },
    ]
    if (active) {
      items.push(
        { value: 'probe', label: '模型就绪测试', description: `${active.displayName} · ${active.model}` },
        { value: 'models', label: '选择模型', description: `当前 ${active.model}` },
        ...(props.backend.reasoningSupported ? [{ value: 'reasoning', label: '推理强度', description: `当前 ${props.backend.reasoningEffort}` }] : []),
      )
    }
    const providers = new Map(props.backend.listBrainProviderCatalog().map(item => [item.id, item.displayName]))
    for (const profile of profiles) {
      items.push({
        value: `select:${profile.id}`,
        label: `${profile.active ? '●' : '○'} ${profile.displayName}`,
        description: `${providers.get(profile.providerId) ?? profile.providerId} · ${profile.model} · ${providerCredential(profile)}`,
      })
    }
    return items
  }

  const selectModel = async (initialSetup = false): Promise<boolean> => {
    if (!props.backend.providerConfigured) {
      tell('模型未配置 · 请先配置模型 / 提供方')
      return false
    }
    tell('正在读取提供方的真实模型列表…', 30_000)
    try {
      const models = await props.backend.listBrainModels()
      if (models.length === 0) {
        tell('提供方没有返回模型列表；保留当前模型 ID。')
        return false
      }
      const value = await askList('选择真实模型', models.slice(0, 100).map(model => ({ value: model, label: model, description: '' })), { searchable: true, allowCancel: !initialSetup })
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

  const selectReasoning = async (initialSetup = false): Promise<boolean> => {
    if (!props.backend.reasoningSupported) return true
    const current = props.backend.reasoningEffort
    const value = await askList('选择推理强度', [
      { value: 'default', label: `${current === 'default' ? '● ' : ''}默认`, description: '使用提供方默认推理强度' },
      { value: 'low', label: `${current === 'low' ? '● ' : ''}低`, description: '低推理强度' },
      { value: 'high', label: `${current === 'high' ? '● ' : ''}高`, description: '高推理强度' },
      { value: 'max', label: `${current === 'max' ? '● ' : ''}最大`, description: '最大推理强度（提供方支持时）' },
    ], { allowCancel: !initialSetup })
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
    tell('正在执行模型就绪测试…', 30_000)
    try {
      const result = await props.backend.probeBrain()
      tell(`${result.ready ? '模型就绪' : '模型未就绪'} · ${result.latencyMs}ms · ${result.message}`, 8000)
      refresh()
      return result.ready
    } catch (error) {
      tell(`模型就绪测试失败 · ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const configureProvider = async (providerId: string, credentialMode: 'os' | 'env', initialSetup: boolean): Promise<boolean> => {
    const provider = props.backend.listBrainProviderCatalog().find(item => item.id === providerId)
    if (!provider) { tell(`提供方目录不存在：${providerId}`); return false }
    const profiles = props.backend.listBrainProfiles().filter(item => item.providerId === providerId && item.source === 'config')
    const displayName = profiles.length === 0 ? provider.displayName : `${provider.displayName} ${profiles.length + 1}`
    let baseUrl: string | undefined
    let model: string | undefined
    if (provider.customEndpoint) {
      baseUrl = await askInput('Base URL', '例如：https://api.example.com/v1', '', { allowCancel: !initialSetup })
      if (baseUrl === undefined) return false
      model = await askInput('默认模型 ID', '请输入 endpoint 实际支持的 model ID', '', { allowCancel: !initialSetup })
      if (model === undefined) return false
    }
    const credential = credentialMode === 'os'
      ? await askInput('API Key', provider.credentialRequired ? '安全写入系统凭据库；输入内容不会回显' : '安全写入系统凭据库；留空表示无需鉴权', '', { secret: true, allowCancel: !initialSetup })
      : await askInput('API Key 环境变量', '只保存变量名；留空表示无需鉴权', 'XIAOYU_API_KEY', { allowCancel: !initialSetup })
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
      await selectModel(initialSetup)
      await selectReasoning(initialSetup)
      return await probe()
    } catch (error) {
      tell(`提供方保存失败 · ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const providerCatalog = async (initialSetup: boolean): Promise<boolean> => {
    const catalog = props.backend.listBrainProviderCatalog()
    const value = await askList(initialSetup ? '配置 Xiaoyu 模型' : '添加提供方', catalog.map((item: BrainProviderCatalogItem) => ({
      value: item.id,
      label: item.displayName,
      description: item.description,
      keywords: [item.id, item.displayName],
    })), { searchable: true, allowCancel: !initialSetup })
    if (!value) return false
    return configureProvider(value, 'os', initialSetup)
  }

  const providerManager = async (initialSetup = false): Promise<void> => {
    while (true) {
      const value = await askList(initialSetup ? '配置 Xiaoyu 模型' : '模型 / 提供方', profileItems(), { allowCancel: !initialSetup })
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
          tell(`模型配置已切换 · ${profile.displayName} · ${profile.model}`)
          refresh()
          const ready = await probe()
          if (initialSetup && ready) return
        }
      } catch (error) {
        tell(`模型配置操作失败 · ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const settingsDialog = async () => {
    const current = settings()
    const value = await askList('终端设置', [
      { value: 'visual', label: '丰富显示', description: `当前：${current.visual === 'vivid' ? '丰富' : '简洁'}` },
      { value: 'tips', label: '提示信息', description: `当前：${current.tips ? '开启' : '关闭'}` },
      { value: 'logo', label: 'Logo 模式', description: `当前：${current.logo === 'auto' ? '自动' : '紧凑'}` },
    ])
    if (!value) return
    const next = value === 'visual'
      ? toggleTerminalVisual(settings())
      : value === 'tips'
        ? { ...settings(), tips: !settings().tips }
        : { ...settings(), logo: settings().logo === 'auto' ? 'compact' as const : 'auto' as const }
    setSettings(next)
    saveTerminalUiSettings(next)
    tell('终端设置已更新')
  }

  const runCommand = async (command: string): Promise<boolean> => {
    if (command === 'settings') { await settingsDialog(); return true }
    if (command === 'visual') {
      const next = toggleTerminalVisual(settings())
      setSettings(next); saveTerminalUiSettings(next); tell(`终端视觉 · ${next.visual === 'vivid' ? '丰富显示' : '简洁显示'}`); return true
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
    const value = await askList('命令', commandPaletteOptions(), { searchable: true })
    if (value) await runCommand(value)
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

    const placeholder: TerminalTranscriptItem = { role: 'assistant', text: '', placeholder: true }
    setTranscript(current => [...current, { role: 'user', text: line }, placeholder])
    setBusy(true)
    controller = new AbortController()
    refresh()
    try {
      await props.backend.sendMessage(
        line,
        mode(),
        event => setTranscript(current => {
          const next = current.map(item => ({ ...item }))
          applyTerminalRunEvent(next, event)
          return next
        }),
        controller.signal,
        (request, signal) => askApproval(request, signal),
      )
      setTranscript(current => current.map(item => item === placeholder || (item.placeholder && item.text.length === 0)
        ? { ...item, text: '(没有文本输出)', placeholder: false }
        : item))
      tell('完成', 2600)
    } catch (error) {
      const aborted = controller.signal.aborted
      const message = `${aborted ? '已中止当前响应' : '请求失败'} · ${error instanceof Error ? error.message : String(error)}`
      setTranscript(current => {
        const next = current.filter(item => !item.placeholder)
        next.push({ role: 'assistant', text: message })
        return next
      })
      tell(aborted ? '已中止当前响应' : '请求失败')
    } finally {
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

  onMount(() => {
    process.title = 'Xiaoyu'
    const animation = setInterval(() => setPhase(value => value + 1), 420)
    const tips = setInterval(() => setTipIndex(value => value + 1), 4800)
    const clockTimer = setInterval(() => setClock(Date.now()), 800)
    onCleanup(() => {
      clearInterval(animation)
      clearInterval(tips)
      clearInterval(clockTimer)
      controller?.abort()
    })
    refocusPrompt()
    if (needsInitialBrainSetup(providerConfigured())) queueMicrotask(() => { void providerManager(true) })
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

  return (
    <box width={dimensions().width} height={dimensions().height} flexDirection="column" backgroundColor={COLOR.background}>
      <box flexGrow={1} flexDirection="column" alignItems="center" paddingTop={1}>
        <Show when={showLogo()}>
          <Logo compact={compactLogo()} vivid={settings().visual === 'vivid'} phase={phase()} />
        </Show>

        <box width={contentWidth()} flexGrow={1} flexDirection="column" justifyContent="flex-end" paddingTop={1} paddingBottom={1}>
          <Show when={transcript().length > 0}>
            <box flexDirection="column" gap={1}>
              <For each={transcript().slice(-18)}>{item => {
                const meta = roleMeta(item.role)
                return (
                  <box flexDirection="row" gap={2}>
                    <box width={8}><text fg={meta.color}><strong>{meta.label}</strong></text></box>
                    <box flexGrow={1}><text fg={item.role === 'reasoning' ? COLOR.faint : item.role === 'tool' ? COLOR.soft : COLOR.text}>{item.text || (item.placeholder ? '…' : '')}</text></box>
                  </box>
                )
              }}</For>
            </box>
          </Show>
        </box>

        <box width={contentWidth()} flexDirection="column" gap={1} paddingBottom={1}>
          <box flexDirection="row" alignItems="flex-start" onMouseDown={() => prompt?.focus()}>
            <text fg={MODE_META[mode()].color}>▌</text>
            <box flexGrow={1} paddingLeft={1}>
              <textarea
                ref={(value: TextareaRenderable) => { prompt = value }}
                focused
                minHeight={1}
                maxHeight={5}
                wrapMode="word"
                placeholder="输入消息…（输入 / 唤起命令）"
                placeholderColor={COLOR.faint}
                textColor={COLOR.text}
                focusedTextColor={COLOR.text}
                cursorColor={COLOR.text}
                onSubmit={() => { void submit(prompt?.plainText ?? '') }}
                onKeyDown={(event: KeyEvent) => {
                  if (event.name !== 'tab') return
                  event.preventDefault(); event.stopPropagation()
                  const next = cycleTerminalAgentMode(mode(), event.shift ? -1 : 1)
                  setMode(next)
                  tell(`模式已切换 · ${MODE_META[next].label} · ${MODE_META[next].description}`, 2600)
                  refocusPrompt()
                }}
                keyBindings={[
                  { name: 'return', action: 'submit' },
                  { name: 'return', shift: true, action: 'newline' },
                  { name: 'return', ctrl: true, action: 'newline' },
                ]}
              />
            </box>
          </box>
          <box flexDirection="row" paddingLeft={2}>
            <text fg={MODE_META[mode()].color}><strong>{MODE_META[mode()].label}</strong></text>
            <text fg={COLOR.soft}> · </text>
            <text fg={providerReady() ? COLOR.green : COLOR.yellow}>{providerReady() ? '●' : '○'}</text>
            <text fg={COLOR.text}> {providerLabel()}</text>
            <text fg={COLOR.soft}> · </text>
            <text fg={reasoningColor(reasoningEffort())}><strong>{reasoningEffort()}</strong></text>
          </box>
        </box>

        <box width={contentWidth()} flexDirection="row" justifyContent="space-between" paddingTop={1} paddingBottom={1}>
          <For each={hintItems()}>{item => <text fg={COLOR.soft}>{item}</text>}</For>
        </box>
        <Show when={settings().tips}>
          <box width={contentWidth()} flexDirection="row" gap={2} paddingBottom={1}>
            <text fg={COLOR.orange}>●  提示</text>
            <text fg={COLOR.soft}>{tip()}</text>
          </box>
        </Show>
      </box>

      <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg={COLOR.faint}>{props.backend.workspace}</text>
        <text fg={COLOR.faint}>{props.backend.version}</text>
      </box>

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
    targetFps: 60,
    maxFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    autoFocus: false,
    openConsoleOnError: false,
    enableMouseMovement: true,
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
