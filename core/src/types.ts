/**
 * 文件作用：保留旧 Core 通用类型入口，转发到拥有真实 Contract 的稳定 package。
 * 关联模块：xma-ai、xma-plugin、core/src/index.ts。
 * 当前实现：只导出历史公开类型别名。
 * 职责边界：禁止把新的跨域类型继续堆回 core/types。
 * @deprecated 新代码必须直接使用对应稳定 package 公共入口。
 */
export type { JsonPrimitive, JsonValue, JsonObject } from 'xma-ai'
export type { Disposer, ServiceKey } from 'xma-plugin'