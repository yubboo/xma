//! 文件作用：实现 XMA Native Runtime 的 OS Credentials 后端，统一封装 Windows Credential Manager、macOS Keychain 与 Linux Secret Service。
//! 关联模块：native/protocol、native/runtime/main.rs、core/src/native.ts、Provider Credentials Service。
//! 当前实现：稳定别名校验、系统凭据库状态探测、Secret 读/写/删；Linux 仅在系统存在 `secret-tool` 时启用。
//! 职责边界：本模块只做本机 Secret 存储，不解释 Provider/Profile 业务；Secret 不写日志、不写文件，也不允许调用方指定任意系统 service 名称。

use xma_native_protocol::{
    CredentialDeleteResult, CredentialReadResult, CredentialStoreStatus, CredentialWriteResult,
};

const SERVICE_NAME: &str = "Xiaoyu Management Agent";
// Windows Credential Manager 的 CRED_MAX_CREDENTIAL_BLOB_SIZE 为 5*512；取三平台共同上限，避免 Host 语义随平台漂移。
const MAX_SECRET_BYTES: usize = 5 * 512;

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 128 {
        return Err("native credential key must contain 1..128 bytes".to_string());
    }
    if !key
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
    {
        return Err("native credential key contains unsupported characters".to_string());
    }
    Ok(())
}

fn validate_secret(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err("native credential value must not be empty".to_string());
    }
    if value.len() > MAX_SECRET_BYTES {
        return Err(format!(
            "native credential value exceeds hard limit {MAX_SECRET_BYTES}"
        ));
    }
    Ok(())
}

pub fn status() -> CredentialStoreStatus {
    platform::status()
}

pub fn read(key: &str) -> Result<CredentialReadResult, String> {
    validate_key(key)?;
    let result = platform::read(key)?;
    if result.found {
        let value = result.value.as_deref().ok_or_else(|| {
            "native credential backend returned found=true without a value".to_string()
        })?;
        validate_secret(value)?;
    }
    Ok(result)
}

pub fn write(key: &str, value: &str) -> Result<CredentialWriteResult, String> {
    validate_key(key)?;
    validate_secret(value)?;
    platform::write(key, value)
}

