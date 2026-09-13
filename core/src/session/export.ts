/**
 * 文件作用：转发旧 Session Export 子路径到 xma-session。
 * 关联模块：xma-session、core/src/index.ts。
 * 当前实现：只做 deprecated re-export。
 * 职责边界：禁止产生第二份 Session Export 实现。
 * @deprecated 新代码必须直接使用对应稳定 package 公共入口。
 */
export * from 'xma-session'