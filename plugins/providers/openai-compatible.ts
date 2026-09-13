/**
 * 文件作用：实现 XMA 第一条真实 OpenAI-compatible Transport Adapter。
 * 关联模块：core/src/provider.ts、core/src/model.ts、未来 Provider Settings/Conformance Tests。
 * 当前实现：Bearer 认证、/models Catalog、Chat Completions SSE 文本/Tool Call/Usage、取消、错误归一化与真实最小 Brain Ready Probe。
 * 职责边界：本文件只代表 OpenAI-compatible 协议族，不因厂商品牌名称推断兼容；OpenAI Responses、Claude/Gemini native 必须使用独立 Adapter。
 */

import type { ModelEvent, ModelMessage, ModelProvider, ModelRequest, ModelToolSpec } from '../../core/src/model.ts'
import {
  ProviderRequestError,
  providerErrorSummary,
  type BrainReadyProbeResult,
  type CredentialResolver,
  type ModelDescriptor,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderProfile,
} from '../../core/src/provider.ts'
import type { JsonObject, JsonValue } from '../../core/src/types.ts'

export const OPENAI_COMPATIBLE_ADAPTER_ID = 'xma.openai-compatible'

interface JsonRecord {
  [key: string]: JsonValue | undefined
}

function objectValue(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderRequestError('malformed_response', `OpenAI-compatible ${label} must be an object.`, false)
  }
  return value as JsonRecord
}

function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanOption(profile: ProviderProfile, key: string, fallback: boolean): boolean {
  const value = profile.options?.[key]
  return typeof value === 'boolean' ? value : fallback
}

function endpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

async function resolveHeaders(profile: ProviderProfile, credentials: CredentialResolver): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  for (const [name, value] of Object.entries(profile.headers ?? {})) headers[name] = value
  if (profile.auth.type === 'bearer') {
    const secret = await credentials.resolve(profile.auth.credential)
    if (!secret) throw new ProviderRequestError('auth_invalid', `Credential is unavailable for provider profile ${profile.id}.`, false)
    headers.authorization = `Bearer ${secret}`
  }
  return headers
}

function redactSecret(text: string, headers: Readonly<Record<string, string>>): string {
  const authorization = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  const secret = authorization?.replace(/^Bearer\s+/i, '')
  if (!secret || secret.length < 6) return text
  return text.split(secret).join('[REDACTED]')
}

function mapStatus(status: number, body: string): ProviderRequestError {
  const lower = body.toLowerCase()
  if (status === 401) return new ProviderRequestError('auth_invalid', body || 'Provider authentication failed.', false, status)
  if (status === 403) return new ProviderRequestError('permission_denied', body || 'Provider permission denied.', false, status)
  if (status === 404) return new ProviderRequestError('model_not_found', body || 'Provider model or endpoint not found.', false, status)
  if (status === 408) return new ProviderRequestError('timeout', body || 'Provider request timed out.', true, status)
  if (status === 429) return new ProviderRequestError('rate_limited', body || 'Provider rate limit exceeded.', true, status)
  if (status >= 500) return new ProviderRequestError('server_error', body || `Provider server error ${status}.`, true, status)
  if (status === 400 && (lower.includes('context') || lower.includes('token limit') || lower.includes('maximum'))) {
    return new ProviderRequestError('context_too_large', body || 'Provider context limit exceeded.', false, status)
  }
  return new ProviderRequestError('unknown', body || `Provider request failed with HTTP ${status}.`, false, status)
}

async function providerFetch(url: string, init: RequestInit, signal: AbortSignal, headersForRedaction: Readonly<Record<string, string>>): Promise<Response> {
  try {
    const response = await fetch(url, { ...init, signal })
    if (response.ok) return response
    const body = redactSecret((await response.text()).slice(0, 2048), headersForRedaction)
    throw mapStatus(response.status, body)
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new ProviderRequestError('cancelled', 'Provider request cancelled.', false)
    }
    throw new ProviderRequestError('network', error instanceof Error ? error.message : String(error), true)
  }
}

