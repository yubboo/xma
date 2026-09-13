/**
 * 文件作用：定义 XMA AI/Tool/Session 共用的 JSON 可序列化协议值。
 * 关联模块：xma-ai、xma-tools、xma-session、xma-native。
 * 当前实现：JsonPrimitive / JsonValue / JsonObject。
 * 职责边界：这里只定义协议值，不承载业务模型或 Plugin 生命周期。
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
