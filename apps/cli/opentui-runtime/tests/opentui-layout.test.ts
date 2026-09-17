/**
 * 文件作用：使用 Bun + OpenTUI Core 真实 Renderer 验证 Transcript、用户消息带与多行 Metrics Dock 的布局边界。
 * 关联模块：apps/cli/opentui-runtime/app.tsx、Transcript viewport、Prompt Dock。
 * 职责边界：只验证 Renderer 布局行为，不修改生产布局参数，也不访问外部服务。
 */

import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'

test('conversation layout keeps prompt dock visible and gives transcript a real wheel-scroll range', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 })
  try {
    const shell = new BoxRenderable(setup.renderer, {
      id: 'shell',
      width: 80,
      height: 24,
      flexDirection: 'column',
    })
    const workbench = new BoxRenderable(setup.renderer, {
      id: 'workbench',
      width: '100%',
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      overflow: 'hidden',
      flexDirection: 'column',
    })
    const transcriptSlot = new BoxRenderable(setup.renderer, {
      id: 'transcript-slot',
      width: '100%',
      height: 0,
      flexBasis: 0,
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      overflow: 'hidden',
    })
    const scroll = new ScrollBoxRenderable(setup.renderer, {
      id: 'transcript-scroll',
      width: '100%',
      height: '100%',
      minHeight: 0,
      scrollY: true,
      stickyScroll: true,
      stickyStart: 'bottom',
      scrollbarOptions: { visible: false },
      contentOptions: { flexDirection: 'column' },
    })

    for (let index = 0; index < 60; index += 1) {
      const row = new BoxRenderable(setup.renderer, {
        id: `row-${index}`,
        width: '100%',
        height: 1,
        flexShrink: 0,
      })
      row.add(new TextRenderable(setup.renderer, { content: `message-${index}` }))
      scroll.add(row)
    }

    const promptDock = new BoxRenderable(setup.renderer, {
      id: 'prompt-dock',
      width: '100%',
      height: 6,
      flexShrink: 0,
      flexDirection: 'column',
    })
    promptDock.add(new TextRenderable(setup.renderer, { content: 'INPUT DOCK' }))

    transcriptSlot.add(scroll)
    workbench.add(transcriptSlot)
    workbench.add(promptDock)
    shell.add(workbench)
    setup.renderer.root.add(shell)

    await setup.renderOnce()

    assert.ok(promptDock.y >= 0, 'prompt dock must be laid out on screen')
    assert.ok(promptDock.y + promptDock.height <= shell.height, 'prompt dock must stay inside the terminal viewport')
    assert.ok(transcriptSlot.height > 0, 'transcript slot must receive the remaining height')
    assert.equal(scroll.height, transcriptSlot.height, 'scrollbox must fill only the bounded transcript slot')
    assert.ok(scroll.scrollHeight > scroll.viewport.height, 'long transcript must produce a real scroll range')

    scroll.scrollTo(scroll.scrollHeight)
    await setup.renderOnce()
    const bottom = scroll.scrollTop
    assert.ok(bottom > 0, 'scrollbox must reach a non-zero bottom offset')

    await setup.mockMouse.scroll(20, Math.max(1, Math.floor(scroll.viewport.height / 2)), 'up')
    await setup.renderOnce()
    assert.ok(scroll.scrollTop < bottom, 'mouse wheel up must move away from the sticky bottom')
  } finally {
    setup.renderer.destroy()
  }
})

test('Pi-style user message band fills the content column and keeps one row of vertical padding', async () => {
  const setup = await createTestRenderer({ width: 80, height: 16 })
  try {
    const shell = new BoxRenderable(setup.renderer, {
      id: 'shell-user-band',
      width: 80,
      height: 16,
      alignItems: 'center',
    })
    const content = new BoxRenderable(setup.renderer, {
      id: 'content-column',
      width: 60,
      flexDirection: 'column',
    })
    const userBand = new BoxRenderable(setup.renderer, {
      id: 'user-band',
      width: '100%',
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 1,
      paddingRight: 1,
      flexShrink: 0,
    })
    const text = new TextRenderable(setup.renderer, { content: '你好' })

    userBand.add(text)
    content.add(userBand)
    shell.add(content)
    setup.renderer.root.add(shell)
    await setup.renderOnce()

    assert.equal(userBand.width, content.width, 'user background must span the complete transcript content column')
    assert.ok(userBand.height >= 3, 'one text row plus top/bottom padding must occupy at least three terminal rows')
    assert.equal(text.x, userBand.x + 1, 'user text must keep one column of horizontal inset')
    assert.equal(text.y, userBand.y + 1, 'user text must keep one row of top inset')
  } finally {
    setup.renderer.destroy()
  }
})

test('a taller multi-row metrics dock remains atomic and inside a 24-row terminal', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 })
  try {
    const shell = new BoxRenderable(setup.renderer, {
      id: 'shell-metrics',
      width: 80,
      height: 24,
      flexDirection: 'column',
    })
    const transcriptSlot = new BoxRenderable(setup.renderer, {
      id: 'slot-metrics',
      width: '100%',
      height: 0,
      flexBasis: 0,
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      overflow: 'hidden',
    })
    const promptDock = new BoxRenderable(setup.renderer, {
      id: 'prompt-dock-metrics',
      width: '100%',
      flexShrink: 0,
      flexDirection: 'column',
    })
    const inputPanel = new BoxRenderable(setup.renderer, {
      id: 'input-panel',
      width: '100%',
      height: 4,
      flexShrink: 0,
    })
    const detail = new BoxRenderable(setup.renderer, {
      id: 'detail-block',
      width: '100%',
      flexDirection: 'column',
      flexShrink: 0,
      paddingTop: 1,
      paddingBottom: 1,
    })
    for (let index = 0; index < 3; index += 1) {
      const row = new BoxRenderable(setup.renderer, { width: '100%', height: 1, flexShrink: 0 })
      row.add(new TextRenderable(setup.renderer, { content: `metrics-row-${index}` }))
      detail.add(row)
    }
    const shortcuts = new BoxRenderable(setup.renderer, { width: '100%', height: 3, flexShrink: 0 })

    promptDock.add(inputPanel)
    promptDock.add(detail)
    promptDock.add(shortcuts)
    shell.add(transcriptSlot)
    shell.add(promptDock)
    setup.renderer.root.add(shell)
    await setup.renderOnce()

    assert.equal(detail.height, 5, 'three metrics rows plus top/bottom padding must remain fully visible')
    assert.ok(promptDock.height >= 12, 'the fixed dock must grow to include all multi-row detail content')
    assert.ok(promptDock.y + promptDock.height <= shell.height, 'the complete atomic dock must remain inside the terminal')
    assert.equal(transcriptSlot.height, shell.height - promptDock.height, 'transcript must consume only the remaining height')
  } finally {
    setup.renderer.destroy()
  }
})
