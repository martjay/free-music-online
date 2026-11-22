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

function plainArtistName(value: string): string {
    return value
        .trim()
        .replace(/\s*[[(（【].*$/u, '')
        .trim()
        .toLowerCase();
}

function sameArtistName(left: string, right: string): boolean {
    const a = left.trim().toLowerCase();
    const b = right.trim().toLowerCase();
    if (a && a === b) return true;
    const plainA = plainArtistName(left);
    const plainB = plainArtistName(right);
    return !!plainA && plainA === plainB;
}

function artistRecords(source: unknown): Record<string, unknown>[] {
    const list = Array.isArray(source) ? source : source ? [source] : [];
    return list.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
}

function recordName(record: Record<string, unknown>): string {
    const value = record.name ?? record.singername ?? record.author_name ?? record.title;
    return typeof value === 'string' ? value : '';
}

function recordArtistId(record: Record<string, unknown>, platform: string): string | undefined {
    if (platform === 'tx' || platform.endsWith(':tx')) {
        const mid = firstId(
            record.mid,
            record.singerMID,
            record.singerMid,
            record.singermid,
            record.singer_mid,
        );
        if (mid && !/^\d+$/.test(mid)) return mid;
    }
    return firstId(
        record.mid,
        record.singerMID,
        record.singerMid,
        record.singermid,
        record.singer_mid,
        record.id,
        record.singerid,
        record.singer_id,
        record.author_id,
    );
}

const ARTIST_LIST_KEYS = ['singer', 'singers', 'artists', 'ar', 'authors', 'artist'] as const;

function peopleIn(
    payload: Record<string, unknown>,
    platform: string,
): { name: string; id?: string }[] {
    for (const key of ARTIST_LIST_KEYS) {
        const people = artistRecords(payload[key])
            .map((record) => ({
                name: recordName(record),
                id: recordArtistId(record, platform),
            }))
            .filter((person) => person.name || person.id);
        if (people.length > 0) return people;
    }
    return [];
}

/** 合作歌曲里按点击的名字找这个人自己的编号，不要总用第一个歌手。 */
export function resolveArtistIdByName(
    item: { platform?: string; raw?: unknown } | null | undefined,
    name: string,
    index?: number,
    count?: number,
): string | undefined {
    if (!item?.raw || typeof item.raw !== 'object') return undefined;
    const platform = item.platform ?? '';
    const raw = item.raw as Record<string, unknown>;
    const payloads = [raw];
    if (raw.raw && typeof raw.raw === 'object') payloads.push(raw.raw as Record<string, unknown>);

    let people: { name: string; id?: string }[] = [];
    for (const payload of payloads) {
        people = peopleIn(payload, platform);
        if (people.length > 0) break;
    }

    const named = people.find((person) => person.id && sameArtistName(person.name, name));
    if (named?.id) return named.id;
    if (
        index != null &&
        count != null &&
        count > 1 &&
        people.length === count &&
        people[index]?.id
    ) {
        return people[index].id;
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
