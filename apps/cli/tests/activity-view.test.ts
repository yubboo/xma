import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTerminalActivityElapsed, terminalActivityPresentation } from '../opentui-runtime/ui/activity-view.ts'

test('activity elapsed uses human Chinese seconds/minutes/hours without fake fixed values', () => {
  assert.equal(formatTerminalActivityElapsed(42_999), '42秒')
  assert.equal(formatTerminalActivityElapsed(95_500), '1分35秒')
  assert.equal(formatTerminalActivityElapsed(3_723_000), '1小时2分3秒')
})

test('running activity exposes processed time + thinking state and completed activity exposes final duration', () => {
  assert.deepEqual(
    terminalActivityPresentation({ startedAtMs: 1_000, elapsedMs: 0, outcome: 'running' }, 52_000),
    { elapsedMs: 51_000, timeLabel: '已处理 51秒', stateLabel: '正在思考' },
  )
  assert.deepEqual(
    terminalActivityPresentation({ startedAtMs: 1_000, elapsedMs: 95_000, outcome: 'completed' }, 200_000),
    { elapsedMs: 95_000, timeLabel: '用时 1分35秒' },
  )
  assert.equal(
    terminalActivityPresentation({ startedAtMs: 1_000, elapsedMs: 4_000, outcome: 'cancelled' }, 5_000).timeLabel,
    '用时 4秒 · 已中止',
  )
})
