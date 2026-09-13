/**
 * 文件作用：从 XMA `skills/<namespace>/<name>/` 目录安全读取 skill.json + SKILL.md。
 * 关联模块：contract.ts、registry.ts、skills/*、未来用户级 Skill 安装目录。
 * 当前实现：基于稳定 Skill ID 的路径解析、目录越界防护、metadata 校验和 SKILL.md 加载。
 * 职责边界：Loader 只读取 Skill bundle，不把 Skill 自动安装到 Agent，也不执行其中描述的任何 Tool。
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentBrainCapability } from '../agent/contract.ts'
import type { LoadedSkill, SkillDefinition, SkillRequirements } from './contract.ts'

const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const BRAIN_CAPABILITIES = new Set<AgentBrainCapability>([
  'text',
  'tool-calling',
  'reasoning',
  'vision',
  'file-input',
  'image-output',
  'web-search',
  'long-context',
])

function strings(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`XMA Skill ${label} must be a non-empty string array.`)
  }
  const normalized = value.map(item => item.trim())
  if (new Set(normalized).size !== normalized.length) throw new Error(`XMA Skill ${label} contains duplicates.`)
  return normalized
}

function parseRequirements(value: unknown): SkillRequirements | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('XMA Skill requires must be an object.')
  const raw = value as Record<string, unknown>
  const tools = strings(raw.tools, 'requires.tools')
  const brainRaw = strings(raw.brain, 'requires.brain')
  const brain = brainRaw?.map(item => {
    if (!BRAIN_CAPABILITIES.has(item as AgentBrainCapability)) throw new Error(`XMA Skill has unknown Brain capability: ${item}`)
    return item as AgentBrainCapability
  })
  if (!tools && !brain) return undefined
  return {
    ...(tools ? { tools } : {}),
    ...(brain ? { brain } : {}),
  }
}

function parseDefinition(raw: unknown, expectedId: string): SkillDefinition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`XMA Skill metadata must be an object: ${expectedId}`)
  const object = raw as Record<string, unknown>
  const id = String(object.id ?? '').trim()
  const name = String(object.name ?? '').trim()
  const description = String(object.description ?? '').trim()
  const version = String(object.version ?? '').trim()
  if (id !== expectedId) throw new Error(`XMA Skill metadata id mismatch: expected ${expectedId}, got ${id || '<empty>'}`)
  if (!SKILL_ID_PATTERN.test(id)) throw new Error(`Invalid XMA Skill id: ${id}`)
  if (!name) throw new Error(`XMA Skill ${id} is missing name.`)
  if (!description) throw new Error(`XMA Skill ${id} is missing description.`)
  if (!VERSION_PATTERN.test(version)) throw new Error(`XMA Skill ${id} has invalid version: ${version}`)
  const requires = parseRequirements(object.requires)
  const tags = strings(object.tags, 'tags')
  return {
    id,
    name,
    description,
    version,
    ...(requires ? { requires } : {}),
    ...(tags ? { tags } : {}),
  }
}

function assertSkillId(id: string): void {
  if (!SKILL_ID_PATTERN.test(id)) throw new Error(`Invalid XMA Skill id: ${id}`)
}

export class SkillLoader {
  readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  async load(id: string): Promise<LoadedSkill> {
    assertSkillId(id)
    const directory = path.resolve(this.root, ...id.split('/'))
    const relative = path.relative(this.root, directory)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`XMA Skill path escapes root: ${id}`)

    const metadataFile = path.join(directory, 'skill.json')
    const instructionsFile = path.join(directory, 'SKILL.md')
    let metadataRaw: unknown
    try {
      metadataRaw = JSON.parse(await readFile(metadataFile, 'utf8')) as unknown
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`XMA Skill metadata JSON is invalid: ${id}`)
      throw error
    }
    const definition = parseDefinition(metadataRaw, id)
    const instructions = (await readFile(instructionsFile, 'utf8')).trim()
    if (!instructions) throw new Error(`XMA Skill instructions are empty: ${id}`)
    return {
      definition,
      instructions,
      directory,
    }
  }

  async loadMany(ids: readonly string[]): Promise<readonly LoadedSkill[]> {
    const result: LoadedSkill[] = []
    for (const id of ids) result.push(await this.load(id))
    return result
  }
}
