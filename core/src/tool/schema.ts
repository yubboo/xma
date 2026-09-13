/**
 * 文件作用：转发旧 Tool Schema 子路径到 xma-tools。
 * 关联模块：xma-tools、core/src/index.ts。
 * 当前实现：只做 deprecated re-export。
 * 职责边界：禁止产生第二份 Tool Schema 实现。
 * @deprecated 新代码必须直接使用对应稳定 package 公共入口。
 */
export * from 'xma-tools'