/**
 * 文件作用：定义 XMA Core 内最基础、最稳定的公共类型。
 * 关联模块：plugin.ts、agent.ts、model.ts、tool/router.ts、workspace.ts。
 * 当前实现：JSON 值、释放函数、服务键等最小类型。
 * 职责边界：不要在这里加入 Minecraft、Writer 或具体厂商模型类型。
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type Disposer = () => void | Promise<void>
export type ServiceKey = string
