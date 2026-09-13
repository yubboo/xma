/**
 * 文件作用：转发旧 Core Model 入口到稳定 xma-ai package。
 * 关联模块：xma-ai、core/src/index.ts。
 * 当前实现：只做 deprecated re-export，保持旧 import 兼容。
 * 职责边界：禁止在本文件恢复 Model 实现或协议逻辑。
 * @deprecated 新代码必须直接使用对应稳定 package 公共入口。
 */
export * from 'xma-ai'