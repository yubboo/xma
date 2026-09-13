import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ENVIRONMENT_PROFILE_ID,
  TerminalBrainStore,
  loadBrainConfig,
  profileToProvider,
} from '../src/brain.ts'

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('Brain Store persists only credential references and never the API Key Secret', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xma-brain-'))
  const file = path.join(root, 'brain.json')
  try {
    withEnv({ XIAOYU_TEST_KEY: 'secret-value-must-not-persist' }, () => {
      const store = new TerminalBrainStore(file)
      const profile = store.upsert({
        displayName: 'Local Provider',
        baseUrl: 'https://example.com/v1/',
        model: 'demo-model',
        credentialEnv: 'XIAOYU_TEST_KEY',
      })
      assert.equal(profile.baseUrl, 'https://example.com/v1')
      assert.equal(store.active()?.id, profile.id)
      const raw = readFileSync(file, 'utf8')
      assert.match(raw, /XIAOYU_TEST_KEY/)
      assert.doesNotMatch(raw, /secret-value-must-not-persist/)
      const view = store.list().find(item => item.id === profile.id)
      assert.equal(view?.credentialReady, true)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Brain Store can switch profiles and persist the selected model', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xma-brain-'))
  const file = path.join(root, 'brain.json')
  try {
    withEnv({ XIAOYU_BASE_URL: undefined, XIAOYU_MODEL: undefined, XIAOYU_API_KEY: undefined }, () => {
      const store = new TerminalBrainStore(file)
      const first = store.upsert({ displayName: 'One', baseUrl: 'https://one.example/v1', model: 'one' })
      const second = store.upsert({ displayName: 'Two', baseUrl: 'https://two.example/v1', model: 'two' })
      store.select(first.id)
      assert.equal(store.active()?.id, first.id)
      const updated = store.updateModel(first.id, 'one-next')
      assert.equal(updated.model, 'one-next')
      const reloaded = new TerminalBrainStore(file)
      assert.equal(reloaded.active()?.id, first.id)
      assert.equal(reloaded.active()?.model, 'one-next')
      assert.equal(reloaded.list().some(item => item.id === second.id), true)
      assert.equal(loadBrainConfig(file).activeProfileId, first.id)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy XIAOYU_* environment config remains a read-only compatible Brain profile', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xma-brain-'))
  const file = path.join(root, 'brain.json')
  try {
    withEnv({
      XIAOYU_BASE_URL: 'https://env.example/v1',
      XIAOYU_MODEL: 'env-model',
      XIAOYU_API_KEY: 'env-secret',
    }, () => {
      const store = new TerminalBrainStore(file)
      const profile = store.active()
      assert.equal(profile?.id, ENVIRONMENT_PROFILE_ID)
      const view = store.list()[0]
      assert.equal(view?.source, 'environment')
      assert.equal(view?.credentialReady, true)
      const provider = profileToProvider(profile!)
      assert.deepEqual(provider.auth, { type: 'bearer', credential: { source: 'env', key: 'XIAOYU_API_KEY' } })
      assert.throws(() => store.updateModel(ENVIRONMENT_PROFILE_ID, 'other'), /XIAOYU_MODEL/)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
