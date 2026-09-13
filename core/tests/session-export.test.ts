/**
 * 文件作用：验证 XMA Session Export、Secret Redaction 与未来相邻版本 Migration Contract。
 * 关联模块：core/src/session/export.ts、session/contract.ts、runtime.ts。
 * 当前实现：文本/嵌套 JSON 脱敏、原 Snapshot 不被修改、相邻迁移和未来版本拒绝测试。
 * 职责边界：测试不会把 Secret 写入 Provider Profile；这里故意构造含 Secret 的历史，用于证明导出边界能做二次防护。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SessionMigrationRegistry,
  createSecretValueRedactor,
  exportSession,
  type StoredSessionSnapshot,
} from '../src/session/export.ts'
import { SESSION_FORMAT_VERSION, type SessionSnapshot } from '../src/session/contract.ts'

test('Session export redacts known Secret values recursively without mutating the live snapshot', () => {
  const secret = 'sk-secret-123456789'
  const snapshot: SessionSnapshot = {
    header: {
      formatVersion: SESSION_FORMAT_VERSION,
      sessionId: 'export-test',
      agentId: 'xiaoyu.code',
      createdAt: '2026-09-13T00:00:00.000Z',
    },
    events: [
      {
        type: 'context/snapshot',
        sessionId: 'export-test',
        sequence: 1,
        timestamp: '2026-09-13T00:00:01.000Z',
        turnId: 'turn-1',
        stepId: 'step-1',
        digest: 'context-digest',
        content: `context ${secret}`,
        sources: [{ sourceId: 'fixture', digest: 'source-digest' }],
      },
      {
        type: 'user/message',
        sessionId: 'export-test',
        sequence: 2,
        timestamp: '2026-09-13T00:00:02.000Z',
        turnId: 'turn-1',
        content: `user ${secret}`,
      },
      {
        type: 'tool/result',
        sessionId: 'export-test',
        sequence: 3,
        timestamp: '2026-09-13T00:00:03.000Z',
        turnId: 'turn-1',
        stepId: 'step-1',
        callId: 'call-1',
        name: 'fixture.tool',
        ok: true,
        code: 'OK',
        content: `result ${secret}`,
        data: { nested: [`value ${secret}`] },
      },
      {
        type: 'turn/end',
        sessionId: 'export-test',
        sequence: 4,
        timestamp: '2026-09-13T00:00:04.000Z',
        turnId: 'turn-1',
        outcome: 'completed',
        text: `done ${secret}`,
      },
    ],
  }

  const exported = exportSession(snapshot, createSecretValueRedactor([secret]))
  assert.equal(exported.redacted, true)
  const json = JSON.stringify(exported)
  assert.equal(json.includes(secret), false)
  assert.equal(json.includes('[REDACTED]'), true)
  assert.equal(JSON.stringify(snapshot).includes(secret), true)
})

test('Session migration registry only allows explicit adjacent upgrades and rejects future formats', () => {
  const registry = new SessionMigrationRegistry()
  registry.register({
    fromVersion: 0,
    toVersion: 1,
    migrate(snapshot) {
      return { ...structuredClone(snapshot), header: { ...snapshot.header, formatVersion: 1 } }
    },
  })
  const legacy: StoredSessionSnapshot = {
    header: {
      formatVersion: 0,
      sessionId: 'legacy',
      agentId: 'xiaoyu.code',
      createdAt: '2026-09-13T00:00:00.000Z',
    },
    events: [],
  }
  assert.equal(registry.migrate(legacy, SESSION_FORMAT_VERSION).header.formatVersion, 1)
  assert.equal(legacy.header.formatVersion, 0)

  assert.throws(() => registry.register({
    fromVersion: 2,
    toVersion: 4,
    migrate(snapshot) { return snapshot },
  }), /advance exactly one/)
  assert.throws(() => registry.migrate({ ...legacy, header: { ...legacy.header, formatVersion: 2 } }, 1), /Unsupported future/)
})
