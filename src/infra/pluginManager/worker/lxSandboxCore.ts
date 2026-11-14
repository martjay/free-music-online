/**
 * pluginManager — 洛雪插件沙箱核心（Web Worker 移植版）
 *
 * 由旧版插件沙箱移植：
 * - Node VM 沙箱执行 → new Function 执行（Worker 环境）
 * - axios / lx.request → host_request 消息桥（宿主经 Tauri http_request 转发，穿透 CORS）
 * - 移除 crypto / https / Buffer 等 Node 依赖
 *   注意：LX 的 lx.utils.crypto 仍需 MD5/AES，这里用浏览器可用的 crypto-js 实现
 * 由 lxWorker.ts 在 Web Worker 中加载运行。
 */

import CryptoJS from 'crypto-js';
import {
    decodeKrc,
    decodeKuwoLyricx,
    decodeQrc,
    fixTlrcTimeTag,
    parseKuwoLrc,
    parseQrcToLrc,
} from '../../../common/lyricCodec';

// ─── Worker 侧：与宿主的 HTTP 桥 ───

interface IHostHttpResult {
    status: number;
    headers: Record<string, string>;
    data: any;
}

interface IHostHttpOptions {
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
    responseType?: string;
}

const workerScope = self as unknown as { postMessage: (message: any) => void };

const pendingHostRequests = new Map<
    string,
    { resolve: (value: IHostHttpResult) => void; reject: (err: Error) => void }
>();
let hostRequestSeq = 0;

/** 宿主回复入口（由 lxWorker.ts 收到 host_response 时调用） */
export function handleHostResponse(
    reqId: string,
    result: IHostHttpResult | null,
    error: string | null,
): void {
    const waiter = pendingHostRequests.get(reqId);
    if (!waiter) return;
    pendingHostRequests.delete(reqId);
    if (error || !result) {
        waiter.reject(new Error(error || 'Host request failed'));
    } else {
        waiter.resolve(result);
    }
}

/** 向宿主发起 HTTP 请求（宿主走 Tauri http_request） */
function hostHttp(
    method: string,
    url: string,
    options: IHostHttpOptions = {},
): Promise<IHostHttpResult> {
    const reqId = `req_${++hostRequestSeq}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
        pendingHostRequests.set(reqId, { resolve, reject });
        workerScope.postMessage({
            type: 'host_request',
            reqId,
            payload: {
                method,
                url,
                headers: options.headers,
                body: options.body,
                responseType: options.responseType,
            },
        });
    });
}

function buildUrlWithParams(url: string, params?: Record<string, any>): string {
    if (!params) return url;
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        usp.append(key, String(value));
    }
    const query = usp.toString();
    if (!query) return url;
    return url + (url.includes('?') ? '&' : '?') + query;
}

/** axios 兼容 shim：适配器层沿用 axios.get / axios.post 的调用形态 */
const axios = {
    get(url: string, config: Record<string, any> = {}) {
        const finalUrl = buildUrlWithParams(url, config.params);
        return hostHttp('GET', finalUrl, {
            headers: config.headers,
            timeout: config.timeout,
            responseType: config.responseType,
        }).then((resp) => ({ status: resp.status, headers: resp.headers, data: resp.data }));
    },
    post(url: string, data?: any, config: Record<string, any> = {}) {
        const finalUrl = buildUrlWithParams(url, config.params);
        return hostHttp('POST', finalUrl, {
            headers: config.headers,
            body: data,
            timeout: config.timeout,
            responseType: config.responseType,
        }).then((resp) => ({ status: resp.status, headers: resp.headers, data: resp.data }));
    },
};

/** base64 文本解码（替代 Node Buffer） */
function decodeBase64Utf8(base64: string): string {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
}

/** 供沙箱全局使用的极简 Buffer 兼容垫片（覆盖 base64 与字符串场景） */
const BufferShim = {
    from(data: any, encoding?: string) {
        if (encoding === 'base64' && typeof data === 'string') {
            return { toString: (_enc?: string) => decodeBase64Utf8(data) };
        }
        if (typeof data === 'string') {
            return { toString: (_enc?: string) => data };
        }
        return { toString: () => String(data) };
    },
};

/** 把各种输入统一转成字节数组（模拟 Node Buffer.from 的常用编码） */
function toLxBytes(data: any, encoding?: string): Uint8Array {
    if (typeof data === 'string') {
        const enc = (encoding || 'utf8').toLowerCase();
        if (enc === 'base64') {
            const binary = atob(data);
            return Uint8Array.from(binary, (c) => c.charCodeAt(0));
        }
        if (enc === 'hex') {
            const bytes: number[] = [];
            for (let i = 0; i + 1 < data.length; i += 2)
                bytes.push(parseInt(data.slice(i, i + 2), 16));
            return Uint8Array.from(bytes);
        }
        return new TextEncoder().encode(data);
    }
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (Array.isArray(data)) return Uint8Array.from(data);
    if (data && typeof data === 'object' && data.buffer instanceof ArrayBuffer) {
        return new Uint8Array(
            data.buffer,
            data.byteOffset || 0,
            data.byteLength ?? data.length ?? 0,
        );
    }
    return new TextEncoder().encode(String(data));
}

/** 字节数组按指定编码转字符串（对应 Buffer#toString） */
function lxBytesToString(bytes: Uint8Array, format?: string): string {
    const fmt = (format || 'utf8').toLowerCase();
    if (fmt === 'hex') return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    if (fmt === 'base64') {
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary);
    }
    return new TextDecoder().decode(bytes);
}

/** Uint8Array ↔ crypto-js WordArray */
function bytesToWordArray(bytes: Uint8Array): any {
    const words: number[] = [];
    for (let i = 0; i < bytes.length; i++) words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
    return CryptoJS.lib.WordArray.create(words as any, bytes.length);
}

function wordArrayToBytes(wordArray: any): Uint8Array {
    const words: number[] = wordArray.words;
    const { sigBytes } = wordArray;
    const bytes = new Uint8Array(sigBytes);
    for (let i = 0; i < sigBytes; i++) {
        bytes[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    return bytes;
}

/** 洛雪 lx.utils 的 Worker 兼容实现（crypto-js 提供同步的 MD5/AES） */
const lxUtils = {
    buffer: {
        from: (data: any, encoding?: string) => toLxBytes(data, encoding),
        bufToString: (buffer: any, format?: string) => lxBytesToString(toLxBytes(buffer), format),
    },
    crypto: {
        md5: (value: any) =>
            CryptoJS.MD5(bytesToWordArray(toLxBytes(value))).toString(CryptoJS.enc.Hex),
        randomBytes: (size: number) => {
            const bytes = new Uint8Array(size);
            globalThis.crypto.getRandomValues(bytes);
            return bytes;
        },
        aesEncrypt: (buffer: any, mode = 'aes-128-cbc', key: any, iv?: any) => {
            const isEcb = /ecb/i.test(mode);
            const config: any = {
                mode: isEcb ? CryptoJS.mode.ECB : CryptoJS.mode.CBC,
                // 与洛雪保持一致：不做自动填充，由音源自行补齐块大小
                padding: CryptoJS.pad.NoPadding,
            };
            if (!isEcb) config.iv = bytesToWordArray(toLxBytes(iv ?? ''));
            const encrypted = CryptoJS.AES.encrypt(
                bytesToWordArray(toLxBytes(buffer)),
                bytesToWordArray(toLxBytes(key)),
                config,
            );
            return wordArrayToBytes(encrypted.ciphertext);
        },
        rsaEncrypt: () => {
            throw new Error('当前运行环境不支持 utils.crypto.rsaEncrypt');
        },
    },
};

/**
 * 创建受保护的沙箱全局对象。
 * 使用 Proxy 保护预注入的全局变量不被覆盖或删除，
 * 但允许插件代码创建新的全局变量（var/function 声明需要）。
 */
function createProtectedGlobal(globals: Record<string, any>): Record<string, any> {
    const frozenKeys = new Set(Object.keys(globals));

    return new Proxy(globals, {
        set(target, prop, value) {
            // 禁止覆盖预注入的全局变量
            if (frozenKeys.has(prop as string)) {
                return false;
            }
            // 允许插件声明新变量
            target[prop as string] = value;
            return true;
        },
        deleteProperty(target, prop) {
            if (frozenKeys.has(prop as string)) {
                return false;
            }
            delete target[prop as string];
            return true;
        },
        defineProperty(target, prop, descriptor) {
            if (frozenKeys.has(prop as string)) {
                return false;
            }
            Object.defineProperty(target, prop, descriptor);
            return true;
        },
    });
}

const LX_EVENT_NAMES = {
    request: 'request',
    inited: 'inited',
    updateAlert: 'updateAlert',
} as const;

const LX_QUALITY_MAP: Record<IMusic.IQualityKey, string> = {
    low: '128k',
    standard: '320k',
    high: 'flac',
    super: 'flac',
};

const LX_SEARCH_PAGE_SIZE = 30;
const NETEASE_PLAYLIST_PAGE_SIZE = 30;
const ONLINE_PLAYLIST_PAGE_SIZE = 30;
const BROWSER_USER_AGENT = 'Mozilla/5.0';
const MOBILE_USER_AGENT =
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const NETEASE_HEADERS = {
    Referer: 'https://music.163.com/',
    'User-Agent': BROWSER_USER_AGENT,
};
const KUGOU_HTTPS_AGENT = undefined; // Rust http_request 已忽略证书校验

type ILxRequestHandler = (payload: {
    source: string;
    action: string;
    info: Record<string, any>;
}) => unknown;

interface ILxSourceDefine {
    name?: string;
    type?: string;
    actions?: string[];
    qualitys?: string[];
}

interface ILxInitedPayload {
    sources?: Record<string, ILxSourceDefine>;
}

type ILxSearchResult = {
    isEnd?: boolean;
    data: any[];
};
type ILxMediaSearcher = (query: string, page: number, platform: string) => Promise<ILxSearchResult>;
type ILxLyricGetter = (musicInfo: Record<string, any>) => Promise<ILyric.ILyricSource | null>;
type ILxMusicInfoGetter = (
    musicInfo: Record<string, any>,
) => Promise<Partial<IMusic.IMusicItem> | null>;
type ILxMusicSheetImporter = (urlLike: string, platform: string) => Promise<IMusic.IMusicItem[]>;
type ILxAlbumInfoGetter = (
    albumItem: IAlbum.IAlbumItem,
    page: number,
    platform: string,
) => Promise<IPlugin.IAlbumInfoResult | null>;
type ILxArtistWorksGetter = (
    artistItem: IArtist.IArtistItem,
    page: number,
    type: IArtist.ArtistMediaType,
    platform: string,
) => Promise<ILxSearchResult>;
type ILxSheetInfoResult = {
    isEnd?: boolean;
    sheetItem?: IMusic.IMusicSheetItem;
    musicList?: IMusic.IMusicItem[];
};
type ILxTopListInfoResult = {
    isEnd?: boolean;
    topListItem?: IMusic.IMusicSheetItem;
    musicList?: IMusic.IMusicItem[];
};
type ILxRecommendSheetTagsResult = {
    pinned?: IMusic.IMusicSheetItem[];
    data?: IMusic.IMusicSheetGroupItem[];
    sorts?: Array<{ id: string; title: string }>;
};
type ILxPaginationResponse<T> = {
    isEnd?: boolean;
    data: T[];
};
type ILxTopListsGetter = (platform: string) => Promise<IMusic.IMusicSheetGroupItem[]>;
type ILxTopListDetailGetter = (
    topListItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
) => Promise<ILxTopListInfoResult>;
type ILxRecommendTagsGetter = () => Promise<ILxRecommendSheetTagsResult>;
type ILxRecommendSheetsGetter = (
    tag: IMedia.IUnique,
    page: number,
    platform: string,
    sortId?: string,
) => Promise<ILxPaginationResponse<IMusic.IMusicSheetItem>>;
type ILxMusicSheetInfoGetter = (
    sheetItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
) => Promise<ILxSheetInfoResult | null>;

type IParsedSheetLink = {
    id: string;
    url?: string;
    collection?: boolean;
};

function readPluginHeader(code: string): Record<string, string> {
    // 洛雪音源用 /*! ... */，也兼容 /** ... */
    const match = code.match(/\/\*[!*]([\s\S]*?)\*\//);
    if (!match) return {};

    const meta: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
        const item = line.match(/^\s*\*\s*@([\w-]+)\s+(.+?)\s*$/);
        if (item) {
            meta[item[1]] = item[2];
        }
    }
    return meta;
}

/** 文件头键名大小写不统一，@updateURL / @update_url 都认 */
function readHeaderValue(meta: Record<string, string>, ...keys: string[]): string | undefined {
    const folded = new Map(
        Object.entries(meta).map(([key, value]) => [key.toLowerCase(), value.trim()]),
    );
    for (const key of keys) {
        const value = folded.get(key.toLowerCase());
        if (value) return value;
    }
    return undefined;
}

/** 从文件头取出更新日期。@update 有时是更新说明，只接受日期。 */
function scriptUpdateDate(meta: Record<string, string>): string | undefined {
    const candidates = [
        readHeaderValue(meta, 'lastupdate', 'last_update', 'last-update'),
        readHeaderValue(meta, 'update', 'updated', 'date'),
        readHeaderValue(meta, 'version'),
    ];
    for (const value of candidates) {
        const match = value?.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (!match) continue;
        return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
    return undefined;
}

function extractLxMusicInfo(musicItem: IMusic.IMusicItemPartial): Record<string, any> {
    const raw = (musicItem as any)?.raw ?? (musicItem as any)?.musicInfo ?? {};
    return {
        ...raw,
        ...musicItem,
    };
}

function buildLxMusicInfo(
    musicItem: IMusic.IMusicItemPartial,
    sourceKey: string,
): Record<string, any> {
    const info = extractLxMusicInfo(musicItem);
    const fallbackId =
        info.id ??
        info.songId ??
        info.songmid ??
        info.hash ??
        info.rid ??
        info.DC_TARGETID ??
        info.contentId ??
        info.copyrightId;

    if (sourceKey === 'kg') {
        info.hash ??= fallbackId;
    } else {
        info.songmid ??= fallbackId;
    }

    return info;
}

function getMiguToneFlag(quality: IMusic.IQualityKey): string {
    if (quality === 'low') return 'LQ';
    if (quality === 'high') return 'HQ';
    if (quality === 'super') return 'SQ';
    return 'PQ';
}

async function getOfficialLxMediaSource(
    sourceKey: string,
    musicInfo: Record<string, any>,
    quality: IMusic.IQualityKey,
): Promise<IPlugin.IMediaSourceResult | null> {
    if (sourceKey === 'wy') {
        const songId = musicInfo.songmid ?? musicInfo.id ?? musicInfo.songId;
        if (!songId) return null;

        return {
            url: `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(
                String(songId),
            )}.mp3`,
            headers: {
                Referer: 'https://music.163.com/',
                'User-Agent': BROWSER_USER_AGENT,
            },
            quality,
        };
    }

    if (sourceKey === 'mg') {
        const contentId =
            musicInfo.contentId ?? (/^\w{18}$/.test(String(musicInfo.id)) ? musicInfo.id : null);
        if (!contentId) return null;

        const resp = await axios.get(
            'https://app.pd.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do',
            {
                params: {
                    contentId,
                    copyrightId: musicInfo.copyrightId ?? '0',
                    resourceType: musicInfo.resourceType ?? '2',
                    toneFlag: getMiguToneFlag(quality),
                    netType: '00',
                    userId: '15548614588710179085069',
                    ua: 'Android_migu',
                    version: '5.1',
                    channel: '0',
                },
                headers: {
                    'User-Agent': MOBILE_USER_AGENT,
                    Referer: 'https://music.migu.cn/',
                },
                timeout: 15000,
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400,
            },
        );

        const url = resp.headers.location;
        if (!url) return null;

        return {
            url,
            headers: {
                Referer: 'https://music.migu.cn/',
                'User-Agent': MOBILE_USER_AGENT,
            },
            quality,
        };
    }

    return null;
}

function normalizeLxMusicUrlResult(result: any): IPlugin.IMediaSourceResult | null {
    if (!result) return null;
    if (typeof result === 'string') {
        return result ? { url: result } : null;
    }
    if (typeof result === 'object') {
        const url = result.url ?? result.musicUrl ?? result.location;
        if (!url) return null;
        return {
            url,
            headers: result.headers,
            userAgent: result.userAgent ?? result.headers?.['user-agent'],
        };
    }
    return null;
}

function getLxQuality(sourceKey: string, quality: IMusic.IQualityKey): string {
    if (sourceKey === 'kg') {
        return '128k';
    }
    return LX_QUALITY_MAP[quality] ?? '320k';
}

function normalizeLxMusicUrl(url: string, sourceKey: string): string {
    try {
        const parsed = new URL(url);

        if (sourceKey === 'tx' && parsed.pathname.includes('/kgqq/qq.php')) {
            parsed.protocol = 'https:';
            parsed.hostname = 'music.haitangw.cc';
            parsed.port = '';
            parsed.pathname = parsed.pathname.replace('/kgqq/qq.php', '/kgqq1/qq.php');
            return parsed.toString();
        }

        if (sourceKey === 'kg' && parsed.pathname.includes('/kg.php')) {
            parsed.searchParams.set('level', 'standard');
            return parsed.toString();
        }
    } catch {
        return url;
    }

    return url;
}

function normalizeArtistNames(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === 'string') return item;
                return item?.name ?? item?.singername ?? item?.author_name ?? '';
            })
            .filter(Boolean)
            .join(' / ');
    }
    return typeof value === 'string' && value ? value : '未知歌手';
}

function cleanSearchText(value: unknown): string {
    if (value == null) return '';
    return String(value)
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim();
}

function extractFirstUrl(value: string): string | null {
    const match = value.match(/https?:\/\/[^\s"'<>，。；、]+/i);
    return match?.[0] ?? null;
}

function parseNumericInput(value: string): string | null {
    const trimmed = value.trim();
    return /^\d{4,}$/.test(trimmed) ? trimmed : null;
}

async function resolveShareUrl(urlLike: string): Promise<string> {
    const firstUrl = extractFirstUrl(urlLike);
    if (!firstUrl) return urlLike.trim();

    try {
        const resp = await axios.get(firstUrl, {
            headers: {
                'User-Agent': BROWSER_USER_AGENT,
            },
            timeout: 10000,
            maxRedirects: 5,
            responseType: 'text',
            validateStatus: (status) => status >= 200 && status < 400,
        });
        return resp.request?.res?.responseUrl ?? firstUrl;
    } catch {
        return firstUrl;
    }
}

function getUrlParam(urlLike: string, names: string[]): string | null {
    try {
        const parsed = new URL(urlLike);
        for (const name of names) {
            const value =
                parsed.searchParams.get(name) ??
                parsed.hash.match(new RegExp(`[?&]${name}=([^&]+)`))?.[1];
            if (value) return decodeURIComponent(value);
        }
    } catch {
        return null;
    }
    return null;
}

function decodeTextEntities(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;

    const text = value
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim();

    return text || undefined;
}

function formatLrcTime(value: unknown): string | null {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return null;

    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

function buildKuwoLyricText(list: unknown): string | undefined {
    if (!Array.isArray(list)) return undefined;

    const lrc = list
        .map((item) => {
            const time = formatLrcTime(item?.time);
            if (!time) return null;
            const line = decodeTextEntities(item?.lineLyric) ?? '';
            return `[${time}]${line}`;
        })
        .filter(Boolean)
        .join('\n');

    return lrc || undefined;
}

function normalizeDurationSeconds(value: unknown): number | undefined {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n > 10000 ? Math.round(n / 1000) : Math.round(n);
}

function buildKuwoArtwork(path: unknown): string | undefined {
    if (typeof path !== 'string' || !path) return undefined;
    if (/^https?:\/\//i.test(path)) return path;
    return `https://img4.kuwo.cn/star/albumcover/${path}`;
}

