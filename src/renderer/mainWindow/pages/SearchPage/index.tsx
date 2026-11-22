/**
 * SearchPage — 搜索结果页
 *
 * URL 格式: /search/:query（query 经 encodeURIComponent 编码）
 *
 * 布局：
 *   标题  "xxx的搜索结果"（xxx 以品牌色显示）
 *   TabBar  音乐 | 专辑 | 作者 | 歌单
 *   音源    全部 / 酷我 / 酷狗 / QQ / 网易云 / 咪咕（四个模式共用）
 *           默认按 LX Music 固定列出；设置里可改成只显示已启用插件
 *   Body    根据 type 渲染对应 ResultComponent
 *
 * 状态全部由 jotai store 管理，方便未来前进/后退恢复。
 */

import { useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Play } from 'lucide-react';
import { useAtomValue, useSetAtom } from 'jotai/react';
import { MUSIC_CATALOG_SOURCES, catalogSourceLabel } from '@common/musicCatalog';
import { useConfigValue } from '@renderer/common/hooks/useConfigValue';
import { useSortedSearchablePlugins } from '@infra/pluginManager/renderer/hooks';
import trackPlayer from '@renderer/mainWindow/core/trackPlayer';
import { PluginFeatureUnavailable } from '../../components/business/PluginFeatureUnavailable';
import { Button } from '../../components/ui/Button';
import { TabBar } from '../../components/ui/TabBar';
import { MusicResult } from './components/MusicResult';
import { AlbumResult } from './components/AlbumResult';
import { ArtistResult } from './components/ArtistResult';
import { SheetResult } from './components/SheetResult';
import {
    ALL_SOURCE,
    SEARCH_MEDIA_TYPES,
    SEARCH_TAB_LABEL_KEYS,
    type SearchMediaType,
    searchQueryAtom,
    searchResultsAtom,
    activeMediaTypeAtom,
    activeSearchSourceAtom,
    forgetSearchScroll,
    rememberSearchScroll,
    resetSearchResults,
    restoreSearchScroll,
    store,
} from './store';
import { useSearch } from './useSearch';
import './index.scss';

// ── 组件映射 ──

const RESULT_COMPONENTS: Record<SearchMediaType, React.ComponentType<{ pluginHash: string }>> = {
    music: MusicResult,
    album: AlbumResult,
    artist: ArtistResult,
    sheet: SheetResult,
};

// ── SearchPage ──

