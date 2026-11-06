use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Window};

/// 与托盘菜单页面的盒模型一致。改样式时两边一起改。
const MENU_WIDTH: f64 = 180.0;
const MENU_HEIGHT: f64 = 196.0;
static SHOWN_AT_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// 刚弹出时系统可能先送一次失焦，这段时间内不要把菜单关掉。
pub fn on_tray_menu_blur(window: &Window) {
    let shown = SHOWN_AT_MS.load(Ordering::Acquire);
    if now_ms().saturating_sub(shown) < 250 {
        return;
    }
    let _ = window.hide();
}

pub fn show_tray_menu(app: &AppHandle, icon_x: i32, icon_y: i32, icon_w: i32, icon_h: i32) {
    let Some(window) = app.get_webview_window("tray-menu") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    let monitor = app
        .monitor_from_point(icon_x as f64, icon_y as f64)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let scale = monitor.as_ref().map(|item| item.scale_factor()).unwrap_or(1.0);
    let phys_w = (MENU_WIDTH * scale).round() as i32;
    let phys_h = (MENU_HEIGHT * scale).round() as i32;

    let mut x = icon_x + icon_w / 2 - phys_w / 2;
    let gap = (6.0 * scale).round() as i32;
    let mut y = icon_y - phys_h - gap;
    if let Some(monitor) = &monitor {
        let area = monitor.work_area();
        let ax = area.position.x;
        let ay = area.position.y;
        let aw = area.size.width as i32;
        let ah = area.size.height as i32;
        if y < ay {
            y = icon_y + icon_h + gap;
        }
        let max_x = (ax + aw - phys_w).max(ax);
        let max_y = (ay + ah - phys_h).max(ay);
        x = x.clamp(ax, max_x);
        y = y.clamp(ay, max_y);
    }

    SHOWN_AT_MS.store(now_ms(), Ordering::Release);
    let _ = window.set_size(LogicalSize::new(MENU_WIDTH, MENU_HEIGHT));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("tray-menu-open", ());
}

#[tauri::command]
pub fn tray_menu_click(app: AppHandle, action: String) {
    if let Some(window) = app.get_webview_window("tray-menu") {
        let _ = window.hide();
    }
    match action.as_str() {
        "previous" | "play-pause" | "next" => {
            let _ = app.emit("taskbar-media", action);
        }
        "show" => crate::restore_main_window(&app),
        "desktop-lyric" => {
            let next = !super::app_config::get_config_bool("lyric.enableDesktopLyric", false);
            let _ = super::app_config::patch_config(
                &app,
                serde_json::json!({ "lyric.enableDesktopLyric": next }),
            );
        }
        "lock-lyric" => {
            let next = !super::app_config::get_config_bool("lyric.lockLyric", false);
            let _ = super::app_config::patch_config(
                &app,
                serde_json::json!({ "lyric.lockLyric": next }),
            );
        }
        "exit" => app.exit(0),
        _ => {}
    }
}