function pickMiguArtwork(items: unknown): string | undefined {
    if (!Array.isArray(items)) return undefined;
    const preferred =
        items.find((item) => item?.imgSizeType === '02') ??
        items.find((item) => item?.imgSizeType === '01') ??
        items[0];
    return typeof preferred?.img === 'string' ? preferred.img : undefined;
}

async function fetchNeteaseSongDetails(songIds: unknown[]): Promise<Map<string, any>> {
    const ids = songIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);

    if (!ids.length) return new Map();

    try {
        const resp = await axios.get('https://music.163.com/api/song/detail/', {
            params: {
                ids: JSON.stringify(ids),
            },
            headers: {
                Referer: 'https://music.163.com/',
                'User-Agent': BROWSER_USER_AGENT,
            },
            timeout: 15000,
            responseType: 'json',
        });

        const songs = Array.isArray(resp.data?.songs) ? resp.data.songs : [];
        return new Map(songs.map((song: any) => [String(song.id), song]));
    } catch {
        return new Map();
    }
}

function mapNeteaseSongInfo(
    song: any,
    platform: string,
): Partial<IMusic.IMusicItem> & Record<string, any> {
    const album = song?.album ?? song?.al ?? {};
    return {
        id: String(song?.id),
        platform,
        title: cleanSearchText(song?.name),
        artist: normalizeArtistNames(song?.artists ?? song?.ar),
        album: cleanSearchText(album?.name),
        artwork: album?.picUrl ?? album?.blurPicUrl,
        duration: normalizeDurationSeconds(song?.duration ?? song?.dt),
        raw: song,
        songId: song?.id,
        songmid: song?.id,
    };
}

function splitKugouFilename(value: unknown): { artist?: string; title?: string } {
    const text = cleanSearchText(value);
    const match = text.match(/^(.+?)\s+-\s+(.+)$/);
    if (!match) return { title: text };
    return {
        artist: match[1],
        title: match[2],
    };
}

function mapTencentSongInfo(item: any, platform: string): IMusic.IMusicItem {
    const songMid = item.songmid ?? item.mid ?? item.media_mid ?? item.strMediaMid;
    const albumMid = item.albummid ?? item.album?.mid;
    return {
        id: String(songMid ?? item.songid ?? item.id ?? ''),
        platform,
        title: cleanSearchText(item.songname ?? item.name ?? item.title),
        artist: normalizeArtistNames(item.singer),
        album: cleanSearchText(item.albumname ?? item.album?.name ?? item.album?.title),
        artwork: albumMid
            ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
            : undefined,
        duration: normalizeDurationSeconds(item.interval),
        raw: item,
        songmid: songMid,
        songId: item.songid ?? item.songId ?? item.id,
        media_mid: item.media_mid,
        strMediaMid: item.strMediaMid,
    };
}

function mapKugouSongInfo(item: any, platform: string): IMusic.IMusicItem {
    const parsed = splitKugouFilename(item.filename);
    const title = cleanSearchText(
        item.songname ?? item.songname_original ?? item.audio_name ?? parsed.title,
    );
    const artist = cleanSearchText(
        item.singername ?? item.author_name ?? normalizeArtistNames(item.authors) ?? parsed.artist,
    );
    const artworkSource =
        item.trans_param?.union_cover ?? item.album_sizable_cover ?? item.imgurl ?? item.img;
    const artwork = artworkSource ? String(artworkSource).replace('{size}', '300') : undefined;

    return {
        id: String(item.hash ?? item.HASH ?? item.audio_id ?? item.album_audio_id),
        platform,
        title,
        artist: artist || parsed.artist || '未知歌手',
        album: cleanSearchText(item.album_name ?? item.albumname ?? item.remark),
        artwork,
        duration: normalizeDurationSeconds(item.duration ?? item.timelength),
        raw: item,
        hash: item.hash ?? item.HASH,
    };
}

function mapKuwoSongInfo(item: any, platform: string): IMusic.IMusicItem {
    const rid = String(item.DC_TARGETID ?? item.id ?? item.MUSICRID ?? '').replace(/^MUSIC_/, '');
    return {
        id: rid,
        platform,
        title: cleanSearchText(item.SONGNAME ?? item.NAME ?? item.name),
        artist: cleanSearchText(item.ARTIST ?? item.FARTIST ?? item.artist),
        album: cleanSearchText(item.ALBUM ?? item.album),
        artwork: buildKuwoArtwork(item.web_albumpic_short ?? item.albumpic),
        duration: normalizeDurationSeconds(item.DURATION ?? item.duration),
        raw: item,
        rid,
        songmid: rid,
        musicrid: item.MUSICRID,
        MUSICRID: item.MUSICRID,
        DC_TARGETID: item.DC_TARGETID ?? item.id,
    };
}

function mapNeteaseSheetItem(item: any, platform: string): IMusic.IMusicSheetItem {
    const creator = item?.creator ?? item?.user ?? {};
    const trackCount = Number(item?.trackCount ?? item?.trackNumber ?? item?.songCount ?? 0);
    const playCount = Number(item?.playCount ?? item?.subscribedCount ?? 0);

    return {
        id: String(item?.id ?? item?.playlistId),
        platform,
        title: cleanSearchText(item?.name ?? item?.title),
        artwork: item?.coverImgUrl ?? item?.picUrl ?? item?.coverUrl,
        description: cleanSearchText(
            item?.description ?? item?.copywriter ?? item?.updateFrequency,
        ),
        worksNum: trackCount > 0 ? trackCount : undefined,
        playCount: playCount > 0 ? playCount : undefined,
        artist: cleanSearchText(creator?.nickname ?? creator?.name),
        createAt: Number(item?.createTime) || undefined,
        raw: item,
    };
}

function mapNeteaseAlbumItem(item: any, platform: string): IAlbum.IAlbumItem {
    const artistSource =
        Array.isArray(item?.artists) && item.artists.length
            ? item.artists
            : item?.artist
              ? [item.artist]
              : undefined;
    const artist = normalizeArtistNames(artistSource);
    const publishTime = Number(item?.publishTime ?? item?.publish_time ?? 0);
    const size = Number(item?.size ?? item?.songCount ?? 0);

    return {
        id: String(item?.id),
        platform,
        title: cleanSearchText(item?.name ?? item?.title),
        artwork: item?.picUrl ?? item?.blurPicUrl,
        description: cleanSearchText(item?.description ?? item?.briefDesc),
        worksNum: size > 0 ? size : undefined,
        artist,
        date: publishTime ? new Date(publishTime).getFullYear().toString() : undefined,
        createAt: publishTime || undefined,
        raw: item,
    };
}

function mapNeteaseArtistItem(item: any, platform: string): IArtist.IArtistItem {
    return {
        id: String(item?.id),
        platform,
        name: cleanSearchText(item?.name),
        avatar: item?.img1v1Url ?? item?.picUrl ?? '',
        fans: Number(item?.fansSize ?? item?.fansCount) || undefined,
        description: cleanSearchText(item?.briefDesc ?? item?.description),
    };
}

function mapNeteaseTag(item: any): IMusic.IMusicSheetItem {
    const title = cleanSearchText(item?.name ?? item?.title ?? item);
    return {
        id: title,
        platform: '',
        title,
    };
}

function mapTencentSheetItem(item: any, platform: string): IMusic.IMusicSheetItem {
    const creator = item?.creator ?? {};
    return {
        id: String(item?.dissid ?? item?.tid ?? item?.id),
        platform,
        title: cleanSearchText(item?.dissname ?? item?.title ?? item?.topTitle),
        artwork: item?.imgurl ?? item?.picUrl ?? item?.logo,
        description: cleanSearchText(item?.introduction ?? item?.desc),
        worksNum: Number(item?.songnum ?? item?.song_count) || undefined,
        playCount: Number(item?.listennum ?? item?.listenCount) || undefined,
        artist: cleanSearchText(creator?.name ?? item?.nickname),
        raw: item,
    };
}

function mapKugouSheetItem(item: any, platform: string): IMusic.IMusicSheetItem {
    const artwork = item?.imgurl ?? item?.img_cover ?? item?.bannerurl ?? item?.album_img_9;
    return {
        id: String(item?.specialid ?? item?.rankid ?? item?.id),
        platform,
        title: cleanSearchText(item?.specialname ?? item?.rankname ?? item?.name),
        artwork: artwork ? String(artwork).replace('{size}', '300') : undefined,
        description: cleanSearchText(item?.intro ?? item?.description ?? item?.update_frequency),
        worksNum: Number(item?.songcount ?? item?.song_count ?? item?.total) || undefined,
        playCount:
            Number(
                item?.playcount ?? item?.play_count ?? item?.total_play_count ?? item?.play_times,
            ) || undefined,
        artist: cleanSearchText(item?.nickname ?? item?.singername),
        raw: item,
    };
}

function mapRecommendTag(id: unknown, title: unknown): IMusic.IMusicSheetItem {
    return {
        id: String(id ?? ''),
        platform: '',
        title: cleanSearchText(title),
    };
}

async function getTencentTopLists(platform: string): Promise<IMusic.IMusicSheetGroupItem[]> {
    const resp = await axios.get('https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg', {
        params: { format: 'json' },
        headers: { Referer: 'https://y.qq.com/', 'User-Agent': BROWSER_USER_AGENT },
        timeout: 15000,
        responseType: 'json',
    });
    const list = Array.isArray(resp.data?.data?.topList) ? resp.data.data.topList : [];
    const data = list
        .filter((item: any) => item?.id && item?.topTitle)
        .map((item: any) => mapTencentSheetItem(item, platform));
    return data.length ? [{ title: 'QQ音乐', data }] : [];
}

