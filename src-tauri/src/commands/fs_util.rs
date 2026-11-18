use std::fs;
use std::io::Write;
use std::path::Path;
use tauri::AppHandle;

#[cfg(mobile)]
use tauri_plugin_fs::{FsExt, OpenOptions as PluginOpenOptions};

fn is_uri_path(path: &str) -> bool {
    path.starts_with("content:") || path.starts_with("file:") || path.starts_with("asset:")
}

#[cfg(mobile)]
fn to_plugin_path(path: &str) -> tauri_plugin_fs::FilePath {
    path.parse().unwrap()
}

fn read_bytes(app: &AppHandle, path: &str) -> Result<Vec<u8>, String> {
    #[cfg(mobile)]
    {
        if is_uri_path(path) {
            return app.fs().read(to_plugin_path(path)).map_err(|e| e.to_string());
        }
        return fs::read(path).map_err(|e| e.to_string());
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        fs::read(path).map_err(|e| e.to_string())
    }
}

fn write_bytes(app: &AppHandle, path: &str, bytes: &[u8], append: bool) -> Result<(), String> {
    #[cfg(mobile)]
    {
        if is_uri_path(path) {
            let payload = if append {
                let mut existing = app.fs().read(to_plugin_path(path)).unwrap_or_default();
                existing.extend_from_slice(bytes);
                existing
            } else {
                bytes.to_vec()
            };
            let mut options = PluginOpenOptions::new();
            options.write(true).create(true).truncate(true);
            let mut file = app
                .fs()
                .open(to_plugin_path(path), options)
                .map_err(|e| e.to_string())?;
            file.write_all(&payload).map_err(|e| e.to_string())?;
            return Ok(());
        }
        return write_path(path, bytes, append);
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        write_path(path, bytes, append)
    }
}

fn write_path(path: &str, bytes: &[u8], append: bool) -> Result<(), String> {
    if append {
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut file| file.write_all(bytes))
            .map_err(|e| e.to_string())
    } else {
        fs::write(path, bytes).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_write_file(
    app: AppHandle,
    path: String,
    content: serde_json::Value,
    is_binary: bool,
    append: Option<bool>,
) -> Result<(), String> {
    let append = append.unwrap_or(false);
    if is_binary {
        if let Some(arr) = content.as_array() {
            let bytes: Vec<u8> = arr.iter().filter_map(|v| v.as_u64().map(|n| n as u8)).collect();
            return write_bytes(&app, &path, &bytes, append);
        }
    }
    if let Some(s) = content.as_str() {
        return write_bytes(&app, &path, s.as_bytes(), append);
    }
    Err("Invalid content format".to_string())
}

#[tauri::command]
pub fn fs_read_file(
    app: AppHandle,
    path: String,
    encoding: Option<String>,
) -> Result<serde_json::Value, String> {
    let bytes = read_bytes(&app, &path)?;
    if encoding.is_some() {
        let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
        return Ok(serde_json::Value::String(text));
    }
    let json_bytes: Vec<serde_json::Value> = bytes.into_iter().map(serde_json::Value::from).collect();
    Ok(serde_json::Value::Array(json_bytes))
}

#[tauri::command]
pub fn fs_is_file(path: String) -> bool {
    if is_uri_path(&path) {
        return true;
    }
    Path::new(&path).is_file()
}

/// 批量读取文件字节数。不存在或不可读的路径返回 null，不中断其余结果。
#[tauri::command]
pub fn fs_file_sizes(paths: Vec<String>) -> Vec<Option<u64>> {
    paths
        .into_iter()
        .map(|path| fs::metadata(path).ok().filter(|meta| meta.is_file()).map(|meta| meta.len()))
        .collect()
}

#[tauri::command]
pub fn fs_is_folder(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
pub fn fs_remove(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else if p.is_file() {
        fs::remove_file(p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn fs_mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_copy_file(app: AppHandle, src: String, dest: String) -> Result<(), String> {
    if is_uri_path(&src) || is_uri_path(&dest) {
        let bytes = read_bytes(&app, &src)?;
        return write_bytes(&app, &dest, &bytes, false);
    }
    fs::copy(src, dest).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read_dir(path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        if let Ok(name) = entry.file_name().into_string() {
            names.push(name);
        }
    }
    Ok(names)
}

#[tauri::command]
pub fn fs_rename(src: String, dest: String) -> Result<(), String> {
    fs::rename(src, dest).map_err(|e| e.to_string())
}
