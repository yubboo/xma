import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ENVIRONMENT_PROFILE_ID,
  TerminalBrainStore,
  loadBrainConfig,
  osCredentialKey,
  profileToProvider,
} from '../src/brain.ts'
import { CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID, DEEPSEEK_PROVIDER_ID, builtinProviderCatalogEntry } from '../../../plugins/providers/catalog.ts'
import { OPENAI_COMPATIBLE_ADAPTER_ID } from '../../../plugins/providers/openai-compatible.ts'

function customProfileFields() {
  return { providerId: CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID, adapterId: OPENAI_COMPATIBLE_ADAPTER_ID }
}

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
        ...customProfileFields(),
        displayName: 'Local Provider',
        baseUrl: 'https://example.com/v1/',
        model: 'demo-model',
        credential: { source: 'env', key: 'XIAOYU_TEST_KEY' },
      })
      assert.equal(profile.baseUrl, 'https://example.com/v1')
      assert.equal(store.active()?.id, profile.id)
      const raw = readFileSync(file, 'utf8')
      assert.match(raw, /XIAOYU_TEST_KEY/)
      assert.match(raw, /"source": "env"/)
      assert.doesNotMatch(raw, /secret-value-must-not-persist/)
      const view = store.list().find(item => item.id === profile.id)
      assert.equal(view?.credentialReady, true)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Brain Store persists only OS credential aliases and uses caller-provided readiness', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xma-brain-'))
  const file = path.join(root, 'brain.json')
  try {
    withEnv({ XIAOYU_BASE_URL: undefined, XIAOYU_MODEL: undefined, XIAOYU_API_KEY: undefined }, () => {
      const store = new TerminalBrainStore(file)
      const id = store.allocateId('Secure Provider')
      const key = osCredentialKey(id)
      const profile = store.upsert({
        id,
        ...customProfileFields(),
        displayName: 'Secure Provider',
        baseUrl: 'https://secure.example/v1',
        model: 'secure-model',
        credential: { source: 'os', key },
      })
      const raw = readFileSync(file, 'utf8')
      assert.match(raw, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.doesNotMatch(raw, /super-secret-api-key/)
      assert.equal(store.list().find(item => item.id === profile.id)?.credentialReady, false)
      assert.equal(store.list(new Map([[profile.id, true]])).find(item => item.id === profile.id)?.credentialReady, true)
      assert.deepEqual(profileToProvider(profile).auth, { type: 'bearer', credential: { source: 'os', key } })
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy Brain profiles migrate in memory to v3 CredentialReference and explicit provider identity', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xma-brain-'))
  const file = path.join(root, 'brain.json')
  try {
    writeFileSync(file, JSON.stringify({
      formatVersion: 1,
      activeProfileId: 'legacy',
      profiles: [{
        id: 'legacy',
        displayName: 'Legacy',
        baseUrl: 'https://legacy.example/v1',
        model: 'legacy-model',
        credentialEnv: 'LEGACY_API_KEY',
      }],
    }), 'utf8')
    const loaded = loadBrainConfig(file)
    assert.equal(loaded.formatVersion, 3)
    assert.deepEqual(loaded.profiles[0]?.credential, { source: 'env', key: 'LEGACY_API_KEY' })
    assert.equal(loaded.profiles[0]?.providerId, CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID)
    assert.equal(loaded.profiles[0]?.adapterId, OPENAI_COMPATIBLE_ADAPTER_ID)

    const store = new TerminalBrainStore(file)
    store.updateModel('legacy', 'legacy-model-next')
    const persisted = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    assert.equal(persisted.formatVersion, 3)
    assert.doesNotMatch(JSON.stringify(persisted), /credentialEnv/)
    assert.match(JSON.stringify(persisted), /LEGACY_API_KEY/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('v2 Brain profile migrates to v3 without pretending legacy generic profiles are branded Providers', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'xma-brain-'))
  const file = path.join(root, 'brain.json')
  try {
    writeFileSync(file, JSON.stringify({
      formatVersion: 2,
      activeProfileId: 'legacy-v2',
      profiles: [{
        id: 'legacy-v2',
        displayName: 'Legacy v2',
        baseUrl: 'https://legacy-v2.example/v1',
        model: 'legacy-v2-model',
        credential: { source: 'env', key: 'LEGACY_V2_API_KEY' },
      }],
    }), 'utf8')
    const loaded = loadBrainConfig(file)
    assert.equal(loaded.formatVersion, 3)
    assert.equal(loaded.profiles[0]?.providerId, CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID)
    assert.equal(loaded.profiles[0]?.adapterId, OPENAI_COMPATIBLE_ADAPTER_ID)
    assert.equal(loaded.profiles[0]?.options, undefined)

    const store = new TerminalBrainStore(file)
    store.updateModel('legacy-v2', 'legacy-v2-model-next')
    const persisted = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    assert.equal(persisted.formatVersion, 3)
    assert.match(JSON.stringify(persisted), /custom-openai-compatible/)
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
      const first = store.upsert({ ...customProfileFields(), displayName: 'One', baseUrl: 'https://one.example/v1', model: 'one' })
      const second = store.upsert({ ...customProfileFields(), displayName: 'Two', baseUrl: 'https://two.example/v1', model: 'two' })
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
      assert.equal(provider.providerId, CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID)
      assert.throws(() => store.updateModel(ENVIRONMENT_PROFILE_ID, 'other'), /XIAOYU_MODEL/)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('DeepSeek catalog creates a real official provider profile template without persisting Secret values', () => {
  const preset = builtinProviderCatalogEntry(DEEPSEEK_PROVIDER_ID)
  assert.ok(preset)
  assert.equal(preset.baseUrl, 'https://api.deepseek.com')
  assert.equal(preset.adapterId, OPENAI_COMPATIBLE_ADAPTER_ID)
  assert.equal(preset.credentialRequired, true)
  assert.equal(preset.options?.reasoning, true)
  assert.equal(preset.options?.thinkingMode, 'enabled')
  assert.equal(preset.options?.reasoningEffort, 'high')
  assert.equal(preset.options?.reasoningContentToolContinuation, true)
  assert.equal(preset.options?.toolProbeThinkingMode, 'disabled')
  assert.equal(preset.options?.modelCatalogDiscovery, true)
})
