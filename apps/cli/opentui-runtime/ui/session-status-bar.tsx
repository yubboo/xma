/**
 * 文件作用：把 Terminal 专用 Session status item 投影成 Xiaoyu 输入 Dock 下方的一行 OpenTUI UI。
 * 关联模块：session-status.ts、prompt-dock.tsx、contracts.ts。
 * 当前实现：只负责 Renderable；状态字段选择和格式化在纯函数模块中，真实数据来自 xma-session canonical metrics。
 * 职责边界：禁止在组件内按 Provider 品牌计算 usage、价格、余额或套餐额度。
 */

import type { SessionRuntimeMetrics } from '../contracts.ts'
import { sessionStatusItems } from './session-status.ts'
import { COLOR } from './theme.ts'

export function SessionStatusBar(props: { width: number; metrics: SessionRuntimeMetrics }) {
  return (
    <box
      id="xiaoyu-session-status-bar"
      width="100%"
      height={1}
      flexShrink={0}
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={COLOR.faint}>{sessionStatusItems(props.metrics, props.width).join('  ·  ')}</text>
    </box>
  )
}
