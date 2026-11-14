/**
 * 平台检测测到的播放耗时。
 * 换源时按这个时间从快到慢调用，避免每次都换成不同平台。
 */

const STORAGE_KEY = 'plugin-playback-latency:v1';

let cache: Record<string, number> | null = null;

function readCache(): Record<string, number> {
    if (cache) return cache;
    cache = {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        if (!parsed || typeof parsed !== 'object') return cache;
        for (const [hash, value] of Object.entries(parsed)) {
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
                cache[hash] = value;
            }
        }
    } catch {
        // 隐私模式或损坏的记录不影响播放
    }
    return cache;
}

function persist(next: Record<string, number>): void {
    cache = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // 写失败时本次会话仍使用内存里的结果
    }
}

/** 最近一次检测里，拿到可播放地址并探活成功的耗时（毫秒） */
export function getPluginPlaybackLatency(hash: string): number | null {
    const value = readCache()[hash];
    return typeof value === 'number' ? value : null;
}

export function rememberPluginPlaybackLatency(hash: string, latencyMs: number): void {
    if (!hash || !Number.isFinite(latencyMs) || latencyMs <= 0) return;
    persist({ ...readCache(), [hash]: Math.round(latencyMs) });
}

export function forgetPluginPlaybackLatency(hash: string): void {
    const current = readCache();
    if (!(hash in current)) return;
    const next = { ...current };
    delete next[hash];
    persist(next);
}

/** 导入配置时一次写完，避免每个平台都重写本地记录。 */
export function applyPluginPlaybackLatencies(
    updates: Array<{ hash: string; latencyMs: number | null }>,
): void {
    const next = { ...readCache() };
    for (const item of updates) {
        if (!item.hash) continue;
        if (item.latencyMs != null && Number.isFinite(item.latencyMs) && item.latencyMs > 0) {
            next[item.hash] = Math.round(item.latencyMs);
        } else {
            delete next[item.hash];
        }
    }
    persist(next);
}
