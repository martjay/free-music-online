/**
 * 下载目录只接受可写路径。空路径和「.」退回默认目录。
 * 手机端再限制必须落在应用数据目录里，避免选到系统拒绝写入的公共路径。
 */
export function resolveDownloadDirectory(input: {
    configured?: string | null;
    fallback: string;
    restrictToDir?: string | null;
}): string {
    const fallback = input.fallback.trim();
    const configured = (input.configured ?? '').trim();
    if (!configured || configured === '.') return fallback;

    const root = input.restrictToDir?.trim();
    if (root) {
        const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');
        const file = normalize(configured);
        const base = normalize(root);
        if (file !== base && !file.startsWith(`${base}/`)) return fallback;
    }

    return configured;
}
