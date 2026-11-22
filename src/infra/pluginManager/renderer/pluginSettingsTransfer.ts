/**
 * 插件导入导出。
 * 导出开关、排序、检测耗时，以及插件脚本本身，方便 Windows 和 Android 互拷。
 */

import { LOCAL_PLUGIN_HASH } from '@common/constant';
import fsUtil from '@infra/fsUtil/renderer';
import { mergeLibraryEntries } from '@infra/library/renderer';
import type { ILibraryEntry } from '@infra/library/types';
import musicSheet from '@infra/musicSheet/renderer';
import { pluginPlatformLabel, pluginScriptLabel } from '@infra/pluginManager/common/pluginIdentity';
import { applyPluginPlaybackLatencies, getPluginPlaybackLatency } from '../common/playbackLatency';
import pluginManager from './index';

export interface IPluginPlatformSettings {
    scriptName: string;
    platform: string;
    platformLabel: string;
    sourceKey?: string;
    enabled: boolean;
    playbackEnabled?: boolean;
    order?: number;
    latencyMs: number | null;
    userVariables?: Record<string, string>;
    srcUrl?: string;
    sourceRedirectPlatform?: string | null;
}

export interface IPluginScriptPayload {
    scriptName: string;
    sourceHash?: string;
    srcUrl?: string;
    code: string;
}

export interface IPluginStarredSheet {
    platform: string;
    id: string;
    title?: string | null;
    artwork?: string | null;
    raw?: string;
    tracks?: IMusic.IMusicItem[];
}

export interface IPluginLibraryPayload {
    entries?: ILibraryEntry[];
    sheets?: IPluginStarredSheet[];
}

export interface IPluginSettingsFile {
    kind: 'free-music-online-plugins';
    version: 1 | 2;
    exportedAt: string;
    platforms: IPluginPlatformSettings[];
    scripts?: IPluginScriptPayload[];
    favorites?: IMusic.IMusicItem[];
    library?: IPluginLibraryPayload;
}

export interface IPluginSettingsImportResult {
    installed: number;
    applied: number;
    skipped: number;
    failed: number;
    error?: string;
    hasScripts: boolean;
    favoritesAdded: number;
    libraryAdded: number;
}

