//! 文件作用：XMA Rust Native Runtime 的 stdio JSON-RPC 入口与第一批 Security Kernel enforcement。
//! 关联模块：xma-native-protocol、core/src/native.ts、plugins/tools/native.ts、未来 PTY/Network/Sandbox 模块。
//! 当前实现：Host Policy、一次性 Capability lease、真实路径 confinement、UTF-8 文件读写、绝对可执行文件 canonical identity、无 shell 进程执行、超时/输出上限与 runtime.status。
//! 职责边界：Rust 只执行 Native/Security/Performance 工作，不承担 Agent 推理；任何来自 TypeScript/模型的路径、程序与权限都必须在这里重新验证。

use anyhow::Result;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use xma_native_protocol::{
    CapabilityGrant, CapabilityKind, CapabilityLease, JsonRpcRequest, JsonRpcResponse,
    NativeHostPolicy, ProcessRunRequest, ProcessRunResult, ReadTextRequest, ReadTextResult,
    RuntimeStatus, WriteTextRequest, WriteTextResult, PROTOCOL_VERSION,
};

const DEFAULT_READ_MAX_BYTES: usize = 1024 * 1024;
const DEFAULT_WRITE_MAX_BYTES: usize = 1024 * 1024;
const DEFAULT_PROCESS_OUTPUT_MAX_BYTES: usize = 256 * 1024;
const DEFAULT_PROCESS_TIMEOUT_MS: u64 = 60_000;
const HARD_FILE_MAX_BYTES: usize = 16 * 1024 * 1024;
const HARD_PROCESS_OUTPUT_MAX_BYTES: usize = 4 * 1024 * 1024;
const HARD_PROCESS_TIMEOUT_MS: u64 = 15 * 60_000;

#[derive(Clone)]
struct HostPolicy {
    roots: Vec<PathBuf>,
    programs: Vec<PathBuf>,
    max_read_bytes: usize,
    max_write_bytes: usize,
    max_process_output_bytes: usize,
    max_process_timeout_ms: u64,
}

#[derive(Clone)]
struct CapabilityScope {
    kind: CapabilityKind,
    roots: Vec<PathBuf>,
    programs: Vec<PathBuf>,
}

#[derive(Default)]
struct RuntimeState {
    host_policy: Option<HostPolicy>,
    capabilities: HashMap<String, CapabilityScope>,
}

static NEXT_CAPABILITY_ID: AtomicU64 = AtomicU64::new(1);

fn status(state: &RuntimeState) -> RuntimeStatus {
    let policy_configured = state.host_policy.is_some();
    RuntimeStatus {
        name: "XMA Native Runtime".to_string(),
        version: "0.1.0".to_string(),
        protocol: PROTOCOL_VERSION.to_string(),
        ready: policy_configured,
        policy_configured,
        capabilities: vec![
            "runtime.status".to_string(),
            "capability.issue".to_string(),
            "fs.read_text".to_string(),
            "fs.write_text".to_string(),
            "process.run".to_string(),
        ],
    }
}

fn decode<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| format!("invalid native params: {error}"))
}

fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn canonicalize_roots(roots: &[String], label: &str) -> Result<Vec<PathBuf>, String> {
    if roots.is_empty() {
        return Err(format!("{label} requires at least one root"));
    }
    roots
        .iter()
        .map(|root| {
            fs::canonicalize(root)
                .map_err(|error| format!("cannot canonicalize {label} root {root:?}: {error}"))
        })
        .collect()
}

