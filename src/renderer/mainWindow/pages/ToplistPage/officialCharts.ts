/**
 * 排行榜页最前面的官方榜。
 *
 * 名单来自洛雪客户端收录的网易云歌单（美国公告牌、英国 UK、日本公信榜、
 * 法国 NRJ、俄罗斯 TopHit、Beatport）。每次进入详情都重新请求。
 * 播放不走网易云 id，而是用设置里选中的音源按歌名和歌手搜索。
 */

import { tauriInvoke } from '@infra/tauriBridge/ipc';
import appConfig from '@infra/appConfig/renderer';
import pluginManager from '@infra/pluginManager/renderer';
import { sortByPluginOrder } from '@infra/pluginManager/common/sortByOrder';
import { store, pluginsAtom, pluginMetaAtom } from '@infra/pluginManager/renderer/store';
import trackPlayer from '@renderer/mainWindow/core/trackPlayer';

export const OFFICIAL_CHART_PLATFORM = 'official-chart';

export interface IOfficialChart {
    id: string;
    titleKey: string;
}

export const OFFICIAL_CHARTS: IOfficialChart[] = [
    { id: '60198', titleKey: 'toplist.chart_billboard' },
    { id: '180106', titleKey: 'toplist.chart_uk' },
    { id: '60131', titleKey: 'toplist.chart_oricon' },
    { id: '27135204', titleKey: 'toplist.chart_nrj' },
    { id: '6939992364', titleKey: 'toplist.chart_tophit' },
    { id: '3812895', titleKey: 'toplist.chart_beatport' },
];

interface INeteaseResponse {
    statusCode: number;
    body: string;
}

interface INeteasePlaylist {
    name?: string;
    coverImgUrl?: string;
    updateTime?: number;
    trackIds?: Array<{ id?: number }>;
    tracks?: INeteaseSong[];
}

interface INeteaseSong {
    id?: number;
    name?: string;
    dt?: number;
    ar?: Array<{ name?: string }>;
    artists?: Array<{ name?: string }>;
    al?: { name?: string; picUrl?: string };
    album?: { name?: string; picUrl?: string };
}

function searchablePlugins(): IPlugin.IPluginDelegate[] {
    const plugins = store.get(pluginsAtom);
    const meta = store.get(pluginMetaAtom);
    return sortByPluginOrder(
        plugins.filter(
            (plugin) =>
                plugin.supportedMethod.includes('search') &&
                plugin.supportedMethod.includes('getMediaSource') &&
                meta[plugin.hash]?.enabled !== false,
        ),
        meta,
    );
}

/** 设置里选中的音源。没选中或已经关掉时，用当前第一个能搜索也能播放的平台。 */
export function officialChartPlugin(): IPlugin.IPluginDelegate | null {
    const plugins = searchablePlugins();
    const saved = appConfig.getConfigByKey('playMusic.officialChartPlugin');
    if (saved) {
        const picked = plugins.find((plugin) => plugin.hash === saved);
        if (picked) return picked;
    }
    return plugins[0] ?? null;
}

function neteasePlugin(): IPlugin.IPluginDelegate | null {
    return searchablePlugins().find((plugin) => plugin.sourceKey === 'wy') ?? null;
}

export function neteaseChartSongId(song: IMusic.IMusicItem): string {
    const rawId = song.songId ?? song.songmid ?? song.id;
    const text = String(rawId);
    const parts = text.split(':');
    return parts.length >= 3 ? parts[parts.length - 1] : text;
}

/** 榜单歌曲来自网易云，用真实歌曲 id 接到网易云音源上就能直接播。 */
export function asNeteaseChartSong(
    song: IMusic.IMusicItem,
    plugin: IPlugin.IPluginDelegate,
): IMusic.IMusicItem {
    const id = neteaseChartSongId(song);
    return {
        ...song,
        id,
        platform: plugin.platform,
        songId: Number(id),
        songmid: id,
    };
}

async function neteaseGet<T>(path: string): Promise<T> {
    const res = await tauriInvoke<INeteaseResponse | null>('netease_request', {
        method: 'GET',
        path,
        body: null,
    });
    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`chart request failed: ${res?.statusCode ?? 0}`);
    }
    return JSON.parse(res.body) as T;
}

