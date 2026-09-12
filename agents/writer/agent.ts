/**
 * 文件作用：定义未来 Xiaoyu Writer 专业智能体的身份骨架。
 * 关联模块：XMA Core、未来 Writer Workspace/Memory/Knowledge。
 * 当前实现：仅元数据，不宣称 Writer Agent 已产品完成。
 * 职责边界：写作记忆和文件必须与 Minecraft/Code Workspace 隔离。
 */

export const writerAgent = {
  id: 'xiaoyu.writer',
  name: 'Xiaoyu Writer',
  description: '小说、长文与创作任务专业智能体',
  status: 'skeleton' as const,
}
