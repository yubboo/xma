/**
 * 文件作用：检查 XMA 必读开发文档是否齐全，并验证版本/仓库/固定流程没有漂移。
 * 关联模块：AGENTS.md、docs/development/*。
 * 当前实现：存在性和关键标记检查。
 * 职责边界：不替代人工架构评审。
 */

import { existsSync, readFileSync } from 'node:fs'

const docs = [
  'docs/architecture/PROJECT-ARCHITECTURE.md',
  'docs/architecture/DIRECTORY-STRUCTURE.md',
  'docs/architecture/LANGUAGE-OWNERSHIP.md',
  'docs/architecture/PLUGIN-SYSTEM.md',
  'docs/architecture/AGENT-RUNTIME.md',
  'docs/architecture/WORKSPACE.md',
  'docs/architecture/MODEL-PROVIDER.md',
  'docs/architecture/DESKTOP-RUNTIME.md',
  'docs/architecture/DESKTOP-WORKBENCH.md',
  'docs/security/NATIVE-CAPABILITIES.md',
  'docs/development/DEVELOPMENT-RULES.md',
  'docs/development/DEVELOPMENT-PLAN.md',
  'docs/development/PROJECT-STATUS.md',
  'docs/development/UPSTREAM-REFERENCE.md',
  'docs/development/VERSIONING-AND-RELEASES.md',
  'docs/development/WINDOWS-WORKFLOW.md',
  'docs/development/CODE-COMMENT-STANDARD.md',
]
for (const file of docs) if (!existsSync(file)) throw new Error(`Required XMA doc missing: ${file}`)
const agents = readFileSync('AGENTS.md', 'utf8')
for (const marker of ['https://github.com/yubboo/xma.git', '0.1.100', 'XMA-Sync.bat', 'DeepSeek Harness', 'Electron 41.2.0', 'Tauri 2', 'AGENT-RUNTIME.md', 'WORKSPACE.md', 'MODEL-PROVIDER.md', 'UPSTREAM-REFERENCE.md', '.codex/', '.claude/']) {
  if (!agents.includes(marker)) throw new Error(`AGENTS.md rule missing: ${marker}`)
}
console.log('XMA Documentation Gate PASS')
