use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const LOG_RETENTION_FILES: usize = 30;
const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
const MAX_FIELD_CHARS: usize = 1_200;
const MAX_DETAILS_CHARS: usize = 8_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogEntry {
    level: String,
    scope: String,
    event: String,
    message: Option<String>,
    details: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDirectory {
    path: String,
}

fn unix_days_to_ymd(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as i32, m as u32, d as u32)
}

fn current_utc_parts() -> (String, String) {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = unix_days_to_ymd(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    (
        format!("{year:04}-{month:02}-{day:02}"),
        format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"),
    )
}

fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("logs"))
        .map_err(|error| format!("解析日志目录失败: {error}"))
}

fn clamp_string(value: &str, limit: usize) -> String {
    let mut output = String::new();
    for ch in value.chars().take(limit) {
        output.push(ch);
    }
    if value.chars().count() > limit {
        output.push_str("...");
    }
    output
}

fn normalize_level(level: &str) -> &'static str {
    match level {
        "debug" => "debug",
        "warn" => "warn",
        "error" => "error",
        _ => "info",
    }
}

fn append_detail_parts(prefix: &str, value: &Value, parts: &mut Vec<String>) {
    match value {
        Value::Null => parts.push(format!("{prefix}=null")),
        Value::Bool(value) => parts.push(format!("{prefix}={value}")),
        Value::Number(value) => parts.push(format!("{prefix}={value}")),
        Value::String(value) => parts.push(format!("{prefix}=\"{}\"", escape_log_text(value))),
        Value::Array(values) => {
            if values.is_empty() {
                parts.push(format!("{prefix}=[]"));
                return;
            }
            for (index, item) in values.iter().enumerate() {
                append_detail_parts(&format!("{prefix}[{index}]"), item, parts);
            }
        }
        Value::Object(map) => {
            if map.is_empty() {
                parts.push(format!("{prefix}={{}}"));
                return;
            }
            for (key, item) in map {
                let next_prefix = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                append_detail_parts(&next_prefix, item, parts);
            }
        }
    }
}

fn format_details(details: Option<Value>) -> Option<String> {
    let details = details?;
    let mut parts = Vec::new();
    append_detail_parts("", &details, &mut parts);
    let details_text = parts.join(" ");
    if details_text.is_empty() {
        return None;
    }
    Some(clamp_string(&details_text, MAX_DETAILS_CHARS))
}

fn escape_log_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
        .replace('"', "\\\"")
}

fn format_log_line(
    timestamp: &str,
    level: &str,
    scope: &str,
    event: &str,
    message: Option<&str>,
    details: Option<Value>,
) -> String {
    let normalized_level = normalize_level(level).to_uppercase();
    let mut line = format!(
        "{} {:<5} [{}] {}",
        timestamp,
        normalized_level,
        clamp_string(scope, MAX_FIELD_CHARS),
        clamp_string(event, MAX_FIELD_CHARS),
    );

    if let Some(message) = message.filter(|value| !value.trim().is_empty()) {
        line.push_str(" - ");
        line.push_str(&escape_log_text(&clamp_string(message, MAX_FIELD_CHARS)));
    }

    if let Some(details_text) = format_details(details) {
        line.push_str(" | ");
        line.push_str(&details_text);
    }

    line
}

fn log_file_path(dir: &Path) -> PathBuf {
    let (date, _) = current_utc_parts();
    dir.join(format!("magpie-{date}.log"))
}

fn cleanup_old_logs(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    let mut files = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?.to_string();
            if name.starts_with("magpie-") && name.ends_with(".log") {
                Some((name, path))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    files.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in files.into_iter().skip(LOG_RETENTION_FILES) {
        let _ = fs::remove_file(path);
    }
}

fn append_log(app: &AppHandle, entry: AppLogEntry) -> Result<(), String> {
    let dir = log_dir(app)?;
    fs::create_dir_all(&dir).map_err(|error| format!("创建日志目录失败: {error}"))?;
    cleanup_old_logs(&dir);

    let path = log_file_path(&dir);
    let should_truncate = fs::metadata(&path)
        .map(|metadata| metadata.len() > LOG_MAX_BYTES)
        .unwrap_or(false);

    let (_, timestamp) = current_utc_parts();
    let record = format_log_line(
        &timestamp,
        &entry.level,
        &entry.scope,
        &entry.event,
        entry.message.as_deref(),
        entry.details,
    );

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(!should_truncate)
        .truncate(should_truncate)
        .open(&path)
        .map_err(|error| format!("打开日志文件失败: {error}"))?;

    if should_truncate {
        let truncate_record = format_log_line(
            &timestamp,
            "warn",
            "native.logger",
            "log.truncated",
            Some("日志文件超过大小限制，已从当前记录重新开始。"),
            None,
        );
        writeln!(file, "{truncate_record}")
            .map_err(|error| format!("写入日志截断记录失败: {error}"))?;
    }

    writeln!(file, "{record}").map_err(|error| format!("写入日志失败: {error}"))
}

pub fn append_native_startup_log(app: &AppHandle) {
    let _ = append_log(
        app,
        AppLogEntry {
            level: "info".to_string(),
            scope: "native".to_string(),
            event: "app.native_startup".to_string(),
            message: Some("Native shell started.".to_string()),
            details: None,
        },
    );
}

#[tauri::command]
pub fn append_app_log(app: AppHandle, entry: AppLogEntry) -> Result<(), String> {
    append_log(&app, entry)
}

#[tauri::command]
pub fn get_app_log_directory(app: AppHandle) -> Result<AppDirectory, String> {
    let dir = log_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|error| format!("创建日志目录失败: {error}"))?;
    Ok(AppDirectory {
        path: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn reveal_app_data_directory(app: AppHandle) -> Result<AppDirectory, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("解析应用数据目录失败: {error}"))?;
    fs::create_dir_all(&path).map_err(|error| format!("创建应用数据目录失败: {error}"))?;
    fs::create_dir_all(path.join("logs")).map_err(|error| format!("创建日志目录失败: {error}"))?;

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(&path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&path);
        command
    };

    command
        .spawn()
        .map_err(|error| format!("打开应用数据目录失败: {error}"))?;

    Ok(AppDirectory {
        path: path.to_string_lossy().to_string(),
    })
}
