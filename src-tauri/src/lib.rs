mod commands;

use commands::{
    app_config::{self, app_config_reset, app_config_set, app_config_sync},
    audio_tag::*,
    dialog::*,
    download::*,
    forwarder::*,
    fs_util::*,
    global_context::*,
    http_proxy::*,
    local_meta::*,
    lyric_window::{
        self, set_lyric_display_span, set_lyric_hover_rects, set_lyric_topmost, sync_lyric_window,
        LyricWindowState,
    },
    netease::*,
    open_api::*,
    system_util::*,
    taskbar_toolbar::*,
    tray_menu::{on_tray_menu_blur, show_tray_menu, tray_menu_click},
    webdav::*,
};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

/// 从配置文件读取关闭行为。
fn read_close_behavior() -> String {
    app_config::read_config_value()
        .get("normal.closeBehavior")
        .and_then(|v| v.as_str())
        .unwrap_or("minimize")
        .to_string()
}

/// 显示并聚焦主窗口；同时恢复任务栏按钮（关闭到托盘时曾被隐藏）
/// 注意：命名需避开 `system_util::show_main_window` 命令，否则会遮蔽同名命令
fn restore_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
        let _ = window.unminimize();
        let _ = window.show();
        reinstall_taskbar_window(&window);
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ForwarderPortState::default())
        .manage(DownloadCancelState::default())
        .manage(LyricWindowState::default())
        .invoke_handler(tauri::generate_handler![
            // Global Context
            global_context_get,
            // App Config
            app_config_sync,
            app_config_set,
            app_config_reset,
            // System Util
            exit_app,
            app_update_installer_path,
            app_update_installer_valid,
            apply_app_update,
            minimize_window,
            show_main_window,
            toggle_maximize,
            toggle_visible,
            enter_minimode,
            exit_minimode,
            toggle_minimode,
            tray_menu_click,
            open_external,
            open_path,
            show_item_in_folder,
            ignore_mouse_event,
            log_entry,
            get_cache_size,
            clear_cache,
            // 桌面歌词窗口
            sync_lyric_window,
            set_lyric_hover_rects,
            set_lyric_display_span,
            set_lyric_topmost,
            // Dialog
            show_open_dialog,
            show_save_dialog,
            // Fs Util
            fs_write_file,
            fs_read_file,
            fs_is_file,
            fs_file_sizes,
            taskbar_toolbar_install,
            taskbar_toolbar_set_playing,
            fs_is_folder,
            fs_remove,
            fs_mkdir,
            fs_copy_file,
            fs_read_dir,
            fs_rename,
            // HTTP Request / Forwarder
            http_request,
            probe_media_url,
            forwarder_get_port,
            // Local Music
            local_scan_dir,
            local_parse_meta,
            // Download
            download_file,
            download_cancel,
            // Audio Tag（下载完成后写入封面/歌词）
            write_audio_meta,
            // WebDAV
            webdav_test,
            webdav_put,
            webdav_get,
            // NetEase Account（登录窗口与带 Cookie 请求）
            netease_login_open,
            netease_login_wait,
            netease_login_close,
            netease_session,
            netease_request,
            netease_logout,
            // Open API
            open_api_start,
            open_api_set_status,
        ])
        .setup(|app| {
            commands::forwarder::init_forwarder(app.handle().clone());
            lyric_window::init_lyric_window(app.handle());
            restore_saved_placements(app.handle());
            install_taskbar_windows(app.handle());

            // ── 系统托盘 ──
            // 关闭按钮在「最小化」模式下只会隐藏窗口，必须提供托盘入口将其找回。
            // 右键用应用自己的菜单，系统菜单改不了行距。
            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .show_menu_on_left_click(false)
                .tooltip("Free Music Online")
                .on_tray_icon_event(|tray, event| {
                    let TrayIconEvent::Click {
                        button,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    else {
                        return;
                    };
                    if button == MouseButton::Left {
                        restore_main_window(tray.app_handle());
                        return;
                    }
                    if button == MouseButton::Right {
                        let tauri::Position::Physical(tauri::PhysicalPosition { x, y }) =
                            rect.position
                        else {
                            return;
                        };
                        let tauri::Size::Physical(tauri::PhysicalSize { width, height }) = rect.size
                        else {
                            return;
                        };
                        show_tray_menu(tray.app_handle(), x, y, width as i32, height as i32);
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            // 启动时按磁盘配置对齐一次歌词窗口（隐藏状态下也会正确设置穿透与置顶）
            let enabled = app_config::get_config_bool("lyric.enableDesktopLyric", false);
            let always_on_top = app_config::get_config_bool("lyric.alwaysOnTop", true);
            let locked = app_config::get_config_bool("lyric.lockLyric", false);
            if let Err(err) = lyric_window::sync_lyric_window(
                app.handle().clone(),
                enabled,
                always_on_top,
                locked,
            ) {
                log::warn!("[tray] sync lyric window on startup failed: {err}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match window.label() {
                // 主窗口关闭请求：按配置决定「退出」还是「隐藏到托盘」，
                // 避免窗口被销毁后进程与音频仍在后台运行却无法找回。
                "main" => {
                    if let WindowEvent::Focused(true) = event {
                        if let Some(webview) = window.app_handle().get_webview_window("main") {
                            install_taskbar_window(&webview);
                        }
                    }
                    if let WindowEvent::Moved(_) | WindowEvent::Resized(_) = event {
                        on_main_window_geometry(window);
                    }
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        on_main_window_geometry(window);
                        if read_close_behavior() == "exit_app" {
                            window.app_handle().exit(0);
                            return;
                        }
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = window.set_skip_taskbar(true);
                        if let Some(webview) = window.app_handle().get_webview_window("main") {
                            detach_taskbar_window(&webview);
                        }
                    }
                }
                // 歌词窗口：几何变化防抖持久化 + 关闭请求拦截
                "lyric" => lyric_window::handle_lyric_window_event(window, event),
                "tray-menu" => {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    if let WindowEvent::Focused(false) = event {
                        on_tray_menu_blur(window);
                    }
                }
                "minimode" => {
                    if let WindowEvent::Focused(true) = event {
                        if let Some(webview) = window.app_handle().get_webview_window("minimode") {
                            install_taskbar_window(&webview);
                        }
                    }
                    if let WindowEvent::Moved(_) | WindowEvent::Resized(_) = event {
                        on_minimode_geometry(window);
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running anhe-player tauri application");
}
