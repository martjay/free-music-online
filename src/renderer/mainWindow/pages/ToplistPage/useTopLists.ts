import { useState, useCallback } from 'react';
import { RequestStatus } from '@common/constant';
import pluginManager from '@infra/pluginManager/renderer';

interface ITopListCache {
    status: RequestStatus;
    data: IMusic.IMusicSheetGroupItem[];
}

/** 挂在模块上，详情页返回后还能用刚才的榜单，不用重新请求。 */
const topListCache: Record<string, ITopListCache> = {};

/**
 * useTopLists — 排行榜数据获取 hook
 *
 * 按目录平台缓存分组榜单，切换平台时复用已有数据。
 */
export function useTopLists(platform: string) {
    const [status, setStatus] = useState<RequestStatus>(() => {
        return topListCache[platform]?.status ?? RequestStatus.Idle;
    });
    const [data, setData] = useState<IMusic.IMusicSheetGroupItem[]>(() => {
        return topListCache[platform]?.data ?? [];
    });

    const fetch = useCallback(async () => {
        const cached = topListCache[platform];
        // 已有数据或正在加载中，不重复请求
        if (cached?.data?.length || cached?.status === RequestStatus.Pending) {
            setStatus(cached.status);
            setData(cached.data);
            return;
        }

        setStatus(RequestStatus.Pending);
        setData([]);
        topListCache[platform] = { status: RequestStatus.Pending, data: [] };

        try {
            const result = await pluginManager.callPluginMethod({
                platform,
                method: 'getTopLists',
                args: [],
            });
            const groupData = result ?? [];
            topListCache[platform] = { status: RequestStatus.Done, data: groupData };
            setStatus(RequestStatus.Done);
            setData(groupData);
        } catch {
            topListCache[platform] = { status: RequestStatus.Error, data: [] };
            setStatus(RequestStatus.Error);
            setData([]);
        }
    }, [platform]);

    const retry = useCallback(() => {
        // 清除缓存后重试
        delete topListCache[platform];
        fetch();
    }, [platform, fetch]);

    const syncFromCache = useCallback(() => {
        const cached = topListCache[platform];
        if (cached) {
            setStatus(cached.status);
            setData(cached.data);
        } else {
            setStatus(RequestStatus.Idle);
            setData([]);
        }
    }, [platform]);

    return { status, data, fetch, retry, syncFromCache };
}
