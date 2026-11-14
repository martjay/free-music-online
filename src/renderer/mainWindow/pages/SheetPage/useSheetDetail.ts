import { useState, useRef, useCallback, useEffect } from 'react';
import { RequestStatus } from '@common/constant';
import { compositeKey } from '@common/mediaKey';
import pluginManager from '@infra/pluginManager/renderer';
import musicSheet from '@infra/musicSheet/renderer';

const MAX_SHEET_PAGES = 40;

interface IOnlineSheetPage {
    musicList: IMusic.IMusicItem[];
    isEnd: boolean;
    sheetItem?: IMusic.IMusicSheetItem;
}

/**
 * useSheetDetail — 远程歌单详情 hook
 *
 * 普通歌单按页加载。收藏歌单先把线上列表拉全：成功就覆盖本地，失败再用本地记录。
 */
export function useSheetDetail(originalItem: IMusic.IMusicSheetItem) {
    const [sheetItem, setSheetItem] = useState<IMusic.IMusicSheetItem>(originalItem);
    const [musicList, setMusicList] = useState<IMusic.IMusicItem[]>([]);
    const [requestStatus, setRequestStatus] = useState<RequestStatus>(RequestStatus.Idle);
    const [isEnd, setIsEnd] = useState(false);

    const pageRef = useRef(1);
    const pendingRef = useRef(false);
    const listRef = useRef<IMusic.IMusicItem[]>([]);
    const sheetRef = useRef(originalItem);
    const itemKeyRef = useRef(compositeKey(originalItem.platform, originalItem.id));
    const runRef = useRef(0);

    const stillCurrent = useCallback((run: number, key: string) => {
        return runRef.current === run && itemKeyRef.current === key;
    }, []);

    const applyCached = useCallback(
        async (item: IMusic.IMusicSheetItem, key: string, run: number) => {
            const cached = await musicSheet.getStarredSheetMusic(item.platform, item.id);
            if (!stillCurrent(run, key) || cached.length === 0) return false;
            listRef.current = cached;
            setMusicList(cached);
            setIsEnd(true);
            setRequestStatus(RequestStatus.Done);
            pendingRef.current = false;
            return true;
        },
        [stillCurrent],
    );

    const fetchOnlinePage = useCallback(async (item: IMusic.IMusicSheetItem, page: number) => {
        const result = await pluginManager.callPluginMethod({
            platform: item.platform,
            method: 'getMusicSheetInfo',
            args: [item, page],
        });
        const pageResult: IOnlineSheetPage = {
            musicList: result?.musicList ?? [],
            isEnd: result?.isEnd ?? true,
            sheetItem: result?.sheetItem,
        };
        return pageResult;
    }, []);

    const fetchPage = useCallback(
        async (item: IMusic.IMusicSheetItem, page: number, isFirstPage: boolean) => {
            if (pendingRef.current) return;
            const run = ++runRef.current;
            pendingRef.current = true;
            setRequestStatus(RequestStatus.Pending);

            const key = compositeKey(item.platform, item.id);

            try {
                const result = await fetchOnlinePage(item, page);
                if (!stillCurrent(run, key)) return;

                if (isFirstPage && result.musicList.length === 0) {
                    if (await applyCached(item, key, run)) return;
                }
                if (!stillCurrent(run, key)) return;

                if (result.sheetItem) {
                    const nextSheet = { ...sheetRef.current, ...result.sheetItem };
                    sheetRef.current = nextSheet;
                    setSheetItem(nextSheet);
                }

                const nextList = isFirstPage
                    ? result.musicList
                    : [...listRef.current, ...result.musicList];
                listRef.current = nextList;
                setMusicList(nextList);
                setIsEnd(result.isEnd);
                setRequestStatus(RequestStatus.Done);
                pageRef.current = page;
                pendingRef.current = false;
            } catch (error) {
                if (!stillCurrent(run, key)) return;
                console.warn('[SheetPage] load music sheet failed:', error);
                if (await applyCached(item, key, run)) return;
                setRequestStatus(RequestStatus.Error);
                pendingRef.current = false;
            }
        },
        [applyCached, fetchOnlinePage, stillCurrent],
    );

    const syncStarredSheet = useCallback(
        async (item: IMusic.IMusicSheetItem) => {
            const run = ++runRef.current;
            pendingRef.current = true;
            setRequestStatus(RequestStatus.Pending);
            const key = compositeKey(item.platform, item.id);

            try {
                const collected: IMusic.IMusicItem[] = [];
                let ended = false;
                let lastPage = 1;
                for (let page = 1; page <= MAX_SHEET_PAGES; page += 1) {
                    const result = await fetchOnlinePage(item, page);
                    if (!stillCurrent(run, key)) return;
                    lastPage = page;
                    if (result.sheetItem) {
                        const nextSheet = { ...sheetRef.current, ...result.sheetItem };
                        sheetRef.current = nextSheet;
                        setSheetItem(nextSheet);
                    }
                    collected.push(...result.musicList);
                    ended = result.isEnd || result.musicList.length === 0;
                    if (ended) break;
                }
                if (!stillCurrent(run, key)) return;

                if (collected.length === 0) {
                    if (await applyCached(item, key, run)) return;
                    listRef.current = [];
                    setMusicList([]);
                    setIsEnd(true);
                    setRequestStatus(RequestStatus.Done);
                    pendingRef.current = false;
                    return;
                }

                listRef.current = collected;
                setMusicList(collected);
                setIsEnd(ended);
                setRequestStatus(RequestStatus.Done);
                pageRef.current = lastPage;
                pendingRef.current = false;
                if (ended && stillCurrent(run, key)) {
                    await musicSheet.saveStarredSheetMusic(item, collected, true);
                }
            } catch (error) {
                if (!stillCurrent(run, key)) return;
                console.warn('[SheetPage] sync starred sheet failed:', error);
                if (await applyCached(item, key, run)) return;
                setRequestStatus(RequestStatus.Error);
                pendingRef.current = false;
            }
        },
        [applyCached, fetchOnlinePage, stillCurrent],
    );

    useEffect(() => {
        const key = compositeKey(originalItem.platform, originalItem.id);
        itemKeyRef.current = key;
        pendingRef.current = false;
        listRef.current = [];
        sheetRef.current = originalItem;
        setSheetItem(originalItem);
        setMusicList([]);
        setIsEnd(false);
        pageRef.current = 1;
        if (musicSheet.isSheetStarred(originalItem)) {
            void syncStarredSheet(originalItem);
        } else {
            void fetchPage(originalItem, 1, true);
        }
    }, [originalItem.platform, originalItem.id, fetchPage, syncStarredSheet]);

    const loadMore = useCallback(() => {
        if (isEnd || pendingRef.current) return;
        void fetchPage(sheetRef.current, pageRef.current + 1, false);
    }, [isEnd, fetchPage]);

    const retry = useCallback(() => {
        if (musicSheet.isSheetStarred(sheetRef.current)) {
            void syncStarredSheet(sheetRef.current);
            return;
        }
        const isFirstPage = pageRef.current <= 1 && listRef.current.length === 0;
        void fetchPage(sheetRef.current, isFirstPage ? 1 : pageRef.current + 1, isFirstPage);
    }, [fetchPage, syncStarredSheet]);

    return { sheetItem, musicList, requestStatus, isEnd, loadMore, retry, syncStarredSheet };
}
