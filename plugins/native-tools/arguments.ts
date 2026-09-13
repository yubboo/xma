/**
 * 文件作用：集中解析 Native Tool 的模型参数，保证 FS/Process 工具采用同一 fail-loud 规则。
 * 关联模块：filesystem.ts、process.ts。
 * 当前实现：string / integer / boolean / string[] 参数读取。
 * 职责边界：只做 Tool arguments 的确定性类型检查，不处理权限、Approval 或 Native Capability。
 */

import type { JsonObject } from 'xma-ai'

export function stringArg(args: JsonObject, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new Error(`XMA native tool argument ${key} must be a string.`)
  return value
}

export function optionalIntegerArg(args: JsonObject, key: string): number | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`XMA native tool argument ${key} must be an integer.`)
  return value
}

export function optionalBooleanArg(args: JsonObject, key: string): boolean | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`XMA native tool argument ${key} must be a boolean.`)
  return value
}

export function stringArrayArg(args: JsonObject, key: string): string[] {
  const value = args[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`XMA native tool argument ${key} must be an array of strings.`)
  return value.map(item => String(item))
}
