/**
 * 文件作用：定义 Xiaoyu Code 专业智能体的第一版正式 AgentDefinition。
 * 关联模块：core/src/agent/*、skills/code/*、Native filesystem/process tools、未来 Git/Search/Patch 工具。
 * 当前实现：Code Agent 身份、首批 Skills、Tool/Brain 能力要求和验证型交付标准。
 * 职责边界：这里不复制 Codex Runtime、不硬编码修 Bug 决策树；专业方法由 Skill 提供，执行仍复用 XMA AgentRuntime。
 */

import type { AgentDefinition } from 'xma-agent-loop'

export const codeAgent: AgentDefinition = {
  id: 'xiaoyu.code',
  name: 'Xiaoyu Code',
  description: '面向软件开发、调试、测试与代码交付任务的专业智能体',
  version: '0.1.0',
  kind: 'specialist',
  status: 'foundation',
  skills: [
    'common/task-planning',
    'common/verification',
    'code/bug-fixing',
    'code/testing',
  ],
  tools: [
    'native.fs.read_text',
    'native.fs.write_text',
    'native.process.run',
  ],
  brain: {
    required: ['text', 'tool-calling'],
    preferred: ['reasoning', 'long-context', 'file-input'],
  },
  workspace: {
    access: 'owned',
  },
  memory: {
    enabled: true,
  },
  delivery: {
    requireVerification: true,
    evidence: ['tests', 'diff', 'summary'],
  },
  delegation: {
    canDelegate: false,
  },
}
