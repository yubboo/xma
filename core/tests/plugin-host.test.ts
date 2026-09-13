/**
 * 文件作用：验证 XMA Plugin Host 与 DeepSeek Harness 基础兼容 Contract。
 * 关联模块：core/src/plugin.ts、plugins/dsh-compat。
 * 当前实现：service proxy、inject、effect、事件分发、对象/函数插件和 unmount 回归测试。
 * 职责边界：这里只证明基础 Contract；不代表所有 DeepSeek Harness 专属 Service 已兼容。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { XmaPluginHost } from '../src/plugin.ts'
import { adaptDeepSeekHarnessPlugin } from 'xma-plugin-dsh'

test('XMA plugin host provides services through ctx.<service> and tears effects down', async () => {
  const host = new XmaPluginHost()
  let disposed = false
  host.context.provide('tools', { ready: true })
  const id = await host.mount({
    id: 'example',
    inject: ['tools'],
    apply(context) {
      assert.equal((context.tools as { ready: boolean }).ready, true)
      context.effect(() => () => { disposed = true })
    },
  })
  await host.unmount(id)
  assert.equal(disposed, true)
  await host.shutdown()
})

test('DeepSeek Harness object plugin with inject + apply can be adapted', async () => {
  const host = new XmaPluginHost()
  host.context.provide('tools', { name: 'xma-tools' })
  let seen = ''
  const plugin = adaptDeepSeekHarnessPlugin('fixture', {
    inject: ['tools'],
    apply(context) { seen = (context.tools as { name: string }).name },
  })
  await host.mount(plugin)
  assert.equal(seen, 'xma-tools')
  await host.shutdown()
})

test('DeepSeek Harness function plugin can carry inject metadata', async () => {
  const host = new XmaPluginHost()
  host.context.provide('tools', { value: 42 })
  let seen = 0
  const plugin = ((context) => { seen = (context.tools as { value: number }).value }) as ((context: typeof host.context) => void) & { inject?: readonly string[] }
  plugin.inject = ['tools']
  await host.mount(adaptDeepSeekHarnessPlugin('function-fixture', plugin))
  assert.equal(seen, 42)
  await host.shutdown()
})

test('event dispatch supports emit / parallel / serial / bail / waterfall basics', async () => {
  const host = new XmaPluginHost()
  const trace: string[] = []
  host.context.on('emit-test', value => { trace.push(String(value)) })
  host.context.emit('emit-test', 'a')
  assert.deepEqual(trace, ['a'])

  host.context.on('decision', () => false)
  host.context.on('decision', () => 'accepted')
  assert.equal(host.context.bail('decision'), 'accepted')
  assert.equal(await host.context.serial('decision'), 'accepted')

  host.context.on('flow', (_value, next) => `outer(${String((next as () => unknown)())})`)
  assert.equal(host.context.waterfall('flow', 'x', () => 'base'), 'outer(base)')
  await host.shutdown()
})
