/**
 * 文件作用：转发旧 Core Provider 入口到稳定 xma-ai package。
 * 关联模块：xma-ai、core/src/index.ts。
 * 当前实现：只做 deprecated re-export，保持旧 import 兼容。
 * 职责边界：禁止在本文件恢复 Provider/HTTP/凭据实现。
 * @deprecated 新代码必须直接使用对应稳定 package 公共入口。
 */
export * from 'xma-ai'