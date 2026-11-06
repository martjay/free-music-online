use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow, Window};

const MINIMODE_WIDTH: f64 = 408.0;
const MINIMODE_HEIGHT: f64 = 148.0;
const MAIN_MIN_WIDTH: f64 = 900.0;
const MAIN_MIN_HEIGHT: f64 = 600.0;

struct MiniMemory {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    at: Instant,
}

struct MainMemory {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    maximized: bool,
    at: Instant,
}

static MAIN_MEMORY: Mutex<Option<MainMemory>> = Mutex::new(None);
static MAIN_SAVE_PENDING: AtomicBool = AtomicBool::new(false);
static PLACEMENT_SUPPRESS: AtomicBool = AtomicBool::new(false);

static MINI_MEMORY: Mutex<Option<MiniMemory>> = Mutex::new(None);
static MINI_SAVE_PENDING: AtomicBool = AtomicBool::new(false);

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
        super::taskbar_toolbar::install_taskbar_window(&window);
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
        restore_mini_placement(&mini);
        let _ = mini.show();
        let _ = mini.set_focus();
        super::taskbar_toolbar::install_taskbar_window(&mini);
    }
}

#[tauri::command]
pub fn exit_minimode(app: AppHandle) {
    if let Some(mini) = app.get_webview_window("minimode") {
        persist_mini_placement(&mini, true);
        let _ = mini.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
        super::taskbar_toolbar::install_taskbar_window(&main);
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

/// 迷你窗被拖动或改变大小时钳回工作区，并记住位置和尺寸。
pub fn on_minimode_geometry(window: &Window) {
    if PLACEMENT_SUPPRESS.load(Ordering::Acquire) {
        return;
    }
    let Some(webview) = window.app_handle().get_webview_window(window.label()) else {
        return;
    };
    persist_mini_placement(&webview, false);
}

/// 主窗口移动或改变大小时记住位置、尺寸和最大化状态。
pub fn on_main_window_geometry(window: &Window) {
    if PLACEMENT_SUPPRESS.load(Ordering::Acquire) {
        return;
    }
    let Some(webview) = window.app_handle().get_webview_window("main") else {
        return;
    };
    persist_main_placement(&webview, false);
}

pub fn restore_saved_placements(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        restore_main_placement(&main);
    }
}

fn restore_mini_placement(window: &WebviewWindow) {
    let config = super::app_config::read_config_value();
    let (width, height) = saved_logical_size(
        config.get("private.minimodeWindowSize"),
        MINIMODE_WIDTH,
        MINIMODE_HEIGHT,
        320.0,
        120.0,
    );
    suppress_placement_events();
    let _ = window.set_size(LogicalSize::new(width, height));
    let Some(pos) = config.get("private.minimodeWindowPosition") else {
        return;
    };
    let Some(x) = pos.get("x").and_then(|value| value.as_i64()) else {
        return;
    };
    let Some(y) = pos.get("y").and_then(|value| value.as_i64()) else {
        return;
    };
    let (phys_w, phys_h) = physical_size(window, width, height);
    let (x, y) = clamp_to_work_area(
        window.app_handle(),
        window.current_monitor().ok().flatten(),
        x as i32,
        y as i32,
        phys_w,
        phys_h,
    );
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn persist_mini_placement(window: &WebviewWindow, force: bool) {
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let Some((width, height, phys_w, phys_h)) = logical_window_size(window) else {
        return;
    };
    let (x, y) = clamp_to_work_area(
        window.app_handle(),
        window.current_monitor().ok().flatten(),
        pos.x,
        pos.y,
        phys_w,
        phys_h,
    );
    if x != pos.x || y != pos.y {
        suppress_placement_events();
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }

    if !force {
        let memory = MINI_MEMORY.lock().unwrap();
        if let Some(prev) = memory.as_ref() {
            if prev.x == x && prev.y == y && prev.width == width && prev.height == height {
                return;
            }
            if prev.at.elapsed() < Duration::from_millis(200) {
                drop(memory);
                schedule_mini_save(window.app_handle().clone());
                return;
            }
        }
    }

    write_mini_placement(window, x, y, width, height);
}

fn schedule_mini_save(app: AppHandle) {
    if MINI_SAVE_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(220));
        MINI_SAVE_PENDING.store(false, Ordering::Release);
        if let Some(window) = app.get_webview_window("minimode") {
            persist_mini_placement(&window, true);
        }
    });
}

fn write_mini_placement(window: &WebviewWindow, x: i32, y: i32, width: i32, height: i32) {
    if let Ok(mut memory) = MINI_MEMORY.lock() {
        *memory = Some(MiniMemory {
            x,
            y,
            width,
            height,
            at: Instant::now(),
        });
    }
    let _ = super::app_config::patch_config(
        window.app_handle(),
        serde_json::json!({
            "private.minimodeWindowPosition": { "x": x, "y": y },
            "private.minimodeWindowSize": { "width": width, "height": height }
        }),
    );
}

