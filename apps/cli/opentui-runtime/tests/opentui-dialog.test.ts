/**
 * 文件作用：使用 Bun + 真实 OpenTUI/Solid 测试 Renderer 验证模型配置 SecretInput 的粘贴与提交生命周期。
 * 关联模块：apps/cli/opentui-runtime/ui/dialogs.tsx、Provider Setup。
 * 职责边界：只验证 Dialog Host 交互；不访问真实 Provider，也不读取用户真实 API Key。
 */

import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { testRender } from '@opentui/solid'
import { InputDialog, ListDialog } from '../ui/dialogs.tsx'

test('secret provider input accepts bracketed paste and submits without exposing the secret in rendered text', async () => {
  let submitted: string | undefined
  const setup = await testRender(() => InputDialog({
    title: 'API Key',
    description: 'test only',
    initial: '',
    secret: true,
    allowCancel: true,
    onDone: value => { submitted = value },
  }), { width: 80, height: 24 })

  try {
    await setup.renderOnce()
    setup.mockInput.pasteBracketedText('sk-test-secret')
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    assert.doesNotMatch(frame, /sk-test-secret/)
    assert.match(frame, /•+/)

    setup.mockInput.pressEnter()
    await setup.renderOnce()
    assert.equal(submitted, 'sk-test-secret')
  } finally {
    setup.renderer.destroy()
  }
})


test('slash prefix ListDialog selects the filtered command on Enter without leaving the modal unsettled', async () => {
  let selected: string | undefined
  const setup = await testRender(() => ListDialog({
    title: '命令',
    items: [{ value: 'help', label: '帮助', description: '查看快捷命令', shortcut: '/help' }],
    searchable: true,
    allowCancel: true,
    initialQuery: '/he',
    searchMode: 'shortcut-prefix',
    onDone: value => { selected = value },
  }), { width: 100, height: 30 })

  try {
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /\/help/)
    setup.mockInput.pressEnter()
    await setup.renderOnce()
    assert.equal(selected, 'help')
  } finally {
    setup.renderer.destroy()
  }
})
