/**
 * 文件作用：实现 XMA 模型上下文（Context Assembly）的注册、确定性组装与快照摘要。
 * 关联模块：runtime.ts、session/contract.ts、未来 Workspace/Skill/Knowledge/Plugin Context Source。
 * 当前实现：Context Source Registry、稳定排序、异步组装、字符上限、SHA-256 快照与可释放注册。
 * 职责边界：这里只组装模型可见上下文，不读取 Provider Secret、不执行 Tool；任何进入模型的动态内容必须先形成 durable Context Snapshot。
 */

import { createHash } from 'node:crypto'
import type { SessionHeader, SessionSnapshot } from './session/contract.ts'
import type { Disposer } from './types.ts'
import type { WorkspaceAccessDecision, WorkspaceAccessRequest, WorkspaceBinding } from './workspace.ts'

export interface ContextAssemblyRequest {
  header: SessionHeader
  snapshot: SessionSnapshot
  turnId: string
  stepId: string
  signal: AbortSignal
  /** 当前 Session 的稳定 Workspace Binding；legacy 无 Workspace Session 为空。 */
  workspace?: WorkspaceBinding
  /** 跨 Workspace Context Source 读取前由 Runtime 注入授权判断。 */
  authorizeWorkspaceAccess?(request: WorkspaceAccessRequest): WorkspaceAccessDecision
}

export interface ContextSource {
  /** 稳定来源 ID，用于日志溯源和重复注册检测。 */
  id: string
  /** 数值越小越靠前；相同 order 以 id 的 code-unit 顺序稳定排序。 */
  order?: number
  /** 声明 Context Source 读取的 Workspace；不填 workspaceId 表示当前 Session Workspace。 */
  workspaceAccess?: { workspaceId?: string }
  render(request: ContextAssemblyRequest): string | undefined | Promise<string | undefined>
}

export interface AssembledContextSection {
  sourceId: string
  order: number
  content: string
  digest: string
  workspaceId?: string
}

export interface ContextAssembly {
  content: string
  digest: string
  sections: readonly AssembledContextSection[]
}

export interface ContextRegistryOptions {
  /** 防止插件/文档误把无限内容直接塞进模型；超限 fail loud，不静默截断语义。 */
  maxCharacters?: number
}

const DEFAULT_MAX_CHARACTERS = 64 * 1024

function digestText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function compareSources(a: ContextSource, b: ContextSource): number {
  const order = (a.order ?? 0) - (b.order ?? 0)
  if (order !== 0) return order
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function assertSource(source: ContextSource): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(source.id)) {
    throw new Error(`Invalid XMA context source id: ${source.id}`)
  }
  if (source.order !== undefined && !Number.isSafeInteger(source.order)) {
    throw new Error(`XMA context source order must be a safe integer: ${source.id}`)
  }
}

/**
 * ContextRegistry 是 Runtime 级可扩展上下文源容器。
 * 注册返回 disposer；后续 Plugin Host 接入时可以把 Source 生命周期直接绑定到 plugin effect。
 */
export class ContextRegistry {
  readonly #sources = new Map<string, ContextSource>()
  readonly #maxCharacters: number

  constructor(options: ContextRegistryOptions = {}) {
    this.#maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS
    if (!Number.isSafeInteger(this.#maxCharacters) || this.#maxCharacters <= 0) {
      throw new Error('XMA context maxCharacters must be a positive safe integer.')
    }
  }

  register(source: ContextSource): Disposer {
    assertSource(source)
    if (this.#sources.has(source.id)) throw new Error(`XMA context source already registered: ${source.id}`)
    this.#sources.set(source.id, source)
    return () => {
      if (this.#sources.get(source.id) === source) this.#sources.delete(source.id)
    }
  }

  list(): readonly ContextSource[] {
    return [...this.#sources.values()].sort(compareSources)
  }

  async assemble(request: ContextAssemblyRequest): Promise<ContextAssembly> {
    const sections: AssembledContextSection[] = []
    let characters = 0

    for (const source of this.list()) {
      if (request.signal.aborted) throw Object.assign(new Error('XMA context assembly aborted.'), { name: 'AbortError' })
      let workspaceId: string | undefined
      if (source.workspaceAccess !== undefined) {
        workspaceId = source.workspaceAccess.workspaceId ?? request.workspace?.workspaceId
        if (workspaceId === undefined) {
          throw new Error(`XMA context source ${source.id} requires a Workspace but the Session is unbound.`)
        }
        const sameWorkspace = request.workspace?.workspaceId === workspaceId
        if (!sameWorkspace) {
          const decision = request.authorizeWorkspaceAccess?.({ workspaceId, permission: 'read' })
          if (decision?.allow !== true) {
            const reason = decision && !decision.allow ? decision.reason : 'no Workspace authorization provider'
            throw new Error(`XMA context source ${source.id} cannot read workspace ${workspaceId}: ${reason}`)
          }
        }
      }

      const rendered = await source.render(request)
      if (rendered === undefined || rendered.length === 0) continue
      characters += rendered.length
      if (characters > this.#maxCharacters) {
        throw new Error(`XMA context exceeds maxCharacters (${this.#maxCharacters}) while rendering ${source.id}`)
      }
      sections.push({
        sourceId: source.id,
        order: source.order ?? 0,
        content: rendered,
        digest: digestText(rendered),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      })
    }

    const content = sections.map(section => section.content).join('\n\n')
    return Object.freeze({
      content,
      digest: digestText(content),
      sections: Object.freeze(sections.map(section => Object.freeze({ ...section }))),
    })
  }
}
