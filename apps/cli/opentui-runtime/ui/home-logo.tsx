/**
 * 文件作用：独立渲染 Xiaoyu Terminal 首页 Logo 与高亮动画，避免 Logo 帧驱动父级工作台状态。
 * 关联模块：app.tsx、theme.ts。
 * 职责边界：只负责首页品牌视觉；不得触碰 Prompt caret、Transcript 滚动、Provider/Agent 状态。
 */

import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { COLOR } from './theme.ts'

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

export function HomeLogo(props: { compact: boolean; gradient: boolean }) {
  const [frame, setFrame] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => {
      if (!props.gradient) return
      setFrame(value => value + 1)
    }, 100)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box flexDirection="column" alignItems="center" backgroundColor={COLOR.background}>
      <Show
        when={!props.compact}
        fallback={
          <box flexDirection="column" alignItems="center" paddingBottom={1} backgroundColor={COLOR.background}>
            <text fg={COLOR.faint}>XIAOYU</text>
            <text fg={props.gradient ? logoGlyphColor(4, 10, frame(), COLOR.orange) : COLOR.orange}><strong>✦ XIAOYU</strong></text>
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
                frame={frame()}
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
