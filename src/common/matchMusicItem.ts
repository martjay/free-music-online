/**
 * 在另一个平台的搜索结果里找同一首歌。
 * 分数达到 6 才接受，避免把试听换成另一首同名曲。
 */

function normalizeCompareText(value?: string | null): string {
    return String(value ?? '')
        .toLowerCase()
        .replace(/（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]/g, '')
        .replace(/[\s"'`~!@#$%^*_+=|\\:;,.，。！？?、/<>《》“”‘’{}【】()[\]-]/g, '');
}

function splitArtists(artist?: string): string[] {
    return String(artist ?? '')
        .split(/\/|、|,|，|;|；|&|＆|\s+feat\.?\s+|\s+ft\.?\s+/i)
        .map((item) => normalizeCompareText(item))
        .filter(Boolean);
}

function hasArtistOverlap(sourceArtist?: string, candidateArtist?: string): boolean {
    const sourceArtists = splitArtists(sourceArtist);
    const candidateArtists = splitArtists(candidateArtist);
    if (sourceArtists.length === 0 || candidateArtists.length === 0) return false;
    return sourceArtists.some((source) =>
        candidateArtists.some(
            (candidate) =>
                source === candidate || source.includes(candidate) || candidate.includes(source),
        ),
    );
}

function scoreMusicItem(source: IMusic.IMusicItem, candidate: IMusic.IMusicItem): number {
    const sourceTitle = normalizeCompareText(source.title);
    const candidateTitle = normalizeCompareText(candidate.title);
    if (!sourceTitle || !candidateTitle) return 0;

    let score = 0;
    if (sourceTitle === candidateTitle) score += 6;
    else if (sourceTitle.includes(candidateTitle) || candidateTitle.includes(sourceTitle)) {
        score += 4;
    }

    if (hasArtistOverlap(source.artist, candidate.artist)) score += 3;

    const sourceAlbum = normalizeCompareText(source.album);
    const candidateAlbum = normalizeCompareText(candidate.album);
    if (sourceAlbum && candidateAlbum && sourceAlbum === candidateAlbum) score += 1;

    if (source.duration && candidate.duration) {
        const diff = Math.abs(source.duration - candidate.duration);
        if (diff <= 3) score += 2;
        else if (diff <= 10) score += 1;
    }

    return score;
}

export function pickSameMusicItem(
    source: IMusic.IMusicItem,
    candidates: IMusic.IMusicItem[],
): IMusic.IMusicItem | null {
    let best: { item: IMusic.IMusicItem; score: number } | null = null;
    for (const item of candidates) {
        const score = scoreMusicItem(source, item);
        if (!best || score > best.score) best = { item, score };
    }
    return best && best.score >= 6 ? best.item : null;
}
