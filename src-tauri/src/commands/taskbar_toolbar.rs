//! Windows 任务栏缩略图工具栏：悬停图标时，预览窗口下方显示上一首 / 播放暂停 / 下一首。

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateDIBSection, DeleteObject, GetDC, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER,
    DIB_RGB_COLORS,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THUMBBUTTON, THUMBBUTTONFLAGS,
    THB_FLAGS, THB_ICON, THB_TOOLTIP, THBF_ENABLED,
};
use windows::Win32::UI::WindowsAndMessaging::{
    ChangeWindowMessageFilterEx, CreateIconIndirect, GetAncestor, GetSystemMetrics,
    RegisterWindowMessageW, GA_ROOT, ICONINFO, MSGFLT_ALLOW, SM_CXSMICON, WM_COMMAND,
};

const BUTTON_PREV: u32 = 40001;
const BUTTON_PLAY: u32 = 40002;
const BUTTON_NEXT: u32 = 40003;

#[cfg(windows)]
static PLAYING: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static TASKBAR_APP: OnceLock<AppHandle> = OnceLock::new();
#[cfg(windows)]
static TASKBAR_CREATED: AtomicU32 = AtomicU32::new(0);
#[cfg(windows)]
static ADDED: Mutex<Vec<isize>> = Mutex::new(Vec::new());
#[cfg(windows)]
static PENDING: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// 给主窗口和小播放器都装上任务栏按钮。
pub fn install_taskbar_windows(app: &AppHandle) {
    for label in ["main", "minimode"] {
        if let Some(window) = app.get_webview_window(label) {
            install_taskbar_window(&window);
        }
    }
}

pub fn install_taskbar_window(window: &WebviewWindow) {
    schedule_install(window, false);
}

/// 窗口收进托盘后，系统会拆掉缩略图按钮。先忘掉挂过的记录，避免下次只更新播放图标。
pub fn detach_taskbar_window(window: &WebviewWindow) {
    if let Some(hwnd) = root_hwnd(window) {
        forget_added(hwnd);
    }
}

/// 窗口从托盘重新出现时，任务栏会丢掉缩略图按钮。必须重新挂，不能只更新播放图标。
pub fn reinstall_taskbar_window(window: &WebviewWindow) {
    if let Some(hwnd) = root_hwnd(window) {
        forget_added(hwnd);
    }
    schedule_install(window, true);
}

fn schedule_install(window: &WebviewWindow, reset_tab: bool) {
    let _ = TASKBAR_APP.set(window.app_handle().clone());
    let Some(hwnd) = root_hwnd(window) else {
        log::warn!("[taskbar] 取不到窗口句柄");
        return;
    };
    if is_added(hwnd) && !reset_tab {
        let playing = PLAYING.load(Ordering::Acquire);
        let _ = window.run_on_main_thread(move || unsafe {
            let _ = update_play_button(hwnd_from(hwnd), playing);
        });
        return;
    }
    if !mark_pending(hwnd) {
        return;
    }
    let app = window.app_handle().clone();
    let _ = app.clone().run_on_main_thread(move || unsafe {
        try_install(app, hwnd, 0, reset_tab);
    });
}

#[tauri::command]
pub fn taskbar_toolbar_install(window: WebviewWindow) {
    install_taskbar_window(&window);
}

#[tauri::command]
pub fn taskbar_toolbar_set_playing(app: AppHandle, playing: bool) {
    PLAYING.store(playing, Ordering::Release);
    install_taskbar_windows(&app);
}

#[cfg(windows)]
fn root_hwnd(window: &WebviewWindow) -> Option<isize> {
    let hwnd = window.hwnd().ok()?;
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let chosen = if root.is_invalid() { hwnd } else { root };
    if chosen.is_invalid() {
        None
    } else {
        Some(chosen.0 as isize)
    }
}

#[cfg(windows)]
fn hwnd_from(bits: isize) -> HWND {
    HWND(bits as *mut core::ffi::c_void)
}

