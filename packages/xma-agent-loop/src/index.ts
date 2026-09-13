/**
 * 文件作用：提供 xma-agent-loop 的稳定公共入口。
 * 关联模块：agent Contract/Registry/Delegation、Runtime、legacy compatibility。
 * 当前实现：集中导出 Agent Engine 公共 API。
 * 职责边界：跨 package 调用必须从这里进入，不允许依赖内部物理路径。
 */
export * from './agent/contract.ts'
export * from './agent/registry.ts'
export * from './agent/delegation.ts'
export * from './runtime.ts'
export * from './legacy-run-agent.ts'