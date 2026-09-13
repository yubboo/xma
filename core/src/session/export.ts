/**
 * 文件作用：提供 XMA Session 的安全导出、可组合 Redaction 与未来格式迁移 Contract。
 * 关联模块：contract.ts、store.ts、../provider.ts、未来 App Protocol/CLI export。
 * 当前实现：Session Export Envelope、已知 Secret 精确脱敏、递归 JSON Redactor、Migration Registry。
 * 职责边界：导出不得主动解析/保存 Provider Secret；调用方只能把 Credentials Service 已知的 Secret 值临时交给 redactor，结果中不得保留原值。
 */

import type { SessionEvent, SessionHeader, SessionSnapshot } from './contract.ts'
import type { JsonValue } from '../types.ts'

export const SESSION_EXPORT_VERSION = 1 as const

export interface SessionExportEnvelope {
  exportVersion: typeof SESSION_EXPORT_VERSION
  exportedAt: string
  /** true 表示该 Envelope 是安全导出投影，可能不再保持原始 digest 的可重放一致性。 */
  redacted: boolean
  session: SessionSnapshot
}

export interface SessionRedactor {
  redactText(value: string): string
}

function redactJson(value: JsonValue, redactor: SessionRedactor): JsonValue {
  if (typeof value === 'string') return redactor.redactText(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(item => redactJson(item, redactor))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactJson(item, redactor)]))
}

/** 用当前进程已知 Secret 构造精确值脱敏器；空值/过短值被忽略，避免误伤普通文本。 */
export function createSecretValueRedactor(secrets: readonly string[], replacement = '[REDACTED]'): SessionRedactor {
  const values = [...new Set(secrets.filter(secret => secret.length >= 6))].sort((a, b) => b.length - a.length)
  return {
    redactText(value: string): string {
      let redacted = value
      for (const secret of values) redacted = redacted.split(secret).join(replacement)
      return redacted
    },
  }
}

function redactEvent(event: SessionEvent, redactor: SessionRedactor): SessionEvent {
  const clone = structuredClone(event)
  if (clone.type === 'user/message' || clone.type === 'assistant/message') {
    clone.content = redactor.redactText(clone.content)
    if (clone.type === 'assistant/message') {
      clone.toolCalls = clone.toolCalls.map(call => ({
        ...call,
        arguments: redactJson(call.arguments, redactor) as typeof call.arguments,
      }))
    }
  } else if (clone.type === 'turn/end') {
    clone.text = redactor.redactText(clone.text)
  } else if (clone.type === 'tool/result') {
    clone.content = redactor.redactText(clone.content)
    if (clone.data !== undefined) clone.data = redactJson(clone.data, redactor)
  } else if (clone.type === 'context/snapshot') {
    clone.content = redactor.redactText(clone.content)
  } else if (clone.type === 'workspace/access-granted' || clone.type === 'workspace/access-revoked') {
    clone.reason = redactor.redactText(clone.reason)
  }
  return clone
}

/** 导出默认保持完整 durable 语义；传入 redactor 时才执行显式脱敏，避免静默改写历史。 */
export function exportSession(snapshot: SessionSnapshot, redactor?: SessionRedactor): SessionExportEnvelope {
  const session = redactor === undefined
    ? structuredClone(snapshot)
    : {
        header: structuredClone(snapshot.header),
        events: snapshot.events.map(event => redactEvent(event, redactor)),
      }
  return { exportVersion: SESSION_EXPORT_VERSION, exportedAt: new Date().toISOString(), redacted: redactor !== undefined, session }
}

export interface StoredSessionSnapshot {
  header: Omit<SessionHeader, 'formatVersion'> & { formatVersion: number }
  events: unknown[]
}

export interface SessionMigration {
  fromVersion: number
  toVersion: number
  migrate(snapshot: StoredSessionSnapshot): StoredSessionSnapshot
}

/**
 * MigrationRegistry 只做相邻版本、单向升级；不提供隐式降级或“猜格式”。
 * 当前 0.1.0 没有历史已发布格式迁移，因此默认 registry 为空；未来 Store generation 升级必须显式接入此 Contract。
 */
export class SessionMigrationRegistry {
  readonly #migrations = new Map<number, SessionMigration>()

  register(migration: SessionMigration): void {
    if (migration.toVersion !== migration.fromVersion + 1) {
      throw new Error('XMA session migration must advance exactly one format version.')
    }
    if (this.#migrations.has(migration.fromVersion)) {
      throw new Error(`XMA session migration already registered from v${migration.fromVersion}.`)
    }
    this.#migrations.set(migration.fromVersion, migration)
  }

  migrate(snapshot: StoredSessionSnapshot, targetVersion: number): StoredSessionSnapshot {
    if (snapshot.header.formatVersion > targetVersion) {
      throw new Error(`Unsupported future XMA session format: ${snapshot.header.formatVersion}`)
    }
    let current = structuredClone(snapshot)
    while (current.header.formatVersion < targetVersion) {
      const migration = this.#migrations.get(current.header.formatVersion)
      if (!migration) throw new Error(`No XMA session migration from v${current.header.formatVersion} to v${current.header.formatVersion + 1}.`)
      current = migration.migrate(current)
      if (current.header.formatVersion !== migration.toVersion) {
        throw new Error(`XMA session migration v${migration.fromVersion} did not produce v${migration.toVersion}.`)
      }
    }
    return current
  }
}

export const defaultSessionMigrations = new SessionMigrationRegistry()
