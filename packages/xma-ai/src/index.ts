/**
 * 文件作用：提供 xma-ai 的稳定公共入口。
 * 关联模块：model、provider、protocol、OpenAI-compatible transport。
 * 当前实现：集中导出模型与 Provider 公共 Contract。
 * 职责边界：跨 package 调用必须从这里进入，不允许 xma-ai/src 深层导入。
 */
export * from './protocol/json.ts'
export * from './model/model.ts'
export * from './provider/provider.ts'
export * from './openai-compatible.ts'