/**
 * 文件作用：提供小鱼 Manager Agent 的稳定 workspace package 公共入口。
 * 关联模块：runtime/agent.ts、xma-agent-loop。
 * 当前实现：仅导出 xiaoyuAgent。
 * 职责边界：Agent 具体能力和 Runtime 不在入口文件实现。
 */
export { xiaoyuAgent } from './runtime/agent.ts'