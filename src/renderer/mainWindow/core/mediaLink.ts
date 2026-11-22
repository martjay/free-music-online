import pluginManager from '@infra/pluginManager/renderer';

function textId(value: unknown): string | undefined {
    if (value == null) return undefined;
    const text = String(value).trim();
    if (!text || text === '0' || text === 'undefined') return undefined;
    return text;
}

function firstId(...values: unknown[]): string | undefined {
    for (const value of values) {
        const id = textId(value);
        if (id) return id;
    }
    return undefined;
}

function nestedArtistId(source: unknown): string | undefined {
    const list = Array.isArray(source) ? source : source ? [source] : [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const id = firstId(
            record.id,
            record.mid,
            record.singerid,
            record.singer_id,
            record.singerMID,
            record.singerMid,
            record.author_id,
        );
        if (id) return id;
    }
    return undefined;
}

/** 优先用已经记下的 id，否则从平台原始数据里取，保证链接仍指向当前平台。 */
function tencentSingerMid(source: unknown): string | undefined {
    const list = Array.isArray(source) ? source : source ? [source] : [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const mid = firstId(
            record.mid,
            record.singerMID,
            record.singerMid,
            record.singermid,
            record.singer_mid,
        );
        if (mid && !/^\d+$/.test(mid)) return mid;
    }
    return undefined;
}

export function resolveArtistId(
    item?: { artistId?: string; platform?: string; raw?: unknown } | null,
): string | undefined {
    if (!item) return undefined;
    const platform = item.platform ?? '';
    const raw = (item.raw ?? {}) as Record<string, unknown>;
    if (platform === 'tx' || platform.endsWith(':tx')) {
        const mid = firstId(
            raw.singer_mid,
            raw.singerMID,
            raw.singerMid,
            raw.singermid,
            tencentSingerMid(raw.singer),
            tencentSingerMid(raw.singers),
        );
        if (mid && (!item.artistId || /^\d+$/.test(item.artistId))) return mid;
    }
    if (item.artistId) return item.artistId;
    return firstId(
        raw.artistId,
        raw.ARTISTID,
        raw.artistid,
        raw.singerId,
        raw.singerid,
        raw.singer_id,
        raw.singerMID,
        raw.singerMid,
        raw.singer_mid,
        raw.singermid,
        nestedArtistId(raw.artists),
        nestedArtistId(raw.ar),
        nestedArtistId(raw.singer),
        nestedArtistId(raw.singers),
        nestedArtistId(raw.authors),
        nestedArtistId(raw.artist),
    );
}

export function resolveAlbumId(
    item?: { albumId?: string; raw?: unknown } | null,
): string | undefined {
    if (!item) return undefined;
    if (item.albumId) return item.albumId;
    const raw = (item.raw ?? {}) as Record<string, unknown>;
    const album = raw.album as Record<string, unknown> | undefined;
    const albums = Array.isArray(raw.albums)
        ? (raw.albums[0] as Record<string, unknown>)
        : undefined;
    return firstId(
        raw.albumId,
        raw.ALBUMID,
        raw.albumid,
        raw.albummid,
        raw.albumMid,
        album?.id,
        album?.mid,
        albums?.id,
    );
}

/** 酷我用 A&B，其他平台用 A / B。带空格的 & 留给 Simon & Garfunkel 这种单人名字。 */
export function splitArtistNames(value: string): string[] {
    const names = value
        .split(/\s*(?:(?<!\s)&(?!\s)| \/ |、|，|, )\s*/)
        .map((part) => part.trim())
        .filter(Boolean);
    return names.length > 0 ? names : value.trim() ? [value.trim()] : [];
}

function sameName(left: string, right: string) {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** 没有编号时，用当前歌曲的平台按名字再查一次。 */
export async function resolveCatalogArtist(music: {
    platform: string;
    artist: string;
    artistId?: string;
    raw?: unknown;
}): Promise<IArtist.IArtistItem | null> {
    const id = resolveArtistId(music);
    if (id) {
        return { id, platform: music.platform, name: music.artist, avatar: '' };
    }
    if (!music.platform || !music.artist) return null;
    const result = await pluginManager.callPluginMethod({
        platform: music.platform,
        method: 'search',
        args: [music.artist, 1, 'artist'],
    });
    const list = (result?.data ?? []) as IArtist.IArtistItem[];
    return list.find((item) => sameName(item.name, music.artist)) ?? list[0] ?? null;
}

export async function resolveCatalogAlbum(music: {
    platform: string;
    artist: string;
    album: string;
    artwork?: string;
    albumId?: string;
    raw?: unknown;
}): Promise<IAlbum.IAlbumItem | null> {
    const id = resolveAlbumId(music);
    if (id) {
        return {
            id,
            platform: music.platform,
            title: music.album,
            artist: music.artist,
            artwork: music.artwork,
            description: '',
        };
    }
    if (!music.platform || !music.album) return null;
    const result = await pluginManager.callPluginMethod({
        platform: music.platform,
        method: 'search',
        args: [music.album, 1, 'album'],
    });
    const list = (result?.data ?? []) as IAlbum.IAlbumItem[];
    const sameTitle = list.filter((item) => sameName(item.title, music.album));
    return (
        sameTitle.find((item) => sameName(item.artist ?? '', music.artist)) ??
        sameTitle[0] ??
        list[0] ??
        null
    );
}
