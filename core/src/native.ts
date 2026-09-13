/**
 * 文件作用：定义 TypeScript Core 到 Rust Native Runtime 的 Capability Bridge，并提供 stdio JSON-RPC 客户端。
 * 关联模块：plugins/tools/native.ts、native/protocol、native/runtime、ToolRouter/Approval。
 * 当前实现：Native status、OS Credentials RPC、Capability lease、受限文件读写、无 shell 的受限进程执行、本地 stdio RPC 生命周期与可等待的子进程关闭。
 * 职责边界：TypeScript 只能申请最小授权并发起调用；路径/程序/超时等真实安全约束必须由 Rust Kernel 再次独立验证，不能只信 Tool 参数。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadLineInterface } from 'node:readline'
import type { JsonObject, JsonValue } from './types.ts'

export type NativeCapabilityKind = 'filesystem.read' | 'filesystem.write' | 'process.spawn'

export interface NativeCapabilityGrant {
  kind: NativeCapabilityKind
  roots: readonly string[]
  programs?: readonly string[]
}

export interface NativeCapabilityLease {
  token: string
  kind: NativeCapabilityKind
}

export interface NativeRuntimeStatus {
  name: string
  version: string
  protocol: string
  ready: boolean
  policyConfigured: boolean
  capabilities: readonly string[]
}

export interface NativeCredentialStoreStatus {
  backend: string
  available: boolean
  detail?: string
}

export interface NativeCredentialReadResult {
  found: boolean
  value?: string
}

export interface NativeCredentialWriteResult {
  stored: boolean
}

export interface NativeCredentialDeleteResult {
  deleted: boolean
}

export interface NativeHostPolicy {
  /** Native Runtime 启动时锁定的宿主最大根目录；Tool Capability 只能申请其子集。 */
  roots: readonly string[]
  /** Native Runtime 启动时锁定的绝对可执行文件身份白名单；Rust canonicalize 后冻结，Tool Capability 只能申请其子集。 */
  programs?: readonly string[]
  maxReadBytes?: number
  maxWriteBytes?: number
  maxProcessOutputBytes?: number
  maxProcessTimeoutMs?: number
}

export interface NativeReadTextRequest {
  token: string
  path: string
  maxBytes?: number
}

export interface NativeReadTextResult {
  path: string
  content: string
  bytes: number
  truncated: boolean
}

export interface NativeWriteTextRequest {
  token: string
  path: string
  content: string
  createParents?: boolean
  maxBytes?: number
}

export interface NativeWriteTextResult {
  path: string
  bytes: number
}

export interface NativeProcessRunRequest {
  token: string
  program: string
  args?: readonly string[]
  cwd: string
  timeoutMs?: number
  maxOutputBytes?: number
}

export interface NativeProcessRunResult {
  program: string
  cwd: string
  exitCode: number | null
  success: boolean
  timedOut: boolean
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export interface NativeClient {
  status(signal?: AbortSignal): Promise<NativeRuntimeStatus>
  credentialStatus(signal?: AbortSignal): Promise<NativeCredentialStoreStatus>
  readCredential(key: string, signal?: AbortSignal): Promise<NativeCredentialReadResult>
  writeCredential(key: string, value: string, signal?: AbortSignal): Promise<NativeCredentialWriteResult>
  deleteCredential(key: string, signal?: AbortSignal): Promise<NativeCredentialDeleteResult>
  issueCapability(grant: NativeCapabilityGrant, signal?: AbortSignal): Promise<NativeCapabilityLease>
  readText(request: NativeReadTextRequest, signal?: AbortSignal): Promise<NativeReadTextResult>
  writeText(request: NativeWriteTextRequest, signal?: AbortSignal): Promise<NativeWriteTextResult>
  runProcess(request: NativeProcessRunRequest, signal?: AbortSignal): Promise<NativeProcessRunResult>
  close(): Promise<void>
}

interface JsonRpcResponse {
  id: number | null
  result?: JsonValue
  error?: string
}

interface PendingRequest {
  resolve(value: JsonValue): void
  reject(error: Error): void
  cleanup(): void
}

export interface StdioNativeClientOptions {
  executable: string
  /** Host Policy 在 Native Runtime 进程初始化时只设置一次；后续 Tool lease 不能超出这个上限。 */
  policy: NativeHostPolicy
  args?: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string') throw new Error(`XMA Native response field ${field} must be a string.`)
  return value
}

function asNumber(value: JsonValue | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`XMA Native response field ${field} must be a number.`)
  return value
}

function asBoolean(value: JsonValue | undefined, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`XMA Native response field ${field} must be a boolean.`)
  return value
}