async function getTencentTopListDetail(
    topListItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxTopListInfoResult> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const resp = await axios.get('https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg', {
        params: {
            format: 'json',
            topid: topListItem.raw?.id ?? topListItem.id,
            page: 'detail',
            type: 'top',
            song_begin: (currentPage - 1) * ONLINE_PLAYLIST_PAGE_SIZE,
            song_num: ONLINE_PLAYLIST_PAGE_SIZE,
        },
        headers: { Referer: 'https://y.qq.com/', 'User-Agent': BROWSER_USER_AGENT },
        timeout: 15000,
        responseType: 'json',
    });
    const list = Array.isArray(resp.data?.songlist) ? resp.data.songlist : [];
    const musicList = list
        .map((item: any) => item?.data ?? item)
        .filter((item: any) => item?.songmid || item?.songid)
        .map((item: any) => mapTencentSongInfo(item, platform));
    const total = Number(resp.data?.total_song_num ?? 0);
    return {
        topListItem: {
            ...topListItem,
            artwork: resp.data?.topinfo?.pic_v12 ?? topListItem.artwork,
            description: cleanSearchText(resp.data?.topinfo?.info ?? topListItem.description),
        },
        musicList,
        isEnd:
            musicList.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && currentPage * ONLINE_PLAYLIST_PAGE_SIZE >= total),
    };
}

const TENCENT_PLAYLIST_HEADERS = { Referer: 'https://y.qq.com/', 'User-Agent': BROWSER_USER_AGENT };

function tencentMusicuUrl(data: Record<string, unknown>): string {
    return `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify(data))}`;
}

function mapTencentCategorySheet(basic: any, platform: string): IMusic.IMusicSheetItem {
    return {
        id: String(basic?.tid ?? ''),
        platform,
        title: cleanSearchText(basic?.title),
        artwork: basic?.cover?.medium_url || basic?.cover?.default_url,
        description: cleanSearchText(String(basic?.desc ?? '').replace(/<br>/g, '\n')),
        worksNum: Number(basic?.song_cnt) || undefined,
        playCount: Number(basic?.play_cnt) || undefined,
        artist: cleanSearchText(basic?.creator?.nick),
        raw: basic,
    };
}

async function fetchTencentRecommendPlaylists(
    page: number,
    platform: string,
): Promise<ILxPaginationResponse<IMusic.IMusicSheetItem>> {
    const resp = await axios.get(
        tencentMusicuUrl({
            comm: { cv: 1602, ct: 20 },
            playlist: {
                module: 'music.playlist.PlaylistSquare',
                method: 'GetRecommendWhole',
                param: {
                    IsReqFeed: true,
                    FeedReq: {
                        From: (page - 1) * ONLINE_PLAYLIST_PAGE_SIZE,
                        Size: ONLINE_PLAYLIST_PAGE_SIZE,
                    },
                },
            },
        }),
        { headers: TENCENT_PLAYLIST_HEADERS, timeout: 15000, responseType: 'json' },
    );
    const list = Array.isArray(resp.data?.playlist?.data?.FeedRsp?.List)
        ? resp.data.playlist.data.FeedRsp.List
        : [];
    return {
        data: list
            .map((item: any) => item?.Playlist?.basic)
            .filter((item: any) => item?.tid && item?.title)
            .map((item: any) => mapTencentCategorySheet(item, platform)),
        isEnd: list.length < ONLINE_PLAYLIST_PAGE_SIZE,
    };
}

async function fetchTencentCategoryPlaylists(
    categoryId: string,
    page: number,
    platform: string,
): Promise<ILxPaginationResponse<IMusic.IMusicSheetItem>> {
    const resp = await axios.get(
        tencentMusicuUrl({
            comm: { cv: 1602, ct: 20 },
            playlist: {
                method: 'get_category_content',
                param: {
                    titleid: Number(categoryId),
                    caller: '0',
                    category_id: Number(categoryId),
                    size: ONLINE_PLAYLIST_PAGE_SIZE,
                    page: page - 1,
                    use_page: 1,
                },
                module: 'playlist.PlayListCategoryServer',
            },
        }),
        { headers: TENCENT_PLAYLIST_HEADERS, timeout: 15000, responseType: 'json' },
    );
    const content = resp.data?.playlist?.data?.content ?? {};
    const list = Array.isArray(content.v_item) ? content.v_item : [];
    const total = Number(content.total_cnt ?? 0);
    return {
        data: list
            .map((item: any) => item?.basic)
            .filter((item: any) => item?.tid && item?.title)
            .map((item: any) => mapTencentCategorySheet(item, platform)),
        isEnd:
            list.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && page * ONLINE_PLAYLIST_PAGE_SIZE >= total),
    };
}

async function getTencentRecommendSheetTags(): Promise<ILxRecommendSheetTagsResult> {
    const resp = await axios.get(
        tencentMusicuUrl({
            tags: {
                method: 'get_all_categories',
                param: { qq: '' },
                module: 'playlist.PlaylistAllCategoriesServer',
            },
        }),
        { headers: TENCENT_PLAYLIST_HEADERS, timeout: 15000, responseType: 'json' },
    );
    const groups = Array.isArray(resp.data?.tags?.data?.v_group) ? resp.data.tags.data.v_group : [];
    const data = groups
        .map((group: any) => ({
            title: cleanSearchText(group?.group_name),
            data: (Array.isArray(group?.v_item) ? group.v_item : [])
                .filter((item: any) => item?.id != null && item?.name)
                .map((item: any) => mapRecommendTag(item.id, item.name)),
        }))
        .filter((group: IMusic.IMusicSheetGroupItem) => group.data.length);
    const hot = data.find((group: IMusic.IMusicSheetGroupItem) => group.title === '热门');
    const pinned = (hot?.data ?? data[0]?.data ?? []).slice(0, 10);
    return {
        pinned,
        data,
        sorts: [
            { id: '-1', title: '推荐' },
            { id: '3', title: '最热' },
            { id: '2', title: '最新' },
        ],
    };
}

async function getTencentRecommendSheetsByTag(
    tag: IMedia.IUnique,
    page: number,
    platform: string,
    sortId = '-1',
): Promise<ILxPaginationResponse<IMusic.IMusicSheetItem>> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const tagId = tag?.id && tag.id !== 'all' ? String(tag.id) : '';
    if (!tagId) {
        if (!sortId || sortId === '-1')
            return fetchTencentRecommendPlaylists(currentPage, platform);
        return fetchTencentCategoryPlaylists(sortId, currentPage, platform);
    }
    return fetchTencentCategoryPlaylists(tagId, currentPage, platform);
}

/** 歌单详情里的 dissid 有时是被截断的数字，保留更长的那一串。 */
function tencentSheetId(sheetItem: IMusic.IMusicSheetItem): string {
    const raw = sheetItem.raw ?? {};
    const fromRaw = String(raw.tid ?? raw.disstid ?? raw.dissid ?? '').trim();
    const fromId = String(sheetItem.id ?? '').trim();
    if (/^\d+$/.test(fromRaw) && /^\d+$/.test(fromId)) {
        return fromRaw.length >= fromId.length ? fromRaw : fromId;
    }
    return fromRaw || fromId;
}

function tencentDissParam(id: string): number | string {
    if (/^\d+$/.test(id) && Number.isSafeInteger(Number(id))) return Number(id);
    return id;
}

function parseMaybeJson(data: unknown): any {
    if (data && typeof data === 'object') return data;
    if (typeof data !== 'string') return null;
    const trimmed = data.trim();
    try {
        return JSON.parse(trimmed);
    } catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

async function fetchTencentPlaylistByMusicu(
    sheetItem: IMusic.IMusicSheetItem,
    disstid: string,
    start: number,
    platform: string,
): Promise<ILxSheetInfoResult | null> {
    const resp = await axios.get(
        tencentMusicuUrl({
            comm: { ct: 24, cv: 0 },
            req_1: {
                module: 'music.srfDissInfo.DissInfo',
                method: 'CgiGetDiss',
                param: {
                    disstid: tencentDissParam(disstid),
                    userinfo: 1,
                    tag: 1,
                    song_begin: start,
                    song_num: ONLINE_PLAYLIST_PAGE_SIZE,
                    onlysonglist: 0,
                    enc_song_info: 0,
                },
            },
        }),
        { headers: TENCENT_PLAYLIST_HEADERS, timeout: 15000, responseType: 'json' },
    );
    const payload = resp.data?.req_1;
    if (!payload || payload.code !== 0) return null;
    const data = payload.data ?? {};
    const songs = Array.isArray(data.songlist) ? data.songlist : [];
    const dir = data.dirinfo ?? {};
    const total = Number(dir.songnum ?? data.total_song_num ?? 0);
    if (!songs.length && !dir.title && !total) return null;
    return {
        sheetItem: {
            ...sheetItem,
            title: cleanSearchText(dir.title) || sheetItem.title,
            artwork: dir.picurl || sheetItem.artwork,
            description: cleanSearchText(dir.desc) || sheetItem.description,
            worksNum: total || sheetItem.worksNum,
            artist: cleanSearchText(dir.creator?.nick ?? dir.host_nick) || sheetItem.artist,
        },
        musicList: songs
            .filter((item: any) => item?.mid || item?.songmid || item?.name || item?.songname)
            .map((item: any) => mapTencentSongInfo(item, platform)),
        isEnd:
            songs.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && start + songs.length >= total),
    };
}

async function fetchTencentPlaylistByLegacy(
    sheetItem: IMusic.IMusicSheetItem,
    disstid: string,
    start: number,
    platform: string,
): Promise<ILxSheetInfoResult | null> {
    const resp = await axios.get(
        'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg',
        {
            params: {
                type: 1,
                json: 1,
                utf8: 1,
                onlysong: 0,
                disstid,
                format: 'json',
                g_tk: 5381,
                loginUin: 0,
                hostUin: 0,
                inCharset: 'utf8',
                outCharset: 'utf-8',
                notice: 0,
                platform: 'yqq',
                needNewCode: 0,
            },
            headers: { Referer: 'https://y.qq.com/', 'User-Agent': BROWSER_USER_AGENT },
            timeout: 15000,
            responseType: 'json',
        },
    );
    const body = parseMaybeJson(resp.data);
    const playlist = body?.cdlist?.[0];
    if (!playlist) return null;
    const songs = Array.isArray(playlist.songlist) ? playlist.songlist : [];
    const pageSongs = songs.slice(start, start + ONLINE_PLAYLIST_PAGE_SIZE);
    return {
        sheetItem: { ...sheetItem, ...mapTencentSheetItem(playlist, platform) },
        musicList: pageSongs.map((item: any) => mapTencentSongInfo(item, platform)),
        isEnd: start + pageSongs.length >= songs.length,
    };
}

async function fetchTencentPlaylistInfo(
    sheetItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxSheetInfoResult | null> {
    const disstid = tencentSheetId(sheetItem);
    if (!disstid) return null;
    const currentPage = Math.max(Number(page) || 1, 1);
    const start = (currentPage - 1) * ONLINE_PLAYLIST_PAGE_SIZE;
    try {
        const modern = await fetchTencentPlaylistByMusicu(sheetItem, disstid, start, platform);
        if (modern?.musicList.length || modern?.isEnd) return modern;
    } catch {
        /* 新接口失败时再试旧歌单接口 */
    }
    try {
        return await fetchTencentPlaylistByLegacy(sheetItem, disstid, start, platform);
    } catch {
        return null;
    }
}

async function getKugouTopLists(platform: string): Promise<IMusic.IMusicSheetGroupItem[]> {
    const resp = await axios.get('http://mobilecdn.kugou.com/api/v3/rank/list', {
        params: { version: 9108, plat: 0 },
        headers: { Referer: 'https://www.kugou.com/', 'User-Agent': BROWSER_USER_AGENT },
        timeout: 15000,
        responseType: 'json',
    });
    const list = Array.isArray(resp.data?.data?.info) ? resp.data.data.info : [];
    const data = list
        .filter((item: any) => item?.rankid && item?.rankname)
        .map((item: any) => mapKugouSheetItem(item, platform));
    return data.length ? [{ title: '酷狗音乐', data }] : [];
}

async function getKugouTopListDetail(
    topListItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxTopListInfoResult> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const resp = await axios.get('http://mobilecdn.kugou.com/api/v3/rank/song', {
        params: {
            rankid: topListItem.raw?.rankid ?? topListItem.id,
            page: currentPage,
            pagesize: ONLINE_PLAYLIST_PAGE_SIZE,
            version: 9108,
            plat: 0,
        },
        headers: { Referer: 'https://www.kugou.com/', 'User-Agent': BROWSER_USER_AGENT },
        timeout: 15000,
        responseType: 'json',
    });
    const result = resp.data?.data ?? {};
    const list = Array.isArray(result.info) ? result.info : [];
    const musicList = list.map((item: any) => mapKugouSongInfo(item, platform));
    const total = Number(result.total ?? 0);
    return {
        topListItem,
        musicList,
        isEnd:
            musicList.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && currentPage * ONLINE_PLAYLIST_PAGE_SIZE >= total),
    };
}

async function getKugouRecommendSheetTags(): Promise<ILxRecommendSheetTagsResult> {
    const resp = await axios.get(
        'http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_smarty=1',
        {
            headers: { Referer: 'https://www.kugou.com/', 'User-Agent': BROWSER_USER_AGENT },
            timeout: 15000,
            responseType: 'json',
        },
    );
    const tagids = resp.data?.data?.tagids ?? {};
    const data = Object.keys(tagids)
        .map((name) => ({
            title: cleanSearchText(name),
            data: (Array.isArray(tagids[name]?.data) ? tagids[name].data : [])
                .filter((item: any) => item?.id != null && item?.name)
                .map((item: any) => mapRecommendTag(item.id, item.name)),
        }))
        .filter((group: IMusic.IMusicSheetGroupItem) => group.data.length);
    const hotData = resp.data?.data?.hotTag?.data ?? {};
    const pinned = Object.keys(hotData)
        .map((key) => hotData[key])
        .filter((item: any) => item?.special_id != null && item?.special_name)
        .sort((a: any, b: any) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
        .map((item: any) => mapRecommendTag(item.special_id, item.special_name));
    return {
        pinned: pinned.length
            ? pinned
            : data.flatMap((group: IMusic.IMusicSheetGroupItem) => group.data).slice(0, 8),
        data,
        sorts: [
            { id: '5', title: '推荐' },
            { id: '6', title: '最热' },
            { id: '7', title: '最新' },
            { id: '3', title: '热藏' },
            { id: '8', title: '飙升' },
        ],
    };
}

async function getKugouRecommendSheetsByTag(
    tag: IMedia.IUnique,
    page: number,
    platform: string,
    sortId = '5',
): Promise<ILxPaginationResponse<IMusic.IMusicSheetItem>> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const tagId = tag?.id && tag.id !== 'all' ? String(tag.id) : '';
    const resp = await axios.get('http://www2.kugou.kugou.com/yueku/v9/special/getSpecial', {
        params: {
            is_ajax: 1,
            cdn: 'cdn',
            t: sortId || '5',
            c: tagId,
            p: currentPage,
        },
        headers: { Referer: 'https://www.kugou.com/', 'User-Agent': BROWSER_USER_AGENT },
        timeout: 15000,
        responseType: 'json',
    });
    const list = Array.isArray(resp.data?.special_db) ? resp.data.special_db : [];
    return {
        data: list
            .filter((item: any) => item?.specialid && item?.specialname)
            .map((item: any) => mapKugouSheetItem(item, platform)),
        isEnd: list.length < 20,
    };
}

