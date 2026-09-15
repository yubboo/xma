/**
 * 文件作用：实现 Xiaoyu Terminal 的 OpenTUI 主工作台，统一真实输入焦点、响应式布局、命令面板与模型配置交互。
 * 关联模块：main.ts、tui.ts 纯合同/Workspace Trust、brain.ts、xma-agent-loop Runtime 与 Provider/Tool 后端。
 * 当前实现：使用 @opentui/core + @opentui/solid 的 CliRenderer/Textarea 原生输入，提供平滑星空/流星、思考状态、缓冲打字机流式对话、Build/Plan/Compose、命令搜索、Provider/Model/Reasoning 与 Tool Approval。
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
  type TerminalAgentMode,
  type TerminalBackend,
  type TerminalReasoningEffort,
  type TerminalRunEvent,
  type TerminalTranscriptItem,
  type TerminalUiSettings,
} from '../src/tui.ts'
import { filterTuiMenuItems, type TuiMenuItem } from '../src/tui-menu.ts'
import { openTuiContentWidth } from '../src/opentui-layout.ts'

const COLOR = {
  background: '#0b0c0c',
  panel: '#151515',
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
  '██   ██  █████   ███    ███ ',
  ' ██ ██     ██   ██ ██  ██ ██',
  '  ███      ██   █████  ██ ██',
  ' ██ ██     ██   ██ ██  ██ ██',
  '██   ██  █████  ██ ██   ███ ',
] as const

const LOGO_YU = [
  '██   ██  ██  ██',
  ' ██ ██   ██  ██',
  '  ███    ██  ██',
  '  ███    ██  ██',
  '  ███     ████ ',
] as const

const SKY_STARS = [
  { x: 0.07, y: 0.13, offset: 0, period: 18 },
  { x: 0.19, y: 0.09, offset: 6, period: 23 },
  { x: 0.36, y: 0.08, offset: 11, period: 27 },
  { x: 0.63, y: 0.09, offset: 3, period: 21 },
  { x: 0.81, y: 0.12, offset: 14, period: 25 },
  { x: 0.94, y: 0.18, offset: 8, period: 31 },
  { x: 0.06, y: 0.79, offset: 4, period: 22 },
  { x: 0.17, y: 0.88, offset: 17, period: 29 },
  { x: 0.78, y: 0.87, offset: 9, period: 24 },
  { x: 0.91, y: 0.76, offset: 2, period: 28 },
] as const

const STAR_FRAMES = [
  { glyph: '·', color: '#303436' },
  { glyph: '✧', color: COLOR.faint },
  { glyph: '✧', color: COLOR.soft },
  { glyph: '✦', color: COLOR.text },
  { glyph: '✧', color: COLOR.yellow },
  { glyph: '✧', color: COLOR.soft },
  { glyph: '·', color: '#303436' },
] as const

const METEOR_INTERVAL_FRAMES = 160
const METEOR_DURATION_FRAMES = 72
const METEOR_FRAME_MS = 50
const METEOR_DURATION_MS = METEOR_DURATION_FRAMES * METEOR_FRAME_MS
const METEOR_ANGLE = 0.36
const METEOR_TAIL = 32
const METEOR_STEP = 0.15
const METEOR_TAIL_POINTS = Array.from(
  { length: Math.floor(METEOR_TAIL / METEOR_STEP) + 1 },
  (_, index) => index * METEOR_STEP,
)

interface SkyGlyph {
  left: number
  top: number
  text: string
  color: string
}

function toCell(size: number, ratio: number, inset = 1): number {
  return Math.max(0, Math.min(Math.max(0, size - 1), Math.round((size - inset * 2) * ratio) + inset))
}

function starGlyphs(width: number, height: number, frame: number): SkyGlyph[] {
  return SKY_STARS.map(star => {
    const progress = ((frame + star.offset) % star.period) / star.period
    const index = Math.min(STAR_FRAMES.length - 1, Math.floor(progress * STAR_FRAMES.length))
    const visual = STAR_FRAMES[index]!
    return {
      left: toCell(width, star.x),
      top: toCell(height, star.y),
      text: visual.glyph,
      color: visual.color,
    }
  })
}

function brailleBit(column: number, row: number): number {
  if (column === 0) return row === 3 ? 6 : row
  return row === 3 ? 7 : 3 + row
}

function parseHex(color: string): [number, number, number] {
  const value = color.startsWith('#') ? color.slice(1) : color
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

function blendHex(from: string, to: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount))
  const a = parseHex(from)
  const b = parseHex(to)
  const channel = (index: number) => Math.round(a[index]! + (b[index]! - a[index]!) * t).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

/**
 * 中文说明：只生成“真正有像素”的 Braille 流星单元，不再绘制一张覆盖全屏的 StyledText。
 * 这样既保留 MiMo Code 的 2×4 子像素斜向光束，也不会在 OpenTUI 装饰层用空格重绘覆盖主界面文字。
 */
