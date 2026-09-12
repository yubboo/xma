/**
 * 文件作用：定义 XMA Workspace 的最小元数据与隔离边界。
 * 关联模块：agent.ts、未来 Rust filesystem sandbox、各 agents/*。
 * 当前实现：Workspace 描述与 Registry。
 * 职责边界：这里记录“允许的领地”，真正文件系统强制隔离必须由 Rust Native Runtime 执行。
 */

export interface WorkspaceDescriptor {
  id: string
  agentId: string
  name: string
  root: string
}

export class WorkspaceRegistry {
  readonly #items = new Map<string, WorkspaceDescriptor>()

  register(workspace: WorkspaceDescriptor): void {
    if (this.#items.has(workspace.id)) throw new Error(`Workspace already exists: ${workspace.id}`)
    this.#items.set(workspace.id, workspace)
  }

  get(id: string): WorkspaceDescriptor | undefined {
    return this.#items.get(id)
  }

  list(): WorkspaceDescriptor[] {
    return [...this.#items.values()]
  }
}
