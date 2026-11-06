/** 桌面歌词字色 / 描边的预设色，设置页与歌词窗口共用。 */
export const LYRIC_COLOR_SWATCHES = [
    '#ffffff',
    '#34d399',
    '#a78bfa',
    '#f472b6',
    '#60a5fa',
    '#facc15',
    '#f97316',
] as const;

/** 空字符串、none、transparent 都表示不描边。 */
export function activeLyricStroke(value: string | null | undefined): string | null {
    const raw = (value ?? '').trim().toLowerCase();
    if (!raw || raw === 'none' || raw === 'transparent') return null;
    return (value ?? '').trim();
}
