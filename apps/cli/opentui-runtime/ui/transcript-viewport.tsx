/**
 * 文件作用：独立拥有 Xiaoyu Terminal Transcript 的 viewport、底部跟随、历史滚动与消息排版。
 * 关联模块：app.tsx、theme.ts、tui.ts。
 * 职责边界：只投影 Host transcript；不得修改 Agent Runtime。底部对齐通过显式 spacer 计算实现，禁止 flex-end/auto-margin 造成不可达历史。
 */

import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core'
import { For, Show, createSignal } from 'solid-js'
import type { TerminalActivitySummary, TerminalTranscriptItem } from '../contracts.ts'
import { formatTerminalActivityElapsed, terminalActivityPresentation } from './activity-view.ts'
import { COLOR } from './theme.ts'

function roleMeta(role: TerminalTranscriptItem['role']): { label: string; color: string } {
  if (role === 'user') return { label: '你', color: COLOR.orange }
  if (role === 'assistant') return { label: 'Xiaoyu', color: COLOR.orange }
  if (role === 'reasoning') return { label: '思考', color: COLOR.faint }
  if (role === 'tool') return { label: 'Xiaoyu · 工具', color: COLOR.blue }
  if (role === 'activity') return { label: '活动', color: COLOR.soft }
  return { label: '系统', color: COLOR.soft }
}

function RunActivityRow(props: { summary: TerminalActivitySummary; nowMs: number; onToggle: () => void }) {
  const presentation = () => terminalActivityPresentation(props.summary, props.nowMs)
  const toggle = (event: { stopPropagation(): void }) => {
    event.stopPropagation()
    props.onToggle()
  }
  return (
    <box width="100%" flexDirection="column" paddingTop={1} paddingBottom={1} flexShrink={0}>
      <box
        width="100%"
        flexDirection="row"
        onMouseDown={event => event.stopPropagation()}
        onMouseUp={toggle}
      >
        <text fg={props.summary.outcome === 'failed' ? COLOR.red : COLOR.soft}>
          {`${presentation().timeLabel}${props.summary.outcome === 'running' ? '' : ` ${props.summary.expanded ? '▾' : '▸'}`}`}
        </text>
      </box>
      <Show when={props.summary.outcome === 'running'}>
        <box
          width="100%"
          flexDirection="row"
          paddingTop={1}
          onMouseDown={event => event.stopPropagation()}
          onMouseUp={toggle}
        >
          <text fg={COLOR.orange}><strong>Xiaoyu</strong></text>
          <text fg={COLOR.faint}>{` · ${presentation().stateLabel} ${props.summary.expanded ? '▾' : '▸'}`}</text>
        </box>
      </Show>
      <Show when={props.summary.expanded}>
        <box width="100%" flexDirection="column" paddingTop={1} paddingLeft={2} gap={1} flexShrink={0}>
          <For each={props.summary.entries}>{entry => (
            <box width="100%" flexDirection="row" gap={1} flexShrink={0}>
              <box width={3} flexShrink={0}>
                <text fg={entry.kind === 'tool-result' ? (entry.ok === false ? COLOR.red : COLOR.green) : COLOR.faint}>
                  {entry.kind === 'tool-call' ? '›' : entry.kind === 'tool-result' ? (entry.ok === false ? '✗' : '✓') : '·'}
                </text>
              </box>
              <box flexGrow={1} minWidth={0}>
                <text fg={entry.kind === 'status' ? COLOR.faint : COLOR.soft}>{entry.text}</text>
              </box>
              <box width={10} flexShrink={0} justifyContent="flex-end">
                <text fg={COLOR.faint}>{`+${formatTerminalActivityElapsed(entry.elapsedMs)}`}</text>
              </box>
            </box>
          )}</For>
        </box>
      </Show>
    </box>
  )
}

export function TranscriptViewport(props: {
  width: number
  contentWidth: number
  items: readonly TerminalTranscriptItem[]
  nowMs: number
  onToggleActivity: (id: string) => void
  onScrollReady: (scroll: ScrollBoxRenderable) => void
}) {
  const [topSpacer, setTopSpacer] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined
  let body: BoxRenderable | undefined

  const syncTopSpacer = () => queueMicrotask(() => {
    if (!scroll || !body) return
    const viewportHeight = Math.max(0, scroll.viewport.height)
    const bodyHeight = Math.max(0, body.height)
    const next = Math.max(0, viewportHeight - bodyHeight)
    setTopSpacer(current => current === next ? current : next)
  })

  return (
    <scrollbox
      ref={(value: ScrollBoxRenderable) => {
        scroll = value
        props.onScrollReady(value)
        syncTopSpacer()
      }}
      width={props.width}
      height="100%"
      minHeight={0}
      scrollX={false}
      scrollY={true}
      stickyScroll={true}
      stickyStart="bottom"
      contentOptions={{ flexDirection: 'column' }}
      viewportCulling={true}
      scrollbarOptions={{ visible: false }}
      onSizeChange={syncTopSpacer}
    >
      <box height={topSpacer()} flexShrink={0} />
      <box
        ref={(value: BoxRenderable) => { body = value; syncTopSpacer() }}
        width={props.width}
        flexDirection="column"
        alignItems="center"
        flexShrink={0}
        onSizeChange={syncTopSpacer}
      >
        <box width={props.contentWidth} flexDirection="column" gap={1} paddingTop={1} paddingBottom={1} flexShrink={0}>
          <For each={props.items}>{item => {
            const meta = roleMeta(item.role)
            if (item.role === 'activity' && item.activity) {
              return <RunActivityRow summary={item.activity} nowMs={props.nowMs} onToggle={() => props.onToggleActivity(item.activity!.id)} />
            }
            if (item.role === 'user') {
              return (
                <box width="100%" flexDirection="row" justifyContent="flex-end" flexShrink={0}>
                  <box
                    maxWidth={Math.max(20, Math.floor(props.contentWidth * 0.72))}
                    backgroundColor={COLOR.userMessage}
                    paddingLeft={1}
                    paddingRight={1}
                    flexShrink={0}
                  >
                    <text fg={COLOR.userMessageText}>{item.text}</text>
                  </box>
                </box>
              )
            }
            if (item.placeholder) return <></>
            if (item.role === 'assistant') {
              return (
                <box width="100%" flexDirection="column" flexShrink={0}>
                  <text fg={meta.color}><strong>{meta.label}</strong></text>
                  <text fg={COLOR.text}>{item.text}</text>
                </box>
              )
            }
            if (item.role === 'reasoning') return <></>
            return (
              <box width="100%" flexDirection="row" gap={2} flexShrink={0}>
                <box width={14} flexShrink={0}><text fg={meta.color}><strong>{meta.label}</strong></text></box>
                <box flexGrow={1} minWidth={0}>
                  <text fg={item.role === 'tool' ? COLOR.soft : COLOR.text}>{item.text}</text>
                </box>
              </box>
            )
          }}</For>
        </box>
      </box>
    </scrollbox>
  )
}
