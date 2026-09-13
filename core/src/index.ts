/**
 * 文件作用：XMA 0.1.x 迁移期 Compatibility Facade 公共入口。
 * 关联模块：packages/xma-*、apps/*、仍待迁移的 Skill/App Protocol 模块。
 * 当前实现：把已迁移平台能力转发到稳定 xma-* package，同时保留尚未迁移的兼容 API。
 * 职责边界：新平台能力不得继续实现在 core/；core 只允许兼容转发与未迁移薄层。
 */

export * from 'xma-agent-loop'
export * from 'xma-ai'
export * from 'xma-context'
export * from 'xma-native'
export * from 'xma-plugin'
export * from 'xma-session'
export * from 'xma-tools'

export * from './app-protocol.ts'
export * from './skill/contract.ts'
export * from './skill/loader.ts'
export * from './skill/registry.ts'