#[cfg(windows)]
fn is_added(hwnd: isize) -> bool {
    ADDED.lock().ok().is_some_and(|list| list.contains(&hwnd))
}

#[cfg(windows)]
fn mark_added(hwnd: isize) {
    if let Ok(mut list) = ADDED.lock() {
        if !list.contains(&hwnd) {
            list.push(hwnd);
        }
    }
    if let Ok(mut pending) = PENDING.lock() {
        pending.retain(|item| *item != hwnd);
    }
}

#[cfg(windows)]
fn mark_pending(hwnd: isize) -> bool {
    let Ok(mut pending) = PENDING.lock() else {
        return false;
    };
    if pending.contains(&hwnd) {
        return false;
    }
    pending.push(hwnd);
    true
}

#[cfg(windows)]
fn clear_pending(hwnd: isize) {
    if let Ok(mut pending) = PENDING.lock() {
        pending.retain(|item| *item != hwnd);
    }
}

fn forget_added(hwnd: isize) {
    if let Ok(mut list) = ADDED.lock() {
        list.retain(|item| *item != hwnd);
    }
    clear_pending(hwnd);
}

#[cfg(windows)]
unsafe fn try_install(app: AppHandle, hwnd_bits: isize, attempt: u8, reset_tab: bool) {
    if is_added(hwnd_bits) && !reset_tab {
        let _ = update_play_button(hwnd_from(hwnd_bits), PLAYING.load(Ordering::Acquire));
        return;
    }
    let hwnd = hwnd_from(hwnd_bits);
    let _ = subclass(hwnd);
    match add_buttons(hwnd, PLAYING.load(Ordering::Acquire), reset_tab || attempt > 0) {
        Ok(()) => {
            mark_added(hwnd_bits);
            log::info!("[taskbar] 缩略图按钮已挂上");
        }
        Err(err) => {
            if attempt == 0 || attempt == 15 {
                log::warn!("[taskbar] 挂按钮失败，第 {attempt} 次: {err}");
            }
            if attempt >= 40 {
                clear_pending(hwnd_bits);
                return;
            }
            let next = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                let again = next.clone();
                let _ = next.run_on_main_thread(move || unsafe {
                    try_install(again, hwnd_bits, attempt + 1, reset_tab);
                });
            });
        }
    }
}

#[cfg(windows)]
unsafe fn add_buttons(hwnd: HWND, playing: bool, reset_tab: bool) -> windows::core::Result<()> {
    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    let taskbar: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)?;
    taskbar.HrInit()?;
    // 缩略图按钮每个任务栏按钮只能挂一次。窗口藏进托盘后再出现，系统会拆掉旧按钮。
    // 先从任务栏摘掉再挂回去，才能重新 ThumbBarAddButtons。
    if reset_tab {
        let _ = taskbar.DeleteTab(hwnd);
        let _ = taskbar.AddTab(hwnd);
    }
    let buttons = [
        thumb_button(BUTTON_PREV, icon_bits(0), "上一首"),
        thumb_button(BUTTON_PLAY, icon_bits(if playing { 2 } else { 1 }), if playing { "暂停" } else { "播放" }),
        thumb_button(BUTTON_NEXT, icon_bits(3), "下一首"),
    ];
    taskbar.ThumbBarAddButtons(hwnd, &buttons)
}

#[cfg(windows)]
unsafe fn update_play_button(hwnd: HWND, playing: bool) -> windows::core::Result<()> {
    if !is_added(hwnd.0 as isize) {
        return Ok(());
    }
    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    let taskbar: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)?;
    taskbar.HrInit()?;
    let buttons = [thumb_button(
        BUTTON_PLAY,
        icon_bits(if playing { 2 } else { 1 }),
        if playing { "暂停" } else { "播放" },
    )];
    taskbar.ThumbBarUpdateButtons(hwnd, &buttons)
}

