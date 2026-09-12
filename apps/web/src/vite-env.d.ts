/**
 * 文件作用：向 TypeScript 声明 Vite 客户端类型（包括 CSS/静态资源导入）。
 * 关联模块：apps/web/src/main.ts、Vite 构建。
 * 当前实现：引用 vite/client 官方类型。
 * 职责边界：这里只补充构建类型，不承载 Web 业务逻辑。
 */
/// <reference types="vite/client" />
