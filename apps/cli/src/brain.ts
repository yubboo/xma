/**
 * 文件作用：管理 Xiaoyu Terminal 的 Brain/Provider 用户配置，并把非 Secret 配置转换为 Core Provider Profile。
 * 关联模块：main.ts、tui.ts、core/provider.ts、plugins/providers/openai-compatible.ts。
 * 当前实现：用户级 JSON Profile Store、活动 Profile、模型选择、环境变量凭据引用和旧版 XIAOYU_* 环境配置兼容。
 * 职责边界：本文件绝不持久化 API Key 等 Secret；Secret 继续由 EnvironmentCredentialResolver / 后续 Credentials Service 提供。
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ProviderProfile } from '../../../core/src/provider.ts'
import { OPENAI_COMPATIBLE_ADAPTER_ID } from '../../../plugins/providers/openai-compatible.ts'

export const BRAIN_CONFIG_FORMAT_VERSION = 1
export const ENVIRONMENT_PROFILE_ID = 'environment'

export interface TerminalBrainProfile {
  id: string
  displayName: string
  baseUrl: string
  model: string
  credentialEnv?: string
}

export interface TerminalBrainConfig {
  formatVersion: 1
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

function validateCredentialEnv(value: string | undefined): string | undefined {
  const key = value?.trim()
  if (!key) return undefined
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('API Key 环境变量名无效。')
  return key
}

function validateProfile(profile: TerminalBrainProfile): TerminalBrainProfile {
  const id = profile.id.trim()
  const displayName = profile.displayName.trim()
  const model = profile.model.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('Provider Profile ID 无效。')
  if (!displayName) throw new Error('Provider 显示名称不能为空。')
  if (!model) throw new Error('模型 ID 不能为空。')
  const credentialEnv = validateCredentialEnv(profile.credentialEnv)
  return {
    id,
    displayName,
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    model,
    ...(credentialEnv ? { credentialEnv } : {}),
  }
}

function parseConfig(raw: unknown): TerminalBrainConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Brain 配置根结构无效。')
  const object = raw as Record<string, unknown>
  if (object.formatVersion !== BRAIN_CONFIG_FORMAT_VERSION) {
    throw new Error(`不支持的 Brain 配置版本：${String(object.formatVersion)}`)
  }
  if (!Array.isArray(object.profiles)) throw new Error('Brain 配置 profiles 必须是数组。')
  const profiles = object.profiles.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Brain Profile #${index + 1} 无效。`)
    const profile = entry as Record<string, unknown>
    return validateProfile({
      id: String(profile.id ?? ''),
      displayName: String(profile.displayName ?? ''),
      baseUrl: String(profile.baseUrl ?? ''),
      model: String(profile.model ?? ''),
      ...(profile.credentialEnv === undefined ? {} : { credentialEnv: String(profile.credentialEnv) }),
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
    displayName: 'Environment Provider',
    baseUrl,
    model,
    ...(process.env.XIAOYU_API_KEY ? { credentialEnv: 'XIAOYU_API_KEY' } : {}),
  })
}

export function profileToProvider(profile: TerminalBrainProfile): ProviderProfile {
  return {
    id: profile.id,
    adapterId: OPENAI_COMPATIBLE_ADAPTER_ID,
    displayName: profile.displayName,
    baseUrl: profile.baseUrl,
    auth: profile.credentialEnv
      ? { type: 'bearer', credential: { source: 'env', key: profile.credentialEnv } }
      : { type: 'none' },
    defaultModel: profile.model,
  }
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

  list(): readonly TerminalBrainProfileView[] {
    const environment = environmentBrainProfile()
    const active = this.active()?.id
    const configured = this.#config.profiles.map(profile => ({
      ...profile,
      source: 'config' as const,
      active: active === profile.id,
      credentialReady: !profile.credentialEnv || Boolean(process.env[profile.credentialEnv]),
    }))
    if (!environment) return configured
    return [{
      ...environment,
      source: 'environment',
      active: active === environment.id,
      credentialReady: !environment.credentialEnv || Boolean(process.env[environment.credentialEnv]),
    }, ...configured]
  }

  active(): TerminalBrainProfile | undefined {
    const configuredId = this.#config.activeProfileId
    if (configuredId) return this.#config.profiles.find(profile => profile.id === configuredId)
    return environmentBrainProfile() ?? this.#config.profiles[0]
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