pub fn delete(key: &str) -> Result<CredentialDeleteResult, String> {
    validate_key(key)?;
    platform::delete(key)
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::ptr;
    use std::slice;

    const CRED_TYPE_GENERIC: u32 = 1;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
    const ERROR_NOT_FOUND: i32 = 1168;

    #[repr(C)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        credential_type: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        credential_blob_size: u32,
        credential_blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "Advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredReadW(
            target_name: *const u16,
            credential_type: u32,
            flags: u32,
            credential: *mut *mut CredentialW,
        ) -> i32;
        fn CredDeleteW(target_name: *const u16, credential_type: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn target(key: &str) -> Vec<u16> {
        wide(&format!("XMA/{key}"))
    }

    fn last_error(label: &str) -> String {
        format!("{label}: {}", std::io::Error::last_os_error())
    }

    pub fn status() -> CredentialStoreStatus {
        CredentialStoreStatus {
            backend: "windows-credential-manager".to_string(),
            available: true,
            detail: None,
        }
    }

    pub fn read(key: &str) -> Result<CredentialReadResult, String> {
        let target_name = target(key);
        let mut raw: *mut CredentialW = ptr::null_mut();
        let ok = unsafe {
            CredReadW(
                target_name.as_ptr(),
                CRED_TYPE_GENERIC,
                0,
                &mut raw as *mut *mut CredentialW,
            )
        };
        if ok == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NOT_FOUND) {
                return Ok(CredentialReadResult {
                    found: false,
                    value: None,
                });
            }
            return Err(format!("cannot read Windows credential: {error}"));
        }
        if raw.is_null() {
            return Err("Windows Credential Manager returned a null credential".to_string());
        }

        let result = unsafe {
            let credential = &*raw;
            let bytes = if credential.credential_blob_size == 0 {
                Vec::new()
            } else {
                slice::from_raw_parts(
                    credential.credential_blob as *const u8,
                    credential.credential_blob_size as usize,
                )
                .to_vec()
            };
            CredFree(raw as *mut c_void);
            String::from_utf8(bytes)
                .map_err(|_| "Windows credential is not valid UTF-8".to_string())
        }?;

        Ok(CredentialReadResult {
            found: true,
            value: Some(result),
        })
    }

    pub fn write(key: &str, value: &str) -> Result<CredentialWriteResult, String> {
        let mut target_name = target(key);
        let mut username = wide("xiaoyu");
        let mut secret = value.as_bytes().to_vec();
        let credential = CredentialW {
            flags: 0,
            credential_type: CRED_TYPE_GENERIC,
            target_name: target_name.as_mut_ptr(),
            comment: ptr::null_mut(),
            last_written: FileTime {
                low_date_time: 0,
                high_date_time: 0,
            },
            credential_blob_size: secret.len() as u32,
            credential_blob: secret.as_mut_ptr(),
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: ptr::null_mut(),
            target_alias: ptr::null_mut(),
            user_name: username.as_mut_ptr(),
        };
        let ok = unsafe { CredWriteW(&credential, 0) };
        secret.fill(0);
        if ok == 0 {
            return Err(last_error("cannot write Windows credential"));
        }
        Ok(CredentialWriteResult { stored: true })
    }

    pub fn delete(key: &str) -> Result<CredentialDeleteResult, String> {
        let target_name = target(key);
        let ok = unsafe { CredDeleteW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NOT_FOUND) {
                return Ok(CredentialDeleteResult { deleted: false });
            }
            return Err(format!("cannot delete Windows credential: {error}"));
        }
        Ok(CredentialDeleteResult { deleted: true })
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::ffi::{c_char, c_void};
    use std::ptr;
    use std::slice;

    const ERR_SEC_SUCCESS: i32 = 0;
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainFindGenericPassword(
            keychain_or_array: *const c_void,
            service_name_length: u32,
            service_name: *const c_char,
            account_name_length: u32,
            account_name: *const c_char,
            password_length: *mut u32,
            password_data: *mut *mut c_void,
            item_ref: *mut *mut c_void,
        ) -> i32;
        fn SecKeychainAddGenericPassword(
            keychain: *mut c_void,
            service_name_length: u32,
            service_name: *const c_char,
            account_name_length: u32,
            account_name: *const c_char,
            password_length: u32,
            password_data: *const c_void,
            item_ref: *mut *mut c_void,
        ) -> i32;
        fn SecKeychainItemModifyAttributesAndData(
            item_ref: *mut c_void,
            attr_list: *const c_void,
            length: u32,
            data: *const c_void,
        ) -> i32;
        fn SecKeychainItemDelete(item_ref: *mut c_void) -> i32;
        fn SecKeychainItemFreeContent(attr_list: *mut c_void, data: *mut c_void) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(value: *const c_void);
    }

    fn os_error(label: &str, status: i32) -> String {
        format!("{label} failed with OSStatus {status}")
    }

    pub fn status() -> CredentialStoreStatus {
        CredentialStoreStatus {
            backend: "macos-keychain".to_string(),
            available: true,
            detail: None,
        }
    }

    pub fn read(key: &str) -> Result<CredentialReadResult, String> {
        let service = SERVICE_NAME.as_bytes();
        let account = key.as_bytes();
        let mut password_length = 0u32;
        let mut password_data: *mut c_void = ptr::null_mut();
        let mut item_ref: *mut c_void = ptr::null_mut();
        let status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null(),
                service.len() as u32,
                service.as_ptr() as *const c_char,
                account.len() as u32,
                account.as_ptr() as *const c_char,
                &mut password_length,
                &mut password_data,
                &mut item_ref,
            )
        };
        if status == ERR_SEC_ITEM_NOT_FOUND {
            return Ok(CredentialReadResult {
                found: false,
                value: None,
            });
        }
        if status != ERR_SEC_SUCCESS {
            return Err(os_error("cannot read macOS keychain credential", status));
        }

        let bytes = unsafe {
            if password_length == 0 {
                Vec::new()
            } else {
                slice::from_raw_parts(password_data as *const u8, password_length as usize).to_vec()
            }
        };
        unsafe {
            if !password_data.is_null() {
                let _ = SecKeychainItemFreeContent(ptr::null_mut(), password_data);
            }
            if !item_ref.is_null() {
                CFRelease(item_ref as *const c_void);
            }
        }
        let value = String::from_utf8(bytes)
            .map_err(|_| "macOS keychain credential is not valid UTF-8".to_string())?;
        Ok(CredentialReadResult {
            found: true,
            value: Some(value),
        })
    }

    pub fn write(key: &str, value: &str) -> Result<CredentialWriteResult, String> {
        let service = SERVICE_NAME.as_bytes();
        let account = key.as_bytes();
        let secret = value.as_bytes();
        let mut item_ref: *mut c_void = ptr::null_mut();
        let find_status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null(),
                service.len() as u32,
                service.as_ptr() as *const c_char,
                account.len() as u32,
                account.as_ptr() as *const c_char,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut item_ref,
            )
        };

        let status = if find_status == ERR_SEC_SUCCESS {
            let result = unsafe {
                SecKeychainItemModifyAttributesAndData(
                    item_ref,
                    ptr::null(),
                    secret.len() as u32,
                    secret.as_ptr() as *const c_void,
                )
            };
            unsafe {
                if !item_ref.is_null() {
                    CFRelease(item_ref as *const c_void);
                }
            }
            result
        } else if find_status == ERR_SEC_ITEM_NOT_FOUND {
            unsafe {
                SecKeychainAddGenericPassword(
                    ptr::null_mut(),
                    service.len() as u32,
                    service.as_ptr() as *const c_char,
                    account.len() as u32,
                    account.as_ptr() as *const c_char,
                    secret.len() as u32,
                    secret.as_ptr() as *const c_void,
                    ptr::null_mut(),
                )
            }
        } else {
            return Err(os_error(
                "cannot inspect macOS keychain credential before write",
                find_status,
            ));
        };

        if status != ERR_SEC_SUCCESS {
            return Err(os_error("cannot write macOS keychain credential", status));
        }
        Ok(CredentialWriteResult { stored: true })
    }

    pub fn delete(key: &str) -> Result<CredentialDeleteResult, String> {
        let service = SERVICE_NAME.as_bytes();
        let account = key.as_bytes();
        let mut item_ref: *mut c_void = ptr::null_mut();
        let find_status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null(),
                service.len() as u32,
                service.as_ptr() as *const c_char,
                account.len() as u32,
                account.as_ptr() as *const c_char,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut item_ref,
            )
        };
        if find_status == ERR_SEC_ITEM_NOT_FOUND {
            return Ok(CredentialDeleteResult { deleted: false });
        }
        if find_status != ERR_SEC_SUCCESS {
            return Err(os_error(
                "cannot find macOS keychain credential",
                find_status,
            ));
        }
        let delete_status = unsafe { SecKeychainItemDelete(item_ref) };
        unsafe {
            if !item_ref.is_null() {
                CFRelease(item_ref as *const c_void);
            }
        }
        if delete_status != ERR_SEC_SUCCESS {
            return Err(os_error(
                "cannot delete macOS keychain credential",
                delete_status,
            ));
        }
        Ok(CredentialDeleteResult { deleted: true })
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    fn secret_tool() -> Option<PathBuf> {
        ["/usr/bin/secret-tool", "/bin/secret-tool"]
            .iter()
            .map(PathBuf::from)
            .find(|path| path.is_file())
    }

    fn unavailable() -> String {
        "Linux OS Credentials 需要系统 Secret Service 与 secret-tool；当前未找到 /usr/bin/secret-tool 或 /bin/secret-tool。".to_string()
    }

    fn command(path: &Path, action: &str, key: &str) -> Command {
        let mut command = Command::new(path);
        command.arg(action);
        if action == "store" {
            command.arg(format!("--label={SERVICE_NAME}"));
        }
        command.args(["application", "xiaoyu", "credential", key]);
        command
    }

    pub fn status() -> CredentialStoreStatus {
        match secret_tool() {
            Some(path) => CredentialStoreStatus {
                backend: "linux-secret-service".to_string(),
                available: true,
                detail: Some(path.display().to_string()),
            },
            None => CredentialStoreStatus {
                backend: "linux-secret-service".to_string(),
                available: false,
                detail: Some(unavailable()),
            },
        }
    }

    pub fn read(key: &str) -> Result<CredentialReadResult, String> {
        let path = secret_tool().ok_or_else(unavailable)?;
        let output = command(&path, "lookup", key)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("cannot run Linux secret-tool lookup: {error}"))?;
        if !output.status.success() {
            if output.status.code() == Some(1) && output.stdout.is_empty() {
                return Ok(CredentialReadResult {
                    found: false,
                    value: None,
                });
            }
            return Err(format!(
                "Linux secret-tool lookup failed with exit code {}",
                output
                    .status
                    .code()
                    .map_or_else(|| "signal".to_string(), |code| code.to_string())
            ));
        }
        let mut bytes = output.stdout;
        while bytes
            .last()
            .is_some_and(|byte| matches!(*byte, b'\n' | b'\r'))
        {
            bytes.pop();
        }
        let value = String::from_utf8(bytes)
            .map_err(|_| "Linux Secret Service returned a non-UTF-8 credential".to_string())?;
        Ok(CredentialReadResult {
            found: true,
            value: Some(value),
        })
    }

    pub fn write(key: &str, value: &str) -> Result<CredentialWriteResult, String> {
        let path = secret_tool().ok_or_else(unavailable)?;
        let mut child = command(&path, "store", key)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("cannot run Linux secret-tool store: {error}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(value.as_bytes()).map_err(|error| {
                format!("cannot send credential to Linux Secret Service: {error}")
            })?;
        }
        let output = child
            .wait_with_output()
            .map_err(|error| format!("cannot wait Linux secret-tool store: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Linux secret-tool store failed with exit code {}",
                output
                    .status
                    .code()
                    .map_or_else(|| "signal".to_string(), |code| code.to_string())
            ));
        }
        Ok(CredentialWriteResult { stored: true })
    }

    pub fn delete(key: &str) -> Result<CredentialDeleteResult, String> {
        let path = secret_tool().ok_or_else(unavailable)?;
        let output = command(&path, "clear", key)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("cannot run Linux secret-tool clear: {error}"))?;
        if output.status.success() {
            return Ok(CredentialDeleteResult { deleted: true });
        }
        if output.status.code() == Some(1) {
            return Ok(CredentialDeleteResult { deleted: false });
        }
        Err(format!(
            "Linux secret-tool clear failed with exit code {}",
            output.status.code().map_or_else(|| "signal".to_string(), |code| code.to_string())
        ))
    }
}

#[cfg(all(not(windows), not(target_os = "macos"), not(target_os = "linux")))]
mod platform {
    use super::*;

    fn unavailable() -> String {
        "OS Credentials backend is not implemented for this platform".to_string()
    }

    pub fn status() -> CredentialStoreStatus {
        CredentialStoreStatus {
            backend: "unavailable".to_string(),
            available: false,
            detail: Some(unavailable()),
        }
    }

    pub fn read(_key: &str) -> Result<CredentialReadResult, String> {
        Err(unavailable())
    }

    pub fn write(_key: &str, _value: &str) -> Result<CredentialWriteResult, String> {
        Err(unavailable())
    }

    pub fn delete(_key: &str) -> Result<CredentialDeleteResult, String> {
        Err(unavailable())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_keys_are_strict_and_secret_has_a_hard_limit() {
        assert!(validate_key("provider:demo.api-key").is_ok());
        assert!(validate_key("../bad").is_err());
        assert!(validate_key("").is_err());
        assert!(validate_secret("secret").is_ok());
        assert!(validate_secret("").is_err());
        assert!(validate_secret(&"x".repeat(MAX_SECRET_BYTES + 1)).is_err());
    }
}
