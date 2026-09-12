/**
 * 文件作用：展示 DeepSeek Harness / Cordis 风格插件如何通过 XMA 兼容层加载。
 * 关联模块：plugins/compat/deepseek-harness/index.ts、core/src/plugin.ts。
 * 当前实现：声明 tools 依赖并读取服务；真实插件可用同样的 inject/apply 形态。
 * 职责边界：示例不代表 DSH 全部专属 Service 已完成适配。
 */

export const deepSeekStyleExamplePlugin = {
  inject: ['tools'],
  apply(context: { require<T>(key: string): T }) {
    const tools = context.require<unknown>('tools')
    void tools
  },
}