function meteorGlyphs(width: number, height: number, frame: number): SkyGlyph[] {
  if (width <= 0 || height <= 0) return []
  const step = frame % METEOR_INTERVAL_FRAMES
  if (step >= METEOR_DURATION_FRAMES) return []

  const sequence = Math.floor(frame / METEOR_INTERVAL_FRAMES)
  const jitter = ((sequence * 37 + 17) % 100) / 100
  const startX = Math.max(2, width - 2 - jitter * Math.max(1, width * 0.15))
  const startY = sequence % 2
  const speed = Math.max(0.011, Math.min(0.038, (height - startY) / (Math.sin(METEOR_ANGLE) * METEOR_DURATION_MS)))
  const elapsed = step * METEOR_FRAME_MS
  const distance = elapsed * speed
  const dx = -Math.cos(METEOR_ANGLE)
  const dy = Math.sin(METEOR_ANGLE)
  const headX = startX + distance * dx
  const headY = startY + distance * dy
  const envelope = Math.sin((step / METEOR_DURATION_FRAMES) * Math.PI)
  const cells = new Map<number, { dots: number; nearestTailPoint: number }>()

  const setDot = (pixelX: number, pixelY: number, tailPoint: number) => {
    const subX = Math.floor(pixelX * 2)
    const subY = Math.floor(pixelY * 4)
    const cellX = subX >> 1
    const cellY = subY >> 2
    if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height) return
    const bit = brailleBit(subX & 1, subY & 3)
    const key = cellY * width + cellX
    const previous = cells.get(key)
    cells.set(key, {
      dots: (previous?.dots ?? 0) | (1 << bit),
      nearestTailPoint: Math.min(previous?.nearestTailPoint ?? Number.POSITIVE_INFINITY, tailPoint),
    })
  }

  for (const tailPoint of METEOR_TAIL_POINTS) {
    setDot(headX - tailPoint * dx, headY - tailPoint * dy, tailPoint)
  }

  const headSubX = Math.floor(headX * 2)
  const headSubY = Math.floor(headY * 4)
  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      if (offsetX * offsetX + offsetY * offsetY > 1) continue
      const subX = headSubX + offsetX
      const subY = headSubY + offsetY
      const cellX = subX >> 1
      const cellY = subY >> 2
      if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height) continue
      const bit = brailleBit(subX & 1, subY & 3)
      const key = cellY * width + cellX
      const previous = cells.get(key)
      cells.set(key, { dots: (previous?.dots ?? 0) | (1 << bit), nearestTailPoint: 0 })
    }
  }

  const glyphs: SkyGlyph[] = []
  for (const [key, value] of cells) {
    const left = key % width
    const top = Math.floor(key / width)
    const fade = Math.pow(1 - value.nearestTailPoint / METEOR_TAIL, 1.3) * envelope
    const headBlend = Math.max(0, 1 - value.nearestTailPoint / 5)
    const beam = blendHex('#b4d7ff', '#ffffff', headBlend)
    const color = blendHex(COLOR.background, beam, Math.max(0.08, fade))
    glyphs.push({ left, top, text: String.fromCharCode(0x2800 + value.dots), color })
  }
  glyphs.sort((a, b) => a.top - b.top || a.left - b.left)
  return glyphs
}

function BackgroundSky(props: {
  width: number
  height: number
  starFrame: number
  meteorFrame: number
  vivid: boolean
  stars: boolean
  meteors: boolean
}) {
  const starItems = createMemo(() => props.stars ? starGlyphs(props.width, props.height, props.starFrame) : [])
  const meteorItems = createMemo(() => props.meteors ? meteorGlyphs(props.width, props.height, props.meteorFrame) : [])
  return (
    <Show when={props.vivid && (props.stars || props.meteors)}>
      <box position="absolute" zIndex={0} width={props.width} height={props.height} left={0} top={0}>
        <For each={starItems()}>{star => (
          <box position="absolute" left={star.left} top={star.top}>
            <text fg={star.color}>{star.text}</text>
          </box>
        )}</For>
        <For each={meteorItems()}>{meteor => (
          <box position="absolute" left={meteor.left} top={meteor.top}>
            <text fg={meteor.color}>{meteor.text}</text>
          </box>
        )}</For>
      </box>
    </Show>
  )
}

