import { useState, useRef, useCallback, useEffect } from 'react';
import { RequestStatus } from '@common/constant';
import pluginManager from '@infra/pluginManager/renderer';

interface SheetListCache {
    sheets: IMusic.IMusicSheetItem[];
    isEnd: boolean;
    page: number;
}

/** 挂在模块上，详情页返回后还能用刚才加载过的歌单，不用从第一页重来。 */
const sheetListCache = new Map<string, SheetListCache>();

function sheetCacheKey(platform: string, tagId: string, sortId: string): string {
    return `${platform}\0${tagId}\0${sortId}`;
}

/**
 * useRecommendSheets — 获取推荐歌单列表 hook
 *
 * 支持分页加载。当 tag 变更时，自动重置并加载首页。
 */
export function useRecommendSheets(
    platform: string,
    tag: IMedia.IUnique | null,
    sortId = '',
) {
    const initial = sheetListCache.get(sheetCacheKey(platform, tag?.id ?? '', sortId));
    const [sheets, setSheets] = useState<IMusic.IMusicSheetItem[]>(() => initial?.sheets ?? []);
    const [requestStatus, setRequestStatus] = useState<RequestStatus>(
        initial ? RequestStatus.Done : RequestStatus.Idle,
    );
    const [isEnd, setIsEnd] = useState(initial?.isEnd ?? false);

    const pageRef = useRef(initial?.page ?? 1);
    const pendingRef = useRef(false);
    const tagIdRef = useRef<string>(tag?.id ?? '');
    const sortIdRef = useRef(sortId);
    sortIdRef.current = sortId;
    const sheetsRef = useRef(sheets);
    sheetsRef.current = sheets;

    const fetchPage = useCallback(
        async (fetchTag: IMedia.IUnique, page: number, isFirstPage: boolean) => {
            if (pendingRef.current) return;
            pendingRef.current = true;
            setRequestStatus(RequestStatus.Pending);

            try {
                const result = await pluginManager.callPluginMethod({
                    platform,
                    method: 'getRecommendSheetsByTag',
                    args: [fetchTag, page, sortId || undefined],
                });

                // 检查 tag 是否已经变化
                if (tagIdRef.current !== fetchTag.id || sortIdRef.current !== sortId) return;

                const resData = result?.data ?? [];
                const resIsEnd = result?.isEnd ?? true;

                const nextSheets = isFirstPage ? resData : [...sheetsRef.current, ...resData];
                sheetListCache.set(sheetCacheKey(platform, fetchTag.id, sortId), {
                    sheets: nextSheets,
                    isEnd: resIsEnd,
                    page,
                });
                setSheets(nextSheets);
                setIsEnd(resIsEnd);
                setRequestStatus(RequestStatus.Done);
                pageRef.current = page;
            } catch {
                if (tagIdRef.current !== fetchTag.id || sortIdRef.current !== sortId) return;
                setRequestStatus(RequestStatus.Error);
            } finally {
                pendingRef.current = false;
            }
        },
        [platform, sortId],
    );

    // tag 变化时重置并加载首页。同一组合已经加载过则直接用缓存。
    useEffect(() => {
        if (!tag) return;
        tagIdRef.current = tag.id;
        const cached = sheetListCache.get(sheetCacheKey(platform, tag.id, sortId));
        if (cached) {
            pendingRef.current = false;
            pageRef.current = cached.page;
            setSheets(cached.sheets);
            setIsEnd(cached.isEnd);
            setRequestStatus(RequestStatus.Done);
            return;
        }
        pendingRef.current = false;
        setSheets([]);
        setIsEnd(false);
        pageRef.current = 1;
        fetchPage(tag, 1, true);
    }, [tag?.id, platform, sortId, fetchPage]);

    const loadMore = useCallback(() => {
        if (!tag || isEnd || pendingRef.current) return;
        fetchPage(tag, pageRef.current + 1, false);
    }, [tag, isEnd, fetchPage]);

    const retry = useCallback(() => {
        if (!tag) return;
        sheetListCache.delete(sheetCacheKey(platform, tag.id, sortId));
        const isFirstPage = pageRef.current <= 1 && sheets.length === 0;
        fetchPage(tag, isFirstPage ? 1 : pageRef.current + 1, isFirstPage);
    }, [tag, sheets.length, fetchPage, platform, sortId]);

    return { sheets, requestStatus, isEnd, loadMore, retry };
}
