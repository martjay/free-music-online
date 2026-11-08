import { useState, useCallback, useEffect } from 'react';
import { RequestStatus } from '@common/constant';
import pluginManager from '@infra/pluginManager/renderer';

/** 挂在模块上，返回歌单页时不用先清空标签再重拉。 */
const recommendTagCache: Record<string, IPlugin.IGetRecommendSheetTagsResult> = {};

/**
 * useRecommendTags — 获取热门歌单标签 hook
 *
 * 调用目录平台的 getRecommendSheetTags，缓存按平台隔离。
 */
export function useRecommendTags(platform: string) {
    const [tags, setTags] = useState<IPlugin.IGetRecommendSheetTagsResult | null>(
        () => recommendTagCache[platform] ?? null,
    );
    const [status, setStatus] = useState<RequestStatus>(() =>
        recommendTagCache[platform] ? RequestStatus.Done : RequestStatus.Pending,
    );

    const fetch = useCallback(async () => {
        if (!recommendTagCache[platform]) {
            setStatus(RequestStatus.Pending);
        }
        try {
            const result = await pluginManager.callPluginMethod({
                platform,
                method: 'getRecommendSheetTags',
                args: [],
            });
            const next: IPlugin.IGetRecommendSheetTagsResult = result ?? { pinned: [], data: [] };
            recommendTagCache[platform] = next;
            setTags(next);
            setStatus(RequestStatus.Done);
        } catch {
            // 标签加载失败时回退为空标签列表，不阻塞歌单加载
            const next: IPlugin.IGetRecommendSheetTagsResult = { pinned: [], data: [] };
            recommendTagCache[platform] = next;
            setTags(next);
            setStatus(RequestStatus.Done);
        }
    }, [platform]);

    useEffect(() => {
        const cached = recommendTagCache[platform];
        if (cached) {
            setTags(cached);
            setStatus(RequestStatus.Done);
        } else {
            setTags(null);
            setStatus(RequestStatus.Pending);
        }
        fetch();
    }, [platform, fetch]);

    return { tags, status };
}
