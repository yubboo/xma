/**
 * 文件作用：独立拥有 Xiaoyu Terminal 输入框、模式/Provider 状态、快捷键栏和底部提示。
 * 关联模块：app.tsx、theme.ts。
 * 职责边界：只负责 Prompt Host UI 与 Textarea 焦点投影；不决定 Agent 行为、Provider 请求或 Tool 权限。
 */

import type { KeyEvent, TextareaRenderable } from '@opentui/core'
import { For, Show } from 'solid-js'
import type { TerminalAgentMode, TerminalReasoningEffort } from '../contracts.ts'
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

  return (
    <>
      <box width={props.width} flexShrink={0} flexDirection="column" paddingBottom={1} onMouseDown={props.onPromptFocus}>
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
            <box flexGrow={1} paddingLeft={1}>
              <textarea
                ref={(value: TextareaRenderable) => {
                  prompt = value
                  props.onPromptReady(value)
                }}
                focused={props.focused}
                minHeight={1}
                maxHeight={5}
                wrapMode="word"
                placeholder="输入消息…（输入 / 唤起命令）"
                placeholderColor={COLOR.faint}
                textColor={COLOR.text}
                focusedTextColor={COLOR.text}
                showCursor={true}
                cursorColor={COLOR.text}
                cursorStyle={{ style: 'block', blinking: true }}
                onSubmit={() => props.onSubmit(prompt?.plainText ?? '')}
                onKeyDown={(event: KeyEvent) => {
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
            </box>
          </box>
          <box flexDirection="row" height={1}>
            <text fg={MODE_META[props.mode].color}>▌</text>
          </box>
          <box flexDirection="row">
            <text fg={MODE_META[props.mode].color}>▌</text>
            <box flexGrow={1} flexDirection="row" justifyContent="space-between" paddingLeft={1}>
              <text fg={MODE_META[props.mode].color}><strong>{MODE_META[props.mode].label}</strong></text>
              <box flexDirection="row">
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

      <box width={props.width} flexDirection="row" justifyContent="space-between" paddingTop={1} paddingBottom={1}>
        <For each={props.hintItems}>{item => <text fg={COLOR.soft}>{item}</text>}</For>
      </box>
      <Show when={props.tipsEnabled}>
        <box width={props.width} flexDirection="row" gap={2} justifyContent="center" paddingBottom={1}>
          <text fg={COLOR.orange}>●  提示</text>
          <text fg={COLOR.soft}>{props.tip}</text>
        </box>
      </Show>
    </>
  )
}