fn starts_in_any_root(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

#[cfg(windows)]
fn same_path(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

#[cfg(not(windows))]
fn same_path(left: &Path, right: &Path) -> bool {
    left == right
}

/// 程序身份只接受绝对路径，并在 Host Policy / lease / execute 三个阶段都 canonicalize。
/// 这样执行时永远不会通过 PATH 或当前目录重新解析另一个同名程序。
fn canonicalize_program(raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(format!(
            "native process program must be an absolute executable path: {raw}"
        ));
    }
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("cannot canonicalize native program {raw:?}: {error}"))?;
    if !canonical.is_file() {
        return Err(format!(
            "native process program is not a file: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn program_allowed(programs: &[PathBuf], requested: &Path) -> bool {
    programs.iter().any(|program| same_path(program, requested))
}

fn checked_usize_limit(
    value: Option<usize>,
    default_value: usize,
    hard_limit: usize,
    label: &str,
) -> Result<usize, String> {
    let value = value.unwrap_or(default_value);
    if value == 0 {
        return Err(format!("{label} must be greater than zero"));
    }
    if value > hard_limit {
        return Err(format!("{label} exceeds native hard limit {hard_limit}"));
    }
    Ok(value)
}

fn checked_u64_limit(
    value: Option<u64>,
    default_value: u64,
    hard_limit: u64,
    label: &str,
) -> Result<u64, String> {
    let value = value.unwrap_or(default_value);
    if value == 0 {
        return Err(format!("{label} must be greater than zero"));
    }
    if value > hard_limit {
        return Err(format!("{label} exceeds native hard limit {hard_limit}"));
    }
    Ok(value)
}

fn configure_policy(
    state: &mut RuntimeState,
    policy: NativeHostPolicy,
) -> Result<RuntimeStatus, String> {
    if state.host_policy.is_some() {
        return Err(
            "native host policy is already configured for this runtime process".to_string(),
        );
    }
    let roots = canonicalize_roots(&policy.roots, "native host policy")?;
    if policy
        .programs
        .iter()
        .any(|program| program.trim().is_empty())
    {
        return Err("native host policy program paths must be non-empty".to_string());
    }
    let programs = policy
        .programs
        .iter()
        .map(|program| canonicalize_program(program))
        .collect::<Result<Vec<_>, _>>()?;
    let host_policy = HostPolicy {
        roots,
        programs,
        max_read_bytes: checked_usize_limit(
            policy.max_read_bytes,
            DEFAULT_READ_MAX_BYTES,
            HARD_FILE_MAX_BYTES,
            "native host maxReadBytes",
        )?,
        max_write_bytes: checked_usize_limit(
            policy.max_write_bytes,
            DEFAULT_WRITE_MAX_BYTES,
            HARD_FILE_MAX_BYTES,
            "native host maxWriteBytes",
        )?,
        max_process_output_bytes: checked_usize_limit(
            policy.max_process_output_bytes,
            DEFAULT_PROCESS_OUTPUT_MAX_BYTES,
            HARD_PROCESS_OUTPUT_MAX_BYTES,
            "native host maxProcessOutputBytes",
        )?,
        max_process_timeout_ms: checked_u64_limit(
            policy.max_process_timeout_ms,
            DEFAULT_PROCESS_TIMEOUT_MS,
            HARD_PROCESS_TIMEOUT_MS,
            "native host maxProcessTimeoutMs",
        )?,
    };
    state.host_policy = Some(host_policy);
    Ok(status(state))
}

fn issue_capability(
    state: &mut RuntimeState,
    grant: CapabilityGrant,
) -> Result<CapabilityLease, String> {
    let host_policy = state
        .host_policy
        .as_ref()
        .ok_or_else(|| "native host policy is not configured".to_string())?;
    let roots = canonicalize_roots(&grant.roots, "native capability")?;
    for root in &roots {
        if !starts_in_any_root(root, &host_policy.roots) {
            return Err(format!(
                "native capability root is outside host policy: {}",
                root.display()
            ));
        }
    }

    match grant.kind {
        CapabilityKind::ProcessSpawn => {
            if grant.programs.is_empty() {
                return Err(
                    "process.spawn capability requires a non-empty program allowlist".to_string(),
                );
            }
        }
        CapabilityKind::FilesystemRead | CapabilityKind::FilesystemWrite => {
            if !grant.programs.is_empty() {
                return Err("filesystem capability must not request process programs".to_string());
            }
        }
    }

    let programs = if grant.kind == CapabilityKind::ProcessSpawn {
        let mut programs = Vec::with_capacity(grant.programs.len());
        for raw in &grant.programs {
            let program = canonicalize_program(raw)?;
            if !program_allowed(&host_policy.programs, &program) {
                return Err(format!(
                    "native capability program is outside host policy: {}",
                    program.display()
                ));
            }
            programs.push(program);
        }
        programs
    } else {
        Vec::new()
    };

    let id = NEXT_CAPABILITY_ID.fetch_add(1, Ordering::Relaxed);
    let token = format!("cap-{id:016x}");
    let kind = grant.kind;
    state.capabilities.insert(
        token.clone(),
        CapabilityScope {
            kind,
            roots,
            programs,
        },
    );
    Ok(CapabilityLease { token, kind })
}

fn take_capability(
    state: &mut RuntimeState,
    token: &str,
    expected: CapabilityKind,
) -> Result<CapabilityScope, String> {
    // Capability lease 是一次性句柄：一旦进入执行路径就消费，避免同一授权被重复复用。
    let scope = state
        .capabilities
        .remove(token)
        .ok_or_else(|| "unknown, consumed, or expired native capability token".to_string())?;
    if scope.kind != expected {
        return Err(format!(
            "native capability kind mismatch: expected {:?}, got {:?}",
            expected, scope.kind
        ));
    }
    Ok(scope)
}

fn resolve_existing_path(scope: &CapabilityScope, raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("native path is empty".to_string());
    }
    let raw_path = Path::new(raw);
    let candidate = if raw_path.is_absolute() {
        raw_path.to_path_buf()
    } else {
        scope.roots[0].join(raw_path)
    };
    let canonical = fs::canonicalize(&candidate).map_err(|error| {
        format!(
            "cannot canonicalize target {}: {error}",
            candidate.display()
        )
    })?;
    if !starts_in_any_root(&canonical, &scope.roots) {
        return Err(format!(
            "native path is outside capability roots: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn resolve_write_path(
    scope: &CapabilityScope,
    raw: &str,
    create_parents: bool,
) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("native path is empty".to_string());
    }
    let raw_path = Path::new(raw);
    let candidate = normalize_lexical(&if raw_path.is_absolute() {
        raw_path.to_path_buf()
    } else {
        scope.roots[0].join(raw_path)
    });

    if candidate.exists() {
        let canonical = fs::canonicalize(&candidate).map_err(|error| {
            format!(
                "cannot canonicalize target {}: {error}",
                candidate.display()
            )
        })?;
        if !starts_in_any_root(&canonical, &scope.roots) {
            return Err(format!(
                "native path is outside capability roots: {}",
                canonical.display()
            ));
        }
        return Ok(canonical);
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| format!("native write target has no parent: {}", candidate.display()))?;
    if create_parents && !parent.exists() {
        // 先找到最近存在祖先做真实路径检查，确认没有经 symlink/junction 越界后才创建目录。
        let mut ancestor = parent;
        while !ancestor.exists() {
            ancestor = ancestor
                .parent()
                .ok_or_else(|| format!("cannot find existing ancestor for {}", parent.display()))?;
        }
        let canonical_ancestor = fs::canonicalize(ancestor).map_err(|error| {
            format!(
                "cannot canonicalize write ancestor {}: {error}",
                ancestor.display()
            )
        })?;
        if !starts_in_any_root(&canonical_ancestor, &scope.roots) {
            return Err(format!(
                "native write ancestor is outside capability roots: {}",
                canonical_ancestor.display()
            ));
        }
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "cannot create parent directories {}: {error}",
                parent.display()
            )
        })?;
    }

    let canonical_parent = fs::canonicalize(parent).map_err(|error| {
        format!(
            "cannot canonicalize write parent {}: {error}",
            parent.display()
        )
    })?;
    if !starts_in_any_root(&canonical_parent, &scope.roots) {
        return Err(format!(
            "native write parent is outside capability roots: {}",
            canonical_parent.display()
        ));
    }
    let name = candidate.file_name().ok_or_else(|| {
        format!(
            "native write target has no file name: {}",
            candidate.display()
        )
    })?;
    Ok(canonical_parent.join(name))
}