const LOGO_HIGHLIGHT = ['#ffffff', '#fff1e4', '#ffc09a', '#ff925c', '#ff7e3f', '#c98f6c', '#a4a4a4'] as const

function logoGlyphColor(index: number, width: number, frame: number, base: string): string {
  const cycle = frame % 88
  if (cycle < 20 || cycle > 72) return base
  const progress = (cycle - 20) / 52
  const center = -6 + progress * (width + 12)
  const distance = Math.abs(index - center)
  if (distance > 6) return base
  const paletteIndex = Math.min(LOGO_HIGHLIGHT.length - 1, Math.floor(distance))
  return LOGO_HIGHLIGHT[paletteIndex] ?? base
}

interface LogoSegment {
  text: string
  color: string
}

function logoLineSegments(left: string, right: string, frame: number, gradient: boolean): LogoSegment[] {
  const line = `${left}  ${right}`
  const leftWidth = left.length + 2
  const segments: LogoSegment[] = []
  for (let index = 0; index < line.length; index += 1) {
    const base = index < leftWidth ? COLOR.orange : COLOR.soft
    const color = gradient ? logoGlyphColor(index, line.length, frame, base) : base
    const char = line[index] ?? ' '
    const previous = segments.at(-1)
    if (previous?.color === color) previous.text += char
    else segments.push({ text: char, color })
  }
  return segments
}

function LogoLine(props: { left: string; right: string; frame: number; gradient: boolean }) {
  const segments = createMemo(() => logoLineSegments(props.left, props.right, props.frame, props.gradient))
  return (
    <box flexDirection="row" backgroundColor={COLOR.background}>
      <For each={segments()}>{segment => <text fg={segment.color}>{segment.text}</text>}</For>
    </box>
  )
}

const MODE_META: Record<TerminalAgentMode, { label: string; color: string; description: string }> = {
  build: { label: 'Build', color: COLOR.orange, description: '完整工具模式' },
  plan: { label: 'Plan', color: COLOR.green, description: '只读规划模式' },
  compose: { label: 'Compose', color: COLOR.blue, description: '纯模型对话 · legacy' },
}

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

