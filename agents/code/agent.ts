/**
 * 文件作用：定义未来 Xiaoyu Code 专业智能体的身份骨架。
 * 关联模块：XMA Core、未来 Git/Search/Edit/Terminal 插件。
 * 当前实现：仅元数据，不宣称 Coding Agent 已产品完成。
 * 职责边界：不要在骨架阶段复制第三方 Coding Agent 的固定流程。
 */

export const codeAgent = {
  id: 'xiaoyu.code',
  name: 'Xiaoyu Code',
  description: '面向软件开发任务的专业智能体',
  status: 'skeleton' as const,
}