async function fetchKugouPlaylistInfo(
    sheetItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxSheetInfoResult | null> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const resp = await axios.get('https://mobilecdn.kugou.com/api/v3/special/song', {
        params: {
            specialid: sheetItem.raw?.specialid ?? sheetItem.id,
            page: currentPage,
            pagesize: ONLINE_PLAYLIST_PAGE_SIZE,
            plat: 0,
            version: 9108,
        },
        headers: { Referer: 'https://www.kugou.com/', 'User-Agent': BROWSER_USER_AGENT },
        httpsAgent: KUGOU_HTTPS_AGENT,
        timeout: 15000,
        responseType: 'json',
    });
    const result = resp.data?.data ?? {};
    const list = Array.isArray(result.info) ? result.info : [];
    const total = Number(result.total ?? 0);
    return {
        sheetItem,
        musicList: list.map((item: any) => mapKugouSongInfo(item, platform)),
        isEnd:
            list.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && currentPage * ONLINE_PLAYLIST_PAGE_SIZE >= total),
    };
}

async function getNeteaseTopLists(platform: string): Promise<IMusic.IMusicSheetGroupItem[]> {
    const resp = await axios.get('https://music.163.com/api/toplist/detail', {
        headers: NETEASE_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });

    const list = Array.isArray(resp.data?.list) ? resp.data.list : [];
    const data = list
        .filter((item: any) => item?.id && item?.name)
        .map((item: any) => mapNeteaseSheetItem(item, platform));

    return data.length ? [{ title: '网易云音乐', data }] : [];
}

async function fetchNeteasePlaylistInfo(
    sheetItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxSheetInfoResult | null> {
    const playlistId = sheetItem.raw?.id ?? sheetItem.id;
    if (!playlistId) return null;

    const currentPage = Math.max(Number(page) || 1, 1);
    const offset = (currentPage - 1) * NETEASE_PLAYLIST_PAGE_SIZE;
    const resp = await axios.get('https://music.163.com/api/v6/playlist/detail', {
        params: {
            id: playlistId,
            n: NETEASE_PLAYLIST_PAGE_SIZE,
            s: 0,
        },
        headers: NETEASE_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });

    const playlist = resp.data?.playlist;
    if (!playlist) return null;

    const trackIds = Array.isArray(playlist.trackIds)
        ? playlist.trackIds.map((item: any) => item?.id).filter(Boolean)
        : [];
    const fallbackTracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    const pageIds = trackIds.slice(offset, offset + NETEASE_PLAYLIST_PAGE_SIZE);
    let tracks: any[] = [];

    if (pageIds.length) {
        const detailById = await fetchNeteaseSongDetails(pageIds);
        tracks = pageIds.map((id: any) => detailById.get(String(id))).filter(Boolean);
    }

    if (!tracks.length && currentPage === 1) {
        tracks = fallbackTracks.slice(0, NETEASE_PLAYLIST_PAGE_SIZE);
    } else if (!trackIds.length) {
        tracks = fallbackTracks.slice(offset, offset + NETEASE_PLAYLIST_PAGE_SIZE);
    }

    const total = Number(playlist.trackCount ?? trackIds.length ?? fallbackTracks.length ?? 0);
    const musicList = tracks
        .filter((item) => item?.id)
        .map((item) => mapNeteaseSongInfo(item, platform) as IMusic.IMusicItem);

    return {
        sheetItem: {
            ...sheetItem,
            ...mapNeteaseSheetItem(playlist, platform),
        },
        musicList,
        isEnd:
            musicList.length < NETEASE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && offset + NETEASE_PLAYLIST_PAGE_SIZE >= total),
    };
}

async function getNeteaseTopListDetail(
    topListItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxTopListInfoResult> {
    const result = await fetchNeteasePlaylistInfo(topListItem, page, platform);
    return {
        topListItem: result?.sheetItem ?? topListItem,
        musicList: result?.musicList ?? [],
        isEnd: result?.isEnd ?? true,
    };
}

async function getNeteaseRecommendSheetTags(): Promise<ILxRecommendSheetTagsResult> {
    const [hotResp, catalogResp] = await Promise.all([
        axios.get('https://music.163.com/api/playlist/hottags', {
            headers: NETEASE_HEADERS,
            timeout: 15000,
            responseType: 'json',
        }),
        axios.get('https://music.163.com/api/playlist/catalogue', {
            headers: NETEASE_HEADERS,
            timeout: 15000,
            responseType: 'json',
        }),
    ]);

    const categories = catalogResp.data?.categories ?? {};
    const sub = Array.isArray(catalogResp.data?.sub) ? catalogResp.data.sub : [];
    const grouped = new Map<string, IMusic.IMusicSheetItem[]>();
    for (const item of sub) {
        const title = cleanSearchText(categories[item?.category]);
        const name = cleanSearchText(item?.name);
        if (!title || !name) continue;
        const list = grouped.get(title) ?? [];
        list.push(mapRecommendTag(name, name));
        grouped.set(title, list);
    }
    const data = [...grouped.entries()].map(([title, items]) => ({ title, data: items }));
    const hotTags = (Array.isArray(hotResp.data?.tags) ? hotResp.data.tags : [])
        .map(mapNeteaseTag)
        .filter((item) => item.id);

    return {
        pinned: hotTags.length ? hotTags : data.flatMap((group) => group.data).slice(0, 8),
        data,
        sorts: [{ id: 'hot', title: '最热' }],
    };
}

async function getNeteaseRecommendSheetsByTag(
    tag: IMedia.IUnique,
    page: number,
    platform: string,
    sortId = 'hot',
): Promise<ILxPaginationResponse<IMusic.IMusicSheetItem>> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const category = cleanSearchText(tag?.title ?? tag?.id) || '全部';
    const resp = await axios.get('https://music.163.com/api/playlist/list', {
        params: {
            cat: category,
            order: sortId || 'hot',
            offset: (currentPage - 1) * NETEASE_PLAYLIST_PAGE_SIZE,
            limit: NETEASE_PLAYLIST_PAGE_SIZE,
            total: currentPage === 1,
        },
        headers: NETEASE_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });

    const playlists = Array.isArray(resp.data?.playlists) ? resp.data.playlists : [];
    const total = Number(resp.data?.total ?? 0);
    return {
        data: playlists.map((item: any) => mapNeteaseSheetItem(item, platform)),
        isEnd:
            resp.data?.more === false ||
            playlists.length < NETEASE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && currentPage * NETEASE_PLAYLIST_PAGE_SIZE >= total),
    };
}

async function getNeteaseMusicSheetInfo(
    sheetItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxSheetInfoResult | null> {
    return fetchNeteasePlaylistInfo(sheetItem, page, platform);
}

async function getNeteaseAlbumInfo(
    albumItem: IAlbum.IAlbumItem,
    page: number,
    platform: string,
): Promise<IPlugin.IAlbumInfoResult | null> {
    if (page > 1) {
        return {
            albumItem,
            musicList: [],
            isEnd: true,
        };
    }

    const albumId = albumItem.raw?.id ?? albumItem.id;
    if (!albumId) return null;

    const resp = await axios.get(`https://music.163.com/api/v1/album/${albumId}`, {
        headers: NETEASE_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });

    const album = resp.data?.album ?? albumItem.raw ?? {};
    const songs = Array.isArray(resp.data?.songs)
        ? resp.data.songs
        : Array.isArray(album?.songs)
          ? album.songs
          : [];

    return {
        albumItem: {
            ...albumItem,
            ...mapNeteaseAlbumItem(album, platform),
        },
        musicList: songs
            .filter((item: any) => item?.id)
            .map((item: any) => mapNeteaseSongInfo(item, platform) as IMusic.IMusicItem),
        isEnd: true,
    };
}

async function getNeteaseArtistWorks(
    artistItem: IArtist.IArtistItem,
    page: number,
    type: IArtist.ArtistMediaType,
    platform: string,
): Promise<ILxSearchResult> {
    const artistId = artistItem.id;
    if (!artistId) return { isEnd: true, data: [] };

    const currentPage = Math.max(Number(page) || 1, 1);
    const offset = (currentPage - 1) * LX_SEARCH_PAGE_SIZE;

    if (type === 'album') {
        const resp = await axios.get(`https://music.163.com/api/artist/albums/${artistId}`, {
            params: {
                offset,
                limit: LX_SEARCH_PAGE_SIZE,
            },
            headers: NETEASE_HEADERS,
            timeout: 15000,
            responseType: 'json',
        });

        const albums = Array.isArray(resp.data?.hotAlbums) ? resp.data.hotAlbums : [];
        return {
            isEnd: resp.data?.more === false || albums.length < LX_SEARCH_PAGE_SIZE,
            data: albums.map((item: any) => mapNeteaseAlbumItem(item, platform)),
        };
    }

    const resp = await axios.get('https://music.163.com/api/v1/artist/songs', {
        params: {
            id: artistId,
            order: 'hot',
            offset,
            limit: LX_SEARCH_PAGE_SIZE,
        },
        headers: NETEASE_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });

    const songs = Array.isArray(resp.data?.songs) ? resp.data.songs : [];
    const total = Number(resp.data?.total ?? 0);
    return {
        isEnd:
            resp.data?.more === false ||
            songs.length < LX_SEARCH_PAGE_SIZE ||
            (total > 0 && currentPage * LX_SEARCH_PAGE_SIZE >= total),
        data: songs.map((item: any) => mapNeteaseSongInfo(item, platform)),
    };
}

function parseNeteaseSheetLink(urlLike: string): IParsedSheetLink | null {
    const id =
        getUrlParam(urlLike, ['id', 'playlistId']) ??
        urlLike.match(/\/playlist\/(?:detail\/)?(\d+)/i)?.[1] ??
        parseNumericInput(urlLike);
    return id ? { id } : null;
}

function parseTencentSheetLink(urlLike: string): IParsedSheetLink | null {
    const id =
        getUrlParam(urlLike, ['disstid', 'id', 'dirid']) ??
        urlLike.match(/\/playlist\/(\d+)/i)?.[1] ??
        urlLike.match(/\/n\/ryqq\/playlist\/(\d+)/i)?.[1] ??
        parseNumericInput(urlLike);
    return id ? { id } : null;
}

function parseKuwoSheetLink(urlLike: string): IParsedSheetLink | null {
    const id =
        getUrlParam(urlLike, ['pid', 'playlistId', 'id']) ??
        urlLike.match(/\/playlist(?:_detail)?\/(\d+)/i)?.[1] ??
        urlLike.match(/\/play_detail\/(\d+)/i)?.[1] ??
        parseNumericInput(urlLike);
    return id ? { id } : null;
}

function parseKugouSheetLink(urlLike: string): IParsedSheetLink | null {
    const collection =
        getUrlParam(urlLike, ['global_specialid', 'global_collection_id']) ??
        urlLike.match(/collection_[\w-]+/i)?.[0];
    if (collection) {
        return {
            id: collection,
            url: extractFirstUrl(urlLike) ?? urlLike,
            collection: true,
        };
    }

    const id =
        getUrlParam(urlLike, ['specialid', 'global_collection_id', 'id']) ??
        urlLike.match(/\/special\/single\/(\d+)\.html/i)?.[1] ??
        urlLike.match(/\/plist\/list\/(\d+)/i)?.[1] ??
        urlLike.match(/\/playlist\/(\d+)/i)?.[1] ??
        parseNumericInput(urlLike);
    return id ? { id } : null;
}

function extractKugouCollectionData(html: string): any[] {
    const marker = html.match(/var\s+data\s*=\s*\[/);
    if (!marker?.index) return [];

    const start = html.indexOf('[', marker.index);
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < html.length; i += 1) {
        const ch = html[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (ch === '[') {
            depth += 1;
        } else if (ch === ']') {
            depth -= 1;
            if (depth === 0) {
                try {
                    const parsed = JSON.parse(html.slice(start, i + 1));
                    return Array.isArray(parsed) ? parsed : [];
                } catch {
                    return [];
                }
            }
        }
    }

    return [];
}

async function importNeteaseMusicSheet(
    urlLike: string,
    platform: string,
): Promise<IMusic.IMusicItem[]> {
    const resolved = await resolveShareUrl(urlLike);
    const parsed = parseNeteaseSheetLink(resolved);
    if (!parsed?.id) return [];

    const sheet = await fetchNeteasePlaylistInfo(
        { id: parsed.id, platform, title: '' },
        1,
        platform,
    );
    if (!sheet?.sheetItem?.raw) return sheet?.musicList ?? [];

    const raw = sheet.sheetItem.raw;
    const trackIds = Array.isArray(raw.trackIds)
        ? raw.trackIds.map((item: any) => item?.id).filter(Boolean)
        : [];
    if (!trackIds.length) return sheet.musicList ?? [];

    const chunks: unknown[][] = [];
    for (let i = 0; i < trackIds.length; i += 500) {
        chunks.push(trackIds.slice(i, i + 500));
    }

    const musicList: IMusic.IMusicItem[] = [];
    for (const chunk of chunks) {
        const detailById = await fetchNeteaseSongDetails(chunk);
        for (const id of chunk) {
            const song = detailById.get(String(id));
            if (song) {
                musicList.push(mapNeteaseSongInfo(song, platform) as IMusic.IMusicItem);
            }
        }
    }

    return musicList;
}

async function importTencentMusicSheet(
    urlLike: string,
    platform: string,
): Promise<IMusic.IMusicItem[]> {
    const resolved = await resolveShareUrl(urlLike);
    const parsed = parseTencentSheetLink(resolved);
    if (!parsed?.id) return [];

    const sheetItem: IMusic.IMusicSheetItem = { id: parsed.id, platform, title: '' };
    const musicList: IMusic.IMusicItem[] = [];
    for (let page = 1; page <= 40; page += 1) {
        const sheet = await fetchTencentPlaylistInfo(sheetItem, page, platform);
        if (!sheet?.musicList.length) break;
        musicList.push(...sheet.musicList);
        if (sheet.isEnd) break;
    }
    return musicList;
}

async function importKuwoMusicSheet(
    urlLike: string,
    platform: string,
): Promise<IMusic.IMusicItem[]> {
    const resolved = await resolveShareUrl(urlLike);
    const parsed = parseKuwoSheetLink(resolved);
    if (!parsed?.id) return [];

    const firstResp = await axios.get('https://nplserver.kuwo.cn/pl.svc', {
        params: {
            op: 'getlistinfo',
            pid: parsed.id,
            pn: 0,
            rn: 1,
            encode: 'utf8',
            keyset: 'pl2012',
        },
        headers: {
            Referer: 'https://www.kuwo.cn/',
            'User-Agent': BROWSER_USER_AGENT,
        },
        timeout: 15000,
        responseType: 'json',
    });

    const total = Number(firstResp.data?.total ?? 0);
    const resp = await axios.get('https://nplserver.kuwo.cn/pl.svc', {
        params: {
            op: 'getlistinfo',
            pid: parsed.id,
            pn: 0,
            rn: Math.max(total, 500),
            encode: 'utf8',
            keyset: 'pl2012',
        },
        headers: {
            Referer: 'https://www.kuwo.cn/',
            'User-Agent': BROWSER_USER_AGENT,
        },
        timeout: 15000,
        responseType: 'json',
    });

    const list = Array.isArray(resp.data?.musiclist) ? resp.data.musiclist : [];
    return list.map((item: any) => mapKuwoSongInfo(item, platform));
}

async function importKugouMusicSheet(
    urlLike: string,
    platform: string,
): Promise<IMusic.IMusicItem[]> {
    const resolved = await resolveShareUrl(urlLike);
    const parsed = parseKugouSheetLink(resolved);
    if (!parsed?.id) return [];

    if (parsed.collection) {
        const url = `https://www.kugou.com/yy/special/single/${parsed.id}.html`;
        const resp = await axios.get(url, {
            headers: {
                Referer: 'https://www.kugou.com/',
                'User-Agent': BROWSER_USER_AGENT,
            },
            timeout: 15000,
            responseType: 'text',
        });
        return extractKugouCollectionData(String(resp.data)).map((item: any) =>
            mapKugouSongInfo(item, platform),
        );
    }

    const pageSize = 200;
    const musicList: IMusic.IMusicItem[] = [];
    let page = 1;
    let total = Infinity;

    while (musicList.length < total && page <= 20) {
        const resp = await axios.get('https://mobilecdn.kugou.com/api/v3/special/song', {
            params: {
                specialid: parsed.id,
                page,
                pagesize: pageSize,
                plat: 0,
                version: 9108,
            },
            headers: {
                Referer: 'https://www.kugou.com/',
                'User-Agent': BROWSER_USER_AGENT,
            },
            httpsAgent: KUGOU_HTTPS_AGENT,
            timeout: 15000,
            responseType: 'json',
        });

        const data = resp.data?.data ?? {};
        const list = Array.isArray(data.info) ? data.info : [];
        total = Number(data.total ?? list.length);
        if (!list.length) break;
        musicList.push(...list.map((item: any) => mapKugouSongInfo(item, platform)));
        page += 1;
    }

    return musicList;
}

async function searchTencentMusic(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'music'>> {
    const resp = await axios.get('https://c.y.qq.com/soso/fcgi-bin/client_search_cp', {
        params: {
            format: 'json',
            w: query,
            p: page,
            n: LX_SEARCH_PAGE_SIZE,
        },
        headers: {
            'User-Agent': BROWSER_USER_AGENT,
        },
        timeout: 15000,
        responseType: 'json',
    });

    const song = resp.data?.data?.song ?? {};
    const list = Array.isArray(song.list) ? song.list : [];
    return {
        isEnd:
            list.length < LX_SEARCH_PAGE_SIZE || page * LX_SEARCH_PAGE_SIZE >= (song.totalnum ?? 0),
        data: list.map((item: any) => mapTencentSongInfo(item, platform)),
    };
}

async function searchNeteaseMusic(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'music'>> {
    const currentPage = Math.max(page, 1);
    const resp = await axios.post(
        'https://music.163.com/api/search/get/web',
        new URLSearchParams({
            s: query,
            type: '1',
            offset: String((currentPage - 1) * LX_SEARCH_PAGE_SIZE),
            limit: String(LX_SEARCH_PAGE_SIZE),
        }).toString(),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: 'https://music.163.com/',
                'User-Agent': BROWSER_USER_AGENT,
            },
            timeout: 15000,
            responseType: 'json',
        },
    );

    const result = resp.data?.result ?? {};
    const list = Array.isArray(result.songs) ? result.songs : [];
    const total = Number(result.songCount ?? 0);
    const detailById = await fetchNeteaseSongDetails(list.map((item: any) => item.id));

    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || currentPage * LX_SEARCH_PAGE_SIZE >= total,
        data: list.map((item: any) => {
            const detail = detailById.get(String(item.id));
            const merged = {
                ...mapNeteaseSongInfo(detail ?? item, platform),
                raw: {
                    ...item,
                    detail,
                },
            };

            if (!merged.album) merged.album = cleanSearchText(item.album?.name);
            if (!merged.artwork) merged.artwork = item.album?.picUrl ?? item.album?.blurPicUrl;
            if (!merged.duration) merged.duration = normalizeDurationSeconds(item.duration);
            return merged;
        }),
    };
}

async function searchNeteaseAlbum(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'album'>> {
    const currentPage = Math.max(page, 1);
    const resp = await axios.post(
        'https://music.163.com/api/search/get/web',
        new URLSearchParams({
            s: query,
            type: '10',
            offset: String((currentPage - 1) * LX_SEARCH_PAGE_SIZE),
            limit: String(LX_SEARCH_PAGE_SIZE),
        }).toString(),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...NETEASE_HEADERS,
            },
            timeout: 15000,
            responseType: 'json',
        },
    );

    const result = resp.data?.result ?? {};
    const list = Array.isArray(result.albums) ? result.albums : [];
    const total = Number(result.albumCount ?? 0);

    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || currentPage * LX_SEARCH_PAGE_SIZE >= total,
        data: list.map((item: any) => mapNeteaseAlbumItem(item, platform)),
    };
}

