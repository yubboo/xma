//! 文件作用：定义 TypeScript Core 与 Rust Native Runtime 之间的稳定 JSON-RPC 协议类型。
//! 关联模块：native/runtime、core/src/native.ts、plugins/tools/native.ts。
//! 当前实现：运行时状态、Capability lease、受限文件读写、绝对可执行文件身份白名单、受限进程执行与通用 JSON-RPC 请求/响应结构。
//! 职责边界：协议层不包含 Agent/Provider/Minecraft 等业务决策；所有 Native 副作用参数都必须由 Rust Runtime 再次验证。

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
    pub policy_configured: bool,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostPolicy {
    pub roots: Vec<String>,
    #[serde(default)]
    /// 绝对可执行文件路径；Rust Runtime 会 canonicalize 后冻结真实路径身份。
    pub programs: Vec<String>,
    #[serde(default)]
    pub max_read_bytes: Option<usize>,
    #[serde(default)]
    pub max_write_bytes: Option<usize>,
    #[serde(default)]
    pub max_process_output_bytes: Option<usize>,
    #[serde(default)]
    pub max_process_timeout_ms: Option<u64>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CapabilityKind {
    #[serde(rename = "filesystem.read")]
    FilesystemRead,
    #[serde(rename = "filesystem.write")]
    FilesystemWrite,
    #[serde(rename = "process.spawn")]
    ProcessSpawn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityGrant {
    pub kind: CapabilityKind,
    pub roots: Vec<String>,
    #[serde(default)]
    pub programs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityLease {
    pub token: String,
    pub kind: CapabilityKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextRequest {
    pub token: String,
    pub path: String,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextResult {
    pub path: String,
    pub content: String,
    pub bytes: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextRequest {
    pub token: String,
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub create_parents: bool,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextResult {
    pub path: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRunRequest {
    pub token: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub max_output_bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRunResult {
    pub program: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_kinds_use_the_stable_dotted_wire_names() {
        assert_eq!(
            serde_json::to_string(&CapabilityKind::FilesystemRead).expect("serialize read kind"),
            "\"filesystem.read\""
        );
        assert_eq!(
            serde_json::to_string(&CapabilityKind::FilesystemWrite).expect("serialize write kind"),
            "\"filesystem.write\""
        );
        assert_eq!(
            serde_json::to_string(&CapabilityKind::ProcessSpawn).expect("serialize process kind"),
            "\"process.spawn\""
        );
        assert_eq!(
            serde_json::from_str::<CapabilityKind>("\"filesystem.read\"")
                .expect("deserialize read kind"),
            CapabilityKind::FilesystemRead
        );
    }
}
