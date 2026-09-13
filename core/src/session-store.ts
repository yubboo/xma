/**
 * 文件作用：实现 XMA Session Store Contract 以及 0.1.x 的 JSONL / Memory 基线后端。
 * 关联模块：session.ts、runtime.ts、未来 Session migration/export/App Protocol。
 * 当前实现：create/open/list/stat、单写者所有权、append/flush/close、JSONL 截断尾恢复和 Memory 测试后端。
 * 职责边界：Store 只持久化 durable event；不会拼 Prompt、不会执行 Tool，也不会写入 API Key 等 Secret。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rm, truncate, writeFile, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import {
  SESSION_FORMAT_VERSION,
  assertDurableJson,
  type SessionEvent,
  type SessionEventInput,
  type SessionHeader,
  type SessionSnapshot,
  type SessionStat,
} from './session.ts'

export type SessionOpenMode = 'read' | 'write'

export interface SessionHandle {
  readonly header: SessionHeader
  readonly mode: SessionOpenMode
  snapshot(): SessionSnapshot
  append(events: readonly SessionEventInput[]): Promise<readonly SessionEvent[]>
  flush(): Promise<void>
  close(): Promise<void>
}

export interface SessionStore {
  create(header: SessionHeader): Promise<SessionHandle>
  open(sessionId: string, mode: SessionOpenMode): Promise<SessionHandle>
  list(): Promise<SessionStat[]>
  stat(sessionId: string): Promise<SessionStat | undefined>
}

interface SessionFileHeaderRecord {
  kind: 'header'
  header: SessionHeader
}

interface SessionFileEventRecord {
  kind: 'event'
  event: SessionEvent
}

type SessionFileRecord = SessionFileHeaderRecord | SessionFileEventRecord

function assertSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId)) {
    throw new Error(`Invalid XMA session id: ${sessionId}`)
  }
}

function buildStat(snapshot: SessionSnapshot): SessionStat {
  const last = snapshot.events.at(-1)
  const stat: SessionStat = {
    sessionId: snapshot.header.sessionId,
    agentId: snapshot.header.agentId,
    createdAt: snapshot.header.createdAt,
    updatedAt: last?.timestamp ?? snapshot.header.createdAt,
    eventCount: snapshot.events.length,
  }
  if (snapshot.header.workspaceId !== undefined) stat.workspaceId = snapshot.header.workspaceId
  return stat
}

function materializeEvents(sessionId: string, startSequence: number, inputs: readonly SessionEventInput[]): SessionEvent[] {
  const now = () => new Date().toISOString()
  return inputs.map((input, index) => {
    const event = {
      ...structuredClone(input),
      sessionId,
      sequence: startSequence + index,
      timestamp: now(),
    } as SessionEvent
    assertDurableJson(event)
    return event
  })
}

class MemoryHandle implements SessionHandle {
  #closed = false

  constructor(
    readonly header: SessionHeader,
    readonly mode: SessionOpenMode,
    private readonly entry: { events: SessionEvent[]; writer: symbol | undefined },
    private readonly writerToken: symbol | undefined,
  ) {}

  snapshot(): SessionSnapshot {
    return { header: structuredClone(this.header), events: this.entry.events.map(event => structuredClone(event)) }
  }

  async append(inputs: readonly SessionEventInput[]): Promise<readonly SessionEvent[]> {
    this.#assertOpen()
    if (this.mode !== 'write') throw new Error('XMA read-only Session handle cannot append events.')
    const appended = materializeEvents(this.header.sessionId, this.entry.events.length + 1, inputs)
    this.entry.events.push(...appended)
    return appended.map(event => structuredClone(event))
  }

  async flush(): Promise<void> {
    this.#assertOpen()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.writerToken !== undefined && this.entry.writer === this.writerToken) this.entry.writer = undefined
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('XMA Session handle is already closed.')
  }
}

export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, { header: SessionHeader; events: SessionEvent[]; writer: symbol | undefined }>()

  async create(header: SessionHeader): Promise<SessionHandle> {
    assertSessionId(header.sessionId)
    if (this.#sessions.has(header.sessionId)) throw new Error(`XMA session already exists: ${header.sessionId}`)
    const writer = Symbol(header.sessionId)
    const entry = { header: structuredClone(header), events: [], writer }
    this.#sessions.set(header.sessionId, entry)
    return new MemoryHandle(structuredClone(header), 'write', entry, writer)
  }

  async open(sessionId: string, mode: SessionOpenMode): Promise<SessionHandle> {
    assertSessionId(sessionId)
    const entry = this.#sessions.get(sessionId)
    if (!entry) throw new Error(`XMA session not found: ${sessionId}`)
    if (mode === 'write') {
      if (entry.writer !== undefined) throw new Error(`XMA session already has a writer: ${sessionId}`)
      const writer = Symbol(sessionId)
      entry.writer = writer
      return new MemoryHandle(structuredClone(entry.header), mode, entry, writer)
    }
    return new MemoryHandle(structuredClone(entry.header), mode, entry, undefined)
  }

  async list(): Promise<SessionStat[]> {
    return [...this.#sessions.values()]
      .map(entry => buildStat({ header: structuredClone(entry.header), events: entry.events.map(event => structuredClone(event)) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async stat(sessionId: string): Promise<SessionStat | undefined> {
    const entry = this.#sessions.get(sessionId)
    if (!entry) return undefined
    return buildStat({ header: structuredClone(entry.header), events: entry.events.map(event => structuredClone(event)) })
  }
}

interface ParsedSessionFile {
  snapshot: SessionSnapshot
  validBytes: number
  repairedTail: boolean
}

async function parseSessionFile(filePath: string): Promise<ParsedSessionFile> {
  const raw = await readFile(filePath, 'utf8')
  const lines = raw.split('\n')
  let validText = ''
  const records: SessionFileRecord[] = []
  let repairedTail = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const isLast = index === lines.length - 1
    if (line.length === 0) {
      if (!isLast) validText += '\n'
      continue
    }
    try {
      const record = JSON.parse(line) as SessionFileRecord
      records.push(record)
      validText += `${line}\n`
    } catch (error) {
      // 只允许忽略“进程在最后一次 append 中断”形成的末尾半行；中间损坏必须 fail loud。
      if (isLast && !raw.endsWith('\n')) {
        repairedTail = true
        break
      }
      throw new Error(`XMA session JSONL is corrupted: ${filePath}: ${String(error)}`)
    }
  }

  const headerRecord = records[0]
  if (!headerRecord || headerRecord.kind !== 'header') throw new Error(`XMA session JSONL missing header: ${filePath}`)
  if (headerRecord.header.formatVersion !== SESSION_FORMAT_VERSION) {
    throw new Error(`Unsupported XMA session format: ${headerRecord.header.formatVersion}`)
  }
  const events: SessionEvent[] = []
  for (const record of records.slice(1)) {
    if (record.kind !== 'event') throw new Error(`Unexpected XMA session record in ${filePath}`)
    events.push(record.event)
  }
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!
    if (event.sessionId !== headerRecord.header.sessionId || event.sequence !== index + 1) {
      throw new Error(`XMA session event sequence mismatch: ${filePath}`)
    }
  }

  return {
    snapshot: { header: headerRecord.header, events },
    validBytes: Buffer.byteLength(validText, 'utf8'),
    repairedTail,
  }
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : ''
    return code === 'EPERM'
  }
}

class JsonlHandle implements SessionHandle {
  #closed = false
  #events: SessionEvent[]

  constructor(
    readonly header: SessionHeader,
    readonly mode: SessionOpenMode,
    events: readonly SessionEvent[],
    private readonly fileHandle: FileHandle | undefined,
    private readonly releaseWriter: (() => Promise<void>) | undefined,
  ) {
    this.#events = events.map(event => structuredClone(event))
  }

  snapshot(): SessionSnapshot {
    return { header: structuredClone(this.header), events: this.#events.map(event => structuredClone(event)) }
  }

  async append(inputs: readonly SessionEventInput[]): Promise<readonly SessionEvent[]> {
    this.#assertOpen()
    if (this.mode !== 'write' || !this.fileHandle) throw new Error('XMA read-only Session handle cannot append events.')
    const appended = materializeEvents(this.header.sessionId, this.#events.length + 1, inputs)
    if (appended.length === 0) return []
    const encoded = appended.map(event => JSON.stringify({ kind: 'event', event } satisfies SessionFileEventRecord)).join('\n') + '\n'
    await this.fileHandle.writeFile(encoded, 'utf8')
    this.#events.push(...appended)
    return appended.map(event => structuredClone(event))
  }

  async flush(): Promise<void> {
    this.#assertOpen()
    if (this.fileHandle) await this.fileHandle.sync()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    try {
      if (this.fileHandle) {
        await this.fileHandle.sync()
        await this.fileHandle.close()
      }
    } finally {
      if (this.releaseWriter) await this.releaseWriter()
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('XMA Session handle is already closed.')
  }
}

export class JsonlSessionStore implements SessionStore {
  constructor(readonly root: string) {}

  async create(header: SessionHeader): Promise<SessionHandle> {
    assertSessionId(header.sessionId)
    await mkdir(this.root, { recursive: true })
    const releaseWriter = await this.#acquireWriter(header.sessionId)
    const filePath = this.#filePath(header.sessionId)
    try {
      const record: SessionFileHeaderRecord = { kind: 'header', header: structuredClone(header) }
      assertDurableJson(record)
      await writeFile(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx' })
      const fileHandle = await open(filePath, 'a')
      return new JsonlHandle(structuredClone(header), 'write', [], fileHandle, releaseWriter)
    } catch (error) {
      await releaseWriter()
      throw error
    }
  }

  async open(sessionId: string, mode: SessionOpenMode): Promise<SessionHandle> {
    assertSessionId(sessionId)
    await mkdir(this.root, { recursive: true })
    const filePath = this.#filePath(sessionId)
    if (mode === 'read') {
      const parsed = await parseSessionFile(filePath)
      return new JsonlHandle(parsed.snapshot.header, mode, parsed.snapshot.events, undefined, undefined)
    }

    const releaseWriter = await this.#acquireWriter(sessionId)
    try {
      const parsed = await parseSessionFile(filePath)
      if (parsed.repairedTail) await truncate(filePath, parsed.validBytes)
      const fileHandle = await open(filePath, 'a')
      return new JsonlHandle(parsed.snapshot.header, mode, parsed.snapshot.events, fileHandle, releaseWriter)
    } catch (error) {
      await releaseWriter()
      throw error
    }
  }

  async list(): Promise<SessionStat[]> {
    await mkdir(this.root, { recursive: true })
    const names = await readdir(this.root)
    const stats: SessionStat[] = []
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      try {
        const parsed = await parseSessionFile(path.join(this.root, name))
        stats.push(buildStat(parsed.snapshot))
      } catch {
        // 列表接口不能把一份损坏 Session 伪装成健康记录；当前 0.1.x 先跳过，open 时仍会 fail loud。
      }
    }
    return stats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async stat(sessionId: string): Promise<SessionStat | undefined> {
    assertSessionId(sessionId)
    try {
      const parsed = await parseSessionFile(this.#filePath(sessionId))
      return buildStat(parsed.snapshot)
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : ''
      if (code === 'ENOENT') return undefined
      throw error
    }
  }

  #filePath(sessionId: string): string {
    return path.join(this.root, `${sessionId}.jsonl`)
  }

  #lockPath(sessionId: string): string {
    return path.join(this.root, `${sessionId}.lock`)
  }

  async #acquireWriter(sessionId: string): Promise<() => Promise<void>> {
    const lockPath = this.#lockPath(sessionId)
    const ownerId = randomUUID()
    const payload = JSON.stringify({ pid: process.pid, ownerId, createdAt: new Date().toISOString() })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const lock = await open(lockPath, 'wx')
        await lock.writeFile(payload, 'utf8')
        await lock.close()
        return async () => {
          try {
            const current = JSON.parse(await readFile(lockPath, 'utf8')) as { ownerId?: string }
            if (current.ownerId === ownerId) await rm(lockPath, { force: true })
          } catch (error) {
            const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : ''
            if (code !== 'ENOENT') throw error
          }
        }
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : ''
        if (code !== 'EEXIST') throw error
        let stale = false
        try {
          const current = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: number }
          stale = !processExists(current.pid ?? -1)
        } catch {
          stale = true
        }
        if (!stale || attempt === 1) throw new Error(`XMA session already has a writer: ${sessionId}`)
        await rm(lockPath, { force: true })
      }
    }
    throw new Error(`Unable to acquire XMA session writer: ${sessionId}`)
  }
}
