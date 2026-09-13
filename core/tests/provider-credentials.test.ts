import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NativeClient } from '../src/native.ts'
import { NativeCredentialStore } from '../../plugins/providers/credentials.ts'

function fakeNative(overrides: Partial<NativeClient> = {}): NativeClient {
  return {
    status: async () => ({ name: 'xma-native', version: '0.1.0', protocol: 'xma.native.v1', ready: true, policyConfigured: true, capabilities: [] }),
    credentialStatus: async () => ({ backend: 'test-keychain', available: true }),
    readCredential: async () => ({ found: false }),
    writeCredential: async () => ({ stored: true }),
    deleteCredential: async () => ({ deleted: false }),
    issueCapability: async grant => ({ token: 'lease', kind: grant.kind }),
    readText: async request => ({ path: request.path, content: '', bytes: 0, truncated: false }),
    writeText: async request => ({ path: request.path, bytes: Buffer.byteLength(request.content) }),
    runProcess: async request => ({
      program: request.program,
      cwd: request.cwd,
      exitCode: 0,
      success: true,
      timedOut: false,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    }),
    close: async () => undefined,
    ...overrides,
  }
}

test('NativeCredentialStore resolves only os references and never falls through to unrelated sources', async () => {
  let reads = 0
  const store = new NativeCredentialStore(fakeNative({
    readCredential: async key => {
      reads += 1
      return { found: true, value: `secret:${key}` }
    },
  }))

  assert.equal(await store.resolve({ source: 'env', key: 'API_KEY' }), undefined)
  assert.equal(reads, 0)
  assert.equal(await store.resolve({ source: 'os', key: 'provider:demo:api-key' }), 'secret:provider:demo:api-key')
  assert.equal(reads, 1)
})

test('NativeCredentialStore exposes backend readiness and write/delete semantics without persisting Secret values', async () => {
  const calls: string[] = []
  const store = new NativeCredentialStore(fakeNative({
    credentialStatus: async () => ({ backend: 'test-keychain', available: true, detail: 'fixture' }),
    readCredential: async key => ({ found: key === 'provider:ready:api-key', ...(key === 'provider:ready:api-key' ? { value: 'fixture-secret' } : {}) }),
    writeCredential: async (key, value) => {
      calls.push(`write:${key}:${value.length}`)
      return { stored: true }
    },
    deleteCredential: async key => {
      calls.push(`delete:${key}`)
      return { deleted: true }
    },
  }))

  assert.deepEqual(await store.status(), { source: 'os', backend: 'test-keychain', available: true, detail: 'fixture' })
  assert.equal(await store.has('provider:ready:api-key'), true)
  assert.equal(await store.has('provider:missing:api-key'), false)
  await store.set('provider:ready:api-key', 'fixture-secret')
  assert.equal(await store.delete('provider:ready:api-key'), true)
  assert.deepEqual(calls, ['write:provider:ready:api-key:14', 'delete:provider:ready:api-key'])
})

test('NativeCredentialStore fails closed when the native backend does not confirm a write', async () => {
  const store = new NativeCredentialStore(fakeNative({
    writeCredential: async () => ({ stored: false }),
  }))
  await assert.rejects(store.set('provider:demo:api-key', 'secret'), /未确认写入成功/)
})
