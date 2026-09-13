/**
 * 文件作用：把 Rust Native OS Credentials 能力适配为 Provider Credentials Service。
 * 关联模块：xma-ai Provider Credential Contract、xma-native client、native/runtime credential.* RPC。
 * 当前实现：系统凭据库状态、存在性检查、Secret 读/写/删，以及 `os` CredentialReference 解析。
 * 职责边界：只接受 `source=os` 的稳定别名；不持久化 Secret，不把 Secret 写入错误、日志、Profile 或 Session。
 */

import type {
  CredentialReference,
  CredentialStore,
  CredentialStoreStatus,
} from 'xma-ai'
import type { NativeClient } from '../client.ts'

export class NativeCredentialStore implements CredentialStore {
  constructor(private readonly client: NativeClient) {}

  async status(signal?: AbortSignal): Promise<CredentialStoreStatus> {
    const result = await this.client.credentialStatus(signal)
    return {
      source: 'os',
      backend: result.backend,
      available: result.available,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    }
  }

  async resolve(reference: CredentialReference): Promise<string | undefined> {
    if (reference.source !== 'os') return undefined
    const result = await this.client.readCredential(reference.key)
    return result.found ? result.value : undefined
  }

  async has(key: string, signal?: AbortSignal): Promise<boolean> {
    const result = await this.client.readCredential(key, signal)
    return result.found
  }

  async set(key: string, value: string, signal?: AbortSignal): Promise<void> {
    const result = await this.client.writeCredential(key, value, signal)
    if (!result.stored) throw new Error('OS Credentials 未确认写入成功。')
  }

  async delete(key: string, signal?: AbortSignal): Promise<boolean> {
    return (await this.client.deleteCredential(key, signal)).deleted
  }
}
