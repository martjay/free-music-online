/**
 * 一份脚本可能拆成多个平台。分组和展示用同一套规则，避免页面各写各的。
 */

import { catalogSourceLabel, catalogSourceOf } from '@common/musicCatalog';

/** 同一脚本的分组键。没有 sourceHash 时退回自身 hash，单独成组。 */
export function pluginGroupKey(
    plugin: Pick<IPlugin.IPluginDelegate, 'hash' | 'sourceHash'>,
): string {
    return plugin.sourceHash || plugin.hash;
}

/** 列表里显示的短平台名。没有单独的展示名时用 platform。 */
export function pluginPlatformLabel(
    plugin: Pick<IPlugin.IPluginDelegate, 'platform' | 'platformLabel'>,
): string {
    return plugin.platformLabel?.trim() || shortPlatformName(plugin.platform);
}

/** 歌曲、歌单上展示的来源。平台内部会带上脚本名，界面只保留「QQ音乐」这一段。 */
export function shortPlatformName(platform?: string | null): string {
    const catalog = catalogSourceOf(platform);
    if (catalog) return catalogSourceLabel(catalog);
    const name = platform?.split(' · ')[0]?.trim();
    return name || '';
}

/**
 * 按歌曲上的平台名找到插件。
 * 先精确匹配（含脚本名的 platform），再按短名，最后按音源键（wy / tx）。
 * 短名或音源键对应多份脚本时不猜测，避免播到另一家音源。
 */
export function findPluginForPlatform<
    T extends Pick<IPlugin.IPluginDelegate, 'platform' | 'platformLabel' | 'sourceKey'>,
>(plugins: Iterable<T>, platform: string): T | undefined {
    let labelMatch: T | undefined;
    let labelCount = 0;
    let sourceMatch: T | undefined;
    let sourceCount = 0;
    for (const plugin of plugins) {
        if (plugin.platform === platform) return plugin;
        if (pluginPlatformLabel(plugin) === platform) {
            labelMatch = plugin;
            labelCount += 1;
        }
        if (plugin.sourceKey && plugin.sourceKey === platform) {
            sourceMatch = plugin;
            sourceCount += 1;
        }
    }
    if (labelCount === 1) return labelMatch;
    return sourceCount === 1 ? sourceMatch : undefined;
}

/** 歌曲平台是音源键时，列出所有对应脚本。调用方再决定试哪一家。 */
export function pluginsForSourceKey<T extends Pick<IPlugin.IPluginDelegate, 'sourceKey'>>(
    plugins: Iterable<T>,
    sourceKey: string,
): T[] {
    const matched: T[] = [];
    for (const plugin of plugins) {
        if (plugin.sourceKey === sourceKey) matched.push(plugin);
    }
    return matched;
}

export function pluginScriptLabel(
    plugin: Pick<IPlugin.IPluginDelegate, 'platform' | 'scriptName'>,
): string | null {
    const name = plugin.scriptName?.trim();
    if (!name || name === plugin.platform) return null;
    return name;
}