function artistName(song: INeteaseSong): string {
    const people = song.ar ?? song.artists ?? [];
    const name = people
        .map((person) => person?.name?.trim())
        .filter(Boolean)
        .join(' / ');
    return name || '';
}

function durationSec(value: unknown): number | undefined {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return undefined;
    return Math.round(ms / 1000);
}

function toChartSong(
    song: INeteaseSong,
    chartId: string,
    platform: string,
): IMusic.IMusicItem | null {
    const id = song.id;
    const title = song.name?.trim();
    if (!id || !title) return null;
    const album = song.al ?? song.album;
    return {
        id: `official:${chartId}:${id}`,
        platform,
        songId: id,
        songmid: String(id),
        title,
        artist: artistName(song),
        album: album?.name?.trim() || undefined,
        artwork: album?.picUrl,
        duration: durationSec(song.dt),
    };
}

async function loadSongs(chartId: string): Promise<{
    playlist: INeteasePlaylist;
    songs: INeteaseSong[];
}> {
    const listed = await neteaseGet<{ playlist?: INeteasePlaylist }>(
        `/api/v6/playlist/detail?id=${encodeURIComponent(chartId)}&n=0`,
    );
    const playlist = listed.playlist ?? {};
    const ids = (playlist.trackIds ?? [])
        .map((item) => item?.id)
        .filter((id): id is number => !!id);
    if (ids.length === 0) {
        return { playlist, songs: playlist.tracks ?? [] };
    }

    const songs: INeteaseSong[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const detail = await neteaseGet<{ songs?: INeteaseSong[] }>(
            `/api/song/detail/?ids=${encodeURIComponent(JSON.stringify(batch))}`,
        );
        songs.push(...(detail.songs ?? []));
    }
    return { playlist, songs: songs.length ? songs : (playlist.tracks ?? []) };
}

export async function fetchOfficialChart(
    chartId: string,
    title: string,
): Promise<{
    sheetItem: IMusic.IMusicSheetItem;
    musicList: IMusic.IMusicItem[];
    updatedAt?: number;
}> {
    const plugin = officialChartPlugin();
    const { playlist, songs } = await loadSongs(chartId);
    const musicList = songs
        .map((song) => toChartSong(song, chartId, plugin?.platform ?? ''))
        .filter((song): song is IMusic.IMusicItem => song !== null);

    return {
        updatedAt: playlist.updateTime,
        sheetItem: {
            id: chartId,
            platform: plugin?.platform ?? '',
            title: playlist.name?.trim() || title,
            artwork: playlist.coverImgUrl,
            worksNum: musicList.length,
        },
        musicList,
    };
}

