// ─── Update Sources ───

/** 本仓库。更新检查和安装包都从这里取，不跟随原项目发版。 */
export const APP_UPDATE_REPO = 'martjay/free-music-online';

export const APP_RELEASES_URL = `https://github.com/${APP_UPDATE_REPO}/releases/latest`;

/** 版本检查源列表（按优先级排列） */
export const UPDATE_SOURCES = [
    `https://raw.githubusercontent.com/${APP_UPDATE_REPO}/main/release/version.json`,
    `https://cdn.jsdelivr.net/gh/${APP_UPDATE_REPO}@main/release/version.json`,
    `https://gh-proxy.org/https://raw.githubusercontent.com/${APP_UPDATE_REPO}/main/release/version.json`,
    `https://hk.gh-proxy.org/https://raw.githubusercontent.com/${APP_UPDATE_REPO}/main/release/version.json`,
    `https://cdn.gh-proxy.org/https://raw.githubusercontent.com/${APP_UPDATE_REPO}/main/release/version.json`,
];

/** Tauri NSIS 安装包文件名，和打包产物保持一致。 */
export function appInstallerName(version: string): string {
    return `FreeMusicOnline_${version}_x64-setup.exe`;
}

export function appInstallerUrl(version: string): string {
    return `https://github.com/${APP_UPDATE_REPO}/releases/download/v${version}/${appInstallerName(version)}`;
}

/** 直连失败时再走常见镜像。非 GitHub 地址只保留原链接。 */
export function withDownloadMirrors(url: string): string[] {
    if (!url.includes('github.com/')) return [url];
    return [url, `https://gh-proxy.org/${url}`, `https://hk.gh-proxy.org/${url}`];
}

/** 桥接 key */
export const CONTEXT_BRIDGE_KEY = '@infra/system-util';
