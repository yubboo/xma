/**
 * 文件作用：转发旧 Workspace 入口到 xma-context，并兼容暴露 Workspace Tool Guard。
 * 关联模块：xma-context、xma-tools、core/src/index.ts。
 * 当前实现：只保留稳定 package re-export。
 * 职责边界：禁止在本文件重新实现 Workspace/Guard。
 * @deprecated 新代码必须直接使用对应稳定 package 公共入口。
 */
export * from 'xma-context'
export { WorkspaceToolSecurityGuard } from 'xma-tools'