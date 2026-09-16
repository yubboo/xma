/**
 * 文件作用：独立拥有 Xiaoyu Terminal 输入框、模式/Provider 状态、快捷键栏和底部提示。
 * 关联模块：app.tsx、theme.ts。
 * 职责边界：只负责 Prompt Host UI 与 Textarea 焦点投影；不决定 Agent 行为、Provider 请求或 Tool 权限。
 */

import type { KeyEvent, TextareaRenderable } from '@opentui/core'
import { For, Show, createSignal } from 'solid-js'
import { slashCommandCompletionSuffix, slashCommandSuggestions, type SessionRuntimeMetrics, type TerminalAgentMode, type TerminalReasoningEffort } from '../contracts.ts'
import { SessionStatusBar, SessionStatusHeadline } from './session-status-bar.tsx'
import { COLOR, MODE_META, reasoningColor } from './theme.ts'

export interface PromptProviderStatus {
  dot: string
  dotColor: string
  label: string
}

export function PromptDock(props: {
  width: number
  panel: boolean
  mode: TerminalAgentMode
  providerStatus: PromptProviderStatus
  providerConfigured: boolean
  reasoningEffort: TerminalReasoningEffort
  metrics: SessionRuntimeMetrics
  focused: boolean
  hintItems: readonly string[]
  tipsEnabled: boolean
  tip: string
  onPromptReady: (prompt: TextareaRenderable) => void
  onPromptFocus: () => void
  onSubmit: (text: string) => void
  onCycleMode: (direction: 1 | -1) => void
}) {
  let prompt: TextareaRenderable | undefined
  const [slashInput, setSlashInput] = createSignal('')
  const [slashSelection, setSlashSelection] = createSignal(0)

  const syncSlashInput = () => {
    const value = prompt?.plainText ?? ''
    const trimmed = value.trimStart()
    const next = trimmed.startsWith('/') && !trimmed.includes(' ') && !trimmed.includes('\n') ? trimmed : ''
    setSlashInput(next)
    setSlashSelection(0)
  }

  const slashDiscoveryActive = () => slashInput().length > 1
  const slashSuggestions = () => slashDiscoveryActive() ? slashCommandSuggestions(slashInput()) : []
  const selectedSlashSuggestion = () => {
    const items = slashSuggestions()
    if (items.length === 0) return undefined
    return items[Math.min(slashSelection(), items.length - 1)]
  }
  const slashShortcut = (item: { value: string; shortcut?: string }) => item.shortcut ?? `/${item.value}`
  const slashGhostSuffix = () => slashCommandCompletionSuffix(slashInput(), selectedSlashSuggestion())
  const slashCandidatePrefix = (item: { value: string; shortcut?: string }) => {
    const shortcut = slashShortcut(item)
    return shortcut.slice(0, Math.min(slashInput().length, shortcut.length))
  }
  const slashCandidateSuffix = (item: { value: string; shortcut?: string }) => {
    const shortcut = slashShortcut(item)
    return shortcut.slice(Math.min(slashInput().length, shortcut.length))
  }
  const slashExact = () => {
    const input = slashInput()
    return slashSuggestions().some(item => slashShortcut(item).toLowerCase() === input.toLowerCase())
  }
  const completeSlashSuggestion = (): boolean => {
    const item = selectedSlashSuggestion()
    if (!item || !prompt) return false
    const input = slashInput()
    const shortcut = slashShortcut(item)
    if (!shortcut.toLowerCase().startsWith(input.toLowerCase())) return false
    prompt.insertText(shortcut.slice(input.length))
    setSlashInput(shortcut)
    setSlashSelection(0)
    return true
  }

  return (
    <box
      id="xiaoyu-prompt-dock"
      width={props.width}
      flexShrink={0}
      flexDirection="column"
    >
      <box width="100%" flexShrink={0} flexDirection="column" onMouseDown={props.onPromptFocus}>
        <box
          flexDirection="column"
          backgroundColor={props.panel ? COLOR.panel : COLOR.background}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={props.panel ? 1 : 0}
          paddingRight={props.panel ? 1 : 0}
        >
          <box flexDirection="row" alignItems="flex-start">
            <text fg={MODE_META[props.mode].color}>▌</text>
            <box flexGrow={1} paddingLeft={1} position="relative">
              <textarea
                ref={(value: TextareaRenderable) => {
                  prompt = value
                  props.onPromptReady(value)
                }}
                focused={props.focused}
                minHeight={1}
                maxHeight={5}
                wrapMode="word"
                placeholder="输入消息…（/ + 字母 查找命令）"
                placeholderColor={COLOR.faint}
                textColor={slashDiscoveryActive() ? COLOR.orange : COLOR.text}
                focusedTextColor={slashDiscoveryActive() ? COLOR.orange : COLOR.text}
                showCursor={true}
                cursorColor={COLOR.soft}
                cursorStyle={{ style: 'line', blinking: false }}
                onContentChange={syncSlashInput}
                onSubmit={() => {
                  const text = prompt?.plainText ?? ''
                  setSlashInput('')
                  setSlashSelection(0)
                  props.onSubmit(text)
                }}
                onKeyDown={(event: KeyEvent) => {
                  const suggestions = slashSuggestions()
                  if (suggestions.length > 0 && event.name === 'up') {
                    event.preventDefault()
                    event.stopPropagation()
                    setSlashSelection(current => (current - 1 + suggestions.length) % suggestions.length)
                    return
                  }
                  if (suggestions.length > 0 && event.name === 'down') {
                    event.preventDefault()
                    event.stopPropagation()
                    setSlashSelection(current => (current + 1) % suggestions.length)
                    return
                  }
                  if (suggestions.length > 0 && event.ctrl && event.name === 'space') {
                    event.preventDefault()
                    event.stopPropagation()
                    completeSlashSuggestion()
                    return
                  }
                  if (suggestions.length > 0 && event.name === 'return' && !slashExact()) {
                    event.preventDefault()
                    event.stopPropagation()
                    completeSlashSuggestion()
                    return
                  }
                  if (event.name !== 'tab') return
                  event.preventDefault()
                  event.stopPropagation()
                  props.onCycleMode(event.shift ? -1 : 1)
                }}
                keyBindings={[
                  { name: 'return', action: 'submit' },
                  { name: 'return', shift: true, action: 'newline' },
                  { name: 'return', ctrl: true, action: 'newline' },
                ]}
              />
              <Show when={slashGhostSuffix()}>
                <text
                  position="absolute"
                  zIndex={20}
                  left={slashInput().length}
                  top={0}
                  fg={COLOR.faint}
                >
                  {slashGhostSuffix()}
                </text>
              </Show>
            </box>
          </box>
          <Show when={slashDiscoveryActive()}>
            <box flexDirection="column" paddingLeft={2} paddingTop={1} paddingBottom={1} flexShrink={0}>
              <box flexDirection="row" gap={2} flexShrink={0}>
                <text fg={COLOR.orange}>快捷命令</text>
                <text fg={COLOR.faint}>↑↓ 选择 · Ctrl+Space 补齐 · 完整命令 Enter 执行</text>
              </box>
              <Show
                when={slashSuggestions().length > 0}
                fallback={<text fg={COLOR.faint}>无匹配命令 · Ctrl+P 查看全部命令</text>}
              >
                <For each={slashSuggestions()}>{(item, index) => (
                  <box width="100%" flexDirection="row" gap={2} flexShrink={0}>
                    <box width={18} flexShrink={0} flexDirection="row">
                      <text fg={index() === slashSelection() ? COLOR.orange : COLOR.soft}>
                        {index() === slashSelection() ? '› ' : '  '}
                      </text>
                      <text fg={COLOR.orange}>{slashCandidatePrefix(item)}</text>
                      <text fg={index() === slashSelection() ? COLOR.soft : COLOR.faint}>{slashCandidateSuffix(item)}</text>
                    </box>
                    <text fg={COLOR.faint}>{item.description ?? item.label}</text>
                  </box>
                )}</For>
              </Show>
            </box>
          </Show>
          <box flexDirection="row" height={1}>
            <text fg={MODE_META[props.mode].color}>▌</text>
          </box>
          <box flexDirection="row">
            <text fg={MODE_META[props.mode].color}>▌</text>
            <box flexGrow={1} flexDirection="row" paddingLeft={1} overflow="hidden">
              <text fg={MODE_META[props.mode].color}><strong>{MODE_META[props.mode].label}</strong></text>
              <box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" justifyContent="flex-end" overflow="hidden" paddingLeft={2}>
                <SessionStatusHeadline width={props.width} metrics={props.metrics} />
                <box flexDirection="row" flexShrink={0}>
                  <text fg={props.providerStatus.dotColor}>{props.providerStatus.dot}</text>
                  <text fg={COLOR.text}> {props.providerStatus.label}</text>
                  <Show when={props.providerConfigured}>
                    <text fg={COLOR.soft}> · </text>
                    <text fg={reasoningColor(props.reasoningEffort)}><strong>{props.reasoningEffort}</strong></text>
                  </Show>
                </box>
              </box>
            </box>
          </box>
        </box>
        <SessionStatusBar width={props.width} metrics={props.metrics} />
      </box>

      <box width="100%" flexDirection="row" justifyContent="space-between" paddingTop={1} paddingBottom={1} flexShrink={0}>
        <For each={props.hintItems}>{item => <text fg={COLOR.soft}>{item}</text>}</For>
      </box>
      <Show when={props.tipsEnabled}>
        <box width="100%" flexDirection="row" gap={2} justifyContent="center" paddingBottom={1} flexShrink={0}>
          <text fg={COLOR.orange}>●  提示</text>
          <text fg={COLOR.soft}>{props.tip}</text>
        </box>
      </Show>
    </box>
  )
}
