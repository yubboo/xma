//! 文件作用：XMA Rust Native Runtime 的第一入口。
//! 关联模块：xma-native-protocol、未来 filesystem/process/pty/network/capability 模块。
//! 当前实现：stdio JSON-RPC 的 initialize/runtime.status 骨架。
//! 职责边界：Rust 只执行 Native/Security/Performance 工作，不承担 Agent 推理。

use anyhow::Result;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use xma_native_protocol::{JsonRpcRequest, JsonRpcResponse, RuntimeStatus, PROTOCOL_VERSION};

fn status() -> RuntimeStatus {
    RuntimeStatus {
        name: "XMA Native Runtime".to_string(),
        version: "0.1.0".to_string(),
        protocol: PROTOCOL_VERSION.to_string(),
        ready: true,
        capabilities: vec!["runtime.status".to_string()],
    }
}

fn handle(request: JsonRpcRequest) -> JsonRpcResponse {
    let result: Result<Value, String> = match request.method.as_str() {
        "initialize" | "runtime/status" => {
            serde_json::to_value(status()).map_err(|error| error.to_string())
        }
        _ => Err(format!("unknown native method: {}", request.method)),
    };

    match result {
        Ok(value) => JsonRpcResponse {
            id: request.id,
            result: Some(value),
            error: None,
        },
        Err(error) => JsonRpcResponse {
            id: request.id,
            result: None,
            error: Some(error),
        },
    }
}

fn main() -> Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(request) => handle(request),
            Err(error) => JsonRpcResponse {
                id: json!(null),
                result: None,
                error: Some(format!("invalid request: {error}")),
            },
        };
        serde_json::to_writer(&mut stdout, &response)?;
        writeln!(&mut stdout)?;
        stdout.flush()?;
    }
    Ok(())
}
