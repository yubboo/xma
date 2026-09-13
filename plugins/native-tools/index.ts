/**
 * 文件作用：提供 Native Tool Plugin 的稳定公共入口。
 * 关联模块：contract.ts、plugin.ts。
 * 当前实现：导出 NativeToolSetOptions 与 registerNativeTools。
 * 职责边界：调用方不得绕过该入口钻入插件内部实现。
 */
export type { NativeToolSetOptions } from './contract.ts'
export { registerNativeTools } from './plugin.ts'