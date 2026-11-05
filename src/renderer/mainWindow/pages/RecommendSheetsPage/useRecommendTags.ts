import { useState, useCallback, useEffect } from 'react';
import { RequestStatus } from '@common/constant';
import pluginManager from '@infra/pluginManager/renderer';

/** 挂在模块上，返回歌单页时不用先清空标签再重拉。 */
const recommendTagCache: Record<string, IPlugin.IGetRecommendSheetTagsResult> = {};

/**
 * useRecommendTags — 获取热门歌单标签 hook
 *
 * 调用插件 getRecommendSheetTags，缓存按 pluginHash 隔离。
 */
export function useRecommendTags(pluginHash: string) {
    const [tags, setTags] = useState<IPlugin.IGetRecommendSheetTagsResult | null>(
        () => recommendTagCache[pluginHash] ?? null,
    );
    const [status, setStatus] = useState<RequestStatus>(() =>
        recommendTagCache[pluginHash] ? RequestStatus.Done : RequestStatus.Idle,
    );

    const fetch = useCallback(async () => {
        if (!recommendTagCache[pluginHash]) {
            setStatus(RequestStatus.Pending);
        }
        try {
            const result = await pluginManager.callPluginMethod({
                hash: pluginHash,
                method: 'getRecommendSheetTags',
                args: [],
            });
            const next: IPlugin.IGetRecommendSheetTagsResult = result ?? { pinned: [], data: [] };
            recommendTagCache[pluginHash] = next;
            setTags(next);
            setStatus(RequestStatus.Done);
        } catch {
            // 标签加载失败时回退为空标签列表，不阻塞歌单加载
            const next: IPlugin.IGetRecommendSheetTagsResult = { pinned: [], data: [] };
            recommendTagCache[pluginHash] = next;
            setTags(next);
            setStatus(RequestStatus.Done);
        }
    }, [pluginHash]);

    useEffect(() => {
        const cached = recommendTagCache[pluginHash];
        if (cached) {
            setTags(cached);
            setStatus(RequestStatus.Done);
        } else {
            setTags(null);
            setStatus(RequestStatus.Idle);
        }
        fetch();
    }, [pluginHash, fetch]);

    return { tags, status };
}
