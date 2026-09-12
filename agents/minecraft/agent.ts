/**
 * 文件作用：定义 Xiaoyu Minecraft Agent 的身份和第一阶段能力边界。
 * 关联模块：core、Minecraft skills/knowledge/tools（后续逐步补齐）。
 * 当前实现：Agent 元数据骨架。
 * 职责边界：Minecraft 是专业 Agent，不得把业务规则写进 XMA Core。
 */

export const minecraftAgent = {
  id: 'xiaoyu.minecraft',
  name: 'Xiaoyu Minecraft',
  description: 'Minecraft 与游戏服务器专业智能体',
  status: 'priority-development' as const,
}
