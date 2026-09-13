/**
 * 文件作用：检查 XMA 文件/目录命名与模块粒度基础规则，防止 kebab-case、snake_case、语义点号重新混用。
 * 关联模块：AGENTS.md、docs/architecture/DIRECTORY-STRUCTURE.md、docs/development/DEVELOPMENT-RULES.md、package.json。
 * 当前实现：检查产品目录、TypeScript/PowerShell/Rust/架构文档命名，限制普通名字长度，并锁定 Session/Tool/Electron/Gate 的已完成分组结构。
 * 职责边界：Gate 只能检查可机械判断的命名问题；是否应该拆文件仍以“不同逻辑/独立生命周期”架构判断为准，不能靠脚本自动拆包。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['apps', 'core', 'agents', 'plugins', 'native', 'scripts'] as const
const MAX_NAME_LENGTH = 32
const MAX_WORDS = 3

const failures: string[] = []

function fail(message: string): void {
  failures.push(message)
}

function words(name: string, separator: '-' | '_'): number {
  return name.split(separator).filter(Boolean).length
}

function assertKebab(name: string, path: string, kind: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    fail(`${kind} 必须使用小写 kebab-case：${path}`)
    return
  }
  if (name.length > MAX_NAME_LENGTH) fail(`${kind} 名称超过 ${MAX_NAME_LENGTH} 字符：${path}`)
  if (words(name, '-') > MAX_WORDS) fail(`${kind} 普通名称最多 ${MAX_WORDS} 个核心词：${path}`)
}

function assertSnake(name: string, path: string): void {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name)) {
    fail(`Rust 模块文件必须使用 snake_case：${path}`)
    return
  }
  if (name.length > MAX_NAME_LENGTH) fail(`Rust 模块名称超过 ${MAX_NAME_LENGTH} 字符：${path}`)
  if (words(name, '_') > MAX_WORDS) fail(`Rust 模块普通名称最多 ${MAX_WORDS} 个核心词：${path}`)
}

function tsStem(name: string): string | undefined {
  for (const suffix of ['.test.tsx', '.test.ts', '.config.tsx', '.config.ts', '.d.ts', '.tsx', '.ts']) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length)
  }
  return undefined
}

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const normalized = path.replaceAll('\\', '/')
    const stat = statSync(path)
    if (stat.isDirectory()) {
      assertKebab(name, normalized, '目录')
      walk(path)
      continue
    }

    const stem = tsStem(name)
    if (stem !== undefined) {
      assertKebab(stem, normalized, 'TypeScript 文件')
      // 点号只用于 test/config/d 等角色后缀；普通单词必须使用连字符。
      const allowed = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)\.(?:ts|tsx|test\.ts|test\.tsx|config\.ts|config\.tsx|d\.ts)$/
      if (!allowed.test(name)) fail(`TypeScript 文件点号只能表达 test/config/d 等角色：${normalized}`)
      continue
    }

    if (name.endsWith('.ps1')) {
      assertKebab(name.slice(0, -4), normalized, 'PowerShell 文件')
      continue
    }

    if (name.endsWith('.rs')) {
      assertSnake(name.slice(0, -3), normalized)
    }
  }
}

for (const root of ROOTS) walk(root)

// docs/ 采用专业文档大写 kebab-case；README 是固定行业文件名。
function walkDocs(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const normalized = path.replaceAll('\\', '/')
    const stat = statSync(path)
    if (stat.isDirectory()) {
      assertKebab(name, normalized, '文档目录')
      walkDocs(path)
      continue
    }
    if (!name.endsWith('.md') || name === 'README.md') continue
    const stem = name.slice(0, -3)
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(stem)) fail(`架构/开发 Markdown 必须使用 UPPER-KEBAB：${normalized}`)
    if (words(stem, '-') > MAX_WORDS) fail(`Markdown 名称最多 ${MAX_WORDS} 个核心词：${normalized}`)
    if (stem.length > 40) fail(`Markdown 名称过长：${normalized}`)
  }
}
walkDocs('docs')

const requiredGroupedPaths = [
  'core/src/session/contract.ts',
  'core/src/session/store.ts',
  'core/src/session/export.ts',
  'core/src/tool/router.ts',
  'core/src/tool/policy.ts',
  'core/src/tool/schema.ts',
  'apps/desktop/scripts/electron/build.ts',
  'apps/desktop/scripts/electron/dev.ts',
  'apps/desktop/scripts/electron/install-runtime.ts',
  'apps/desktop/scripts/electron/runtime.ts',
  'scripts/gates/naming.ts',
  'scripts/gates/architecture.ts',
  'scripts/gates/comments.ts',
  'scripts/gates/documentation.ts',
  'scripts/gates/ai-context.ts',
  'scripts/gates/version.ts',
  'scripts/gates/windows.ts',
  'scripts/gates/repository.ts',
]
for (const path of requiredGroupedPaths) {
  if (!existsSync(path)) fail(`命名/分组重构要求的路径缺失：${path}`)
}

const forbiddenLegacyPaths = [
  'core/src/session.ts',
  'core/src/session-store.ts',
  'core/src/session-export.ts',
  'core/src/tools.ts',
  'core/src/tool-policy.ts',
  'core/src/tool-schema.ts',
  'apps/desktop/scripts/build-electron.ts',
  'apps/desktop/scripts/dev-electron.ts',
  'apps/desktop/scripts/install-electron-runtime.ts',
  'apps/desktop/scripts/electron-runtime-core.ts',
]
for (const path of forbiddenLegacyPaths) {
  if (existsSync(path)) fail(`旧命名/重复领域前缀不得恢复：${path}`)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
if (pkg.scripts?.['gate:naming'] !== 'tsx scripts/gates/naming.ts') fail('package.json 必须提供 gate:naming -> scripts/gates/naming.ts')
if (!(pkg.scripts?.check ?? '').includes('pnpm gate:naming')) fail('pnpm check 必须包含 Naming Gate')

if (failures.length > 0) {
  throw new Error(`XMA Naming Gate FAIL:\n${failures.map(item => ` - ${item}`).join('\n')}`)
}

console.log('XMA Naming Gate PASS (kebab-case / snake_case / semantic dot / concise modules)')