async function searchNeteaseArtist(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'artist'>> {
    const currentPage = Math.max(page, 1);
    const resp = await axios.post(
        'https://music.163.com/api/search/get/web',
        new URLSearchParams({
            s: query,
            type: '100',
            offset: String((currentPage - 1) * LX_SEARCH_PAGE_SIZE),
            limit: String(LX_SEARCH_PAGE_SIZE),
        }).toString(),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...NETEASE_HEADERS,
            },
            timeout: 15000,
            responseType: 'json',
        },
    );

    const result = resp.data?.result ?? {};
    const list = Array.isArray(result.artists) ? result.artists : [];
    const total = Number(result.artistCount ?? 0);

    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || currentPage * LX_SEARCH_PAGE_SIZE >= total,
        data: list.map((item: any) => mapNeteaseArtistItem(item, platform)),
    };
}

async function searchNeteaseSheet(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'sheet'>> {
    const currentPage = Math.max(page, 1);
    const resp = await axios.post(
        'https://music.163.com/api/search/get/web',
        new URLSearchParams({
            s: query,
            type: '1000',
            offset: String((currentPage - 1) * LX_SEARCH_PAGE_SIZE),
            limit: String(LX_SEARCH_PAGE_SIZE),
        }).toString(),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...NETEASE_HEADERS,
            },
            timeout: 15000,
            responseType: 'json',
        },
    );

    const result = resp.data?.result ?? {};
    const list = Array.isArray(result.playlists) ? result.playlists : [];
    const total = Number(result.playlistCount ?? 0);

    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || currentPage * LX_SEARCH_PAGE_SIZE >= total,
        data: list.map((item: any) => mapNeteaseSheetItem(item, platform)),
    };
}

async function searchKugouMusic(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'music'>> {
    const resp = await axios.get('https://mobiles.kugou.com/api/v3/search/song', {
        params: {
            format: 'json',
            keyword: query,
            page,
            pagesize: LX_SEARCH_PAGE_SIZE,
            showtype: 1,
        },
        headers: {
            'User-Agent': BROWSER_USER_AGENT,
        },
        timeout: 15000,
        responseType: 'json',
    });

    const data = resp.data?.data ?? {};
    const list = Array.isArray(data.info) ? data.info : [];
    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || page * LX_SEARCH_PAGE_SIZE >= (data.total ?? 0),
        data: list.map((item: any) => mapKugouSongInfo(item, platform)),
    };
}

async function searchKuwoMusic(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'music'>> {
    const currentPage = Math.max(page, 1);
    const resp = await axios.get('https://search.kuwo.cn/r.s', {
        params: {
            client: 'kt',
            all: query,
            pn: currentPage - 1,
            rn: LX_SEARCH_PAGE_SIZE,
            uid: 0,
            ver: 'kwplayer_ar_9.2.2.1',
            vipver: 1,
            show_copyright_off: 1,
            newver: 1,
            ft: 'music',
            cluster: 0,
            strategy: 2012,
            encoding: 'utf8',
            rformat: 'json',
            mobi: 1,
        },
        headers: {
            Referer: 'https://www.kuwo.cn/',
            'User-Agent': BROWSER_USER_AGENT,
        },
        timeout: 15000,
        responseType: 'json',
    });

    const list = Array.isArray(resp.data?.abslist) ? resp.data.abslist : [];
    const total = Number(resp.data?.TOTAL ?? resp.data?.HIT ?? 0);
    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || currentPage * LX_SEARCH_PAGE_SIZE >= total,
        data: list.map((item: any) => mapKuwoSongInfo(item, platform)),
    };
}

async function searchTencentSheet(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'sheet'>> {
    const currentPage = Math.max(page, 1);
    const resp = await axios.get('http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist', {
        params: {
            page_no: currentPage - 1,
            num_per_page: LX_SEARCH_PAGE_SIZE,
            format: 'json',
            query,
            remoteplace: 'txt.yqq.playlist',
            inCharset: 'utf8',
            outCharset: 'utf-8',
        },
        headers: {
            Referer: 'https://y.qq.com/',
            'User-Agent': BROWSER_USER_AGENT,
        },
        timeout: 15000,
        responseType: 'json',
    });
    const list = Array.isArray(resp.data?.data?.list) ? resp.data.data.list : [];
    const total = Number(resp.data?.data?.sum ?? 0);
    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || currentPage * LX_SEARCH_PAGE_SIZE >= total,
        data: list.map((item: any) => mapTencentSheetItem(item, platform)),
    };
}

async function searchKugouSheet(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'sheet'>> {
    const currentPage = Math.max(page, 1);
    const resp = await axios.get('http://msearchretry.kugou.com/api/v3/search/special', {
        params: {
            keyword: query,
            page: currentPage,
            pagesize: LX_SEARCH_PAGE_SIZE,
            showtype: 10,
            filter: 0,
            version: 7910,
            sver: 2,
        },
        headers: { Referer: 'https://www.kugou.com/', 'User-Agent': BROWSER_USER_AGENT },
        timeout: 15000,
        responseType: 'json',
    });
    const list = Array.isArray(resp.data?.data?.info) ? resp.data.data.info : [];
    const total = Number(resp.data?.data?.total ?? 0);
    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || currentPage * LX_SEARCH_PAGE_SIZE >= total,
        data: list.map((item: any) => mapKugouSheetItem(item, platform)),
    };
}

async function searchKuwoSheet(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'sheet'>> {
    const currentPage = Math.max(page, 1);
    const resp = await axios.get('https://search.kuwo.cn/r.s', {
        params: {
            client: 'kt',
            all: query,
            pn: currentPage - 1,
            rn: LX_SEARCH_PAGE_SIZE,
            ft: 'playlist',
            encoding: 'utf8',
            rformat: 'json',
            mobi: 1,
            vipver: 1,
        },
        headers: KUWO_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });
    const list = Array.isArray(resp.data?.abslist) ? resp.data.abslist : [];
    const total = Number(resp.data?.TOTAL ?? 0);
    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || currentPage * LX_SEARCH_PAGE_SIZE >= total,
        data: list.map((item: any) => mapKuwoSheetItem(item, platform)),
    };
}

async function searchMiguSheet(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'sheet'>> {
    const currentPage = Math.max(page, 1);
    const { list, total } = await searchMiguPlaylists(query, currentPage);
    return {
        isEnd:
            list.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && currentPage * ONLINE_PLAYLIST_PAGE_SIZE >= total),
        data: list.map((item: any) => mapMiguSheetItem(item, platform)),
    };
}

async function searchMiguMusic(
    query: string,
    page: number,
    platform: string,
): Promise<IPlugin.ISearchResult<'music'>> {
    const currentPage = Math.max(page, 1);
    const resp = await axios.get(
        'https://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do',
        {
            params: {
                text: query,
                pageNo: currentPage,
                pageSize: LX_SEARCH_PAGE_SIZE,
                searchSwitch: JSON.stringify({
                    song: 1,
                    album: 0,
                    singer: 0,
                    tagSong: 0,
                    mvSong: 0,
                    songlist: 0,
                    bestShow: 1,
                }),
            },
            headers: {
                Referer: 'http://music.migu.cn/',
                'User-Agent': MOBILE_USER_AGENT,
            },
            timeout: 15000,
            responseType: 'json',
        },
    );

    const result = resp.data?.songResultData ?? {};
    const list = Array.isArray(result.result) ? result.result : [];
    const total = Number(result.totalCount ?? 0);
    return {
        isEnd: list.length < LX_SEARCH_PAGE_SIZE || currentPage * LX_SEARCH_PAGE_SIZE >= total,
        data: list.map((item: any) => {
            const id = String(item.copyrightId ?? item.contentId ?? item.id);
            return {
                id,
                platform,
                title: cleanSearchText(item.name),
                artist: normalizeArtistNames(item.singers),
                album: cleanSearchText(item.albums?.[0]?.name),
                artwork: pickMiguArtwork(item.imgItems),
                raw: item,
                songId: item.id,
                songmid: id,
                contentId: item.contentId,
                copyrightId: item.copyrightId,
                lrc: item.lyricUrl,
            };
        }),
    };
}

async function getNeteaseMusicInfo(
    musicInfo: Record<string, any>,
): Promise<Partial<IMusic.IMusicItem> | null> {
    const songId = musicInfo.songmid ?? musicInfo.songId ?? musicInfo.id;
    const detailById = await fetchNeteaseSongDetails([songId]);
    const detail = detailById.get(String(songId));
    if (!detail) return null;

    return mapNeteaseSongInfo(detail, musicInfo.platform ?? '');
}

async function getNeteaseLyric(
    musicInfo: Record<string, any>,
): Promise<ILyric.ILyricSource | null> {
    const songId = musicInfo.songmid ?? musicInfo.songId ?? musicInfo.id;
    if (!songId) return null;

    const resp = await axios.get('https://music.163.com/api/song/lyric', {
        params: {
            id: songId,
            lv: 1,
            kv: 1,
            tv: -1,
        },
        headers: {
            Referer: 'https://music.163.com/',
            'User-Agent': BROWSER_USER_AGENT,
        },
        timeout: 15000,
        responseType: 'json',
    });

    const rawLrc = decodeTextEntities(resp.data?.lrc?.lyric);
    const translation = decodeTextEntities(resp.data?.tlyric?.lyric);
    if (!rawLrc && !translation) return null;

    return {
        rawLrc,
        translation,
    };
}

async function resolveTencentSongId(musicInfo: Record<string, any>): Promise<number | null> {
    const direct = Number(
        musicInfo.songId ?? musicInfo.songid ?? musicInfo.raw?.songid ?? musicInfo.raw?.id,
    );
    if (Number.isFinite(direct) && direct > 0) return direct;

    const songmid =
        musicInfo.songmid ?? musicInfo.media_mid ?? musicInfo.strMediaMid ?? musicInfo.id;
    if (!songmid) return null;

    try {
        const resp = await axios.post(
            'https://u.y.qq.com/cgi-bin/musicu.fcg',
            {
                comm: { ct: '19', cv: '1859', uin: '0' },
                req: {
                    module: 'music.pf_song_detail_svr',
                    method: 'get_song_detail_yqq',
                    param: { song_type: 0, song_mid: String(songmid) },
                },
            },
            {
                headers: {
                    Referer: 'https://y.qq.com/',
                    'User-Agent': BROWSER_USER_AGENT,
                },
                timeout: 15000,
                responseType: 'json',
            },
        );
        const id = Number(resp.data?.req?.data?.track_info?.id);
        return Number.isFinite(id) && id > 0 ? id : null;
    } catch {
        return null;
    }
}

