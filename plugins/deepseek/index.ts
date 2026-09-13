/**
 * 文件作用：提供 DeepSeek 产品 Provider 插件的稳定公共入口。
 * 关联模块：catalog.ts、plugin.ts、xma-ai。
 * 当前实现：统一导出 Catalog 与 Plugin 装配。
 * 职责边界：共享 OpenAI-compatible Transport 属于 xma-ai，不在这里复制。
 */
export * from './catalog.ts'
export * from './plugin.ts'