#[cfg(windows)]
unsafe fn subclass(hwnd: HWND) -> bool {
    static SEEN: Mutex<Vec<isize>> = Mutex::new(Vec::new());
    let bits = hwnd.0 as isize;
    if let Ok(seen) = SEEN.lock() {
        if seen.contains(&bits) {
            return true;
        }
    }
    let created = RegisterWindowMessageW(w!("TaskbarButtonCreated"));
    if created != 0 {
        TASKBAR_CREATED.store(created, Ordering::Release);
        let _ = ChangeWindowMessageFilterEx(hwnd, created, MSGFLT_ALLOW, None);
    }
    let ok = SetWindowSubclass(hwnd, Some(subclass_proc), 0x4654_4D4F, 0).as_bool();
    if ok {
        if let Ok(mut seen) = SEEN.lock() {
            seen.push(bits);
        }
    } else {
        log::warn!("[taskbar] 窗口子类化失败");
    }
    ok
}

#[cfg(windows)]
unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    let created = TASKBAR_CREATED.load(Ordering::Acquire);
    if created != 0 && msg == created {
        let playing = PLAYING.load(Ordering::Acquire);
        let added = add_buttons(hwnd, playing, false).is_ok()
            || add_buttons(hwnd, playing, true).is_ok();
        if added {
            mark_added(hwnd.0 as isize);
            log::info!("[taskbar] 任务栏图标出现后已挂上按钮");
        }
    }
    if msg == WM_COMMAND {
        let command = match (wparam.0 & 0xffff) as u32 {
            BUTTON_PREV => Some("previous"),
            BUTTON_PLAY => Some("play-pause"),
            BUTTON_NEXT => Some("next"),
            _ => None,
        };
        if let Some(command) = command {
            if let Some(app) = TASKBAR_APP.get() {
                let _ = app.emit("taskbar-media", command);
            }
            return LRESULT(0);
        }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

#[cfg(windows)]
fn thumb_button(id: u32, icon: isize, tip: &str) -> THUMBBUTTON {
    let mut button = THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: windows::Win32::UI::WindowsAndMessaging::HICON(icon as *mut core::ffi::c_void),
        szTip: [0; 260],
        dwFlags: THBF_ENABLED | THUMBBUTTONFLAGS(0),
    };
    for (index, unit) in tip.encode_utf16().take(259).enumerate() {
        button.szTip[index] = unit;
    }
    button
}

#[cfg(windows)]
fn icon_bits(slot: usize) -> isize {
    static ICONS: OnceLock<[isize; 4]> = OnceLock::new();
    let icons = ICONS.get_or_init(|| {
        [
            unsafe { glyph_icon(0) },
            unsafe { glyph_icon(1) },
            unsafe { glyph_icon(2) },
            unsafe { glyph_icon(3) },
        ]
    });
    icons[slot]
}

/// 按系统小图标尺寸画正方形图标。上一版 16×16 点阵被任务栏拉成扁条。
#[cfg(windows)]
unsafe fn glyph_icon(kind: u8) -> isize {
    let size = GetSystemMetrics(SM_CXSMICON).clamp(16, 64) as usize;
    let pixels = paint_glyph(kind, size);
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size as i32,
            biHeight: size as i32,
            biPlanes: 1,
            biBitCount: 32,
            ..Default::default()
        },
        ..Default::default()
    };
    let screen = GetDC(None);
    let mut bits = std::ptr::null_mut();
    let color = match CreateDIBSection(Some(screen), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
        Ok(bitmap) => bitmap,
        Err(err) => {
            log::warn!("[taskbar] 创建图标位图失败: {err}");
            let _ = ReleaseDC(None, screen);
            return 0;
        }
    };
    if !bits.is_null() {
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len());
    }
    let stride = ((size + 31) / 32) * 4;
    let mask_bits = vec![0u8; stride * size];
    let mask = CreateBitmap(
        size as i32,
        size as i32,
        1,
        1,
        Some(mask_bits.as_ptr().cast()),
    );
    let icon_info = ICONINFO {
        fIcon: BOOL(1),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask,
        hbmColor: color,
    };
    let icon = match CreateIconIndirect(&icon_info) {
        Ok(icon) => icon,
        Err(err) => {
            log::warn!("[taskbar] 创建图标失败: {err}");
            windows::Win32::UI::WindowsAndMessaging::HICON(std::ptr::null_mut())
        }
    };
    let _ = info;
    let _ = DeleteObject(color.into());
    let _ = DeleteObject(mask.into());
    let _ = ReleaseDC(None, screen);
    icon.0 as isize
}