async function getTencentLyric(
    musicInfo: Record<string, any>,
): Promise<ILyric.ILyricSource | null> {
    const songId = await resolveTencentSongId(musicInfo);
    if (!songId) return null;

    const resp = await axios.post(
        'https://u.y.qq.com/cgi-bin/musicu.fcg',
        {
            comm: { ct: '19', cv: '1859', uin: '0' },
            req: {
                method: 'GetPlayLyricInfo',
                module: 'music.musichallSong.PlayLyricInfo',
                param: {
                    format: 'json',
                    crypt: 1,
                    ct: 19,
                    cv: 1873,
                    interval: 0,
                    lrc_t: 0,
                    qrc: 1,
                    qrc_t: 0,
                    roma: 0,
                    roma_t: 0,
                    songID: songId,
                    trans: 1,
                    trans_t: 0,
                    type: -1,
                },
            },
        },
        {
            headers: {
                Referer: 'https://y.qq.com/',
                'User-Agent': BROWSER_USER_AGENT,
            },
            timeout: 15000,
            responseType: 'json',
        },
    );

    if (resp.data?.code !== 0 || resp.data?.req?.code !== 0) return null;
    const data = resp.data?.req?.data;
    if (!data?.lyric) return null;

    const [decodedLrc, decodedTrans] = await Promise.all([
        decodeQrc(String(data.lyric)),
        data.trans ? decodeQrc(String(data.trans)) : Promise.resolve(''),
    ]);
    const { lyric } = parseQrcToLrc(decodedLrc);
    const translation = decodedTrans ? fixTlrcTimeTag(decodedTrans, lyric) : '';
    const rawLrc = decodeTextEntities(lyric);
    if (!rawLrc && !translation) return null;
    return { rawLrc: rawLrc || '', translation: translation || undefined };
}

async function getKugouLyric(musicInfo: Record<string, any>): Promise<ILyric.ILyricSource | null> {
    const hash = musicInfo.hash ?? musicInfo.raw?.hash ?? musicInfo.id;
    const keyword = [
        musicInfo.title ?? musicInfo.songname,
        musicInfo.artist ?? musicInfo.singername,
    ]
        .filter(Boolean)
        .join(' ');
    if (!hash || !keyword) return null;

    const durationMs =
        Number(musicInfo._interval) ||
        (() => {
            const sec = normalizeDurationSeconds(
                musicInfo.duration ?? musicInfo.interval ?? musicInfo.raw?.duration,
            );
            return sec ? sec * 1000 : 0;
        })();

    const kgHeaders = {
        'KG-RC': '1',
        'KG-THash': 'expand_search_manager.cpp:852736169:451',
        'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
    };

    const resp = await axios.get('http://lyrics.kugou.com/search', {
        params: {
            ver: 1,
            man: 'yes',
            client: 'pc',
            keyword,
            hash,
            timelength: durationMs || undefined,
            lrctxt: 1,
        },
        headers: kgHeaders,
        timeout: 15000,
        responseType: 'json',
    });

    const candidates = Array.isArray(resp.data?.candidates) ? resp.data.candidates : [];
    const candidate = candidates[0];
    if (!candidate?.id || !candidate?.accesskey) return null;

    const fmt = candidate.krctype == 1 && candidate.contenttype != 1 ? 'krc' : 'lrc';

    const downloadResp = await axios.get('http://lyrics.kugou.com/download', {
        params: {
            ver: 1,
            client: 'pc',
            id: candidate.id,
            accesskey: candidate.accesskey,
            fmt,
            charset: 'utf8',
        },
        headers: kgHeaders,
        timeout: 15000,
        responseType: 'json',
    });

    const content = downloadResp.data?.content;
    if (typeof content !== 'string' || !content) return null;
    const bodyFmt = downloadResp.data?.fmt || fmt;

    if (bodyFmt === 'krc') {
        const parsed = await decodeKrc(content);
        const rawLrc = decodeTextEntities(parsed.lyric);
        const translation = decodeTextEntities(parsed.tlyric);
        if (!rawLrc && !translation) return null;
        return { rawLrc: rawLrc || '', translation: translation || undefined };
    }

    const rawLrc = decodeTextEntities(decodeBase64Utf8(content));
    return rawLrc ? { rawLrc } : null;
}

async function getKuwoLyric(musicInfo: Record<string, any>): Promise<ILyric.ILyricSource | null> {
    const musicId = String(
        musicInfo.rid ?? musicInfo.songmid ?? musicInfo.DC_TARGETID ?? musicInfo.id ?? '',
    ).replace(/^MUSIC_/, '');
    if (!musicId) return null;

    try {
        const resp = await axios.get(
            `http://mlyric.kuwo.cn/mobi.s?f=web&type=lyric&lrcx=1&rid=${musicId}&encode=utf8`,
            {
                headers: {
                    Referer: 'http://www.kuwo.cn/',
                    'User-Agent': BROWSER_USER_AGENT,
                },
                timeout: 15000,
                responseType: 'base64',
            },
        );
        const b64 = typeof resp.data === 'string' ? resp.data : '';
        if (b64) {
            const text = await decodeKuwoLyricx(b64, true);
            if (text && /\[\d{1,2}:.*\d{1,4}]/.test(text)) {
                const parsed = parseKuwoLrc(text);
                const rawLrc = decodeTextEntities(parsed.lyric);
                const translation = decodeTextEntities(parsed.tlyric);
                if (rawLrc) {
                    return { rawLrc, translation: translation || undefined };
                }
            }
        }
    } catch {
        /* fall through to H5 API */
    }

    const resp = await axios.get('https://m.kuwo.cn/newh5/singles/songinfoandlrc', {
        params: { musicId },
        headers: {
            Referer: 'https://m.kuwo.cn/',
            'User-Agent': BROWSER_USER_AGENT,
        },
        timeout: 15000,
        responseType: 'json',
    });

    const list = resp.data?.data?.lrclist;
    if (!Array.isArray(list) || !list.length) return null;

    // H5 list may embed translation as duplicate timestamps — reuse Kuwo sorter via LRC text
    const asLrc = buildKuwoLyricText(list);
    if (!asLrc) return null;
    const parsed = parseKuwoLrc(asLrc);
    return {
        rawLrc: decodeTextEntities(parsed.lyric) || asLrc,
        translation: decodeTextEntities(parsed.tlyric) || undefined,
    };
}

async function resolveMiguLyricUrls(
    musicInfo: Record<string, any>,
): Promise<{ lrcUrl?: string; trcUrl?: string }> {
    const lrcUrl = musicInfo.lrcUrl ?? musicInfo.lrc ?? musicInfo.lyricUrl ?? musicInfo.raw?.lrcUrl;
    const trcUrl = musicInfo.trcUrl ?? musicInfo.raw?.trcUrl;
    if (lrcUrl) return { lrcUrl, trcUrl };

    const resourceId =
        musicInfo.copyrightId ??
        musicInfo.songmid ??
        musicInfo.songId ??
        musicInfo.id ??
        musicInfo.raw?.copyrightId;
    if (!resourceId) return {};

    try {
        const resp = await axios.post(
            'https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=2',
            `resourceId=${encodeURIComponent(String(resourceId))}`,
            {
                headers: {
                    ...MIGU_HEADERS,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    channel: '0146921',
                },
                timeout: 15000,
                responseType: 'json',
            },
        );
        const item = Array.isArray(resp.data?.resource) ? resp.data.resource[0] : null;
        return {
            lrcUrl: item?.lrcUrl,
            trcUrl: item?.trcUrl,
        };
    } catch {
        return {};
    }
}

async function getMiguLyric(musicInfo: Record<string, any>): Promise<ILyric.ILyricSource | null> {
    const urls = await resolveMiguLyricUrls(musicInfo);
    if (!urls.lrcUrl) return null;

    const headers = {
        Referer: 'https://app.c.nf.migu.cn/',
        'User-Agent': MOBILE_USER_AGENT,
        channel: '0146921',
    };

    const [lrcResp, trcResp] = await Promise.all([
        axios.get(urls.lrcUrl, { headers, timeout: 15000, responseType: 'text' }),
        urls.trcUrl
            ? axios
                  .get(urls.trcUrl, { headers, timeout: 15000, responseType: 'text' })
                  .catch(() => null)
            : Promise.resolve(null),
    ]);

    const rawLrc = decodeTextEntities(lrcResp.data);
    const translation = trcResp ? decodeTextEntities(trcResp.data) : undefined;
    if (!rawLrc && !translation) return null;
    return { rawLrc: rawLrc || '', translation, lrc: urls.lrcUrl };
}

// lyric 搜索复用 music 搜索器：搜索结果项为 IMusicItem（含 raw 字段），
// 关联歌词时由对应的 LX_LYRIC_GETTERS 取词。
const LX_MEDIA_SEARCHERS: Record<
    string,
    Partial<Record<IMedia.SupportMediaType, ILxMediaSearcher>>
> = {
    wy: {
        music: searchNeteaseMusic,
        album: searchNeteaseAlbum,
        artist: searchNeteaseArtist,
        sheet: searchNeteaseSheet,
        lyric: searchNeteaseMusic,
    },
    kw: {
        music: searchKuwoMusic,
        lyric: searchKuwoMusic,
        sheet: searchKuwoSheet,
    },
    tx: {
        music: searchTencentMusic,
        lyric: searchTencentMusic,
        sheet: searchTencentSheet,
    },
    kg: {
        music: searchKugouMusic,
        lyric: searchKugouMusic,
        sheet: searchKugouSheet,
    },
    mg: {
        music: searchMiguMusic,
        lyric: searchMiguMusic,
        sheet: searchMiguSheet,
    },
};

const LX_LYRIC_GETTERS: Record<string, ILxLyricGetter> = {
    tx: getTencentLyric,
    kg: getKugouLyric,
    wy: getNeteaseLyric,
    kw: getKuwoLyric,
    mg: getMiguLyric,
};

const LX_MUSIC_INFO_GETTERS: Record<string, ILxMusicInfoGetter> = {
    wy: getNeteaseMusicInfo,
};

const LX_MUSIC_SHEET_IMPORTERS: Record<string, ILxMusicSheetImporter> = {
    tx: importTencentMusicSheet,
    kg: importKugouMusicSheet,
    wy: importNeteaseMusicSheet,
    kw: importKuwoMusicSheet,
};

const LX_ALBUM_INFO_GETTERS: Record<string, ILxAlbumInfoGetter> = {
    wy: getNeteaseAlbumInfo,
};

const LX_ARTIST_WORKS_GETTERS: Record<string, ILxArtistWorksGetter> = {
    wy: getNeteaseArtistWorks,
};

/** 与洛雪酷我榜单目录同一份。接口目录已停用，这边也用这份完整名单。 */
const KUWO_CHARTS: Array<{ id: string; title: string }> = [
    { id: '93', title: '飙升榜' },
    { id: '17', title: '新歌榜' },
    { id: '16', title: '热歌榜' },
    { id: '158', title: '抖音热歌榜' },
    { id: '292', title: '铃声榜' },
    { id: '284', title: '热评榜' },
    { id: '290', title: 'ACG新歌榜' },
    { id: '286', title: '台湾KKBOX榜' },
    { id: '279', title: '冬日暖心榜' },
    { id: '281', title: '巴士随身听榜' },
    { id: '255', title: 'KTV点唱榜' },
    { id: '280', title: '家务进行曲榜' },
    { id: '282', title: '熬夜修仙榜' },
    { id: '283', title: '枕边轻音乐榜' },
    { id: '278', title: '古风音乐榜' },
    { id: '264', title: 'Vlog音乐榜' },
    { id: '242', title: '电音榜' },
    { id: '187', title: '流行趋势榜' },
    { id: '204', title: '现场音乐榜' },
    { id: '186', title: 'ACG神曲榜' },
    { id: '185', title: '最强翻唱榜' },
    { id: '26', title: '经典怀旧榜' },
    { id: '104', title: '华语榜' },
    { id: '182', title: '粤语榜' },
    { id: '22', title: '欧美榜' },
    { id: '184', title: '韩语榜' },
    { id: '183', title: '日语榜' },
    { id: '145', title: '会员畅听榜' },
    { id: '153', title: '网红新歌榜' },
    { id: '64', title: '影视金曲榜' },
    { id: '176', title: 'DJ嗨歌榜' },
    { id: '106', title: '真声音' },
    { id: '12', title: 'Billboard榜' },
    { id: '49', title: 'iTunes音乐榜' },
    { id: '180', title: 'beatport电音榜' },
    { id: '13', title: '英国UK榜' },
    { id: '164', title: '百大DJ榜' },
    { id: '246', title: 'YouTube音乐排行榜' },
    { id: '265', title: '韩国Genie榜' },
    { id: '14', title: '韩国M-net榜' },
    { id: '8', title: '香港电台榜' },
    { id: '15', title: '日本公信榜' },
    { id: '151', title: '腾讯音乐人原创榜' },
];

const KUWO_HEADERS = { Referer: 'https://www.kuwo.cn/', 'User-Agent': BROWSER_USER_AGENT };
const MIGU_HEADERS = { Referer: 'https://music.migu.cn/', 'User-Agent': MOBILE_USER_AGENT };

function mapKuwoChartSong(item: any, platform: string): IMusic.IMusicItem {
    return mapKuwoSongInfo(
        {
            ...item,
            SONGNAME: item.SONGNAME ?? item.name ?? item.FSONGMNAME,
            ARTIST: item.ARTIST ?? item.artist ?? item.FARTIST,
            ALBUM: item.ALBUM ?? item.album ?? item.FALBUM,
            DURATION: item.DURATION ?? item.duration ?? item.song_duration,
            DC_TARGETID: item.DC_TARGETID ?? item.id,
            MUSICRID: item.MUSICRID ?? (item.id ? `MUSIC_${item.id}` : undefined),
        },
        platform,
    );
}

function mapKuwoSheetItem(item: any, platform: string): IMusic.IMusicSheetItem {
    return {
        id: String(item.playlistid ?? item.id ?? item.DC_TARGETID ?? ''),
        platform,
        title: cleanSearchText(item.name ?? item.title),
        artwork: item.pic ?? item.hts_pic,
        description: cleanSearchText(item.intro ?? item.info),
        worksNum: Number(item.songnum ?? item.num) || undefined,
        playCount: Number(item.playcnt ?? item.playnum) || undefined,
        artist: cleanSearchText(item.nickname ?? item.uname),
        raw: item,
    };
}

