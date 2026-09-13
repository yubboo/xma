/**
 * 文件作用：提供 xma-plugin 的稳定公共入口。
 * 关联模块：plugin.ts。
 * 当前实现：导出 Plugin Context/Service/Event/Effect 生命周期 API。
 * 职责边界：插件消费者只能依赖稳定 Contract，不依赖内部文件位置。
 */
export * from './plugin.ts'