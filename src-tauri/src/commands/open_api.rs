// 本机播放控制。默认只绑 127.0.0.1，允许局域网时才听 0.0.0.0。
// 没有鉴权，设置里默认关闭。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server, StatusCode};

static STARTED: AtomicBool = AtomicBool::new(false);
static STATUS: Mutex<String> = Mutex::new(String::new());

fn json_header() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("header")
}

fn cors_header() -> Header {
    Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).expect("header")
}

fn respond(request: tiny_http::Request, status: u16, body: String) {
    let response = Response::from_string(body)
        .with_status_code(StatusCode(status))
        .with_header(json_header())
        .with_header(cors_header());
    let _ = request.respond(response);
}

#[tauri::command]
pub fn open_api_start(app: AppHandle, port: u16, allow_lan: bool) -> Result<(), String> {
    if STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let host = if allow_lan { "0.0.0.0" } else { "127.0.0.1" };
    let addr = format!("{host}:{port}");
    std::thread::spawn(move || {
        let server = match Server::http(&addr) {
            Ok(server) => server,
            Err(err) => {
                STARTED.store(false, Ordering::SeqCst);
                let _ = app.emit("open-api-error", err.to_string());
                return;
            }
        };
        for request in server.incoming_requests() {
            let url = request.url().to_string();
            let path = url.split('?').next().unwrap_or("/");
            let method = request.method().clone();
            let mut request = request;
            let mut ignored = Vec::new();
            let _ = request.as_reader().read_to_end(&mut ignored);
            if method == Method::Options {
                respond(request, 204, String::new());
                continue;
            }
            let action = match (&method, path) {
                (&Method::Get, "/status") => {
                    let body = STATUS
                        .lock()
                        .map(|guard| guard.clone())
                        .unwrap_or_else(|_| "{}".to_string());
                    respond(request, 200, body);
                    continue;
                }
                (&Method::Post, "/play-pause") => Some("play-pause"),
                (&Method::Post, "/next") => Some("next"),
                (&Method::Post, "/previous") => Some("previous"),
                (&Method::Post, "/pause") => Some("pause"),
                (&Method::Post, "/play") => Some("play"),
                _ => None,
            };
            if let Some(action) = action {
                let _ = app.emit("open-api", action);
                respond(request, 200, "{\"ok\":true}".to_string());
            } else {
                respond(request, 404, "{\"ok\":false}".to_string());
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn open_api_set_status(status: String) {
    if let Ok(mut guard) = STATUS.lock() {
        *guard = status;
    }
}