function mapMiguSongInfo(item: any, platform: string): IMusic.IMusicItem {
    const id = String(item.copyrightId ?? item.contentId ?? item.songId ?? item.id ?? '');
    const artist =
        typeof item.singer === 'string'
            ? cleanSearchText(item.singer)
            : normalizeArtistNames(item.singers);
    return {
        id,
        platform,
        title: cleanSearchText(item.songName ?? item.name),
        artist,
        album: cleanSearchText(item.album ?? item.albums?.[0]?.name),
        artwork: pickMiguArtwork(item.albumImgs ?? item.imgItems),
        raw: item,
        songId: item.songId ?? item.id,
        songmid: id,
        contentId: item.contentId,
        copyrightId: item.copyrightId,
        lrc: item.lrcUrl ?? item.lyricUrl,
        lrcUrl: item.lrcUrl ?? item.lyricUrl,
        mrcUrl: item.mrcUrl,
        trcUrl: item.trcUrl,
    };
}

function mapMiguSheetItem(item: any, platform: string): IMusic.IMusicSheetItem {
    return {
        id: String(item.id ?? item.columnId ?? item.musicListId ?? ''),
        platform,
        title: cleanSearchText(item.name ?? item.columnTitle),
        artwork: item.musicListPicUrl ?? item.columnPic,
        description: cleanSearchText(item.summary ?? item.intro),
        worksNum: Number(item.musicNum) || undefined,
        playCount: Number(item.playNum) || undefined,
        raw: item,
    };
}

async function fetchKuwoBang(chartId: string, page: number): Promise<any> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const resp = await axios.get('http://kbangserver.kuwo.cn/ksong.s', {
        params: {
            from: 'pc',
            fmt: 'json',
            type: 'bang',
            data: 'content',
            id: chartId,
            pn: currentPage - 1,
            rn: ONLINE_PLAYLIST_PAGE_SIZE,
        },
        headers: KUWO_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });
    return resp.data ?? {};
}

async function getKuwoTopLists(platform: string): Promise<IMusic.IMusicSheetGroupItem[]> {
    const charts = await Promise.all(
        KUWO_CHARTS.map(async (chart) => {
            try {
                const data = await fetchKuwoBang(chart.id, 1);
                return mapKuwoSheetItem(
                    {
                        id: chart.id,
                        name: cleanSearchText(data.name) || chart.title,
                        pic: data.pic ?? data.v9_pic2,
                        info: data.info,
                        songnum: data.num,
                    },
                    platform,
                );
            } catch {
                return mapKuwoSheetItem({ id: chart.id, name: chart.title }, platform);
            }
        }),
    );
    return charts.length ? [{ title: '酷我音乐', data: charts }] : [];
}

async function getKuwoTopListDetail(
    topListItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxTopListInfoResult> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const data = await fetchKuwoBang(String(topListItem.raw?.id ?? topListItem.id), currentPage);
    const list = Array.isArray(data.musiclist) ? data.musiclist : [];
    const total = Number(data.num ?? 0);
    return {
        topListItem: {
            ...topListItem,
            title: cleanSearchText(data.name) || topListItem.title,
            artwork: data.pic ?? data.v9_pic2 ?? topListItem.artwork,
            description: cleanSearchText(data.info ?? topListItem.description),
        },
        musicList: list.map((item: any) => mapKuwoChartSong(item, platform)),
        isEnd:
            list.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && currentPage * ONLINE_PLAYLIST_PAGE_SIZE >= total),
    };
}

function mapKuwoPlaylist(item: any, platform: string): IMusic.IMusicSheetItem {
    return {
        id: String(item.id ?? ''),
        platform,
        title: cleanSearchText(item.name),
        artwork: item.img,
        description: cleanSearchText(item.desc),
        worksNum: Number(item.total) || undefined,
        playCount: Number(item.listencnt) || undefined,
        artist: cleanSearchText(item.uname),
        raw: item,
    };
}

async function getKuwoRecommendSheetTags(): Promise<ILxRecommendSheetTagsResult> {
    const headers = KUWO_HEADERS;
    const [tagResp, hotResp] = await Promise.all([
        axios.get(
            'http://wapi.kuwo.cn/api/pc/classify/playlist/getTagList?cmd=rcm_keyword_playlist&user=0&prod=kwplayer_pc_9.0.5.0&vipver=9.0.5.0&source=kwplayer_pc_9.0.5.0&loginUid=0&loginSid=0&appUid=76039576',
            { headers, timeout: 15000, responseType: 'json' },
        ),
        axios.get(
            'http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmTagList?loginUid=0&loginSid=0&appUid=76039576',
            { headers, timeout: 15000, responseType: 'json' },
        ),
    ]);
    const groups = Array.isArray(tagResp.data?.data) ? tagResp.data.data : [];
    const data = groups
        .map((group: any) => ({
            title: cleanSearchText(group?.name),
            data: (Array.isArray(group?.data) ? group.data : [])
                .filter((item: any) => item?.id != null && item?.name)
                .map((item: any) => mapRecommendTag(`${item.id}-${item.digest}`, item.name)),
        }))
        .filter((group: IMusic.IMusicSheetGroupItem) => group.data.length);
    const hot = Array.isArray(hotResp.data?.data?.[0]?.data) ? hotResp.data.data[0].data : [];
    const pinned = hot
        .filter((item: any) => item?.id != null && item?.name)
        .map((item: any) => mapRecommendTag(`${item.id}-${item.digest}`, item.name));
    return {
        pinned,
        data,
        sorts: [
            { id: 'hot', title: '最热' },
            { id: 'new', title: '最新' },
        ],
    };
}

async function getKuwoRecommendSheetsByTag(
    tag: IMedia.IUnique,
    page: number,
    platform: string,
    sortId = 'hot',
): Promise<ILxPaginationResponse<IMusic.IMusicSheetItem>> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const tagId = tag?.id && tag.id !== 'all' ? String(tag.id) : '';
    let url: string;
    if (!tagId) {
        url = `http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=${currentPage}&rn=${ONLINE_PLAYLIST_PAGE_SIZE}&order=${sortId || 'hot'}`;
    } else {
        const [id, type] = tagId.split('-');
        url =
            type === '43'
                ? `http://mobileinterfaces.kuwo.cn/er.s?type=get_pc_qz_data&f=web&id=${id}&prod=pc`
                : `http://wapi.kuwo.cn/api/pc/classify/playlist/getTagPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=${currentPage}&id=${id}&rn=${ONLINE_PLAYLIST_PAGE_SIZE}`;
    }
    const resp = await axios.get(url, {
        headers: KUWO_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });
    const body = resp.data;
    const nested = Array.isArray(body?.data?.data) ? body.data.data : null;
    const list =
        nested ?? (Array.isArray(body) ? body.flatMap((group: any) => group?.list ?? []) : []);
    const total = Number(body?.data?.total ?? 0);
    const pageSize =
        Number(body?.data?.rn ?? ONLINE_PLAYLIST_PAGE_SIZE) || ONLINE_PLAYLIST_PAGE_SIZE;
    return {
        data: list
            .filter((item: any) => item?.id && item?.name)
            .map((item: any) => mapKuwoPlaylist(item, platform)),
        isEnd: !nested || list.length < pageSize || (total > 0 && currentPage * pageSize >= total),
    };
}

async function getKuwoMusicSheetInfo(
    sheetItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxSheetInfoResult | null> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const resp = await axios.get('http://nplserver.kuwo.cn/pl.svc', {
        params: {
            op: 'getlistinfo',
            pid: sheetItem.raw?.playlistid ?? sheetItem.id,
            pn: currentPage - 1,
            rn: ONLINE_PLAYLIST_PAGE_SIZE,
            encode: 'utf8',
            keyset: 'pl2012',
            identity: 'kuwo',
            pcmp4: 1,
            vipver: 'MUSIC_8.7.3.0_BCS28',
            newver: 1,
        },
        headers: KUWO_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });
    const data = resp.data ?? {};
    if (data.result === 'fail') return null;
    const list = Array.isArray(data.musiclist) ? data.musiclist : [];
    const total = Number(data.total ?? data.songnum ?? 0);
    return {
        sheetItem: {
            ...sheetItem,
            title: cleanSearchText(data.title) || sheetItem.title,
            artwork: data.pic || sheetItem.artwork,
            description: cleanSearchText(data.info ?? sheetItem.description),
        },
        musicList: list.map((item: any) => mapKuwoChartSong(item, platform)),
        isEnd:
            list.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && currentPage * ONLINE_PLAYLIST_PAGE_SIZE >= total),
    };
}

async function fetchMiguColumn(columnId: string, start: number, count: number): Promise<any> {
    const resp = await axios.get(
        'https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do',
        {
            params: { columnId, start, count },
            headers: MIGU_HEADERS,
            timeout: 15000,
            responseType: 'json',
        },
    );
    return resp.data?.columnInfo ?? {};
}

async function getMiguTopLists(platform: string): Promise<IMusic.IMusicSheetGroupItem[]> {
    const column = await fetchMiguColumn('15031292', 1, 30);
    const contents = Array.isArray(column.contents) ? column.contents : [];
    const data = contents
        .map((item: any) => item.objectInfo ?? item)
        .filter(
            (item: any) =>
                item?.columnId &&
                item?.columnTitle &&
                !/分类|营销|活动/.test(String(item.columnTitle)),
        )
        .map((item: any) => mapMiguSheetItem(item, platform));
    return data.length ? [{ title: '咪咕音乐', data }] : [];
}

async function getMiguTopListDetail(
    topListItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxTopListInfoResult> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const start = (currentPage - 1) * ONLINE_PLAYLIST_PAGE_SIZE + 1;
    const column = await fetchMiguColumn(
        String(topListItem.raw?.columnId ?? topListItem.id),
        start,
        ONLINE_PLAYLIST_PAGE_SIZE,
    );
    const contents = Array.isArray(column.contents) ? column.contents : [];
    const musicList = contents
        .map((item: any) => item.objectInfo ?? item)
        .filter((item: any) => item?.songName || item?.copyrightId)
        .map((item: any) => mapMiguSongInfo(item, platform));
    const total = Number(column.contentsCount ?? 0);
    return {
        topListItem,
        musicList,
        isEnd:
            musicList.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && start + musicList.length - 1 >= total),
    };
}

function walkMiguPlaylists(nodes: any, list: any[] = [], seen = new Set<string>()): any[] {
    if (!nodes) return list;
    const items = Array.isArray(nodes) ? nodes : [nodes];
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item.contents)) walkMiguPlaylists(item.contents, list, seen);
        if (String(item.resType) === '2021' && item.resId && !seen.has(String(item.resId))) {
            seen.add(String(item.resId));
            list.push(item);
        }
    }
    return list;
}

function mapMiguPlazaSheet(item: any, platform: string): IMusic.IMusicSheetItem {
    const id = String(item.resId ?? item.logEvent?.contentId ?? item.id ?? '');
    return {
        id,
        platform,
        title: cleanSearchText(item.txt ?? item.title ?? item.name),
        artwork: item.img ?? item.imageUrl,
        description: cleanSearchText(item.txt2 ?? item.desc),
        playCount: /^\d+$/.test(String(item.playNum ?? '')) ? Number(item.playNum) : undefined,
        artist: cleanSearchText(item.author),
        raw: item,
    };
}

async function getMiguRecommendSheetTags(): Promise<ILxRecommendSheetTagsResult> {
    const resp = await axios.get(
        'https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-taglist/release',
        { headers: MIGU_HEADERS, timeout: 15000, responseType: 'json' },
    );
    const blocks = Array.isArray(resp.data?.data) ? resp.data.data : [];
    const mapBlock = (block: any) =>
        (Array.isArray(block?.content) ? block.content : [])
            .map((item: any) => {
                const texts = Array.isArray(item?.texts) ? item.texts : [];
                return mapRecommendTag(texts[1], texts[0]);
            })
            .filter((item: IMusic.IMusicSheetItem) => item.id && item.title);
    const pinned = blocks.length ? mapBlock(blocks[0]) : [];
    const data = blocks
        .slice(1)
        .map((block: any) => ({
            title: cleanSearchText(block?.header?.title),
            data: mapBlock(block),
        }))
        .filter((group: IMusic.IMusicSheetGroupItem) => group.data.length);
    return {
        pinned,
        data,
        sorts: [{ id: 'recommend', title: '推荐' }],
    };
}

async function searchMiguPlaylists(
    keyword: string,
    page: number,
): Promise<{ list: any[]; total: number }> {
    const resp = await axios.get(
        'https://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do',
        {
            params: {
                text: keyword,
                pageNo: page,
                pageSize: ONLINE_PLAYLIST_PAGE_SIZE,
                searchSwitch: JSON.stringify({
                    song: 0,
                    album: 0,
                    singer: 0,
                    tagSong: 0,
                    mvSong: 0,
                    songlist: 1,
                    bestShow: 0,
                }),
            },
            headers: MIGU_HEADERS,
            timeout: 15000,
            responseType: 'json',
        },
    );
    const result = resp.data?.songListResultData ?? {};
    return {
        list: Array.isArray(result.result) ? result.result : [],
        total: Number(result.totalCount ?? 0),
    };
}

async function getMiguRecommendSheetsByTag(
    tag: IMedia.IUnique,
    page: number,
    platform: string,
): Promise<ILxPaginationResponse<IMusic.IMusicSheetItem>> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const tagId = tag?.id && tag.id !== 'all' ? String(tag.id) : '';
    const url = tagId
        ? `https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-listbytag/release?pageNumber=${currentPage}&templateVersion=2&tagId=${encodeURIComponent(tagId)}`
        : `https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=${currentPage}`;
    const resp = await axios.get(url, {
        headers: MIGU_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });
    const body = resp.data?.data ?? {};
    let raw: any[] = [];
    if (tagId) {
        const blocks = Array.isArray(body.contentItemList) ? body.contentItemList : [];
        const grid = blocks.find((block: any) => Array.isArray(block?.itemList));
        raw = Array.isArray(grid?.itemList) ? grid.itemList : [];
    } else {
        raw = walkMiguPlaylists(body.contents);
    }
    const data = raw
        .map((item: any) =>
            tagId
                ? mapMiguPlazaSheet(
                      {
                          resId: item.logEvent?.contentId,
                          txt: item.title,
                          img: item.imageUrl,
                          barList: item.barList,
                      },
                      platform,
                  )
                : mapMiguPlazaSheet(item, platform),
        )
        .filter((item) => item.id && item.title);
    return {
        data,
        isEnd: tagId ? data.length < ONLINE_PLAYLIST_PAGE_SIZE : data.length === 0,
    };
}

async function getMiguMusicSheetInfo(
    sheetItem: IMusic.IMusicSheetItem,
    page: number,
    platform: string,
): Promise<ILxSheetInfoResult | null> {
    const currentPage = Math.max(Number(page) || 1, 1);
    const playlistId = String(sheetItem.raw?.resId ?? sheetItem.raw?.id ?? sheetItem.id);
    const resp = await axios.get('https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0', {
        params: {
            playlistId,
            pageNo: currentPage,
            pageSize: ONLINE_PLAYLIST_PAGE_SIZE,
        },
        headers: MIGU_HEADERS,
        timeout: 15000,
        responseType: 'json',
    });
    const list = Array.isArray(resp.data?.data?.songList) ? resp.data.data.songList : [];
    const total = Number(resp.data?.data?.totalCount ?? 0);
    return {
        sheetItem,
        musicList: list.map((item: any) => mapMiguSongInfo(item, platform)),
        isEnd:
            list.length < ONLINE_PLAYLIST_PAGE_SIZE ||
            (total > 0 && currentPage * ONLINE_PLAYLIST_PAGE_SIZE >= total),
    };
}