export async function buildPluginSettingsFile(): Promise<IPluginSettingsFile> {
    const meta = pluginManager.getPluginMeta();
    const plugins = pluginManager
        .getPlugins()
        .filter((plugin) => plugin.hash && plugin.hash !== LOCAL_PLUGIN_HASH);

    const platforms = plugins.map((plugin) => {
        const itemMeta = meta[plugin.hash] ?? {};
        const settings: IPluginPlatformSettings = {
            scriptName: plugin.scriptName?.trim() || pluginScriptLabel(plugin) || plugin.platform,
            platform: plugin.platform,
            platformLabel: pluginPlatformLabel(plugin),
            enabled: itemMeta.enabled !== false,
            playbackEnabled: itemMeta.playbackEnabled !== false,
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

    const scripts: IPluginScriptPayload[] = [];
    const seen = new Set<string>();
    for (const plugin of plugins) {
        const path = plugin.path?.trim();
        if (!path) continue;
        const key = plugin.sourceHash || path;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
            const raw = await fsUtil.readFile(path, 'utf-8');
            const code = typeof raw === 'string' ? raw : '';
            if (!code.trim()) continue;
            const itemMeta = meta[plugin.hash] ?? {};
            const payload: IPluginScriptPayload = {
                scriptName:
                    plugin.scriptName?.trim() || pluginScriptLabel(plugin) || plugin.platform,
                code,
            };
            if (plugin.sourceHash) payload.sourceHash = plugin.sourceHash;
            if (itemMeta.srcUrl) payload.srcUrl = itemMeta.srcUrl;
            scripts.push(payload);
        } catch {
            /* 读不到脚本时仍导出平台配置 */
        }
    }

    const favorites = await musicSheet.exportFavoriteMusic();
    const starred = musicSheet.getAllStarredSheets();
    const sheets = await Promise.all(
        starred.map(async (sheet) => ({
            platform: sheet.platform,
            id: sheet.id,
            title: sheet.title,
            artwork: sheet.artwork,
            raw: sheet.raw,
            tracks: await musicSheet.getStarredSheetMusic(sheet.platform, sheet.id),
        })),
    );
    const libraryEntries = await loadLibraryEntries();

    return {
        kind: 'free-music-online-plugins',
        version: 2,
        exportedAt: new Date().toISOString(),
        platforms,
        scripts,
        favorites,
        library: { entries: libraryEntries, sheets },
    };
}

async function loadLibraryEntries(): Promise<ILibraryEntry[]> {
    const bridge = (window as unknown as { library?: { load?: () => Promise<ILibraryEntry[]> } })
        .library;
    if (!bridge?.load) return [];
    try {
        const entries = await bridge.load();
        return Array.isArray(entries) ? entries : [];
    } catch {
        return [];
    }
}

export async function writePluginSettingsFile(
    path: string,
): Promise<{ plugins: number; favorites: number; library: number }> {
    const file = await buildPluginSettingsFile();
    await fsUtil.writeFile(path, JSON.stringify(file, null, 2), { encoding: 'utf-8' });
    return {
        plugins: file.scripts?.length || file.platforms.length,
        favorites: file.favorites?.length ?? 0,
        library: (file.library?.entries?.length ?? 0) + (file.library?.sheets?.length ?? 0),
    };
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function alreadyInstalled(message?: string): boolean {
    const text = (message ?? '').toLowerCase();
    return text.includes('already installed') || text.includes('已安装');
}

async function installFromUrl(srcUrl: string): Promise<{ success: boolean; message?: string }> {
    return pluginManager.installPlugin(srcUrl);
}

async function installMissingScripts(parsed: Partial<IPluginSettingsFile>): Promise<{
    installed: number;
    failed: number;
    error?: string;
    hasScripts: boolean;
}> {
    const scripts = Array.isArray(parsed.scripts) ? parsed.scripts : [];
    const seenCode = new Set<string>();
    const seenUrl = new Set<string>();
    let installed = 0;
    let failed = 0;
    let error: string | undefined;
    const hasScripts = scripts.some(
        (script) => typeof script?.code === 'string' && script.code.trim(),
    );

    for (const script of scripts) {
        const code = typeof script?.code === 'string' ? script.code.trim() : '';
        const srcUrl = typeof script.srcUrl === 'string' ? script.srcUrl.trim() : '';
        if (code) {
            if (seenCode.has(code)) continue;
            seenCode.add(code);
            let result: { success: boolean; message?: string };
            try {
                result = await pluginManager.installPluginFromCode(code);
            } catch (error) {
                result = {
                    success: false,
                    message: error instanceof Error ? error.message : String(error),
                };
            }
            if (result.success || alreadyInstalled(result.message)) {
                if (result.success) installed += 1;
                continue;
            }
            if (srcUrl.startsWith('http://') || srcUrl.startsWith('https://')) {
                seenUrl.add(srcUrl);
                const remote = await installFromUrl(srcUrl);
                if (remote.success || alreadyInstalled(remote.message)) {
                    if (remote.success) installed += 1;
                    continue;
                }
                error = remote.message || result.message;
            } else {
                error = result.message;
            }
            failed += 1;
            continue;
        }
        if (srcUrl.startsWith('http://') || srcUrl.startsWith('https://')) {
            if (seenUrl.has(srcUrl)) continue;
            seenUrl.add(srcUrl);
            const remote = await installFromUrl(srcUrl);
            if (remote.success) installed += 1;
            else if (!alreadyInstalled(remote.message)) {
                failed += 1;
                error = remote.message;
            }
        }
    }

    if (installed === 0 && Array.isArray(parsed.platforms)) {
        for (const entry of parsed.platforms) {
            const srcUrl = typeof entry?.srcUrl === 'string' ? entry.srcUrl.trim() : '';
            if (!srcUrl.startsWith('http://') && !srcUrl.startsWith('https://')) continue;
            if (seenUrl.has(srcUrl)) continue;
            seenUrl.add(srcUrl);
            const remote = await installFromUrl(srcUrl);
            if (remote.success) installed += 1;
            else if (!alreadyInstalled(remote.message)) {
                failed += 1;
                error = remote.message;
            }
        }
    }

    return { installed, failed, error, hasScripts };
}

export async function importPluginSettingsText(text: string): Promise<IPluginSettingsImportResult> {
    const rawText = stripBom(text).trim();
    let parsed: Partial<IPluginSettingsFile>;
    try {
        parsed = JSON.parse(rawText) as Partial<IPluginSettingsFile>;
    } catch {
        throw new Error('invalid plugin settings');
    }
    if (parsed?.kind !== 'free-music-online-plugins' || !Array.isArray(parsed.platforms)) {
        throw new Error('invalid plugin settings');
    }

    const installResult = await installMissingScripts(parsed);

    const installedPlugins = pluginManager.getPlugins();
    const updates: Array<{ hash: string; meta: Partial<IPlugin.IPluginMeta> }> = [];
    const latencies: Array<{ hash: string; latencyMs: number | null }> = [];
    let skipped = 0;

    for (const entry of parsed.platforms) {
        if (!entry || typeof entry !== 'object') {
            skipped += 1;
            continue;
        }
        const plugin = matchInstalledPlugin(installedPlugins, entry);
        if (!plugin) {
            skipped += 1;
            continue;
        }
        const meta: Partial<IPlugin.IPluginMeta> = {};
        if (typeof entry.enabled === 'boolean') meta.enabled = entry.enabled;
        if (typeof entry.playbackEnabled === 'boolean')
            meta.playbackEnabled = entry.playbackEnabled;
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

    const libraryResult = await importLibraryPayload(parsed);

    return {
        installed: installResult.installed,
        applied: updates.length,
        skipped,
        failed: installResult.failed,
        error: installResult.error,
        hasScripts: installResult.hasScripts,
        favoritesAdded: libraryResult.favoritesAdded,
        libraryAdded: libraryResult.libraryAdded,
    };
}

async function importLibraryPayload(
    parsed: Partial<IPluginSettingsFile>,
): Promise<{ favoritesAdded: number; libraryAdded: number }> {
    const favorites = Array.isArray(parsed.favorites) ? parsed.favorites : [];
    const favoritesAdded = musicSheet.importFavoriteMusic(
        favorites.filter(
            (item) => item && typeof item === 'object' && item.platform && item.id != null,
        ),
    );

    const library = parsed.library;
    const entries = Array.isArray(library?.entries) ? library.entries : [];
    const sheets = Array.isArray(library?.sheets) ? library.sheets : [];
    let libraryAdded = 0;
    try {
        libraryAdded += await mergeLibraryEntries(entries);
    } catch {
        /* 旧版本没有合并接口时跳过专辑、歌手和榜单 */
    }
    try {
        libraryAdded += await musicSheet.importStarredSheets(sheets);
    } catch {
        /* 歌单收藏写入失败时保留已经导入的插件配置 */
    }
    return { favoritesAdded, libraryAdded };
}

export async function readPluginSettingsFile(path: string): Promise<IPluginSettingsImportResult> {
    const raw = await fsUtil.readFile(path, 'utf-8');
    const text = typeof raw === 'string' ? raw : '';
    return importPluginSettingsText(text);
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
