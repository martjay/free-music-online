export type RuntimePlatform = 'android' | 'ios' | 'windows' | 'linux' | 'macos' | 'unknown';

function hasMobilePreviewFlag(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get('mobile') === '1' || params.get('mobile') === 'android';
    } catch {
        return false;
    }
}

export function getRuntimePlatform(): RuntimePlatform {
    if (hasMobilePreviewFlag()) return 'android';
    if (typeof navigator === 'undefined') return 'unknown';
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Windows NT/i.test(ua)) return 'windows';
    if (/Mac OS X/i.test(ua)) return 'macos';
    if (/Linux/i.test(ua)) return 'linux';
    return 'unknown';
}

/** Tauri Android / iOS WebView, or Windows layout preview via `?mobile=1`. */
export function isMobileApp(): boolean {
    const platform = getRuntimePlatform();
    return platform === 'android' || platform === 'ios';
}

export function applyRuntimePlatformAttr(): void {
    if (typeof document === 'undefined') return;
    const platform = getRuntimePlatform();
    document.documentElement.dataset.platform = platform;
    document.documentElement.classList.toggle('is-mobile-app', isMobileApp());
}
