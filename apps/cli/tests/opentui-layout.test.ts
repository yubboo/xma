import assert from 'node:assert/strict'
import test from 'node:test'
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
