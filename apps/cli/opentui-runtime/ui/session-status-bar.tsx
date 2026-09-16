/**
 * 文件作用：把 Host-neutral SessionRuntimeMetrics 投影成 Prompt 主状态行的精简摘要与下方次要指标。
 * 关联模块：session-status.ts、prompt-dock.tsx、contracts.ts。
 * 当前实现：Headline 只显示 context + 真实账户/套餐摘要；Detail Row 显示 billing/tokens/cost/permission 等次要指标。
 * 职责边界：禁止在组件内按 Provider 品牌计算 usage、价格、余额或套餐额度。
 */

import { Show } from 'solid-js'
import type { SessionRuntimeMetrics } from '../contracts.ts'
import { sessionHeadlineItems, sessionStatusItems } from './session-status.ts'
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
  const items = () => sessionStatusItems(props.metrics, props.width)
  return (
    <Show when={items().length > 0}>
      <box
        id="xiaoyu-session-status-bar"
        width="100%"
        height={1}
        flexShrink={0}
        overflow="hidden"
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={COLOR.faint}>{items().join('  ·  ')}</text>
      </box>
    </Show>
  )
}
