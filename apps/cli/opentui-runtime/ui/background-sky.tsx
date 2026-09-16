/**
 * 文件作用：独立渲染 Xiaoyu Terminal 的星空/流星装饰，并把高频动画与主工作台状态隔离。
 * 关联模块：app.tsx、theme.ts。
 * 职责边界：只负责装饰视觉；不得拥有输入焦点、Transcript 滚动、Provider/Agent 状态。对话阶段默认冻结动画，避免装饰帧干扰 Windows Terminal caret。
 */

import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { COLOR } from './theme.ts'

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

export function BackgroundSky(props: {
  width: number
  height: number
  vivid: boolean
  stars: boolean
  meteors: boolean
  motion: boolean
}) {
  const [phase, setPhase] = createSignal(0)
  const starFrame = createMemo(() => props.motion ? Math.floor(phase() / 4) : 0)
  const starItems = createMemo(() => props.stars ? starGlyphs(props.width, props.height, starFrame()) : [])
  const meteorItems = createMemo(() => props.motion && props.meteors ? meteorGlyphs(props.width, props.height, phase()) : [])

  onMount(() => {
    const timer = setInterval(() => {
      if (!props.motion || !props.vivid) return
      setPhase(value => {
        const next = value + 1
        return next
      })
    }, METEOR_FRAME_MS)
    onCleanup(() => clearInterval(timer))
  })

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
