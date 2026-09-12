//! 文件作用：XMA Tauri 2 Desktop 的原生入口。
//! 关联模块：tauri.conf.json、apps/web、XMA Core 与 native/runtime。
//! 当前实现：创建桌面窗口并加载共享 Web UI。
//! 职责边界：Desktop 只是 Shell；Agent 推理仍由 TypeScript Core + 用户配置的大模型完成。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("XMA Tauri desktop failed to start");
}
