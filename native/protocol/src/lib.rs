//! 文件作用：定义 TypeScript Core 与 Rust Native Runtime 之间的稳定协议类型。
//! 关联模块：native/runtime、未来 core Native Client。
//! 当前实现：最小运行时状态与 JSON-RPC 请求/响应结构。
//! 职责边界：协议层不包含 Minecraft、Writer、Provider 等业务知识。

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: &str = "xma.native.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub name: String,
    pub version: String,
    pub protocol: String,
    pub ready: bool,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