export default function SearchPage() {
    const { t } = useTranslation();
    const { query } = useParams<{ query: string }>();
    // react-router 已对 URL 参数自动解码，无需再调用 decodeURIComponent

    const results = useAtomValue(searchResultsAtom);
    const activeType = useAtomValue(activeMediaTypeAtom);
    const selectedSource = useAtomValue(activeSearchSourceAtom);
    const setActiveType = useSetAtom(activeMediaTypeAtom);
    const setSelectedSource = useSetAtom(activeSearchSourceAtom);

    const { search } = useSearch();
    const [searchSourceMode] = useConfigValue('playMusic.searchSourceMode');

    // ── 只有关键词变了才清空结果。标签和平台都留着，从歌单返回也不会被重置。 ──
    useEffect(() => {
        if (!query || store.get(searchQueryAtom) === query) return;

        resetSearchResults();
        forgetSearchScroll(query);
        store.set(searchQueryAtom, query);
    }, [query]);

    useLayoutEffect(() => {
        if (!query || store.get(searchQueryAtom) !== query) return;
        restoreSearchScroll(query);
    }, [query, activeType]);

    // ── 默认五个平台都在。设置改成「已启用插件」后，才按脚本过滤。 ──
    const availablePlugins = useSortedSearchablePlugins(activeType);
    const platforms = useMemo(() => {
        const sources =
            searchSourceMode === 'installed'
                ? MUSIC_CATALOG_SOURCES.filter((source) =>
                      availablePlugins.some((plugin) => plugin.sourceKey === source),
                  )
                : MUSIC_CATALOG_SOURCES;
        return sources.map((source) => ({
            key: source,
            label: catalogSourceLabel(source),
        }));
    }, [availablePlugins, searchSourceMode]);

    const activePluginHash = useMemo(() => {
        const available =
            selectedSource === ALL_SOURCE
                ? platforms.length > 1
                : platforms.some((platform) => platform.key === selectedSource);
        if (available) return selectedSource;
        if (platforms.length > 1) return ALL_SOURCE;
        return platforms[0]?.key ?? '';
    }, [selectedSource, platforms]);

    // ── 自动触发搜索（当 query/type/plugin 变化时） ──
    // 有意不依赖 results：通过 store.get 读取最新快照避免无限循环。
    useEffect(() => {
        if (!query || !activePluginHash) return;

        // 避免重复发起：用 store.get 取最新快照（不依赖渲染周期的 results）
        const currentResults = store.get(searchResultsAtom);
        const existing = currentResults[activeType]?.[activePluginHash];
        if (existing && existing.query === query && existing.data.length > 0) {
            // 已有数据，不重复搜索
            return;
        }
        if (existing && existing.status !== undefined && existing.query === query) {
            // 已在请求中或已有状态
            return;
        }

        search(query, activeType, activePluginHash);
    }, [query, activeType, activePluginHash, search]);

    // ── 切换 Tab ──
    const handleTabChange = useCallback(
        (key: string) => {
            setActiveType(key as SearchMediaType);
        },
        [setActiveType],
    );

    // ── 切换插件 ──
    const handlePluginChange = useCallback(
        (hash: string) => {
            setSelectedSource(hash);
        },
        [setSelectedSource],
    );

    // ── 渲染 ──
    const ResultComponent = RESULT_COMPONENTS[activeType];

    const musicList =
        activeType === 'music' && activePluginHash
            ? (results.music[activePluginHash]?.data ?? [])
            : [];

    const handlePlayAll = useCallback(() => {
        if (musicList.length === 0) return;
        trackPlayer.playMusicWithReplaceQueue(musicList);
    }, [musicList]);

    const tabItems = useMemo(
        () =>
            SEARCH_MEDIA_TYPES.map((key) => ({
                key,
                label: t(SEARCH_TAB_LABEL_KEYS[key]),
            })),
        [t],
    );
    const sourceItems = useMemo(
        () =>
            platforms.length > 1
                ? [{ key: ALL_SOURCE, label: t('search.all_sources') }, ...platforms]
                : platforms,
        [platforms, t],
    );

    return (
        <div
            className="p-search"
            onPointerDown={() => {
                if (query) rememberSearchScroll(query);
            }}
        >
            {/* 标题 */}
            <div className="p-search__header">
                <div className="p-search__title-row">
                    <h2 className="p-search__title">
                        <span className="p-search__title-keyword">「{query}」</span>
                        {t('search.result_title')}
                    </h2>
                    {musicList.length > 0 && (
                        <Button
                            variant="primary"
                            size="md"
                            icon={<Play size={16} fill="currentColor" />}
                            onClick={handlePlayAll}
                        >
                            {t('playback.play_all')}
                        </Button>
                    )}
                </div>

                <div className="p-search__filters">
                    {/* Tab Bar */}
                    <TabBar items={tabItems} activeKey={activeType} onChange={handleTabChange} />

                    {sourceItems.length > 0 && (
                        <TabBar
                            mode="scroll"
                            items={sourceItems}
                            activeKey={activePluginHash}
                            onChange={handlePluginChange}
                        />
                    )}
                </div>
            </div>

            {/* 结果区 */}
            <div className="p-search__result-body">
                {activePluginHash ? (
                    <ResultComponent pluginHash={activePluginHash} />
                ) : (
                    <PluginFeatureUnavailable featureName={t('common.search')} />
                )}
            </div>
        </div>
    );
}