function compactTitle(value: string): string {
    return value
        .toLowerCase()
        .replace(/（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]/g, '')
        .replace(/[\s'"“”‘’()（）[\]【】\-—·.,，。!！?？/\\]/g, '');
}

function matchScore(wanted: IMusic.IMusicItem, found: IMusic.IMusicItem): number {
    const title = compactTitle(found.title ?? '');
    const wantedTitle = compactTitle(wanted.title);
    if (!title || !wantedTitle) return 0;
    if (title === wantedTitle) return 3;
    const shorter = title.length <= wantedTitle.length ? title : wantedTitle;
    const longer = shorter === title ? wantedTitle : title;
    if (shorter.length >= 2 && longer.includes(shorter)) return 2;
    return 0;
}

function searchList(result: unknown): IMusic.IMusicItem[] {
    if (Array.isArray(result)) return result;
    if (
        result &&
        typeof result === 'object' &&
        Array.isArray((result as { data?: unknown }).data)
    ) {
        return (result as { data: IMusic.IMusicItem[] }).data;
    }
    return [];
}

async function searchOnce(
    plugin: IPlugin.IPluginDelegate,
    query: string,
): Promise<IMusic.IMusicItem[]> {
    const result = await pluginManager.callPluginMethod({
        hash: plugin.hash,
        method: 'search',
        args: [query, 1, 'music'],
    });
    return searchList(result).filter((item) => item?.id && item.title);
}

/** 在选中的音源里找和榜单歌曲同名的那一首。找不到就返回空。 */
export async function findChartSongOnPlugin(
    song: IMusic.IMusicItem,
    plugin: IPlugin.IPluginDelegate,
): Promise<IMusic.IMusicItem | null> {
    const queries = [song.title, `${song.title} ${song.artist ?? ''}`.trim()];
    let best: IMusic.IMusicItem | null = null;
    let bestScore = 0;
    for (const query of queries) {
        if (!query) continue;
        const found = await searchOnce(plugin, query);
        for (const item of found) {
            const score = matchScore(song, item);
            if (score > bestScore) {
                best = item;
                bestScore = score;
            }
        }
        if (bestScore >= 2) break;
    }
    return best;
}

let playGeneration = 0;

export function nextOfficialPlay(): number {
    playGeneration += 1;
    return playGeneration;
}

export function isOfficialPlayCurrent(generation: number): boolean {
    return generation === playGeneration;
}

export function formatChartUpdatedAt(updatedAt: number): string {
    const date = new Date(updatedAt);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function resolveChartSong(
    song: IMusic.IMusicItem,
    plugin: IPlugin.IPluginDelegate,
    wy: IPlugin.IPluginDelegate | null,
): Promise<IMusic.IMusicItem | null> {
    if (plugin.sourceKey === 'wy') return asNeteaseChartSong(song, plugin);
    const found = await Promise.race([
        findChartSongOnPlugin(song, plugin).catch((): null => null),
        new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), 5000);
        }),
    ]);
    if (found?.id) {
        return { ...found, id: String(found.id), platform: plugin.platform };
    }
    return wy ? asNeteaseChartSong(song, wy) : null;
}

/**
 * 把榜单放进播放队列。
 * 选中的是网易云时直接用歌单里的歌曲 id。
 * 选的是别的平台时先搜索，搜不到就用网易云原曲顶上，队列仍然补齐。
 */
export async function playOfficialChart(
    list: IMusic.IMusicItem[],
    startItem?: IMusic.IMusicItem,
): Promise<'ok' | 'no-plugin' | 'empty' | 'cancelled'> {
    const plugin = officialChartPlugin();
    const wy = neteasePlugin();
    const target = plugin ?? wy;
    if (!target) return 'no-plugin';

    const generation = nextOfficialPlay();
    const startIndex = startItem
        ? Math.max(
              list.findIndex((item) => item.id === startItem.id),
              0,
          )
        : 0;
    const ordered = list.slice(startIndex);
    if (ordered.length === 0) return 'empty';

    if (target.sourceKey === 'wy') {
        const queue = ordered.map((song) => asNeteaseChartSong(song, target));
        await trackPlayer.playMusicWithReplaceQueue(queue);
        return 'ok';
    }

    let first: IMusic.IMusicItem | null = null;
    let firstIndex = 0;
    for (let index = 0; index < ordered.length; index += 1) {
        if (!isOfficialPlayCurrent(generation)) return 'cancelled';
        first = await resolveChartSong(ordered[index], target, wy);
        if (first) {
            firstIndex = index;
            break;
        }
    }
    if (!isOfficialPlayCurrent(generation)) return 'cancelled';
    if (!first) return 'empty';
    await trackPlayer.playMusicWithReplaceQueue([first]);

    const rest = ordered.slice(firstIndex + 1);
    const slots: Array<IMusic.IMusicItem | null | undefined> = new Array(rest.length);
    let cursor = 0;
    let appended = 0;
    const worker = async (): Promise<void> => {
        while (cursor < slots.length) {
            if (!isOfficialPlayCurrent(generation)) return;
            const index = cursor;
            cursor += 1;
            slots[index] = await resolveChartSong(rest[index], target, wy);
            if (!isOfficialPlayCurrent(generation)) return;
            const ready: IMusic.IMusicItem[] = [];
            while (appended < slots.length && slots[appended] !== undefined) {
                const song = slots[appended];
                appended += 1;
                if (song) ready.push(song);
            }
            if (ready.length > 0 && isOfficialPlayCurrent(generation)) {
                trackPlayer.appendToQueue(ready);
            }
        }
    };
    await Promise.all([worker(), worker(), worker()]);
    return 'ok';
}
