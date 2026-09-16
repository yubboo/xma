/**
 * 文件作用：验证 slash command 的 canonical shortcut 前缀筛选与 matched/remainder 拆分。
 * 关联模块：apps/cli/src/tui-menu.ts、OpenTUI ListDialog slash 搜索。
 * 职责边界：只验证纯菜单语义，不依赖 OpenTUI Renderer 或真实 Terminal。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterTuiMenuShortcutPrefix, splitTuiMenuShortcutPrefix, type TuiMenuItem } from '../src/tui-menu.ts'

const items: readonly TuiMenuItem[] = [
  { value: 'help', label: '帮助', shortcut: '/help' },
  { value: 'settings', label: '设置', shortcut: '/settings' },
  { value: 'provider', label: '模型 / 提供方', shortcut: '/provider' },
]

test('slash prefix filtering stays silent for bare slash and narrows by canonical shortcut', () => {
  assert.deepEqual(filterTuiMenuShortcutPrefix(items, '/'), [])
  assert.deepEqual(filterTuiMenuShortcutPrefix(items, '/h').map(item => item.value), ['help'])
  assert.deepEqual(filterTuiMenuShortcutPrefix(items, '/se').map(item => item.value), ['settings'])
  assert.deepEqual(filterTuiMenuShortcutPrefix(items, '/pro').map(item => item.value), ['provider'])
})

test('slash prefix split exposes the typed match separately from the remaining suffix', () => {
  assert.deepEqual(splitTuiMenuShortcutPrefix(items[0]!, '/he'), {
    shortcut: '/help',
    matched: '/he',
    remainder: 'lp',
  })
  assert.deepEqual(splitTuiMenuShortcutPrefix(items[0]!, '/hel'), {
    shortcut: '/help',
    matched: '/hel',
    remainder: 'p',
  })
  assert.deepEqual(splitTuiMenuShortcutPrefix(items[1]!, '/set'), {
    shortcut: '/settings',
    matched: '/set',
    remainder: 'tings',
  })
})
