/**
 * 文件作用：管理 Xiaoyu Terminal 的 Brain/Provider 用户配置，并把非 Secret 配置转换为 Core Provider Profile。
 * 关联模块：main.ts、tui.ts、core/provider.ts、plugins/providers/openai-compatible.ts、Provider OS Credentials Service。
 * 当前实现：多 Profile JSON Store、真实 Provider 品牌/Adapter 身份、模型选择、OS/环境变量凭据引用和旧版 XIAOYU_* 配置兼容。
 * 职责边界：本文件绝不持久化 API Key 等 Secret；brain.json 只保存 CredentialReference，Secret 必须由 Credentials Service 解析。
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ProviderProfile } from '../../../core/src/provider.ts'
import type { JsonObject } from '../../../core/src/types.ts'
import { CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID } from '../../../plugins/providers/catalog.ts'
import { OPENAI_COMPATIBLE_ADAPTER_ID } from '../../../plugins/providers/openai-compatible.ts'

export const BRAIN_CONFIG_FORMAT_VERSION = 3
export const ENVIRONMENT_PROFILE_ID = 'environment'

export interface TerminalCredentialReference {
  source: 'env' | 'os'
  key: string
}

export interface TerminalBrainProfile {
  id: string
  providerId: string
  adapterId: string
  displayName: string
  baseUrl: string
  model: string
  credential?: TerminalCredentialReference
  options?: JsonObject
}

export interface TerminalBrainConfig {
  formatVersion: 3
  activeProfileId?: string
  profiles: TerminalBrainProfile[]
}

export interface TerminalBrainProfileView extends TerminalBrainProfile {
  source: 'config' | 'environment'
  active: boolean
  credentialReady: boolean
}

function configRoot(): string {
  const configured = process.env.XIAOYU_CONFIG_HOME?.trim()
  if (configured) return path.resolve(configured)
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming')
    return path.join(roaming, 'Xiaoyu')
  }
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Xiaoyu')
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'xiaoyu')
}

export function brainConfigPath(): string {
  return path.join(configRoot(), 'brain.json')
}

function emptyConfig(): TerminalBrainConfig {
  return { formatVersion: BRAIN_CONFIG_FORMAT_VERSION, profiles: [] }
}

function normalizeBaseUrl(value: string): string {
  const text = value.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new Error('Provider Base URL 不是有效 URL。')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Provider Base URL 只允许 http / https。')
  }
  return text
}

function validateCredential(reference: TerminalCredentialReference | undefined): TerminalCredentialReference | undefined {
  if (!reference) return undefined
  const key = reference.key.trim()
  if (!key) throw new Error('Credential Reference 不能为空。')
  if (reference.source === 'env') {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('API Key 环境变量名无效。')
    return { source: 'env', key }
  }
  if (reference.source === 'os') {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) throw new Error('OS Credential Key 无效。')
    return { source: 'os', key }
  }
  throw new Error('不支持的 Credential Source。')
}

function validateProfile(profile: TerminalBrainProfile): TerminalBrainProfile {
  const id = profile.id.trim()
  const providerId = profile.providerId.trim()
  const adapterId = profile.adapterId.trim()
  const displayName = profile.displayName.trim()
  const model = profile.model.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('Provider Profile ID 无效。')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(providerId)) throw new Error('Provider ID 无效。')
  if (!adapterId) throw new Error('Provider Adapter ID 不能为空。')
  if (!displayName) throw new Error('Provider 显示名称不能为空。')
  if (!model) throw new Error('模型 ID 不能为空。')
  const credential = validateCredential(profile.credential)
  return {
    id,
    providerId,
    adapterId,
    displayName,
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    model,
    ...(credential ? { credential } : {}),
    ...(profile.options ? { options: structuredClone(profile.options) } : {}),
  }
}

function parseCredential(profile: Record<string, unknown>): TerminalCredentialReference | undefined {
  const raw = profile.credential
  if (raw !== undefined) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Brain Profile credential 无效。')
    const object = raw as Record<string, unknown>
    const source = String(object.source ?? '')
    if (source !== 'env' && source !== 'os') throw new Error(`不支持的 Brain Credential Source：${source}`)
    return validateCredential({ source, key: String(object.key ?? '') })
  }

  // 兼容 v1 brain.json：credentialEnv 只作为 env reference 迁移读取；下一次保存统一写成当前格式的 credential 对象。
  if (profile.credentialEnv !== undefined) {
    return validateCredential({ source: 'env', key: String(profile.credentialEnv) })
  }
  return undefined
}

function parseConfig(raw: unknown): TerminalBrainConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Brain 配置根结构无效。')
  const object = raw as Record<string, unknown>
  if (object.formatVersion !== 1 && object.formatVersion !== 2 && object.formatVersion !== BRAIN_CONFIG_FORMAT_VERSION) {
    throw new Error(`不支持的 Brain 配置版本：${String(object.formatVersion)}`)
  }
  if (!Array.isArray(object.profiles)) throw new Error('Brain 配置 profiles 必须是数组。')
  // v1 只有 credentialEnv；v2 已有 CredentialReference 但还没有真实 providerId/adapterId/options。
  // 当前 v3 显式迁移旧格式，写回后旧程序会 fail-loud，避免回退时静默丢失真实 Provider 能力语义。
  const profiles = object.profiles.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Brain Profile #${index + 1} 无效。`)
    const profile = entry as Record<string, unknown>
    const credential = parseCredential(profile)
    const providerId = typeof profile.providerId === 'string' && profile.providerId.trim()
      ? profile.providerId.trim()
      : CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID
    const adapterId = typeof profile.adapterId === 'string' && profile.adapterId.trim()
      ? profile.adapterId.trim()
      : OPENAI_COMPATIBLE_ADAPTER_ID
    const options = profile.options && typeof profile.options === 'object' && !Array.isArray(profile.options)
      ? structuredClone(profile.options as JsonObject)
      : undefined
    return validateProfile({
      id: String(profile.id ?? ''),
      providerId,
      adapterId,
      displayName: String(profile.displayName ?? ''),
      baseUrl: String(profile.baseUrl ?? ''),
      model: String(profile.model ?? ''),
      ...(credential ? { credential } : {}),
      ...(options ? { options } : {}),
    })
  })
  const ids = new Set<string>()
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new Error(`Brain Profile ID 重复：${profile.id}`)
    ids.add(profile.id)
  }
  const activeProfileId = typeof object.activeProfileId === 'string' && object.activeProfileId.trim()
    ? object.activeProfileId.trim()
    : undefined
  if (activeProfileId && !ids.has(activeProfileId)) throw new Error(`活动 Brain Profile 不存在：${activeProfileId}`)
  return {
    formatVersion: BRAIN_CONFIG_FORMAT_VERSION,
    profiles,
    ...(activeProfileId ? { activeProfileId } : {}),
  }
}

export function loadBrainConfig(file = brainConfigPath()): TerminalBrainConfig {
  try {
    return parseConfig(JSON.parse(readFileSync(file, 'utf8')) as unknown)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return emptyConfig()
    if (error instanceof SyntaxError) throw new Error(`Brain 配置 JSON 无法解析：${file}`)
    throw error
  }
}

export function saveBrainConfig(config: TerminalBrainConfig, file = brainConfigPath()): void {
  const validated = parseConfig(config)
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, file)
  } finally {
    rmSync(temp, { force: true })
  }
}

export function environmentBrainProfile(): TerminalBrainProfile | undefined {
  const baseUrl = process.env.XIAOYU_BASE_URL?.trim()
  const model = process.env.XIAOYU_MODEL?.trim()
  if (!baseUrl || !model) return undefined
  return validateProfile({
    id: ENVIRONMENT_PROFILE_ID,
    providerId: CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID,
    adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
    displayName: 'Environment Provider',
    baseUrl,
    model,
    ...(process.env.XIAOYU_API_KEY ? { credential: { source: 'env', key: 'XIAOYU_API_KEY' } } : {}),
  })
}

export function profileToProvider(profile: TerminalBrainProfile): ProviderProfile {
  return {
    id: profile.id,
    providerId: profile.providerId,
    adapterId: profile.adapterId,
    displayName: profile.displayName,
    baseUrl: profile.baseUrl,
    auth: profile.credential
      ? { type: 'bearer', credential: profile.credential }
      : { type: 'none' },
    defaultModel: profile.model,
    ...(profile.options ? { options: structuredClone(profile.options) } : {}),
  }
}

export function osCredentialKey(profileId: string): string {
  const normalized = profileId.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(normalized)) throw new Error('Provider Profile ID 无效。')
  return `provider:${normalized}:api-key`
}

function slug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized.slice(0, 40) || 'provider'
}

export class TerminalBrainStore {
  #config: TerminalBrainConfig

  constructor(readonly file = brainConfigPath()) {
    this.#config = loadBrainConfig(file)
  }

  list(osCredentialReadiness: ReadonlyMap<string, boolean> = new Map()): readonly TerminalBrainProfileView[] {
    const environment = environmentBrainProfile()
    const active = this.active()?.id
    const configured = this.#config.profiles.map(profile => ({
      ...profile,
      source: 'config' as const,
      active: active === profile.id,
      credentialReady: profile.credential?.source === 'env'
        ? Boolean(process.env[profile.credential.key])
        : profile.credential?.source === 'os'
          ? osCredentialReadiness.get(profile.id) === true
          : true,
    }))
    if (!environment) return configured
    return [{
      ...environment,
      source: 'environment',
      active: active === environment.id,
      credentialReady: environment.credential?.source === 'env'
        ? Boolean(process.env[environment.credential.key])
        : true,
    }, ...configured]
  }

  active(): TerminalBrainProfile | undefined {
    const configuredId = this.#config.activeProfileId
    if (configuredId) return this.#config.profiles.find(profile => profile.id === configuredId)
    return environmentBrainProfile() ?? this.#config.profiles[0]
  }

  allocateId(displayName: string, preferredId?: string): string {
    const idBase = preferredId?.trim() || slug(displayName)
    let id = idBase
    let suffix = 2
    while (this.#config.profiles.some(profile => profile.id === id)) {
      id = `${idBase}-${suffix}`
      suffix += 1
    }
    return validateProfile({
      id,
      providerId: CUSTOM_OPENAI_COMPATIBLE_PROVIDER_ID,
      adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
      displayName: displayName || 'Provider',
      baseUrl: 'https://example.invalid',
      model: 'placeholder',
    }).id
  }

  upsert(input: Omit<TerminalBrainProfile, 'id'> & { id?: string }): TerminalBrainProfile {
    const idBase = input.id?.trim() || slug(input.displayName)
    let id = idBase
    let suffix = 2
    while (this.#config.profiles.some(profile => profile.id === id && profile.id !== input.id)) {
      id = `${idBase}-${suffix}`
      suffix += 1
    }
    const profile = validateProfile({ ...input, id })
    const index = this.#config.profiles.findIndex(item => item.id === profile.id)
    if (index >= 0) this.#config.profiles[index] = profile
    else this.#config.profiles.push(profile)
    this.#config.activeProfileId = profile.id
    saveBrainConfig(this.#config, this.file)
    return { ...profile }
  }

  select(profileId: string): TerminalBrainProfile {
    if (profileId === ENVIRONMENT_PROFILE_ID) {
      const environment = environmentBrainProfile()
      if (!environment) throw new Error('环境变量 Provider 当前不可用。')
      delete this.#config.activeProfileId
      saveBrainConfig(this.#config, this.file)
      return environment
    }
    const profile = this.#config.profiles.find(item => item.id === profileId)
    if (!profile) throw new Error(`Brain Profile 不存在：${profileId}`)
    this.#config.activeProfileId = profileId
    saveBrainConfig(this.#config, this.file)
    return { ...profile }
  }

  updateModel(profileId: string, model: string): TerminalBrainProfile {
    if (profileId === ENVIRONMENT_PROFILE_ID) throw new Error('环境变量 Provider 的模型请通过 XIAOYU_MODEL 修改。')
    const profile = this.#config.profiles.find(item => item.id === profileId)
    if (!profile) throw new Error(`Brain Profile 不存在：${profileId}`)
    profile.model = model.trim()
    const validated = validateProfile(profile)
    const index = this.#config.profiles.findIndex(item => item.id === profileId)
    this.#config.profiles[index] = validated
    this.#config.activeProfileId = profileId
    saveBrainConfig(this.#config, this.file)
    return { ...validated }
  }
}
