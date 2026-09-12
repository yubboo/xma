/**
 * 文件作用：阻止 XMA 核心架构在后续开发中回退或被业务污染。
 * 关联模块：AGENTS.md、core/、agents/、native/。
 * 当前实现：检查关键目录、语言边界、旧式 Go Core 回流和 DeepSeek Harness 兼容层。
 * 职责边界：Gate 只做静态契约检查，不能替代真实测试。
 */

import { existsSync, readFileSync } from 'node:fs'

const required = [
  'AGENTS.md',
  'core/src/agent.ts',
  'core/src/plugin.ts',
  'plugins/compat/deepseek-harness/index.ts',
  'native/protocol/src/lib.rs',
  'native/runtime/src/main.rs',
  'docs/architecture/PROJECT-ARCHITECTURE.md',
  'docs/architecture/PLUGIN-SYSTEM.md',
]
for (const path of required) if (!existsSync(path)) throw new Error(`XMA Architecture Gate: missing ${path}`)

const agents = readFileSync('core/src/agent.ts', 'utf8')
if (!agents.includes('provider.stream') || !agents.includes('tools.execute')) throw new Error('XMA Agent Loop must remain Model -> Tool -> Observation -> Model')
const compat = readFileSync('plugins/compat/deepseek-harness/index.ts', 'utf8')
for (const marker of ['inject', 'apply(context']) if (!compat.includes(marker)) throw new Error(`DeepSeek Harness compatibility marker missing: ${marker}`)

console.log('XMA Architecture Gate PASS (TypeScript Agent + Rust Native + plugin compatibility)')
