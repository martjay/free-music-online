/** 编辑距离相似度，0 到 1。用于把多音源搜索结果按关键词排到前面。 */
export function textSimilar(a: string, b: string): number {
    const left = a.trim().toLowerCase();
    const right = b.trim().toLowerCase();
    if (!left || !right) return 0;
    const [shorter, longer] =
        left.length > right.length ? [right, left] : [left, right];
    const rows = new Array<number>(longer.length + 1);
    for (let i = 0; i <= longer.length; i++) rows[i] = i;
    for (let i = 1; i <= shorter.length; i++) {
        let diagonal = rows[0];
        rows[0] = i;
        const ch = shorter.charAt(i - 1);
        for (let j = 1; j <= longer.length; j++) {
            const next = Math.min(
                rows[j] + 1,
                rows[j - 1] + 1,
                diagonal + (ch === longer.charAt(j - 1) ? 0 : 1),
            );
            diagonal = rows[j];
            rows[j] = next;
        }
    }
    return 1 - rows[longer.length] / longer.length;
}
