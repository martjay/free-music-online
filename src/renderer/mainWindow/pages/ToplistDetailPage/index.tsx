/**
 * ToplistDetailPage — 排行榜详情页
 *
 * 路由: /toplist-detail/:platform
 * state: { topListItem: IMusic.IMusicSheetItem }
 *
 * 展示榜单封面信息 + 歌曲列表，支持分页加载。
 */

import {
    useState,
    useMemo,
    useDeferredValue,
    useCallback,
    useEffect,
    type MouseEvent,
} from 'react';
import { useParams, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FolderPlus } from 'lucide-react';
import { RequestStatus } from '@common/constant';
import { useSortedSearchablePlugins } from '@infra/pluginManager/renderer/hooks';
import trackPlayer from '@renderer/mainWindow/core/trackPlayer';
import { showToast } from '../../components/ui/Toast';
import {
    nextOfficialPlay,
    OFFICIAL_CHART_PLATFORM,
    officialChartPlugin,
    playOfficialChart,
} from '../ToplistPage/officialCharts';
import { MusicSheetHeader } from '../../components/ui/MusicSheetHeader';
import { SongTable, type RowInteractionDetail } from '../../components/business/SongTable';
import { FavoriteButton } from '../../components/business/FavoriteButton';
import { DownloadButton } from '../../components/business/DownloadButton';
import { SongToolbar } from '../../components/ui/SongToolbar';
import { ListFooter } from '../../components/ui/ListFooter';
import { StatusPlaceholder } from '../../components/ui/StatusPlaceholder';
import { Button } from '../../components/ui/Button';
import { showContextMenu } from '../../components/ui/ContextMenu/contextMenuManager';
import { showModal } from '../../components/ui/Modal/modalManager';
import { useTopListDetail } from './useTopListDetail';
import './index.scss';

export default function ToplistDetailPage() {
    const { t } = useTranslation();
    const { platform: rawPlatform } = useParams<{ platform: string }>();
    const platform = rawPlatform ? decodeURIComponent(rawPlatform) : '';
    const location = useLocation();

    const openedAt = (location.state as { openedAt?: number } | null)?.openedAt ?? 0;

    const topListItem = useMemo<IMusic.IMusicSheetItem | null>(() => {
        const stateItem = (location.state as { topListItem?: IMusic.IMusicSheetItem })?.topListItem;
        if (!stateItem) return null;
        return {
            ...stateItem,
            platform: platform || stateItem.platform,
        };
    }, [platform, location.state]);

    const { sheetItem, musicList, requestStatus, isEnd, loadMore, retry } = useTopListDetail(
        topListItem,
        platform,
        String(openedAt),
    );
    const isOfficialChart = platform === OFFICIAL_CHART_PLATFORM;

    useEffect(() => {
        if (!isOfficialChart) return undefined;
        return () => {
            nextOfficialPlay();
        };
    }, [isOfficialChart]);

    // ── 本地搜索 ──
    const [searchValue, setSearchValue] = useState('');
    const deferredSearch = useDeferredValue(searchValue);

    const searchablePlugins = useSortedSearchablePlugins('music');
    const playbackPlugin = useMemo(() => {
        if (!isOfficialChart || searchablePlugins.length === 0) return null;
        return officialChartPlugin();
    }, [isOfficialChart, searchablePlugins]);

    const filteredList = useMemo(() => {
        const keyword = deferredSearch.trim().toLowerCase();
        const source = playbackPlugin?.platform;
        const rows =
            isOfficialChart && source
                ? musicList.map((item) => ({ ...item, platform: source }))
                : musicList;
        if (!keyword) return rows;
        return rows.filter(
            (item) =>
                item.title.toLowerCase().includes(keyword) ||
                (item.artist ?? '').toLowerCase().includes(keyword) ||
                (item.album ?? '').toLowerCase().includes(keyword),
        );
    }, [musicList, deferredSearch, isOfficialChart, playbackPlugin]);

    const playOfficialSongs = useCallback(
        async (list: IMusic.IMusicItem[], startItem?: IMusic.IMusicItem) => {
            const result = await playOfficialChart(list, startItem);
            if (result === 'no-plugin') {
                showToast(t('toplist.official_no_plugin'), { type: 'warn' });
            } else if (result === 'empty') {
                showToast(t('toplist.official_not_found'), { type: 'warn' });
            }
        },
        [t],
    );

    const handlePlayAll = useCallback(() => {
        if (filteredList.length === 0) return;
        if (isOfficialChart) {
            void playOfficialSongs(filteredList);
            return;
        }
        trackPlayer.playMusicWithReplaceQueue(filteredList);
    }, [filteredList, isOfficialChart, playOfficialSongs]);

    const handleRowDoubleClick = useCallback(
        ({ item }: RowInteractionDetail) => {
            if (!isOfficialChart) return;
            void playOfficialSongs(filteredList, item as IMusic.IMusicItem);
        },
        [filteredList, isOfficialChart, playOfficialSongs],
    );

    const handleRowContextMenu = useCallback(
        ({ selectedItems }: RowInteractionDetail, e: MouseEvent) => {
            showContextMenu(
                'MusicItemMenu',
                { x: e.clientX, y: e.clientY },
                {
                    musicItems: selectedItems as IMusic.IMusicItem[],
                },
            );
        },
        [],
    );

    const handleAddToSheet = useCallback(() => {
        if (musicList.length === 0) return;
        showModal('AddMusicToSheetModal', { musicItems: musicList });
    }, [musicList]);

    if (!topListItem) {
        return (
            <div className="p-toplist-detail">
                <StatusPlaceholder
                    status={RequestStatus.Error}
                    errorTitle={t('toplist.missing_info')}
                    errorDescription={t('toplist.missing_info_desc')}
                />
            </div>
        );
    }

    return (
        <div className="p-toplist-detail">
            <MusicSheetHeader
                musicSheet={
                    isOfficialChart
                        ? { ...sheetItem, platform: playbackPlugin?.platform ?? '' }
                        : sheetItem
                }
            />

            <div className="p-toplist-detail__toolbar">
                <SongToolbar
                    searchPlaceholder={t('toplist.search_placeholder')}
                    searchValue={searchValue}
                    onSearchChange={setSearchValue}
                    onPlayAll={handlePlayAll}
                    disabled={musicList.length === 0}
                >
                    <Button
                        variant="secondary"
                        size="md"
                        icon={<FolderPlus size={16} />}
                        onClick={handleAddToSheet}
                    >
                        {t('playlist.add_to_sheet_menu')}
                    </Button>
                </SongToolbar>
            </div>

            <SongTable
                data={filteredList}
                requestStatus={musicList.length > 0 ? RequestStatus.Done : requestStatus}
                onRetry={retry}
                enableLoadMore={!isEnd && musicList.length > 0}
                loadMoreStatus={requestStatus}
                onLoadMore={loadMore}
                onLoadMoreRetry={retry}
                enableSelection
                onRowDoubleClick={isOfficialChart ? handleRowDoubleClick : undefined}
                statusColumn={(item) => (
                    <>
                        <FavoriteButton musicItem={item} size="sm" />
                        <DownloadButton musicItem={item} size="sm" />
                    </>
                )}
                onRowContextMenu={handleRowContextMenu}
            />

            {isEnd && musicList.length > 0 && <ListFooter status={RequestStatus.Done} />}
        </div>
    );
}