const LX_TOP_LIST_GETTERS: Record<string, ILxTopListsGetter> = {
    tx: getTencentTopLists,
    kg: getKugouTopLists,
    wy: getNeteaseTopLists,
    kw: getKuwoTopLists,
    mg: getMiguTopLists,
};

const LX_TOP_LIST_DETAIL_GETTERS: Record<string, ILxTopListDetailGetter> = {
    tx: getTencentTopListDetail,
    kg: getKugouTopListDetail,
    wy: getNeteaseTopListDetail,
    kw: getKuwoTopListDetail,
    mg: getMiguTopListDetail,
};

const LX_RECOMMEND_TAG_GETTERS: Record<string, ILxRecommendTagsGetter> = {
    tx: getTencentRecommendSheetTags,
    kg: getKugouRecommendSheetTags,
    wy: getNeteaseRecommendSheetTags,
    kw: getKuwoRecommendSheetTags,
    mg: getMiguRecommendSheetTags,
};

const LX_RECOMMEND_SHEET_GETTERS: Record<string, ILxRecommendSheetsGetter> = {
    tx: getTencentRecommendSheetsByTag,
    kg: getKugouRecommendSheetsByTag,
    wy: getNeteaseRecommendSheetsByTag,
    kw: getKuwoRecommendSheetsByTag,
    mg: getMiguRecommendSheetsByTag,
};

const LX_MUSIC_SHEET_INFO_GETTERS: Record<string, ILxMusicSheetInfoGetter> = {
    tx: fetchTencentPlaylistInfo,
    kg: fetchKugouPlaylistInfo,
    wy: getNeteaseMusicSheetInfo,
    kw: getKuwoMusicSheetInfo,
    mg: getMiguMusicSheetInfo,
};

const CATALOG_SOURCE_KEYS = ['kw', 'kg', 'tx', 'wy', 'mg'] as const;

/**
 * 榜单和歌单不依赖用户脚本声明了哪些平台。
 * 五个平台各一个实例，只提供榜单、歌单标签和详情，不提供播放地址。
 */
export function createCatalogInstances(): IPlugin.IPluginInstance[] {
    return CATALOG_SOURCE_KEYS.map((sourceKey) => {
        const platform = `catalog:${sourceKey}`;
        const instance: IPlugin.IPluginInstance = {
            platform,
            platformLabel: sourceKey,
            sourceKey,
            supportedSearchType: [],
            _path: '',
        };
        const topListsGetter = LX_TOP_LIST_GETTERS[sourceKey];
        if (topListsGetter) {
            instance.getTopLists = async () => topListsGetter(platform);
        }
        const topListDetailGetter = LX_TOP_LIST_DETAIL_GETTERS[sourceKey];
        if (topListDetailGetter) {
            instance.getTopListDetail = async (topListItem, page) =>
                topListDetailGetter(topListItem, page, platform);
        }
        const recommendTagGetter = LX_RECOMMEND_TAG_GETTERS[sourceKey];
        if (recommendTagGetter) {
            instance.getRecommendSheetTags = async () => recommendTagGetter();
        }
        const recommendSheetGetter = LX_RECOMMEND_SHEET_GETTERS[sourceKey];
        if (recommendSheetGetter) {
            instance.getRecommendSheetsByTag = async (tag, page = 1, sortId?: string) =>
                recommendSheetGetter(tag, page, platform, sortId);
        }
        const musicSheetInfoGetter = LX_MUSIC_SHEET_INFO_GETTERS[sourceKey];
        if (musicSheetInfoGetter) {
            instance.getMusicSheetInfo = async (sheetItem, page) =>
                musicSheetInfoGetter(sheetItem, page, platform);
        }
        return instance;
    });
}

/**
 * 判断脚本是否为洛雪插件。
 * 混淆后的插件会用 globalThis['\x6c\x78'] / globalThis['lx'] 代替 globalThis.lx，
 * 只匹配字面量 lx 会把这些插件误判为非洛雪脚本。
 */
function looksLikeLxPlugin(code: string): boolean {
    if (!/globalThis/.test(code)) return false;
    return /globalThis\s*(?:\.\s*lx|\[\s*['"]lx['"]\s*\]|\[\s*['"]\\x6c\\x78['"]\s*\]|\[\s*['"]\\u006c\\u0078['"]\s*\])/i.test(
        code,
    );
}

/**
 * 在沙箱中执行洛雪插件，返回由 initSource 事件声明的音源实例列表。
 *
 * 洛雪插件通过 globalThis.lx 注册 request 监听，
 * 再通过 inited 事件发送 sources。这里把每个 source 适配成一个只负责
 * getMediaSource 的安禾插件实例，供应用的音源重定向功能使用。
 */
export async function executeLxPluginCode(
    code: string,
    hash: string,
    pluginPath: string,
): Promise<IPlugin.IPluginInstance[] | null> {
    if (!looksLikeLxPlugin(code)) {
        return null;
    }

    const meta = readPluginHeader(code);
    const requestHandlers: ILxRequestHandler[] = [];
    let initedPayload: ILxInitedPayload | null = null;
    let updateUrl = readHeaderValue(meta, 'updateurl', 'update_url', 'update-url');

    const lx = {
        EVENT_NAMES: LX_EVENT_NAMES,
        // 洛雪运行时版本与环境标识：部分音源据此判断是否启用 utils、以及拼接 User-Agent
        version: '2.0.0',
        env: 'desktop',
        // 脚本元信息：flower/grass 等音源初始化时会直接读取 currentScriptInfo.version
        currentScriptInfo: {
            name: meta.name,
            description: meta.description,
            version: meta.version,
            author: meta.author,
            homepage: meta.homepage,
            rawScript: code,
        },
        utils: lxUtils,
        on(eventName: string, handler: ILxRequestHandler) {
            if (eventName === LX_EVENT_NAMES.request && typeof handler === 'function') {
                requestHandlers.push(handler);
            }
        },
        send(eventName: string, payload: any) {
            if (eventName === LX_EVENT_NAMES.inited) {
                initedPayload = payload;
            } else if (eventName === LX_EVENT_NAMES.updateAlert && payload?.updateUrl) {
                updateUrl = payload.updateUrl;
            }
        },
        request(
            url: string,
            _options: Record<string, any>,
            callback: (err: any, resp: any) => void,
        ) {
            if (url === updateUrl) {
                callback(new Error('Update checks are handled by the app'), {
                    statusCode: 500,
                    body: null,
                });
                return;
            }

            hostHttp(_options?.method ?? 'GET', url, {
                timeout: _options?.timeout ?? 15000,
                responseType: 'json',
                body: _options?.body,
                headers: _options?.headers,
            })
                .then((resp) => {
                    callback(null, {
                        statusCode: resp.status,
                        headers: resp.headers,
                        body: resp.data,
                    });
                })
                .catch((err) => {
                    callback(err, {
                        statusCode: 500,
                        headers: {},
                        body: null,
                    });
                });
        },
    };

    const sandboxBaseGlobals: Record<string, any> = {
        lx,
        console: {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
            info: console.info.bind(console),
            debug: console.debug.bind(console),
            trace: console.trace.bind(console),
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Promise,
        URL,
        URLSearchParams,
        Buffer: BufferShim,
        TextEncoder,
        TextDecoder,
        encodeURIComponent,
        decodeURIComponent,
        encodeURI,
        decodeURI,
        btoa,
        atob,
        fetch: globalThis.fetch,
        AbortController,
        AbortSignal,
        Blob,
        JSON,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Date,
        RegExp,
        Error,
        TypeError,
        RangeError,
        SyntaxError,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Symbol,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        undefined,
        NaN,
        Infinity,
    };
    sandboxBaseGlobals.globalThis = sandboxBaseGlobals;
    const sandboxGlobals = createProtectedGlobal(sandboxBaseGlobals);

    try {
        // Worker 环境改用 new Function 执行；lx 经参数注入，插件闭包仍可捕获自身作用域
        const runner = new Function('globalThis', `var lx = globalThis.lx;\n${code}`);
        runner(sandboxGlobals as any);

        // 洛雪插件可能在 Promise.then 或异步请求后才发送 inited，轮询等待（最多 3 秒）
        for (let i = 0; i < 60; i++) {
            if (initedPayload?.sources && requestHandlers.length > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        if (!initedPayload?.sources || requestHandlers.length === 0) {
            return null;
        }

        const instances: IPlugin.IPluginInstance[] = [];
        for (const [sourceKey, source] of Object.entries(initedPayload.sources)) {
            if (source?.type && source.type !== 'music') continue;
            if (source?.actions && !source.actions.includes('musicUrl')) continue;

            const platformLabel = source.name ?? `${meta.name ?? '洛雪音源'}-${sourceKey}`;
            // 展示名各家脚本都会用「QQ音乐」。platform 带上脚本名，安装和取流才不会互相覆盖。
            const scriptShort = (meta.name ?? '').replace(/\s*[（(].*$/, '').trim();
            const distinguisher = scriptShort || hash.slice(0, 6);
            const platform =
                distinguisher !== platformLabel
                    ? `${platformLabel} · ${distinguisher}`
                    : platformLabel;
            const sourceSearchers = LX_MEDIA_SEARCHERS[sourceKey] ?? {};
            const supportedSearchType = Object.keys(sourceSearchers) as IMedia.SupportMediaType[];
            const instance: IPlugin.IPluginInstance = {
                platform,
                platformLabel,
                scriptName: meta.name,
                sourceKey,
                version: meta.version,
                updatedAt: scriptUpdateDate(meta),
                author: meta.author,
                description: meta.description,
                srcUrl: updateUrl,
                defaultSearchType: 'music',
                supportedSearchType,
                async getMediaSource(musicItem, quality) {
                    const lxQuality = getLxQuality(sourceKey, quality);
                    const musicInfo = buildLxMusicInfo(musicItem, sourceKey);

                    const officialSource = await getOfficialLxMediaSource(
                        sourceKey,
                        musicInfo,
                        quality,
                    );
                    if (officialSource?.url) {
                        return officialSource;
                    }

                    const payload = {
                        source: sourceKey,
                        action: 'musicUrl',
                        info: {
                            musicInfo,
                            type: lxQuality,
                        },
                    };

                    for (const handler of requestHandlers) {
                        const result = await handler(payload);
                        const normalized = normalizeLxMusicUrlResult(result);
                        if (normalized?.url) {
                            return {
                                ...normalized,
                                url: normalizeLxMusicUrl(normalized.url, sourceKey),
                                quality,
                            };
                        }
                    }
                    return null;
                },
                _path: pluginPath,
            };
            if (supportedSearchType.length) {
                instance.search = async (query, page, type) => {
                    const searcher = sourceSearchers[type];
                    if (!searcher) return { isEnd: true, data: [] } as any;
                    return searcher(query, page, platform) as any;
                };
            }

            const lyricGetter = LX_LYRIC_GETTERS[sourceKey];
            if (lyricGetter) {
                instance.getLyric = async (musicItem) =>
                    lyricGetter(buildLxMusicInfo(musicItem, sourceKey));
            }

            const musicInfoGetter = LX_MUSIC_INFO_GETTERS[sourceKey];
            if (musicInfoGetter) {
                instance.getMusicInfo = async (musicItem) =>
                    musicInfoGetter({
                        ...buildLxMusicInfo(musicItem, sourceKey),
                        platform,
                    });
            }

            const musicSheetImporter = LX_MUSIC_SHEET_IMPORTERS[sourceKey];
            if (musicSheetImporter) {
                instance.importMusicSheet = async (urlLike) =>
                    musicSheetImporter(urlLike, platform);
            }

            const albumInfoGetter = LX_ALBUM_INFO_GETTERS[sourceKey];
            if (albumInfoGetter) {
                instance.getAlbumInfo = async (albumItem, page) =>
                    albumInfoGetter(albumItem, page, platform);
            }

            const artistWorksGetter = LX_ARTIST_WORKS_GETTERS[sourceKey];
            if (artistWorksGetter) {
                instance.getArtistWorks = async (artistItem, page, type) =>
                    artistWorksGetter(artistItem, page, type, platform) as any;
            }

            const topListsGetter = LX_TOP_LIST_GETTERS[sourceKey];
            if (topListsGetter) {
                instance.getTopLists = async () => topListsGetter(platform);
            }

            const topListDetailGetter = LX_TOP_LIST_DETAIL_GETTERS[sourceKey];
            if (topListDetailGetter) {
                instance.getTopListDetail = async (topListItem, page) =>
                    topListDetailGetter(topListItem, page, platform);
            }

            const recommendTagGetter = LX_RECOMMEND_TAG_GETTERS[sourceKey];
            if (recommendTagGetter) {
                instance.getRecommendSheetTags = async () => recommendTagGetter();
            }

            const recommendSheetGetter = LX_RECOMMEND_SHEET_GETTERS[sourceKey];
            if (recommendSheetGetter) {
                instance.getRecommendSheetsByTag = async (tag, page = 1, sortId?: string) =>
                    recommendSheetGetter(tag, page, platform, sortId);
            }

            const musicSheetInfoGetter = LX_MUSIC_SHEET_INFO_GETTERS[sourceKey];
            if (musicSheetInfoGetter) {
                instance.getMusicSheetInfo = async (sheetItem, page) =>
                    musicSheetInfoGetter(sheetItem, page, platform);
            }

            instances.push(instance);
        }

        return instances.length > 0 ? instances : null;
    } catch (err) {
        console.error(`[PluginSandbox] Failed to execute lx plugin at ${pluginPath}:`, err);
        return null;
    }
}

/**
 * 从插件实例中提取 delegate（序列化安全的纯数据对象）。
 * delegate 不包含函数，可安全传递到渲染进程。
 *
 * @param instance 插件实例
 * @param hash 插件代码哈希
 */
export function extractPluginDelegate(
    instance: IPlugin.IPluginInstance,
    hash: string,
): IPlugin.IPluginDelegate {
    // 提取支持的方法名列表
    const supportedMethod: string[] = [];
    for (const key of Object.keys(instance)) {
        if (typeof (instance as any)[key] === 'function') {
            supportedMethod.push(key);
        }
    }

    // 深拷贝纯数据部分
    const raw: Record<string, any> = {};
    for (const key of Object.keys(instance)) {
        if (typeof (instance as any)[key] !== 'function') {
            raw[key] = (instance as any)[key];
        }
    }

    const delegate: IPlugin.IPluginDelegate = {
        ...JSON.parse(JSON.stringify(raw)),
        supportedMethod,
        hash,
        path: instance._path,
    };

    return delegate;
}
