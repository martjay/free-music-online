use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct HttpOptions {
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<serde_json::Value>,
    /// 电台代理：`system` 系统代理，`direct` 直连，或其他为自定义代理 URL。
    /// 不传时保持原来的环境变量代理行为。
    #[serde(default)]
    pub proxy: Option<String>,
}

pub(crate) enum OutboundProxy {
    Unspecified,
    Direct,
    Explicit(reqwest::Proxy),
}

/// 把电台页的代理选择应用到 reqwest。系统代理优先读 Windows 的 Internet 设置。
pub fn parse_outbound_proxy(spec: Option<&str>) -> Result<OutboundProxy, String> {
    let Some(spec) = spec.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(OutboundProxy::Unspecified);
    };
    if spec == "direct" {
        return Ok(OutboundProxy::Direct);
    }
    if spec == "system" {
        return match detect_system_proxy() {
            Some(url) => Ok(OutboundProxy::Explicit(
                reqwest::Proxy::all(url).map_err(|err| err.to_string())?,
            )),
            None => Ok(OutboundProxy::Unspecified),
        };
    }
    let url = normalize_proxy_url(spec)?;
    Ok(OutboundProxy::Explicit(
        reqwest::Proxy::all(url).map_err(|err| err.to_string())?,
    ))
}

pub fn apply_async_proxy(
    builder: reqwest::ClientBuilder,
    proxy: OutboundProxy,
) -> reqwest::ClientBuilder {
    match proxy {
        OutboundProxy::Unspecified => builder,
        OutboundProxy::Direct => builder.no_proxy(),
        OutboundProxy::Explicit(proxy) => builder.proxy(proxy),
    }
}

pub fn apply_blocking_proxy(
    builder: reqwest::blocking::ClientBuilder,
    proxy: OutboundProxy,
) -> reqwest::blocking::ClientBuilder {
    match proxy {
        OutboundProxy::Unspecified => builder,
        OutboundProxy::Direct => builder.no_proxy(),
        OutboundProxy::Explicit(proxy) => builder.proxy(proxy),
    }
}

fn normalize_proxy_url(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    if text.is_empty() || text.contains(char::is_whitespace) {
        return Err("代理地址无效".to_string());
    }
    let with_scheme = if text.contains("://") {
        text.to_string()
    } else {
        format!("http://{text}")
    };
    let url = reqwest::Url::parse(&with_scheme).map_err(|_| "代理地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h") || url.port().is_none() {
        return Err("代理地址无效".to_string());
    }
    Ok(url.to_string())
}

fn detect_system_proxy() -> Option<String> {
    #[cfg(windows)]
    {
        windows_system_proxy()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
fn windows_system_proxy() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let settings = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;
    let enabled: u32 = settings.get_value("ProxyEnable").unwrap_or(0);
    if enabled == 0 {
        return None;
    }
    let server: String = settings.get_value("ProxyServer").ok()?;
    parse_windows_proxy_server(&server)
}

fn parse_windows_proxy_server(server: &str) -> Option<String> {
    let server = server.trim();
    if server.is_empty() {
        return None;
    }
    if !server.contains('=') {
        return normalize_proxy_url(server).ok();
    }
    let mut https = None;
    let mut http = None;
    let mut socks = None;
    for part in server.split(';') {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match key.trim().to_ascii_lowercase().as_str() {
            "https" => https = Some(value.to_string()),
            "http" => http = Some(value.to_string()),
            "socks" => socks = Some(value.to_string()),
            _ => {}
        }
    }
    if let Some(value) = https.or(http) {
        return normalize_proxy_url(&value).ok();
    }
    let socks = socks?;
    let raw = if socks.contains("://") {
        socks
    } else {
        format!("socks5://{socks}")
    };
    normalize_proxy_url(&raw).ok()
}

#[derive(Debug, Serialize)]
pub struct HttpResponsePayload {
    #[serde(rename = "statusCode")]
    pub status_code: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn http_request(
    url: String,
    options: Option<HttpOptions>,
) -> Result<HttpResponsePayload, String> {
    let proxy = parse_outbound_proxy(options.as_ref().and_then(|item| item.proxy.as_deref()))?;
    let client = apply_async_proxy(
        reqwest::Client::builder().danger_accept_invalid_certs(true),
        proxy,
    )
    .build()
    .map_err(|e| e.to_string())?;

    let method_str = options
        .as_ref()
        .and_then(|o| o.method.clone())
        .unwrap_or_else(|| "GET".to_string());

    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| e.to_string())?;

    let mut req_builder = client.request(method, &url);

    if let Some(opt) = options {
        if let Some(headers_map) = opt.headers {
            let mut header_map = HeaderMap::new();
            for (k, v) in headers_map {
                if let (Ok(name), Ok(val)) = (
                    HeaderName::from_bytes(k.as_bytes()),
                    HeaderValue::from_str(&v),
                ) {
                    header_map.insert(name, val);
                }
            }
            req_builder = req_builder.headers(header_map);
        }

        if let Some(body_val) = opt.body {
            if let Some(s) = body_val.as_str() {
                req_builder = req_builder.body(s.to_string());
            } else {
                req_builder = req_builder.json(&body_val);
            }
        }
    }

    let resp = req_builder.send().await.map_err(|e| e.to_string())?;
    let status_code = resp.status().as_u16();

    let mut res_headers = HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(val) = v.to_str() {
            res_headers.insert(k.as_str().to_string(), val.to_string());
        }
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;

    Ok(HttpResponsePayload {
        status_code,
        headers: res_headers,
        body,
    })
}

#[derive(Debug, Serialize)]
pub struct MediaProbePayload {
    #[serde(rename = "statusCode")]
    pub status_code: u16,
    #[serde(rename = "contentType")]
    pub content_type: String,
    #[serde(rename = "finalUrl")]
    pub final_url: String,
}

/// 探测媒体地址是否可拉流：只读取响应头，不下载音频内容。
/// 用于音源可用性检测，避免 `http_request` 把整首音频读成文本。
#[tauri::command]
pub async fn probe_media_url(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<MediaProbePayload, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req_builder = client
        .get(&url)
        .header(reqwest::header::RANGE, "bytes=0-2047");

    if let Some(headers_map) = headers {
        let mut header_map = HeaderMap::new();
        for (k, v) in headers_map {
            if let (Ok(name), Ok(val)) = (
                HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_str(&v),
            ) {
                header_map.insert(name, val);
            }
        }
        req_builder = req_builder.headers(header_map);
    }

    let resp = req_builder.send().await.map_err(|e| e.to_string())?;
    let status_code = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let final_url = resp.url().to_string();

    // 只探测响应头：丢弃响应体，避免下载整段音频
    drop(resp);

    Ok(MediaProbePayload {
        status_code,
        content_type,
        final_url,
    })
}

