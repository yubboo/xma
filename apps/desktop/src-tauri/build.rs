// 文件作用：Tauri 桌面壳的构建脚本，由 tauri-build 生成平台资源与配置。
// 关联模块：tauri.conf.json、src/main.rs、apps/web。
// 当前实现：使用 Tauri 2 默认构建流程。
// 职责边界：这里只生成桌面壳资源，不实现 Agent 推理或业务逻辑。

fn main() {
    tauri_build::build()
}
