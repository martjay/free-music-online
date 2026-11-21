use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::AppHandle;
#[cfg(mobile)]
use tauri::Manager;

/// 用户数据目录名。插件、歌单和设置都放在这个目录下。
pub const APP_DATA_DIR_NAME: &str = "Free Music Online";

static USER_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

fn desktop_user_data_dir() -> PathBuf {
    dirs::config_dir()
        .map(|p| p.join(APP_DATA_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_user_data_dir(app: &AppHandle) -> PathBuf {
    #[cfg(mobile)]
    {
        if let Ok(dir) = app.path().app_data_dir() {
            return dir;
        }
        if let Ok(dir) = app.path().app_config_dir() {
            return dir;
        }
        PathBuf::from(".")
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        desktop_user_data_dir()
    }
}

/// 在应用启动时解析并缓存可写目录。安卓上 `dirs::config_dir()` 为空，必须用 Tauri 的 files 目录。
pub fn init_user_data_dir(app: &AppHandle) {
    let dir = resolve_user_data_dir(app);
    let _ = std::fs::create_dir_all(&dir);
    let _ = USER_DATA_DIR.set(dir);
}

pub fn user_data_dir(app: Option<&AppHandle>) -> PathBuf {
    if let Some(dir) = USER_DATA_DIR.get() {
        return dir.clone();
    }
    if let Some(app) = app {
        let dir = resolve_user_data_dir(app);
        let _ = std::fs::create_dir_all(&dir);
        let _ = USER_DATA_DIR.set(dir.clone());
        return dir;
    }
    desktop_user_data_dir()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppPath {
    #[serde(rename = "defaultDownloadPath")]
    pub default_download_path: String,
    pub temp: String,
    #[serde(rename = "userData")]
    pub user_data: String,
    pub res: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GlobalContext {
    #[serde(rename = "appVersion")]
    pub app_version: String,
    #[serde(rename = "appPath")]
    pub app_path: AppPath,
    pub platform: String,
    #[serde(rename = "isWin10OrAbove")]
    pub is_win10_or_above: bool,
}

fn default_download_dir(app: &AppHandle) -> PathBuf {
    #[cfg(mobile)]
    {
        let dir = user_data_dir(Some(app)).join("downloads");
        let _ = std::fs::create_dir_all(&dir);
        return dir;
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        dirs::download_dir().unwrap_or_else(|| PathBuf::from("."))
    }
}

#[tauri::command]
pub fn global_context_get(app: tauri::AppHandle) -> GlobalContext {
    let download_dir = default_download_dir(&app).to_string_lossy().to_string();

    let config_dir = user_data_dir(Some(&app)).to_string_lossy().to_string();

    let temp_dir = std::env::temp_dir().to_string_lossy().to_string();

    GlobalContext {
        // 以 tauri.conf.json 的 version 为唯一事实来源（与安装包/更新检查对齐），
        // 避免 Cargo.toml 与配置不一致时自报旧版本、误报"发现新版本"
        app_version: app.package_info().version.to_string(),
        app_path: AppPath {
            default_download_path: download_dir,
            temp: temp_dir,
            user_data: config_dir,
            res: String::new(),
        },
        platform: std::env::consts::OS.to_string(),
        is_win10_or_above: true,
    }
}