function toOpenAiMessage(message: ModelMessage): JsonObject {
  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map(call => ({
        id: call.callId,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    }
  }
  if (message.role === 'tool') {
    if (!message.toolCallId) throw new ProviderRequestError('malformed_response', 'XMA tool message is missing toolCallId.', false)
    const tool: JsonObject = { role: 'tool', content: message.content, tool_call_id: message.toolCallId }
    if (message.toolName) tool.name = message.toolName
    return tool
  }
  return { role: message.role, content: message.content }
}

function toOpenAiTool(spec: ModelToolSpec): JsonObject {
  return {
    type: 'function',
    function: {
      name: spec.name,
      description: spec.description,
      parameters: structuredClone(spec.inputSchema),
    },
  }
}

async function* sseData(response: Response, signal: AbortSignal): AsyncIterable<string> {
  if (!response.body) throw new ProviderRequestError('malformed_response', 'Provider streaming response has no body.', false)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []

  try {
    while (true) {
      if (signal.aborted) throw new ProviderRequestError('cancelled', 'Provider request cancelled.', false)
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line.length === 0) {
          if (dataLines.length > 0) {
            yield dataLines.join('\n')
            dataLines = []
          }
          continue
        }
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
    }
    buffer += decoder.decode()
    if (buffer.trim().length > 0) {
      for (const line of buffer.split(/\r?\n/)) if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length > 0) yield dataLines.join('\n')
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new ProviderRequestError('cancelled', 'Provider request cancelled.', false)
    }
    throw new ProviderRequestError('network', error instanceof Error ? error.message : String(error), true)
  } finally {
    reader.releaseLock()
  }
}

interface PendingToolCall {
  id: string
  name: string
  argumentsText: string
}

function parseToolArguments(call: PendingToolCall): JsonObject {
  const text = call.argumentsText.trim()
  if (text.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('arguments root must be an object')
    }
    return parsed as JsonObject
  } catch (error) {
    throw new ProviderRequestError('malformed_response', `Provider returned invalid tool arguments for ${call.name}: ${String(error)}`, false)
  }
}

function usageEvent(payload: JsonRecord): Extract<ModelEvent, { type: 'usage' }> | undefined {
  const usageRaw = payload.usage
  if (usageRaw === undefined) return undefined
  const usage = objectValue(usageRaw, 'usage')
  const event: Extract<ModelEvent, { type: 'usage' }> = { type: 'usage' }
  const input = numberValue(usage.prompt_tokens)
  const output = numberValue(usage.completion_tokens)
  const promptDetails = usage.prompt_tokens_details === undefined ? undefined : objectValue(usage.prompt_tokens_details, 'prompt_tokens_details')
  const completionDetails = usage.completion_tokens_details === undefined ? undefined : objectValue(usage.completion_tokens_details, 'completion_tokens_details')
  const cached = promptDetails ? numberValue(promptDetails.cached_tokens) : undefined
  const reasoning = completionDetails ? numberValue(completionDetails.reasoning_tokens) : undefined
  if (input !== undefined) event.inputTokens = input
  if (output !== undefined) event.outputTokens = output
  if (cached !== undefined) event.cachedInputTokens = cached
  if (reasoning !== undefined) event.reasoningTokens = reasoning
  return Object.keys(event).length > 1 ? event : undefined
}

class OpenAiCompatibleModel implements ModelProvider {
  readonly identity

  constructor(
    private readonly profile: ProviderProfile,
    private readonly model: string,
    private readonly credentials: CredentialResolver,
  ) {
    this.identity = { provider: profile.id, model, displayName: profile.displayName }
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const headers = await resolveHeaders(this.profile, this.credentials)
    const body: JsonObject = {
      model: this.model,
      messages: request.messages.map(toOpenAiMessage),
      stream: true,
    }
    if (request.tools.length > 0) body.tools = request.tools.map(toOpenAiTool)
    if (booleanOption(this.profile, 'includeUsage', true)) body.stream_options = { include_usage: true }

    const response = await providerFetch(
      endpoint(this.profile.baseUrl, 'chat/completions'),
      { method: 'POST', headers, body: JSON.stringify(body) },
      request.signal,
      headers,
    )

    const pending = new Map<number, PendingToolCall>()
    for await (const data of sseData(response, request.signal)) {
      if (data === '[DONE]') break
      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch (error) {
        throw new ProviderRequestError('malformed_response', `Provider returned invalid SSE JSON: ${String(error)}`, false)
      }
      const payload = objectValue(parsed, 'stream event')
      const usage = usageEvent(payload)
      if (usage) yield usage

      const choices = arrayValue(payload.choices)
      const choice = choices[0]
      if (choice === undefined) continue
      const choiceObject = objectValue(choice, 'choice')
      const deltaValue = choiceObject.delta
      if (deltaValue === undefined) continue
      const delta = objectValue(deltaValue, 'choice.delta')
      const text = stringValue(delta.content)
      if (text) yield { type: 'text', text }
      const reasoning = stringValue(delta.reasoning_content)
      if (reasoning) yield { type: 'reasoning', text: reasoning }

      for (const rawTool of arrayValue(delta.tool_calls)) {
        const tool = objectValue(rawTool, 'tool_call delta')
        const index = numberValue(tool.index)
        if (index === undefined || !Number.isInteger(index) || index < 0) {
          throw new ProviderRequestError('malformed_response', 'Provider tool_call delta is missing a valid index.', false)
        }
        const current = pending.get(index) ?? { id: '', name: '', argumentsText: '' }
        const id = stringValue(tool.id)
        if (id) current.id = id
        if (tool.function !== undefined) {
          const fn = objectValue(tool.function, 'tool_call.function')
          const name = stringValue(fn.name)
          const argumentsPart = stringValue(fn.arguments)
          if (name) current.name += name
          if (argumentsPart) current.argumentsText += argumentsPart
        }
        pending.set(index, current)
      }
    }

    for (const [index, call] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
      if (!call.id || !call.name) {
        throw new ProviderRequestError('malformed_response', `Provider returned incomplete tool call at index ${index}.`, false)
      }
      yield { type: 'tool-call', callId: call.id, name: call.name, arguments: parseToolArguments(call) }
    }
  }
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly id = OPENAI_COMPATIBLE_ADAPTER_ID
  readonly family = 'openai-compatible' as const