fn requested_usize_limit(
    requested: Option<usize>,
    policy_limit: usize,
    label: &str,
) -> Result<usize, String> {
    let value = requested.unwrap_or(policy_limit);
    if value == 0 {
        return Err(format!("{label} must be greater than zero"));
    }
    if value > policy_limit {
        return Err(format!("{label} exceeds host policy limit {policy_limit}"));
    }
    Ok(value)
}

fn requested_u64_limit(
    requested: Option<u64>,
    policy_limit: u64,
    label: &str,
) -> Result<u64, String> {
    let value = requested.unwrap_or(policy_limit);
    if value == 0 {
        return Err(format!("{label} must be greater than zero"));
    }
    if value > policy_limit {
        return Err(format!("{label} exceeds host policy limit {policy_limit}"));
    }
    Ok(value)
}

fn read_text(state: &mut RuntimeState, request: ReadTextRequest) -> Result<ReadTextResult, String> {
    let scope = take_capability(state, &request.token, CapabilityKind::FilesystemRead)?;
    let policy = state
        .host_policy
        .as_ref()
        .ok_or_else(|| "native host policy is not configured".to_string())?;
    let max_bytes = requested_usize_limit(
        request.max_bytes,
        policy.max_read_bytes,
        "native read maxBytes",
    )?;
    let path = resolve_existing_path(&scope, &request.path)?;
    if !path.is_file() {
        return Err(format!(
            "native read target is not a file: {}",
            path.display()
        ));
    }
    let file = fs::File::open(&path)
        .map_err(|error| format!("cannot open native read target {}: {error}", path.display()))?;
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("cannot read native target {}: {error}", path.display()))?;
    let truncated = bytes.len() > max_bytes;
    if truncated {
        bytes.truncate(max_bytes);
    }
    let content = String::from_utf8(bytes).map_err(|_| {
        format!(
            "native read target is not valid UTF-8 text: {}",
            path.display()
        )
    })?;
    Ok(ReadTextResult {
        path: path.display().to_string(),
        bytes: content.len(),
        content,
        truncated,
    })
}

