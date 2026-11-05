use tauri::{AppHandle, LogicalSize, Manager, WebviewWindow};

const MINIMODE_WIDTH: f64 = 408.0;
const MINIMODE_HEIGHT: f64 = 148.0;

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

/// 一键更新的安装包暂存路径。
#[tauri::command]
pub fn app_update_installer_path(version: String) -> Result<String, String> {
    let safe: String = version
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
        .collect();
    if safe.is_empty() {
        return Err("版本号无效".to_string());
    }
    let mut path = std::env::temp_dir();
    path.push(format!("FreeMusicOnline-{safe}-setup.exe"));
    Ok(path.to_string_lossy().to_string())
}

fn installer_is_exe(path: &std::path::Path) -> bool {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut header = [0u8; 2];
    std::io::Read::read_exact(&mut file, &mut header).is_ok() && &header == b"MZ"
}

#[tauri::command]
pub fn app_update_installer_valid(installer_path: String) -> bool {
    installer_is_exe(std::path::Path::new(&installer_path))
}

/// 退出当前程序后静默安装，再把新版本拉起来。
#[tauri::command]
pub fn apply_app_update(app: AppHandle, installer_path: String) -> Result<(), String> {
    let installer = std::path::PathBuf::from(&installer_path);
    if !installer_is_exe(&installer) {
        return Err("安装包不存在".to_string());
    }
    let extension = installer
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "exe" {
        return Err("只能安装 exe 安装包".to_string());
    }
    let current = std::env::current_exe().map_err(|err| err.to_string())?;
    let script = format!(
        "ping 127.0.0.1 -n 3 >nul & \"{}\" /S & start \"\" \"{}\"",
        installer.display(),
        current.display()
    );

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", &script])
            .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = script;
        return Err("仅支持在 Windows 上安装更新".to_string());
    }

    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn minimize_window(window: WebviewWindow, skip_task_bar: Option<bool>) {
    let _ = window.minimize();
    if let Some(true) = skip_task_bar {
        let _ = window.set_skip_taskbar(true);
    }
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // 关闭到托盘时窗口可能被最小化并隐藏任务栏按钮，恢复显示时一并还原
        let _ = window.set_skip_taskbar(false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn toggle_maximize(window: WebviewWindow) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub fn toggle_visible(window: WebviewWindow) {
    if let Ok(visible) = window.is_visible() {
        if visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
pub fn enter_minimode(app: AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    if let Some(mini) = app.get_webview_window("minimode") {
        let _ = mini.set_size(LogicalSize::new(MINIMODE_WIDTH, MINIMODE_HEIGHT));
        let _ = mini.show();
        let _ = mini.set_focus();
    }
}

#[tauri::command]
pub fn exit_minimode(app: AppHandle) {
    if let Some(mini) = app.get_webview_window("minimode") {
        let _ = mini.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[tauri::command]
pub fn toggle_minimode(app: AppHandle) {
    if let Some(mini) = app.get_webview_window("minimode") {
        if let Ok(is_vis) = mini.is_visible() {
            if is_vis {
                exit_minimode(app);
            } else {
                enter_minimode(app);
            }
        }
    }
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        let _ = std::fs::create_dir_all(p);
    }
    open::that(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_item_in_folder(path: String) -> Result<bool, String> {
    let path = path.trim().to_string();
    // 文件已被移动/删除时不要拉起资源管理器，交由前端提示失败
    if path.is_empty() || !std::path::Path::new(&path).exists() {
        return Ok(false);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        // explorer 的 /select 解析对引号位置敏感：必须只给路径加引号。
        // 若整个参数被引号包裹（std::process::Command 对含空格参数的默认行为），
        // explorer 会把它当成未知项并退回「文档」目录。
        Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        open::that(path).map_err(|e| e.to_string())?;
        Ok(true)
    }
}

/// 忽略鼠标事件（歌词窗口穿透点击等）
#[tauri::command]
pub fn ignore_mouse_event(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

/// 前端日志落点：输出到 stderr（env_logger 接管）
#[tauri::command]
pub fn log_entry(entry: serde_json::Value) {
    log::info!("[frontend] {}", entry);
}

/// WebView2 用户数据目录大小（字节）。目录不存在或统计失败返回 0。
#[tauri::command]
pub fn get_cache_size() -> u64 {
    let candidates = [
        dirs::data_local_dir().map(|d| d.join("com.anhe.player")),
        dirs::config_dir().map(|d| d.join(super::global_context::APP_DATA_DIR_NAME).join("EBWebView")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.is_dir() {
            return dir_size(&candidate, 0);
        }
    }
    0
}

fn dir_size(dir: &std::path::Path, depth: u32) -> u64 {
    if depth > 12 {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += dir_size(&entry.path(), depth + 1);
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

/// 清除 WebView 浏览数据（cookies/localStorage/IndexedDB/缓存）。
/// 注意：Tauri 未提供按类型清除的 API，此处为全量清除。
#[tauri::command]
pub fn clear_cache(window: WebviewWindow) -> Result<(), String> {
    window.clear_all_browsing_data().map_err(|e| e.to_string())
}
