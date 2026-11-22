import pluginManager from '@infra/pluginManager/renderer';
import musicSheet from '@infra/musicSheet/renderer';
import { resolveAlbumId, resolveArtistId, resolveArtistIdByName } from '@common/mediaIdentity';

export { resolveAlbumId, resolveArtistId, resolveArtistIdByName };

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

/** 显示名里的括号别名拿掉再查一次，例如 aespa (에스파)。 */
function lookupQueries(name: string): string[] {
    const primary = name.trim();
    if (!primary) return [];
    const queries = [primary];
    const plain = primary.replace(/\s*[[(（【].*$/u, '').trim();
    if (plain && plain !== primary) queries.push(plain);
    return queries;
}

async function searchByName<T extends { id?: string }>(
    platform: string,
    query: string,
    type: 'artist' | 'album',
): Promise<T[]> {
    try {
        const result = await pluginManager.callPluginMethod({
            platform,
            method: 'search',
            args: [query, 1, type],
        });
        return ((result?.data ?? []) as T[]).filter((item) => !!item?.id);
    } catch {
        return [];
    }
}

/** 列表里的精简歌曲没有编号时，回到收藏记录里把平台编号补上。 */
export async function musicForMediaLink(
    item: IMusic.IMusicItemBase,
): Promise<IMusic.IMusicItemBase> {
    if (item.raw && item.artistId && item.albumId) return item;
    try {
        const stored = await musicSheet.getRawMusicItem(item.platform, String(item.id));
        if (!stored) return item;
        return {
            ...item,
            artistId: item.artistId || resolveArtistId(stored),
            albumId: item.albumId || resolveAlbumId(stored),
            artwork: item.artwork || stored.artwork,
            raw: item.raw ?? stored.raw ?? stored,
        };
    } catch {
        return item;
    }
}

/** 没有编号时，用当前歌曲的平台按名字再查一次。 */
export async function resolveCatalogArtist(music: {
    platform: string;
    artist: string;
    artistId?: string;
    raw?: unknown;
    /** 这首歌拆开后的第几个歌手，从 0 开始。 */
    artistIndex?: number;
    /** 这首歌一共有几个歌手。多于一个时不能拿第一个人的编号去开别人的页面。 */
    artistCount?: number;
}): Promise<IArtist.IArtistItem | null> {
    const named = resolveArtistIdByName(music, music.artist, music.artistIndex, music.artistCount);
    const id =
        named ||
        (!music.artistCount || music.artistCount <= 1 ? resolveArtistId(music) : undefined);
    if (id) {
        return { id, platform: music.platform, name: music.artist, avatar: '' };
    }
    if (!music.platform || !music.artist) return null;
    const queries = lookupQueries(music.artist);
    for (let index = 0; index < queries.length; index += 1) {
        const query = queries[index];
        const list = await searchByName<IArtist.IArtistItem>(music.platform, query, 'artist');
        const matched =
            list.find((item) => sameName(item.name, music.artist) || sameName(item.name, query)) ??
            (index === 0 ? list[0] : undefined);
        if (matched?.id) return matched;
    }
    return null;
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
    const queries = lookupQueries(music.album);
    for (let index = 0; index < queries.length; index += 1) {
        const query = queries[index];
        const list = await searchByName<IAlbum.IAlbumItem>(music.platform, query, 'album');
        const sameTitle = list.filter(
            (item) => sameName(item.title, music.album) || sameName(item.title, query),
        );
        const matched =
            sameTitle.find((item) => sameName(item.artist ?? '', music.artist)) ??
            sameTitle[0] ??
            (index === 0 ? list[0] : undefined);
        if (matched?.id) return matched;
    }
    return null;
}