fn write_text(
    state: &mut RuntimeState,
    request: WriteTextRequest,
) -> Result<WriteTextResult, String> {
    let scope = take_capability(state, &request.token, CapabilityKind::FilesystemWrite)?;
    let policy = state
        .host_policy
        .as_ref()
        .ok_or_else(|| "native host policy is not configured".to_string())?;
    let max_bytes = requested_usize_limit(
        request.max_bytes,
        policy.max_write_bytes,
        "native write maxBytes",
    )?;
    if request.content.len() > max_bytes {
        return Err(format!("native write content exceeds maxBytes {max_bytes}"));
    }
    let path = resolve_write_path(&scope, &request.path, request.create_parents)?;
    fs::write(&path, request.content.as_bytes())
        .map_err(|error| format!("cannot write native target {}: {error}", path.display()))?;
    Ok(WriteTextResult {
        path: path.display().to_string(),
        bytes: request.content.len(),
    })
}

fn read_limited<R: Read + Send + 'static>(
    reader: R,
    limit: usize,
) -> thread::JoinHandle<Result<(Vec<u8>, bool), String>> {
    thread::spawn(move || {
        let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
        reader
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("cannot read child output: {error}"))?;
        let truncated = bytes.len() > limit;
        if truncated {
            bytes.truncate(limit);
        }
        Ok((bytes, truncated))
    })
}