function Logo(props: { compact: boolean; frame: number; gradient: boolean }) {
  return (
    <box flexDirection="column" alignItems="center" backgroundColor={COLOR.background}>
      <Show
        when={!props.compact}
        fallback={
          <box flexDirection="column" alignItems="center" paddingBottom={1} backgroundColor={COLOR.background}>
            <text fg={COLOR.faint}>XIAOYU</text>
            <text fg={props.gradient ? logoGlyphColor(4, 10, props.frame, COLOR.orange) : COLOR.orange}><strong>✦ XIAOYU</strong></text>
            <text fg={COLOR.soft}>Model is replaceable. Agent is ours.</text>
          </box>
        }
      >
        <box flexDirection="column" alignItems="center" paddingBottom={1} backgroundColor={COLOR.background}>
          <text fg={COLOR.faint}>XIAOYU</text>
          <box flexDirection="column" backgroundColor={COLOR.background}>
            <For each={LOGO_XIAO}>{(left, index) => (
              <LogoLine
                left={left}
                right={LOGO_YU[index()] ?? ''}
                frame={props.frame}
                gradient={props.gradient}
              />
            )}</For>
          </box>
          <box paddingTop={1}>
            <text fg={COLOR.faint}>Model is replaceable. Agent is ours.</text>
          </box>
        </box>
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
    if (props.searchable) {
      queueMicrotask(() => searchInput?.focus())
      return
    }
    renderer.setCursorPosition(0, 0, false)
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
      justifyContent="center"
      backgroundColor={COLOR.background}
      onMouseDown={event => event.stopPropagation()}
      onMouseUp={event => event.stopPropagation()}
    >
      <box
        width={Math.max(42, Math.min(74, dimensions().width - 8))}
        maxHeight={Math.max(12, Math.min(22, dimensions().height - 4))}
        flexDirection="column"
        backgroundColor={COLOR.background}
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
              showCursor={false}
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
                  <box width={20} paddingLeft={1}><text fg={active() ? COLOR.orange : COLOR.text}>{item.label}</text></box>
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
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  let field: TextareaRenderable | undefined
  onMount(() => {
    if (!props.secret) {
      queueMicrotask(() => field?.focus())
      return
    }
    renderer.setCursorPosition(0, 0, false)
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
      justifyContent="center"
      backgroundColor={COLOR.background}
    >
      <box
        width={Math.min(74, dimensions().width - 4)}
        flexDirection="column"
        backgroundColor={COLOR.background}
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
            showCursor={false}
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
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [selected, setSelected] = createSignal(0)
  onMount(() => renderer.setCursorPosition(0, 0, false))
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
    <box position="absolute" zIndex={3200} width={dimensions().width} height={dimensions().height} left={0} top={0} alignItems="center" paddingTop={Math.max(3, Math.floor(dimensions().height * 0.25))} backgroundColor={COLOR.background}>
      <box width={Math.min(72, dimensions().width - 4)} flexDirection="column" backgroundColor={COLOR.background} padding={2} gap={1}>
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
  const [activity, setActivity] = createSignal<ActivityState>('idle')
  const [notice, setNotice] = createSignal<NoticeState | undefined>()
  const [dialog, setDialog] = createSignal<DialogState | undefined>()
  const [setupFlow, setSetupFlow] = createSignal({ active: false, message: '' })
  const [phase, setPhase] = createSignal(0)
  const [tipIndex, setTipIndex] = createSignal(0)
  const [clock, setClock] = createSignal(Date.now())
  let prompt: TextareaRenderable | undefined
  let transcriptScroll: ScrollBoxRenderable | undefined
  let controller: AbortController | undefined
  let bufferedEvents: TerminalRunEvent[] = []
  let bufferedCharacters = 0
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
        label: providerLabel(),
      }
    : {
        dot: '○',
        dotColor: COLOR.yellow,
        label: '模型未配置 · Ctrl+P /provider',
      })
  const starFrame = createMemo(() => Math.floor(phase() / 4))
  const logoFrame = createMemo(() => Math.floor(phase() / 2))
  const spinnerGlyph = createMemo(() => ['✦', '✧', '·', '✧'][Math.floor(phase() / 3) % 4]!)
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
  const enqueueRunEvent = (event: TerminalRunEvent) => {
    bufferedEvents.push({ ...event })
    if (event.type === 'text-delta' || event.type === 'reasoning-delta') bufferedCharacters += Array.from(event.text).length
    if (event.type === 'reasoning-delta') setActivity('thinking')
    else if (event.type === 'text-delta') setActivity('streaming')
    else setActivity('tool')
  }
  const pumpRunEvents = () => {
    const event = bufferedEvents[0]
    if (!event) {
      settleEventDrain()
      return
    }
    let projected: TerminalRunEvent = event
    if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
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
    setTranscript(current => {
      const next = current.map(item => ({ ...item }))
      applyTerminalRunEvent(next, projected)
      return next
    })
    renderer.requestRender()
    settleEventDrain()
  }
  const waitForEventDrain = () => bufferedEvents.length === 0
    ? Promise.resolve()
    : new Promise<void>(resolve => { drainResolvers.push(resolve) })
  const clearEventBuffer = () => {
    bufferedEvents = []
    bufferedCharacters = 0
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
    setActivity('thinking')
    setTranscript(current => [...current, { role: 'user', text: line }, placeholder])
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
      await waitForEventDrain()
      setTranscript(current => current.map(item => item.placeholder
        ? { role: 'assistant' as const, text: '(没有文本输出)', placeholder: false }
        : item))
      tell('完成', 2600)
    } catch (error) {
      const aborted = controller.signal.aborted
      clearEventBuffer()
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
    renderer.setCursorPosition(0, 0, false)
    const animation = setInterval(() => {
      setPhase(value => value + 1)
      // 中文说明：Xiaoyu 在 OpenTUI 工作台内永久隐藏 terminal hardware cursor。
      // Windows Text Cursor Indicator 因此不会被星星/流星 dirty frame 带到背景 cell；输入焦点仍由 TextareaRenderable 负责。
      renderer.setCursorPosition(0, 0, false)
    }, 50)
    const streamPump = setInterval(pumpRunEvents, 30)
    const tips = setInterval(() => setTipIndex(value => value + 1), 5500)
    const clockTimer = setInterval(() => setClock(Date.now()), 1000)
    onCleanup(() => {
      clearInterval(animation)
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
    <box width={dimensions().width} height={dimensions().height} flexDirection="column" backgroundColor={COLOR.background}>
      <BackgroundSky
        width={dimensions().width}
        height={dimensions().height}
        starFrame={starFrame()}
        meteorFrame={phase()}
        vivid={settings().visual === 'vivid'}
        stars={settings().stars}
        meteors={settings().meteors}
      />
      <box position="relative" zIndex={10} flexGrow={1} flexDirection="column" alignItems="center" justifyContent={centerMode() ? 'center' : 'flex-end'} paddingTop={1}>
        <Show when={showLogo()}>
          <box width={dockWidth()} flexDirection="column" alignItems="center" paddingBottom={2}>
            <Logo
              compact={compactLogo()}
              frame={logoFrame()}
              gradient={settings().visual === 'vivid' && settings().logoGradient}
            />
          </box>
        </Show>

        <Show when={transcript().length > 0}>
          <scrollbox
            ref={(value: ScrollBoxRenderable) => { transcriptScroll = value }}
            width={dimensions().width}
            flexGrow={1}
            scrollX={false}
            scrollY={true}
            stickyScroll={true}
            stickyStart="bottom"
            viewportCulling={true}
            scrollbarOptions={{ visible: false }}
          >
            <box width={dimensions().width} flexDirection="column" alignItems="center">
              <box width={contentWidth()} flexDirection="column" gap={1} paddingTop={1} paddingBottom={1}>
                <For each={transcript()}>{item => {
                  const meta = roleMeta(item.role)
                  return (
                    <box flexDirection="row" gap={2}>
                      <box width={8}><text fg={meta.color}><strong>{meta.label}</strong></text></box>
                      <box flexGrow={1}><text fg={item.role === 'reasoning' ? COLOR.faint : item.role === 'tool' ? COLOR.soft : COLOR.text}>{item.placeholder ? `${spinnerGlyph()} 正在思考…` : item.text}</text></box>
                    </box>
                  )
                }}</For>
              </box>
            </box>
          </scrollbox>
        </Show>

        <box width={dockWidth()} flexDirection="column" paddingBottom={1} onMouseDown={() => prompt?.focus()}>
          <box
            flexDirection="column"
            backgroundColor={showLogo() ? COLOR.panel : COLOR.background}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={showLogo() ? 1 : 0}
            paddingRight={showLogo() ? 1 : 0}
          >
            <box flexDirection="row" alignItems="flex-start">
              <text fg={MODE_META[mode()].color}>▌</text>
              <box flexGrow={1} paddingLeft={1}>
                <textarea
                  ref={(value: TextareaRenderable) => { prompt = value }}
                  minHeight={1}
                  maxHeight={5}
                  wrapMode="word"
                  placeholder="输入消息…（输入 / 唤起命令）"
                  placeholderColor={COLOR.faint}
                  textColor={COLOR.text}
                  focusedTextColor={COLOR.text}
                  showCursor={false}
                  cursorColor={COLOR.text}
                  cursorStyle={{ style: 'block', blinking: false }}
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
            <box flexDirection="row" height={1}>
              <text fg={MODE_META[mode()].color}>▌</text>
            </box>
            <box flexDirection="row">
              <text fg={MODE_META[mode()].color}>▌</text>
              <box flexGrow={1} flexDirection="row" justifyContent="space-between" paddingLeft={1}>
                <text fg={MODE_META[mode()].color}><strong>{MODE_META[mode()].label}</strong></text>
                <box flexDirection="row">
                  <text fg={providerStatus().dotColor}>{providerStatus().dot}</text>
                  <text fg={COLOR.text}> {providerStatus().label}</text>
                  <Show when={providerConfigured()}>
                    <text fg={COLOR.soft}> · </text>
                    <text fg={reasoningColor(reasoningEffort())}><strong>{reasoningEffort()}</strong></text>
                  </Show>
                </box>
              </box>
            </box>
          </box>
        </box>

        <box width={dockWidth()} flexDirection="row" justifyContent="space-between" paddingTop={1} paddingBottom={1}>
          <For each={hintItems()}>{item => <text fg={COLOR.soft}>{item}</text>}</For>
        </box>
        <Show when={settings().tips}>
          <box width={dockWidth()} flexDirection="row" gap={2} justifyContent="center" paddingBottom={1}>
            <text fg={COLOR.orange}>●  提示</text>
            <text fg={COLOR.soft}>{tip()}</text>
          </box>
        </Show>
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