function parseStatus(value: JsonValue): NativeRuntimeStatus {
  if (!isRecord(value)) throw new Error('XMA Native status response must be an object.')
  if (!Array.isArray(value.capabilities) || value.capabilities.some(item => typeof item !== 'string')) {
    throw new Error('XMA Native status capabilities must be an array of strings.')
  }
  return {
    name: asString(value.name, 'name'),
    version: asString(value.version, 'version'),
    protocol: asString(value.protocol, 'protocol'),
    ready: asBoolean(value.ready, 'ready'),
    policyConfigured: asBoolean(value.policyConfigured, 'policyConfigured'),
    capabilities: Object.freeze(value.capabilities.map(item => String(item))),
  }
}

function hostPolicyParams(policy: NativeHostPolicy): JsonObject {
  const params: JsonObject = {
    roots: [...policy.roots],
    programs: [...(policy.programs ?? [])],
  }
  if (policy.maxReadBytes !== undefined) params.maxReadBytes = policy.maxReadBytes
  if (policy.maxWriteBytes !== undefined) params.maxWriteBytes = policy.maxWriteBytes
  if (policy.maxProcessOutputBytes !== undefined) params.maxProcessOutputBytes = policy.maxProcessOutputBytes
  if (policy.maxProcessTimeoutMs !== undefined) params.maxProcessTimeoutMs = policy.maxProcessTimeoutMs
  return params
}

/**
 * stdio client 只负责本机 Runtime transport，不解释产品权限。Approval/Policy 决策发生在 ToolRouter，Rust 再验证 lease scope。
 */
export class StdioNativeClient implements NativeClient {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #readline: ReadLineInterface
  readonly #pending = new Map<number, PendingRequest>()
  readonly #initialized: Promise<NativeRuntimeStatus>
  #nextId = 1
  #closed = false
  #stderrTail = ''