  capabilities(profile: ProviderProfile): ProviderCapabilities {
    return {
      streamingText: true,
      nativeToolCalling: true,
      parallelToolCalls: booleanOption(profile, 'parallelToolCalls', true),
      reasoning: booleanOption(profile, 'reasoning', false),
      visionInput: booleanOption(profile, 'visionInput', false),
      fileInput: booleanOption(profile, 'fileInput', false),
      imageOutput: false,
      webSearch: false,
      promptCaching: booleanOption(profile, 'promptCaching', false),
      remoteCompaction: false,
      usageReporting: booleanOption(profile, 'includeUsage', true),
      modelCatalogDiscovery: booleanOption(profile, 'modelCatalogDiscovery', true),
    }
  }

  createModel(profile: ProviderProfile, model: string, credentials: CredentialResolver): ModelProvider {
    return new OpenAiCompatibleModel(profile, model, credentials)
  }

  async listModels(profile: ProviderProfile, credentials: CredentialResolver, signal: AbortSignal): Promise<readonly ModelDescriptor[]> {
    if (!this.capabilities(profile).modelCatalogDiscovery) {
      return [{ id: profile.defaultModel, source: 'static', fetchedAt: new Date().toISOString() }]
    }
    const headers = await resolveHeaders(profile, credentials)
    delete headers['content-type']
    const response = await providerFetch(endpoint(profile.baseUrl, 'models'), { method: 'GET', headers }, signal, headers)
    let parsed: unknown
    try {
      parsed = await response.json()
    } catch (error) {
      throw new ProviderRequestError('malformed_response', `Provider models response is invalid JSON: ${String(error)}`, false)
    }
    const body = objectValue(parsed, 'models response')
    const fetchedAt = new Date().toISOString()
    const models: ModelDescriptor[] = []
    for (const item of arrayValue(body.data)) {
      const model = objectValue(item, 'model')
      const id = stringValue(model.id)
      if (!id) continue
      models.push({ id, source: 'remote', fetchedAt })
    }
    return models.sort((a, b) => a.id.localeCompare(b.id))
  }

  async probe(profile: ProviderProfile, model: string, credentials: CredentialResolver, signal: AbortSignal): Promise<BrainReadyProbeResult> {
    const started = performance.now()
    try {
      const headers = await resolveHeaders(profile, credentials)
      const body: JsonObject = {
        model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        stream: false,
        max_tokens: 1,
      }
      const response = await providerFetch(
        endpoint(profile.baseUrl, 'chat/completions'),
        { method: 'POST', headers, body: JSON.stringify(body) },
        signal,
        headers,
      )
      // Probe 必须至少验证返回是 JSON object；不把内容当“模型聪明度”测试，也不持久化回复。
      let parsed: unknown
      try {
        parsed = await response.json()
      } catch (error) {
        throw new ProviderRequestError('malformed_response', `Provider probe response is invalid JSON: ${String(error)}`, false)
      }
      objectValue(parsed, 'probe response')
      return {
        profileId: profile.id,
        adapterId: this.id,
        model,
        ready: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(0, performance.now() - started),
      }
    } catch (error) {
      return {
        profileId: profile.id,
        adapterId: this.id,
        model,
        ready: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(0, performance.now() - started),
        error: providerErrorSummary(error),
      }
    }
  }
}