#[cfg(windows)]
fn paint_glyph(kind: u8, size: usize) -> Vec<u8> {
    let mut top = vec![0u8; size * size * 4];
    let s = size as f32;
    let margin = s * 0.18;
    let mid = s * 0.5;
    let set = |buf: &mut [u8], x: f32, y: f32| {
        let xi = x.round() as isize;
        let yi = y.round() as isize;
        if xi < 0 || yi < 0 || xi >= size as isize || yi >= size as isize {
            return;
        }
        let offset = (yi as usize * size + xi as usize) * 4;
        buf[offset] = 255;
        buf[offset + 1] = 255;
        buf[offset + 2] = 255;
        buf[offset + 3] = 255;
    };
    let fill_rect = |buf: &mut [u8], x0: f32, y0: f32, x1: f32, y1: f32| {
        let left = x0.min(x1);
        let right = x0.max(x1);
        let top_y = y0.min(y1);
        let bottom = y0.max(y1);
        let mut y = top_y;
        while y <= bottom {
            let mut x = left;
            while x <= right {
                set(buf, x, y);
                x += 1.0;
            }
            y += 1.0;
        }
    };
    let fill_tri = |buf: &mut [u8], ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32| {
        let min_x = ax.min(bx).min(cx);
        let max_x = ax.max(bx).max(cx);
        let min_y = ay.min(by).min(cy);
        let max_y = ay.max(by).max(cy);
        let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if area.abs() < 0.001 {
            return;
        }
        let mut y = min_y;
        while y <= max_y {
            let mut x = min_x;
            while x <= max_x {
                let w0 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
                let w1 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
                let w2 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
                if (w0 >= 0.0 && w1 >= 0.0 && w2 >= 0.0) || (w0 <= 0.0 && w1 <= 0.0 && w2 <= 0.0) {
                    set(buf, x, y);
                }
                x += 1.0;
            }
            y += 1.0;
        }
    };

    let bar = s * 0.14;
    match kind {
        0 => {
            fill_rect(&mut top, margin, margin, margin + bar, s - margin);
            fill_tri(
                &mut top,
                margin + bar + s * 0.08,
                mid,
                s - margin,
                margin,
                s - margin,
                s - margin,
            );
        }
        1 => {
            fill_tri(&mut top, margin + s * 0.08, margin, margin + s * 0.08, s - margin, s - margin, mid);
        }
        2 => {
            let gap = s * 0.16;
            let left = mid - gap * 0.5 - bar;
            fill_rect(&mut top, left, margin, left + bar, s - margin);
            fill_rect(&mut top, mid + gap * 0.5, margin, mid + gap * 0.5 + bar, s - margin);
        }
        _ => {
            fill_tri(
                &mut top,
                margin,
                margin,
                margin,
                s - margin,
                s - margin - bar - s * 0.08,
                mid,
            );
            fill_rect(&mut top, s - margin - bar, margin, s - margin, s - margin);
        }
    }

    // 位图自下而上，和画布的从上到下对调，避免图标被压扁。
    let mut bottom_up = vec![0u8; top.len()];
    let row_bytes = size * 4;
    for y in 0..size {
        let src = y * row_bytes;
        let dest = (size - 1 - y) * row_bytes;
        bottom_up[dest..dest + row_bytes].copy_from_slice(&top[src..src + row_bytes]);
    }
    bottom_up
}
