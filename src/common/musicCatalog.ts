/**
 * 排行榜和歌单按音乐平台分类，不跟着已开启的插件走。
 * 歌曲上的 platform 用 catalog: 前缀，避免和某个插件的展示名撞车。
 * 播放和下载再按设置里的优先源，到已开启的音源里找同一首歌。
 */

export const MUSIC_CATALOG_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'] as const;

export type MusicCatalogSource = (typeof MUSIC_CATALOG_SOURCES)[number];

export const CATALOG_PLATFORM_PREFIX = 'catalog:';

const CATALOG_LABELS: Record<MusicCatalogSource, string> = {
    kw: '酷我音乐',
    kg: '酷狗音乐',
    tx: 'QQ音乐',
    wy: '网易云音乐',
    mg: '咪咕音乐',
};

export function isMusicCatalogSource(value: string): value is MusicCatalogSource {
    return (MUSIC_CATALOG_SOURCES as readonly string[]).includes(value);
}

export function catalogPlatform(source: MusicCatalogSource): string {
    return `${CATALOG_PLATFORM_PREFIX}${source}`;
}

export function catalogSourceOf(platform: string | null | undefined): MusicCatalogSource | null {
    if (!platform?.startsWith(CATALOG_PLATFORM_PREFIX)) return null;
    const key = platform.slice(CATALOG_PLATFORM_PREFIX.length);
    return isMusicCatalogSource(key) ? key : null;
}

export function isCatalogPlatform(platform: string | null | undefined): boolean {
    return catalogSourceOf(platform) != null;
}

/** 歌曲来源列展示名。和插件短名一样用中文平台名。 */
export function catalogSourceLabel(source: MusicCatalogSource): string {
    return CATALOG_LABELS[source];
}
