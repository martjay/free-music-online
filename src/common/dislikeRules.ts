const NAME_SPLIT = '@';
const NAME_ALIAS = '#';

export interface DislikeIndex {
    titles: Set<string>;
    artists: Set<string>;
    pairs: Set<string>;
}

function normalize(value: string | undefined): string {
    return (value ?? '').replaceAll(NAME_SPLIT, NAME_ALIAS).toLocaleLowerCase().trim();
}

/** 规则一行一首。`歌名` 屏蔽歌名，`@歌手` 屏蔽歌手，`歌名@歌手` 只屏蔽这一对。 */
export function parseDislikeRules(rules: string | null | undefined): DislikeIndex {
    const titles = new Set<string>();
    const artists = new Set<string>();
    const pairs = new Set<string>();
    for (const raw of (rules ?? '').split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const splitAt = line.indexOf(NAME_SPLIT);
        if (splitAt < 0) {
            titles.add(normalize(line));
            continue;
        }
        const title = normalize(line.slice(0, splitAt));
        const artist = normalize(line.slice(splitAt + 1));
        if (title && artist) pairs.add(`${title}${NAME_SPLIT}${artist}`);
        else if (artist) artists.add(artist);
        else if (title) titles.add(title);
    }
    return { titles, artists, pairs };
}

export function isDisliked(
    item: { title?: string; artist?: string } | null | undefined,
    index: DislikeIndex,
): boolean {
    if (!item) return false;
    if (index.titles.size === 0 && index.artists.size === 0 && index.pairs.size === 0) {
        return false;
    }
    const title = normalize(item.title);
    const artist = normalize(item.artist);
    return (
        (title !== '' && index.titles.has(title)) ||
        (artist !== '' && index.artists.has(artist)) ||
        index.pairs.has(`${title}${NAME_SPLIT}${artist}`)
    );
}

export function appendDislikeRule(
    rules: string | null | undefined,
    item: { title?: string; artist?: string },
): string {
    const title = (item.title ?? '').replaceAll(NAME_SPLIT, NAME_ALIAS).trim();
    const artist = (item.artist ?? '').replaceAll(NAME_SPLIT, NAME_ALIAS).trim();
    const line = artist ? `${title}${NAME_SPLIT}${artist}` : title;
    if (!line) return rules ?? '';
    const existing = parseDislikeRules(rules);
    if (isDisliked(item, existing)) return (rules ?? '').trim();
    const base = (rules ?? '').trim();
    return base ? `${base}\n${line}` : line;
}