  constructor(options: StdioNativeClientOptions) {
    this.#child = spawn(options.executable, [...(options.args ?? [])], {
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    })
    this.#readline = createInterface({ input: this.#child.stdout })
    this.#readline.on('line', line => this.#onLine(line))
    this.#child.stderr.setEncoding('utf8')
    this.#child.stderr.on('data', chunk => {
      this.#stderrTail = `${this.#stderrTail}${String(chunk)}`.slice(-8192)
    })
    this.#child.on('error', error => this.#failAll(new Error(`XMA Native process error: ${error.message}`)))
    this.#child.on('exit', (code, signal) => {
      if (this.#closed) return
      const detail = this.#stderrTail.trim()
      this.#failAll(new Error(`XMA Native process exited unexpectedly (code=${String(code)}, signal=${String(signal)}).${detail ? ` stderr: ${detail}` : ''}`))
    })
    this.#initialized = this.#request('initialize', hostPolicyParams(options.policy)).then(parseStatus)
    // 构造后即使调用方稍后才发第一个 Tool，也不能让初始化失败形成未处理 Promise。
    void this.#initialized.catch(() => undefined)
  }

  async status(signal?: AbortSignal): Promise<NativeRuntimeStatus> {
    await this.#initialized
    return parseStatus(await this.#request('runtime/status', {}, signal))
  }

  async credentialStatus(signal?: AbortSignal): Promise<NativeCredentialStoreStatus> {
    await this.#initialized
    const value = await this.#request('credential/status', {}, signal)
    if (!isRecord(value)) throw new Error('XMA Native credential/status response must be an object.')
    const detail = value.detail
    if (detail !== undefined && typeof detail !== 'string') {
      throw new Error('XMA Native credential/status detail must be a string when present.')
    }
    return {
      backend: asString(value.backend, 'backend'),
      available: asBoolean(value.available, 'available'),
      ...(detail === undefined ? {} : { detail }),
    }
  }

  async readCredential(key: string, signal?: AbortSignal): Promise<NativeCredentialReadResult> {
    await this.#initialized
    const value = await this.#request('credential/read', { key }, signal)
    if (!isRecord(value)) throw new Error('XMA Native credential/read response must be an object.')
    const found = asBoolean(value.found, 'found')
    if (value.value !== undefined && typeof value.value !== 'string') {
      throw new Error('XMA Native credential/read value must be a string when present.')
    }
    if (found && typeof value.value !== 'string') {
      throw new Error('XMA Native credential/read found=true requires a value.')
    }
    return { found, ...(typeof value.value === 'string' ? { value: value.value } : {}) }
  }

  async writeCredential(key: string, secret: string, signal?: AbortSignal): Promise<NativeCredentialWriteResult> {
    await this.#initialized
    const value = await this.#request('credential/write', { key, value: secret }, signal)
    if (!isRecord(value)) throw new Error('XMA Native credential/write response must be an object.')
    return { stored: asBoolean(value.stored, 'stored') }
  }

  async deleteCredential(key: string, signal?: AbortSignal): Promise<NativeCredentialDeleteResult> {
    await this.#initialized
    const value = await this.#request('credential/delete', { key }, signal)
    if (!isRecord(value)) throw new Error('XMA Native credential/delete response must be an object.')
    return { deleted: asBoolean(value.deleted, 'deleted') }
  }

  async issueCapability(grant: NativeCapabilityGrant, signal?: AbortSignal): Promise<NativeCapabilityLease> {
    await this.#initialized
    const value = await this.#request('capability/issue', {
      kind: grant.kind,
      roots: [...grant.roots],
      ...(grant.programs ? { programs: [...grant.programs] } : {}),
    }, signal)
    if (!isRecord(value)) throw new Error('XMA Native capability response must be an object.')
    const kind = asString(value.kind, 'kind')
    if (kind !== 'filesystem.read' && kind !== 'filesystem.write' && kind !== 'process.spawn') {
      throw new Error(`XMA Native capability response has unknown kind: ${kind}`)
    }
    return { token: asString(value.token, 'token'), kind }
  }

  async readText(request: NativeReadTextRequest, signal?: AbortSignal): Promise<NativeReadTextResult> {
    await this.#initialized
    const value = await this.#request('fs/read_text', { ...request }, signal)
    if (!isRecord(value)) throw new Error('XMA Native fs/read_text response must be an object.')
    return {
      path: asString(value.path, 'path'),
      content: asString(value.content, 'content'),
      bytes: asNumber(value.bytes, 'bytes'),
      truncated: asBoolean(value.truncated, 'truncated'),
    }
  }

  async writeText(request: NativeWriteTextRequest, signal?: AbortSignal): Promise<NativeWriteTextResult> {
    await this.#initialized
    const value = await this.#request('fs/write_text', { ...request }, signal)
    if (!isRecord(value)) throw new Error('XMA Native fs/write_text response must be an object.')
    return { path: asString(value.path, 'path'), bytes: asNumber(value.bytes, 'bytes') }
  }

  async runProcess(request: NativeProcessRunRequest, signal?: AbortSignal): Promise<NativeProcessRunResult> {
    await this.#initialized
    const value = await this.#request('process/run', { ...request, args: [...(request.args ?? [])] }, signal)
    if (!isRecord(value)) throw new Error('XMA Native process/run response must be an object.')
    const exitCode = value.exitCode
    if (exitCode !== null && (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode))) {
      throw new Error('XMA Native process/run exitCode must be an integer or null.')
    }
    return {
      program: asString(value.program, 'program'),
      cwd: asString(value.cwd, 'cwd'),
      exitCode: exitCode as number | null,
      success: asBoolean(value.success, 'success'),
      timedOut: asBoolean(value.timedOut, 'timedOut'),
      stdout: asString(value.stdout, 'stdout'),
      stderr: asString(value.stderr, 'stderr'),
      stdoutTruncated: asBoolean(value.stdoutTruncated, 'stdoutTruncated'),
      stderrTruncated: asBoolean(value.stderrTruncated, 'stderrTruncated'),
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#readline.close()
    this.#failAll(new Error('XMA Native client closed.'))
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return

    // Windows 会一直锁住正在运行的 exe；发送终止信号后等待实际 exit，避免 launcher 立即清理 staging 时留下锁文件。
    await new Promise<void>(resolve => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.#child.off('exit', finish)
        resolve()
      }
      const timer = setTimeout(finish, 2_000)
      this.#child.once('exit', finish)
      if (!this.#child.killed) this.#child.kill()
    })
  }

  #request(method: string, params: JsonObject, signal?: AbortSignal): Promise<JsonValue> {
    if (this.#closed) return Promise.reject(new Error('XMA Native client is closed.'))
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('XMA Native request aborted.'), { name: 'AbortError' }))
    const id = this.#nextId++

    return new Promise<JsonValue>((resolve, reject) => {
      const onAbort = (): void => {
        this.#pending.delete(id)
        reject(Object.assign(new Error(`XMA Native request aborted: ${method}`), { name: 'AbortError' }))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
      this.#pending.set(id, { resolve, reject, cleanup })
      this.#child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, 'utf8', error => {
        if (!error) return
        const pending = this.#pending.get(id)
        if (!pending) return
        this.#pending.delete(id)
        pending.cleanup()
        pending.reject(new Error(`Failed to write XMA Native request ${method}: ${error.message}`))
      })
    })
  }

  #onLine(line: string): void {
    let response: JsonRpcResponse
    try {
      response = JSON.parse(line) as JsonRpcResponse
    } catch {
      this.#failAll(new Error(`XMA Native returned invalid JSON: ${line.slice(0, 200)}`))
      return
    }
    if (typeof response.id !== 'number') return
    const pending = this.#pending.get(response.id)
    if (!pending) return
    this.#pending.delete(response.id)
    pending.cleanup()
    if (response.error !== undefined) pending.reject(new Error(`XMA Native RPC failed: ${response.error}`))
    else if (response.result === undefined) pending.reject(new Error('XMA Native RPC response is missing result.'))
    else pending.resolve(response.result)
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.#pending.clear()
  }
}