fn restore_main_placement(window: &WebviewWindow) {
    let config = super::app_config::read_config_value();
    let maximized = config
        .get("private.mainWindowMaximized")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let (width, height) = saved_logical_size(
        config.get("private.mainWindowSize"),
        1100.0,
        690.0,
        MAIN_MIN_WIDTH,
        MAIN_MIN_HEIGHT,
    );
    suppress_placement_events();
    let _ = window.set_size(LogicalSize::new(width, height));
    if let Some(pos) = config.get("private.mainWindowPosition") {
        if let (Some(x), Some(y)) = (
            pos.get("x").and_then(|value| value.as_i64()),
            pos.get("y").and_then(|value| value.as_i64()),
        ) {
            let (phys_w, phys_h) = physical_size(window, width, height);
            let (x, y) = clamp_to_work_area(
                window.app_handle(),
                window.current_monitor().ok().flatten(),
                x as i32,
                y as i32,
                phys_w,
                phys_h,
            );
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
    if maximized {
        let _ = window.maximize();
    }
}

fn persist_main_placement(window: &WebviewWindow, force: bool) {
    let maximized = window.is_maximized().unwrap_or(false);
    if maximized {
        if !force {
            let memory = MAIN_MEMORY.lock().unwrap();
            if memory.as_ref().is_some_and(|prev| prev.maximized) {
                return;
            }
        }
        write_main_maximized(window, true);
        return;
    }

    let Ok(pos) = window.outer_position() else {
        return;
    };
    let Some((width, height, phys_w, phys_h)) = logical_window_size(window) else {
        return;
    };
    if width < MAIN_MIN_WIDTH as i32 || height < MAIN_MIN_HEIGHT as i32 {
        return;
    }
    let (x, y) = clamp_to_work_area(
        window.app_handle(),
        window.current_monitor().ok().flatten(),
        pos.x,
        pos.y,
        phys_w,
        phys_h,
    );

    if !force {
        let memory = MAIN_MEMORY.lock().unwrap();
        if let Some(prev) = memory.as_ref() {
            if !prev.maximized
                && prev.x == x
                && prev.y == y
                && prev.width == width
                && prev.height == height
            {
                return;
            }
            if prev.at.elapsed() < Duration::from_millis(200) {
                drop(memory);
                schedule_main_save(window.app_handle().clone());
                return;
            }
        }
    }

    if let Ok(mut memory) = MAIN_MEMORY.lock() {
        *memory = Some(MainMemory {
            x,
            y,
            width,
            height,
            maximized: false,
            at: Instant::now(),
        });
    }
    let _ = super::app_config::patch_config(
        window.app_handle(),
        serde_json::json!({
            "private.mainWindowPosition": { "x": x, "y": y },
            "private.mainWindowSize": { "width": width, "height": height },
            "private.mainWindowMaximized": false
        }),
    );
}

fn write_main_maximized(window: &WebviewWindow, maximized: bool) {
    if let Ok(mut memory) = MAIN_MEMORY.lock() {
        let (x, y, width, height) = memory
            .as_ref()
            .map(|item| (item.x, item.y, item.width, item.height))
            .unwrap_or((0, 0, 0, 0));
        *memory = Some(MainMemory {
            x,
            y,
            width,
            height,
            maximized,
            at: Instant::now(),
        });
    }
    let _ = super::app_config::patch_config(
        window.app_handle(),
        serde_json::json!({ "private.mainWindowMaximized": maximized }),
    );
}

fn schedule_main_save(app: AppHandle) {
    if MAIN_SAVE_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(220));
        MAIN_SAVE_PENDING.store(false, Ordering::Release);
        if let Some(window) = app.get_webview_window("main") {
            persist_main_placement(&window, true);
        }
    });
}

fn suppress_placement_events() {
    PLACEMENT_SUPPRESS.store(true, Ordering::Release);
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(300));
        PLACEMENT_SUPPRESS.store(false, Ordering::Release);
    });
}

fn saved_logical_size(
    size: Option<&serde_json::Value>,
    fallback_width: f64,
    fallback_height: f64,
    min_width: f64,
    min_height: f64,
) -> (f64, f64) {
    let Some(size) = size else {
        return (fallback_width, fallback_height);
    };
    let width = size
        .get("width")
        .and_then(|value| value.as_f64())
        .unwrap_or(fallback_width)
        .clamp(min_width, 4000.0);
    let height = size
        .get("height")
        .and_then(|value| value.as_f64())
        .unwrap_or(fallback_height)
        .clamp(min_height, 3000.0);
    (width, height)
}

fn logical_window_size(window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let width = (size.width as f64 / scale).round() as i32;
    let height = (size.height as f64 / scale).round() as i32;
    Some((width, height, size.width as i32, size.height as i32))
}

fn physical_size(window: &WebviewWindow, width: f64, height: f64) -> (i32, i32) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let scale = if scale > 0.0 { scale } else { 1.0 };
    ((width * scale).round() as i32, (height * scale).round() as i32)
}

fn clamp_to_work_area(
    app: &AppHandle,
    current: Option<tauri::Monitor>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> (i32, i32) {
    let monitor = app
        .monitor_from_point(x as f64, y as f64)
        .ok()
        .flatten()
        .or(current)
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return (x, y);
    };
    let area = monitor.work_area();
    let ax = area.position.x;
    let ay = area.position.y;
    let aw = area.size.width as i32;
    let ah = area.size.height as i32;
    let max_x = (ax + aw - width).max(ax);
    let max_y = (ay + ah - height).max(ay);
    (x.clamp(ax, max_x), y.clamp(ay, max_y))
}
