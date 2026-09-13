/**
 * 文件作用：提供 TypeScript ↔ Rust Native Bridge 的稳定公共入口。
 * 关联模块：client.ts、credentials/store.ts。
 * 当前实现：集中导出 NativeClient 与 Credential Store bridge。
 * 职责边界：真实 OS 副作用仍由 Rust Kernel enforcement，本入口不扩大权限。
 */
export * from './client.ts'
export * from './credentials/store.ts'