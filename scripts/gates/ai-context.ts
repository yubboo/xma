/**
 * 文件作用：检查 XMA 的仓库级 AI 开发上下文没有分叉成互相冲突的规则副本。
 * 关联模块：AGENTS.md、CLAUDE.md、.agents/、.codex/、.claude/、UPSTREAM-REFERENCE.md。
 * 当前实现：验证公共 Skill 镜像一致、工具入口存在、Codex 环境不偷偷安装依赖、上游固定基线齐全。
 * 职责边界：本 Gate 只检查仓库静态 Contract，不判断外部 Coding Agent 是否真的读取了这些文件。
 */

import { existsSync, readFileSync } from 'node:fs'

const required = [
  'AGENTS.md',
  'CLAUDE.md',
  '.agents/README.md',
  '.agents/skills/xma-development/SKILL.md',
  '.agents/skills/xma-upstream-study/SKILL.md',
  '.codex/README.md',
  '.codex/environments/environment.toml',
  '.codex/skills/xma-development/SKILL.md',
  '.codex/skills/xma-upstream-study/SKILL.md',
  '.claude/README.md',
  '.claude/skills/xma-development/SKILL.md',
  '.claude/skills/xma-upstream-study/SKILL.md',
  'docs/development/UPSTREAM-REFERENCE.md',
]
for (const file of required) {
  if (!existsSync(file)) throw new Error(`XMA AI Context Gate: missing ${file}`)
}

for (const skill of ['xma-development', 'xma-upstream-study']) {
  const canonical = readFileSync(`.agents/skills/${skill}/SKILL.md`, 'utf8')
  for (const adapter of ['.codex', '.claude']) {
    const mirrored = readFileSync(`${adapter}/skills/${skill}/SKILL.md`, 'utf8')
    if (mirrored !== canonical) {
      throw new Error(`XMA AI Context Gate: ${adapter}/skills/${skill}/SKILL.md drifted from .agents canonical source`)
    }
  }
}

const claude = readFileSync('CLAUDE.md', 'utf8')
if (!claude.includes('`AGENTS.md`') || !claude.includes('最高开发约束')) {
  throw new Error('XMA AI Context Gate: CLAUDE.md must keep AGENTS.md authoritative')
}

const codexEnvironment = readFileSync('.codex/environments/environment.toml', 'utf8')
for (const forbidden of ['pnpm install', 'cargo fetch', 'winget ', 'pnpm rebuild']) {
  if (codexEnvironment.includes(forbidden)) {
    throw new Error(`XMA AI Context Gate: Codex environment must not prepare dependencies implicitly: ${forbidden}`)
  }
}

const upstream = readFileSync('docs/development/UPSTREAM-REFERENCE.md', 'utf8')
for (const marker of [
  'openai/codex',
  '7efa9d96fb34c3cafe108a3c870bfc33e5635772',
  'deepseek-ai/deepseek-harness',
  'c291e7961a515f6d7af9304e7fd1d257929aef26',
  'AndrewNog0724/minecraft-host-agent',
  '82cb581ef433c0c6da5e9587950c7dfb528b7c27',
  'Apache-2.0',
  'MIT',
]) {
  if (!upstream.includes(marker)) throw new Error(`XMA AI Context Gate: upstream reference marker missing: ${marker}`)
}

const agents = readFileSync('AGENTS.md', 'utf8')
for (const marker of ['AGENT-RUNTIME.md', 'MODEL-PROVIDER.md', 'DISTRIBUTION.md', 'UPSTREAM-REFERENCE.md', '.agents/skills/', '.codex/', '.claude/', 'Model-visible']) {
  if (!agents.includes(marker)) throw new Error(`XMA AI Context Gate: AGENTS.md new architecture rule missing: ${marker}`)
}

console.log('XMA AI Context Gate PASS (AGENTS authority + mirrored skills + pinned upstream baselines)')
