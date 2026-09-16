/**
 * 文件作用：集中承载 Xiaoyu Terminal 的列表、输入与 Tool Approval 模态 UI，隔离 modal focus/caret 生命周期。
 * 关联模块：app.tsx、theme.ts、tui-menu.ts。
 * 职责边界：只负责 Dialog 展示与用户选择；不拥有 Provider/Agent/Tool 执行逻辑，不修改 Transcript 滚动。
 */

import { decodePasteBytes, type KeyEvent, type PasteEvent, type TextareaRenderable } from '@opentui/core'
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions } from '@opentui/solid'
import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import type { ToolApprovalDecision, ToolApprovalRequest } from 'xma-tools'
import { filterTuiMenuItems, type TuiMenuItem } from '../contracts.ts'
import { COLOR } from './theme.ts'

export function ListDialog(props: {
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
    if (!event.ctrl && !event.meta) {
      const direct = (event.sequence || event.name || '').toLowerCase()
      if (direct === 'y') {
        const yes = filtered().find(item => item.value === 'yes')
        if (yes) { event.preventDefault(); event.stopPropagation(); finish(yes.value); return true }
      }
      if (direct === 'n') {
        const no = filtered().find(item => item.value === 'no')
        if (no) { event.preventDefault(); event.stopPropagation(); finish(no.value); return true }
      }
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
              showCursor={true}
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

export function InputDialog(props: {
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
            showCursor={true}
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

export function ApprovalDialog(props: { request: ToolApprovalRequest; onDone: (value: ToolApprovalDecision) => void }) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [selected, setSelected] = createSignal(0)
  onMount(() => renderer.setCursorPosition(0, 0, false))
  const choices: readonly { label: string; value: ToolApprovalDecision }[] = [
    { label: 'No · 不执行', value: 'deny' },
    { label: 'Yes · 仅执行本次', value: 'allow-once' },
  ]
  useKeyboard(event => {
    if (event.name === 'escape') {
      event.preventDefault(); event.stopPropagation(); props.onDone('deny'); return
    }
    if (!event.ctrl && !event.meta && (event.name === 'y' || event.sequence?.toLowerCase() === 'y')) { event.preventDefault(); event.stopPropagation(); props.onDone('allow-once'); return }
    if (!event.ctrl && !event.meta && (event.name === 'n' || event.sequence?.toLowerCase() === 'n')) { event.preventDefault(); event.stopPropagation(); props.onDone('deny'); return }
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
        <text fg={COLOR.faint}>Y Yes · N No · ↑↓ 选择 · Enter 确认 · Esc = No</text>
      </box>
    </box>
  )
}