fn run_process(
    state: &mut RuntimeState,
    request: ProcessRunRequest,
) -> Result<ProcessRunResult, String> {
    let scope = take_capability(state, &request.token, CapabilityKind::ProcessSpawn)?;
    let policy = state
        .host_policy
        .as_ref()
        .ok_or_else(|| "native host policy is not configured".to_string())?;
    let program = canonicalize_program(&request.program)?;
    if !program_allowed(&scope.programs, &program) {
        return Err(format!(
            "native process program is not in capability allowlist: {}",
            program.display()
        ));
    }
    let cwd = resolve_existing_path(&scope, &request.cwd)?;
    if !cwd.is_dir() {
        return Err(format!(
            "native process cwd is not a directory: {}",
            cwd.display()
        ));
    }
    let timeout_ms = requested_u64_limit(
        request.timeout_ms,
        policy.max_process_timeout_ms,
        "native process timeoutMs",
    )?;
    let max_output = requested_usize_limit(
        request.max_output_bytes,
        policy.max_process_output_bytes,
        "native process maxOutputBytes",
    )?;

    // 禁止 shell=true 或命令字符串拼接：program/argv 分开传入，降低注入面。
    let mut child = Command::new(&program)
        .args(&request.args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cannot spawn native process {}: {error}", program.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "native process stdout pipe missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "native process stderr pipe missing".to_string())?;
    let stdout_reader = read_limited(stdout, max_output);
    let stderr_reader = read_limited(stderr, max_output);

    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child
            .try_wait()
            .map_err(|error| format!("cannot wait native process: {error}"))?
        {
            Some(status) => break status,
            None if started.elapsed() >= Duration::from_millis(timeout_ms) => {
                timed_out = true;
                child
                    .kill()
                    .map_err(|error| format!("cannot kill timed-out native process: {error}"))?;
                break child
                    .wait()
                    .map_err(|error| format!("cannot reap timed-out native process: {error}"))?;
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };

    let (stdout_bytes, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| "native stdout reader thread panicked".to_string())??;
    let (stderr_bytes, stderr_truncated) = stderr_reader
        .join()
        .map_err(|_| "native stderr reader thread panicked".to_string())??;
    let stdout = String::from_utf8_lossy(&stdout_bytes).into_owned();
    let stderr = String::from_utf8_lossy(&stderr_bytes).into_owned();

    Ok(ProcessRunResult {
        program: program.display().to_string(),
        cwd: cwd.display().to_string(),
        exit_code: status.code(),
        success: status.success() && !timed_out,
        timed_out,
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
    })
}

fn handle(request: JsonRpcRequest, state: &mut RuntimeState) -> JsonRpcResponse {
    let result: Result<Value, String> = match request.method.as_str() {
        "initialize" => decode::<NativeHostPolicy>(request.params)
            .and_then(|policy| configure_policy(state, policy))
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "runtime/status" => serde_json::to_value(status(state)).map_err(|error| error.to_string()),
        "capability/issue" => decode::<CapabilityGrant>(request.params)
            .and_then(|grant| issue_capability(state, grant))
            .and_then(|lease| serde_json::to_value(lease).map_err(|error| error.to_string())),
        "fs/read_text" => decode::<ReadTextRequest>(request.params)
            .and_then(|params| read_text(state, params))
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "fs/write_text" => decode::<WriteTextRequest>(request.params)
            .and_then(|params| write_text(state, params))
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
        "process/run" => decode::<ProcessRunRequest>(request.params)
            .and_then(|params| run_process(state, params))
            .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string())),
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
    let mut state = RuntimeState::default();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(request) => handle(request, &mut state),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("xma-native-{name}-{suffix}"));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn configure_for_root(state: &mut RuntimeState, root: &Path, programs: Vec<String>) {
        configure_policy(
            state,
            NativeHostPolicy {
                roots: vec![root.display().to_string()],
                programs,
                max_read_bytes: Some(4096),
                max_write_bytes: Some(4096),
                max_process_output_bytes: Some(4096),
                max_process_timeout_ms: Some(1000),
            },
        )
        .expect("configure host policy");
    }

    #[test]
    fn runtime_fails_closed_until_host_policy_is_configured() {
        let root = temp_root("unconfigured");
        let mut state = RuntimeState::default();
        assert!(!status(&state).ready);
        let denied = issue_capability(
            &mut state,
            CapabilityGrant {
                kind: CapabilityKind::FilesystemRead,
                roots: vec![root.display().to_string()],
                programs: vec![],
            },
        );
        assert!(denied.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn capability_cannot_escalate_beyond_host_policy() {
        let root = temp_root("policy-root");
        let outside = temp_root("policy-outside");
        let mut state = RuntimeState::default();
        let allowed_program = std::env::current_exe()
            .expect("current executable")
            .display()
            .to_string();
        configure_for_root(&mut state, &root, vec![allowed_program]);
        fs::write(outside.join("not-allowed.exe"), "fixture")
            .expect("write outside program fixture");

        let outside_root = issue_capability(
            &mut state,
            CapabilityGrant {
                kind: CapabilityKind::FilesystemRead,
                roots: vec![outside.display().to_string()],
                programs: vec![],
            },
        );
        assert!(outside_root.is_err());

        let outside_program = issue_capability(
            &mut state,
            CapabilityGrant {
                kind: CapabilityKind::ProcessSpawn,
                roots: vec![root.display().to_string()],
                programs: vec![outside.join("not-allowed.exe").display().to_string()],
            },
        );
        assert!(outside_program.is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn filesystem_capability_rejects_traversal_and_keeps_read_write_in_root() {
        let root = temp_root("fs");
        let outside = root.parent().expect("parent").join("outside-xma.txt");
        fs::write(root.join("inside.txt"), "hello").expect("write fixture");
        fs::write(&outside, "outside").expect("write outside fixture");
        let mut state = RuntimeState::default();
        configure_for_root(&mut state, &root, vec![]);

        let read = issue_capability(
            &mut state,
            CapabilityGrant {
                kind: CapabilityKind::FilesystemRead,
                roots: vec![root.display().to_string()],
                programs: vec![],
            },
        )
        .expect("issue read");
        let value = read_text(
            &mut state,
            ReadTextRequest {
                token: read.token.clone(),
                path: "inside.txt".to_string(),
                max_bytes: Some(32),
            },
        )
        .expect("read inside");
        assert_eq!(value.content, "hello");

        // 同一个 lease 已被消费，不能重放第二次文件读取。
        let reused = read_text(
            &mut state,
            ReadTextRequest {
                token: read.token,
                path: "inside.txt".to_string(),
                max_bytes: Some(32),
            },
        );
        assert!(reused.is_err());

        let escaped_lease = issue_capability(
            &mut state,
            CapabilityGrant {
                kind: CapabilityKind::FilesystemRead,
                roots: vec![root.display().to_string()],
                programs: vec![],
            },
        )
        .expect("issue read 2");
        let escaped = read_text(
            &mut state,
            ReadTextRequest {
                token: escaped_lease.token,
                path: "../outside-xma.txt".to_string(),
                max_bytes: Some(32),
            },
        );
        assert!(escaped.is_err());

        let write = issue_capability(
            &mut state,
            CapabilityGrant {
                kind: CapabilityKind::FilesystemWrite,
                roots: vec![root.display().to_string()],
                programs: vec![],
            },
        )
        .expect("issue write");
        write_text(
            &mut state,
            WriteTextRequest {
                token: write.token,
                path: "nested/new.txt".to_string(),
                content: "written".to_string(),
                create_parents: true,
                max_bytes: Some(32),
            },
        )
        .expect("write inside");
        assert_eq!(
            fs::read_to_string(root.join("nested/new.txt")).expect("read back"),
            "written"
        );
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn filesystem_capability_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = temp_root("symlink-root");
        let outside = temp_root("symlink-outside");
        fs::write(outside.join("secret.txt"), "outside").expect("write outside fixture");
        symlink(&outside, root.join("escape")).expect("create symlink");

        let mut state = RuntimeState::default();
        configure_for_root(&mut state, &root, vec![]);
        let lease = issue_capability(
            &mut state,
            CapabilityGrant {
                kind: CapabilityKind::FilesystemRead,
                roots: vec![root.display().to_string()],
                programs: vec![],
            },
        )
        .expect("issue read");
        let escaped = read_text(
            &mut state,
            ReadTextRequest {
                token: lease.token,
                path: "escape/secret.txt".to_string(),
                max_bytes: Some(32),
            },
        );
        assert!(escaped.is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn host_policy_rejects_relative_program_identity() {
        let root = temp_root("relative-program");
        let mut state = RuntimeState::default();
        let result = configure_policy(
            &mut state,
            NativeHostPolicy {
                roots: vec![root.display().to_string()],
                programs: vec!["git.exe".to_string()],
                max_read_bytes: Some(4096),
                max_write_bytes: Some(4096),
                max_process_output_bytes: Some(4096),
                max_process_timeout_ms: Some(1000),
            },
        );
        assert!(result.is_err());
        assert!(!status(&state).ready);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn process_capability_runs_only_the_exact_canonical_program() {
        let root = temp_root("process-exact");
        let mut state = RuntimeState::default();
        let allowed_program = std::env::current_exe()
            .expect("current executable")
            .display()
            .to_string();
        configure_for_root(&mut state, &root, vec![allowed_program.clone()]);
        let lease = issue_capability(
            &mut state,
            CapabilityGrant {
                kind: CapabilityKind::ProcessSpawn,
                roots: vec![root.display().to_string()],
                programs: vec![allowed_program.clone()],
            },
        )
        .expect("issue process");
        let result = run_process(
            &mut state,
            ProcessRunRequest {
                token: lease.token,
                program: allowed_program,
                args: vec!["--list".to_string()],
                cwd: root.display().to_string(),
                timeout_ms: Some(1000),
                max_output_bytes: Some(4096),
            },
        )
        .expect("run exact program");
        assert!(result.success);
        assert!(!result.timed_out);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn process_capability_rejects_program_outside_allowlist() {
        let root = temp_root("process");
        let mut state = RuntimeState::default();
        let allowed_program = std::env::current_exe()
            .expect("current executable")
            .display()
            .to_string();
        configure_for_root(&mut state, &root, vec![allowed_program.clone()]);
        let lease = issue_capability(
            &mut state,
            CapabilityGrant {
                kind: CapabilityKind::ProcessSpawn,
                roots: vec![root.display().to_string()],
                programs: vec![allowed_program],
            },
        )
        .expect("issue process");
        let denied = run_process(
            &mut state,
            ProcessRunRequest {
                token: lease.token,
                program: root.display().to_string(),
                args: vec![],
                cwd: root.display().to_string(),
                timeout_ms: Some(100),
                max_output_bytes: Some(1024),
            },
        );
        assert!(denied.is_err());
        let _ = fs::remove_dir_all(root);
    }
}
