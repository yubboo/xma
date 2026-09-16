/**
 * 文件作用：把 Host-neutral SessionRuntimeMetrics 投影成 Prompt 主状态行摘要与下方全量 detail block。
 * 关联模块：session-status.ts、prompt-dock.tsx、contracts.ts。
 * 当前实现：Headline 显示 context + 真实账户/套餐摘要；0轮 Detail 仅左右展示 billing/permission，1轮起完整 metrics 只换行不隐藏。
 * 职责边界：禁止在组件内按 Provider 品牌计算 usage、价格、余额或套餐额度。
 */

import { For, Show } from 'solid-js'
import type { SessionRuntimeMetrics } from '../contracts.ts'
import { sessionHeadlineItems, sessionIdleStatusItems, sessionStatusRows } from './session-status.ts'
import { COLOR } from './theme.ts'

export function SessionStatusHeadline(props: { width: number; metrics: SessionRuntimeMetrics }) {
  const items = () => sessionHeadlineItems(props.metrics, props.width)
  return (
    <Show when={items().length > 0}>
      <box
        id="xiaoyu-session-status-headline"
        height={1}
        flexGrow={1}
        flexShrink={1}
        minWidth={0}
        overflow="hidden"
        justifyContent="flex-end"
        paddingRight={3}
      >
        <text fg={COLOR.faint}>{items().join(' · ')}</text>
      </box>
    </Show>
  )
}

export function SessionStatusBar(props: { width: number; metrics: SessionRuntimeMetrics }) {
  const rows = () => sessionStatusRows(props.metrics, props.width)
  const idleItems = () => sessionIdleStatusItems(props.metrics)
  const hasConversation = () => props.metrics.turnCount > 0

  return (
    <box
      id="xiaoyu-session-status-bar"
      width="100%"
      flexDirection="column"
      flexShrink={0}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <Show
        when={hasConversation()}
        fallback={(
          <box width="100%" flexDirection="row" justifyContent="space-between" flexShrink={0}>
            <text fg={COLOR.faint}>{idleItems()[0]}</text>
            <text fg={COLOR.faint}>{idleItems()[1]}</text>
          </box>
        )}
      >
        <For each={rows()}>{row => (
          <box width="100%" flexShrink={0}>
            <text fg={COLOR.faint}>{row}</text>
          </box>
        )}</For>
      </Show>
    </box>
  )
}
