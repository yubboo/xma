import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCtrlCAction } from '../src/terminal-shortcuts.ts'

test('Ctrl+C prioritizes copy, then cancel, then guarded exit', () => {
  assert.equal(resolveCtrlCAction({ hasSelection: true, busy: true, modal: true, exitArmed: true }), 'copy-selection')
  assert.equal(resolveCtrlCAction({ hasSelection: false, busy: true, modal: false, exitArmed: false }), 'cancel-turn')
  assert.equal(resolveCtrlCAction({ hasSelection: false, busy: false, modal: true, exitArmed: false }), 'cancel-modal')
  assert.equal(resolveCtrlCAction({ hasSelection: false, busy: false, modal: false, exitArmed: false }), 'arm-exit')
  assert.equal(resolveCtrlCAction({ hasSelection: false, busy: false, modal: false, exitArmed: true }), 'exit')
})
