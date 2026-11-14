/**
 * 插件配置的导入导出。
 * 只保存平台开关、排序和检测耗时，不打包脚本本身。
 * 导入时按脚本名和平台对上已安装的插件，哈希变了也能套回去。
 */

import { LOCAL_PLUGIN_HASH } from '@common/constant';
import fsUtil from '@infra/fsUtil/renderer';
import { pluginPlatformLabel, pluginScriptLabel } from '@infra/pluginManager/common/pluginIdentity';
import { applyPluginPlaybackLatencies, getPluginPlaybackLatency } from '../common/playbackLatency';
import pluginManager from './index';

export interface IPluginPlatformSettings {
    scriptName: string;
    platform: string;
    platformLabel: string;
    sourceKey?: string;
    enabled: boolean;
    order?: number;
    latencyMs: number | null;
    userVariables?: Record<string, string>;
    srcUrl?: string;
    sourceRedirectPlatform?: string | null;
}

export interface IPluginSettingsFile {
    kind: 'free-music-online-plugins';
    version: 1;
    exportedAt: string;
    platforms: IPluginPlatformSettings[];
}

export interface IPluginSettingsImportResult {
    applied: number;
    skipped: number;
}

export function buildPluginSettingsFile(): IPluginSettingsFile {
    const meta = pluginManager.getPluginMeta();
    const platforms = pluginManager
        .getPlugins()
        .filter((plugin) => plugin.hash && plugin.hash !== LOCAL_PLUGIN_HASH)
        .map((plugin) => {
            const itemMeta = meta[plugin.hash] ?? {};
            const settings: IPluginPlatformSettings = {
                scriptName:
                    plugin.scriptName?.trim() || pluginScriptLabel(plugin) || plugin.platform,
                platform: plugin.platform,
                platformLabel: pluginPlatformLabel(plugin),
                enabled: itemMeta.enabled !== false,
                latencyMs: getPluginPlaybackLatency(plugin.hash),
            };
            if (plugin.sourceKey) settings.sourceKey = plugin.sourceKey;
            if (typeof itemMeta.order === 'number') settings.order = itemMeta.order;
            if (itemMeta.userVariables) settings.userVariables = itemMeta.userVariables;
            if (itemMeta.srcUrl) settings.srcUrl = itemMeta.srcUrl;
            if ('sourceRedirectPlatform' in itemMeta) {
                settings.sourceRedirectPlatform = itemMeta.sourceRedirectPlatform ?? null;
            }
            return settings;
        });

    return {
        kind: 'free-music-online-plugins',
        version: 1,
        exportedAt: new Date().toISOString(),
        platforms,
    };
}

export async function writePluginSettingsFile(path: string): Promise<number> {
    const file = buildPluginSettingsFile();
    await fsUtil.writeFile(path, JSON.stringify(file, null, 2), { encoding: 'utf-8' });
    return file.platforms.length;
}

export async function readPluginSettingsFile(path: string): Promise<IPluginSettingsImportResult> {
    const raw = await fsUtil.readFile(path, 'utf-8');
    const text = typeof raw === 'string' ? raw : '';
    const parsed = JSON.parse(text) as Partial<IPluginSettingsFile>;
    if (parsed?.kind !== 'free-music-online-plugins' || !Array.isArray(parsed.platforms)) {
        throw new Error('invalid plugin settings');
    }

    const installed = pluginManager.getPlugins();
    const updates: Array<{ hash: string; meta: Partial<IPlugin.IPluginMeta> }> = [];
    const latencies: Array<{ hash: string; latencyMs: number | null }> = [];
    let skipped = 0;

    for (const entry of parsed.platforms) {
        if (!entry || typeof entry !== 'object') {
            skipped += 1;
            continue;
        }
        const plugin = matchInstalledPlugin(installed, entry);
        if (!plugin) {
            skipped += 1;
            continue;
        }
        const meta: Partial<IPlugin.IPluginMeta> = {};
        if (typeof entry.enabled === 'boolean') meta.enabled = entry.enabled;
        if (typeof entry.order === 'number' && Number.isFinite(entry.order))
            meta.order = entry.order;
        if (entry.userVariables && typeof entry.userVariables === 'object') {
            meta.userVariables = entry.userVariables;
        }
        if (typeof entry.srcUrl === 'string') meta.srcUrl = entry.srcUrl;
        if ('sourceRedirectPlatform' in entry) {
            meta.sourceRedirectPlatform = entry.sourceRedirectPlatform ?? null;
        }
        updates.push({ hash: plugin.hash, meta });
        latencies.push({
            hash: plugin.hash,
            latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : null,
        });
    }

    if (updates.length > 0) {
        await pluginManager.batchSetPluginMeta(updates);
        applyPluginPlaybackLatencies(latencies);
    }

    return { applied: updates.length, skipped };
}

function matchInstalledPlugin(
    plugins: IPlugin.IPluginDelegate[],
    entry: Partial<IPluginPlatformSettings>,
): IPlugin.IPluginDelegate | undefined {
    const platform = typeof entry.platform === 'string' ? entry.platform : '';
    const exact = plugins.find((plugin) => plugin.platform === platform);
    if (exact) return exact;

    const scriptName = typeof entry.scriptName === 'string' ? entry.scriptName.trim() : '';
    if (!scriptName) return undefined;
    const sameScript = plugins.filter((plugin) => (plugin.scriptName?.trim() || '') === scriptName);
    const label = typeof entry.platformLabel === 'string' ? entry.platformLabel : '';
    const byLabel = sameScript.filter((plugin) => pluginPlatformLabel(plugin) === label);
    if (byLabel.length === 1) return byLabel[0];

    const sourceKey = typeof entry.sourceKey === 'string' ? entry.sourceKey : '';
    const bySource = sourceKey ? sameScript.filter((plugin) => plugin.sourceKey === sourceKey) : [];
    return bySource.length === 1 ? bySource[0] : undefined;
}
