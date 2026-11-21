/**
 * 平台检测测到的播放耗时。
 * 换源时按这个时间从快到慢调用，避免每次都换成不同平台。
 */

const STORAGE_KEY = 'plugin-playback-latency:v1';
const PREFERRED_KEY = 'plugin-playback-preferred:v1';
const PROVEN_KEY = 'plugin-playback-proven:v1';
const MAX_PROVEN = 8;

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

function readHashList(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (item): item is string => typeof item === 'string' && item.trim() !== '',
        );
    } catch {
        return [];
    }
}

/**
 * 实际出过声的平台。检测耗时仍是底序，这些平台只是整组排到前面。
 * 某一首歌没有地址，不会从这里删掉。
 */
export function getProvenPlaybackPlugins(): string[] {
    let hashes: string[] = [];
    try {
        hashes = readHashList(localStorage.getItem(PROVEN_KEY));
        const legacy = localStorage.getItem(PREFERRED_KEY)?.trim();
        if (legacy && !hashes.includes(legacy)) hashes.unshift(legacy);
    } catch {
        hashes = [];
    }
    return hashes.slice(0, MAX_PROVEN);
}

export function rememberProvenPlaybackPlugin(hash: string): void {
    if (!hash) return;
    const next = [hash, ...getProvenPlaybackPlugins().filter((item) => item !== hash)].slice(
        0,
        MAX_PROVEN,
    );
    try {
        localStorage.setItem(PROVEN_KEY, JSON.stringify(next));
        localStorage.removeItem(PREFERRED_KEY);
    } catch {
        // 记不住时这次会话仍按检测顺序播放
    }
}

/**
 * 播放候选的排序值，越小越先试。
 * 先是出过声的源，组内仍按检测耗时；没出过声的再按同一套检测耗时。
 * 都没测过时，歌曲自带平台先于其它未测平台。
 */
export function playbackSourceRank(
    hash: string,
    originalHash: string,
    proven: ReadonlySet<string>,
    latencyMs: number | null,
): number {
    const provenRank = proven.has(hash) ? 0 : 2_000_000_000;
    if (latencyMs != null) return provenRank + latencyMs;
    if (hash && hash === originalHash) return provenRank + 1_000_000_000;
    return provenRank + 1_500_000_000;
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
