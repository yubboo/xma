/**
 * 文件作用：转发旧 Core Native Bridge 入口到稳定 xma-native package。
 * 关联模块：xma-native、core/src/index.ts。
 * 当前实现：只做 deprecated re-export，保持旧 import 兼容。
 * 职责边界：禁止在本文件恢复 Native RPC/凭据实现。
 * @deprecated 新代码必须直接使用对应稳定 package 公共入口。
 */
export * from 'xma-native'