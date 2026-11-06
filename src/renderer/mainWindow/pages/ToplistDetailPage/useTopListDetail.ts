import { useState, useRef, useCallback, useEffect } from 'react';
import { RequestStatus } from '@common/constant';
import pluginManager from '@infra/pluginManager/renderer';
import i18n from '@infra/i18n/renderer';
import {
    fetchOfficialChart,
    formatChartUpdatedAt,
    OFFICIAL_CHART_PLATFORM,
} from '../ToplistPage/officialCharts';

/**
 * useTopListDetail — 排行榜详情分页加载 hook
 *
 * 加载指定榜单的歌曲列表，支持分页。
 * 首次 mount 立即触发第一页加载。
 */
export function useTopListDetail(
    topListItem: IMusic.IMusicSheetItem | null,
    platform: string,
    refreshKey = '',
) {
    const [sheetItem, setSheetItem] = useState<IMusic.IMusicSheetItem>(
        topListItem ?? { id: '', platform, title: '' },
    );
    const [musicList, setMusicList] = useState<IMusic.IMusicItem[]>([]);
    const [requestStatus, setRequestStatus] = useState<RequestStatus>(RequestStatus.Idle);
    const [isEnd, setIsEnd] = useState(false);

    const pageRef = useRef(1);
    const pendingRef = useRef(false);

    const fetchPage = useCallback(
        async (page: number, isFirstPage: boolean) => {
            if (!topListItem || pendingRef.current) return;
            pendingRef.current = true;
            setRequestStatus(RequestStatus.Pending);

            try {
                let resMusicList: IMusic.IMusicItem[] = [];
                let resIsEnd = true;
                let nextSheet: IMusic.IMusicSheetItem | undefined;
                let updatedAt: number | undefined;

                if (platform === OFFICIAL_CHART_PLATFORM) {
                    const chart = await fetchOfficialChart(topListItem.id, topListItem.title);
                    resMusicList = chart.musicList;
                    nextSheet = chart.sheetItem;
                    updatedAt = chart.updatedAt;
                } else {
                    const result = await pluginManager.callPluginMethod({
                        platform,
                        method: 'getTopListDetail',
                        args: [topListItem, page],
                    });
                    resMusicList = result?.musicList ?? [];
                    resIsEnd = result?.isEnd ?? true;
                    nextSheet = result?.topListItem;
                }

                if (nextSheet) {
                    setSheetItem((prev) => ({
                        ...prev,
                        ...nextSheet,
                        description: updatedAt
                            ? i18n.t('toplist.official_updated', {
                                  time: formatChartUpdatedAt(updatedAt),
                                  interpolation: { escapeValue: false },
                              })
                            : nextSheet.description,
                    }));
                }

                setMusicList((prev) => (isFirstPage ? resMusicList : [...prev, ...resMusicList]));
                setIsEnd(resIsEnd);
                setRequestStatus(RequestStatus.Done);
                pageRef.current = page;
            } catch {
                setRequestStatus(RequestStatus.Error);
            } finally {
                pendingRef.current = false;
            }
        },
        [topListItem, platform],
    );

    // 初始加载
    useEffect(() => {
        if (topListItem) {
            pageRef.current = 1;
            pendingRef.current = false;
            setMusicList([]);
            setIsEnd(false);
            fetchPage(1, true);
        }
    }, [topListItem?.id, platform, refreshKey]);

    const loadMore = useCallback(() => {
        if (isEnd || pendingRef.current) return;
        fetchPage(pageRef.current + 1, false);
    }, [isEnd, fetchPage]);

    const retry = useCallback(() => {
        const isFirstPage = pageRef.current <= 1 && musicList.length === 0;
        fetchPage(isFirstPage ? 1 : pageRef.current + 1, isFirstPage);
    }, [musicList.length, fetchPage]);

    return { sheetItem, musicList, requestStatus, isEnd, loadMore, retry };
}
