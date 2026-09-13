/**
 * 文件作用：提供 xma-context 的稳定公共入口。
 * 关联模块：assembly/context.ts、workspace/workspace.ts。
 * 当前实现：集中导出 Context Assembly 与 Workspace Contract。
 * 职责边界：跨 package 只依赖公共 Contract，不直接钻入功能簇文件。
 */
export * from './assembly/context.ts'
export * from './workspace/workspace.ts'