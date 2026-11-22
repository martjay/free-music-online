/**
 * 生成媒体资源的复合键（platform + id）。
 * 用于在 Set / Map 中快速查找。
 */
export function compositeKey(platform: string, id: string): string {
    return `${platform}\0${String(id)}`;
}

/** 判断两个媒体资源是否为同一条记录（platform + id 相等） */
export function isSameMedia(
    a: IMedia.IMediaBase | null | undefined,
    b: IMedia.IMediaBase | null | undefined,
): boolean {
    if (!a || !b) return false;
    return a.platform === b.platform && String(a.id) === String(b.id);
}

/**
 * 歌单、排行榜和换源后的播放条目编号经常不同。
 * 编号相同，或去掉标点后的歌名一致、括号里的版本说明也一致、歌手有重叠，才视为同一首。
 * Explicit、Clean、Remix 这类括号内容不同，就不是同一条。
 */
export function isSameSong(
    a: IMedia.IMediaBase | null | undefined,
    b: IMedia.IMediaBase | null | undefined,
): boolean {
    if (!a || !b) return false;
    if (isSameMedia(a, b)) return true;
    const left = splitSongTitle(String(a.title ?? ''));
    const right = splitSongTitle(String(b.title ?? ''));
    if (left.base.length < 2 || left.base !== right.base || left.version !== right.version)
        return false;
    return artistOverlaps(String(a.artist ?? ''), String(b.artist ?? ''));
}

function splitSongTitle(value: string): { base: string; version: string } {
    const versions: string[] = [];
    const withoutVersion = value.replace(
        /（([^）]*)）|\(([^)]*)\)|【([^】]*)】|\[([^\]]*)\]/g,
        (_match, roundFull, round, squareFull, square) => {
            versions.push(compactTitle(roundFull ?? round ?? squareFull ?? square ?? ''));
            return '';
        },
    );
    return {
        base: compactTitle(withoutVersion),
        version: versions.filter(Boolean).join('|'),
    };
}

function compactTitle(value: string): string {
    return value
        .toLowerCase()
        .replace(/（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]/g, '')
        .replace(/[\s'"“”‘’()（）[\]【】\-—·.,，。!！?？/\\]/g, '');
}

function artistOverlaps(left: string, right: string): boolean {
    const a = left.trim().toLowerCase();
    const b = right.trim().toLowerCase();
    if (!a || !b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    const parts = (value: string) =>
        value
            .split(/[/,&、]| feat\.?| ft\.?/i)
            .map((part) => part.trim())
            .filter((part) => part.length >= 2);
    const leftParts = parts(a);
    const rightParts = parts(b);
    return leftParts.some((name) =>
        rightParts.some((other) => name.includes(other) || other.includes(name)),
    );
}

/**
 * 官方榜行的 id 是榜单编号，播放队列里是音源搜索结果。
 * 编号对不上时，用去掉括号后的歌名和重叠的歌手判断是不是正在播的那一行。
 */
export function isOfficialChartNowPlaying(
    row: IMedia.IMediaBase | null | undefined,
    playing: IMedia.IMediaBase | null | undefined,
): boolean {
    if (!row || !playing) return false;
    const rowOfficial = String(row.id).startsWith('official:');
    const playingOfficial = String(playing.id).startsWith('official:');
    if (rowOfficial === playingOfficial) return false;
    const chart = rowOfficial ? row : playing;
    const track = rowOfficial ? playing : row;
    const chartTitle = compactTitle(String(chart.title ?? ''));
    const trackTitle = compactTitle(String(track.title ?? ''));
    if (!chartTitle || chartTitle !== trackTitle) return false;
    return artistOverlaps(String(chart.artist ?? ''), String(track.artist ?? ''));
}
