import { useState, useEffect } from 'react';
import { CONTEXT_BRIDGE_KEY } from './common/constant';
import type {
    INeteaseAccountBridge,
    INeteaseAccountStatus,
    INeteaseMediaSource,
    INeteaseLyricResult,
    INeteaseRadarResult,
} from '@appTypes/infra/neteaseAccount';

/**
 * 下载模块会在桥接注册之前引用本文件。
 * 这里不能在模块加载时把 window 上的桥接存下来，否则登录会一直被当成取消。
 */
function neteaseBridge(): INeteaseAccountBridge | undefined {
    if (typeof window === 'undefined') return undefined;
    return (window as unknown as Record<string, INeteaseAccountBridge | undefined>)[
        CONTEXT_BRIDGE_KEY
    ];
}

class NeteaseAccountRenderer {
    public async getStatus(force?: boolean): Promise<INeteaseAccountStatus> {
        const bridge = neteaseBridge();
        if (!bridge) return { connected: false, profile: null };
        return bridge.getStatus(force);
    }

    public async openLogin(): Promise<'connected' | 'cancelled'> {
        const bridge = neteaseBridge();
        if (!bridge) return 'cancelled';
        return bridge.openLogin();
    }

    public async logout(): Promise<boolean> {
        const bridge = neteaseBridge();
        if (!bridge) return false;
        return bridge.logout();
    }

    public async getDailyRecommendSongs(): Promise<IMusic.IMusicItem[]> {
        const bridge = neteaseBridge();
        if (!bridge) return [];
        return bridge.getDailyRecommendSongs();
    }

    public async getPrivateFmSongs(): Promise<IMusic.IMusicItem[]> {
        const bridge = neteaseBridge();
        if (!bridge) return [];
        return bridge.getPrivateFmSongs();
    }

    public async getPrivateRadarSongs(): Promise<INeteaseRadarResult> {
        const bridge = neteaseBridge();
        if (!bridge) return { songs: [] };
        return bridge.getPrivateRadarSongs();
    }

    public async getMusicUrl(
        songId: string,
        quality?: IMusic.IQualityKey,
    ): Promise<INeteaseMediaSource | null> {
        const bridge = neteaseBridge();
        if (!bridge) return null;
        return bridge.getMusicUrl(songId, quality);
    }

    public async getLyric(songId: string): Promise<INeteaseLyricResult | null> {
        const bridge = neteaseBridge();
        if (!bridge) return null;
        return bridge.getLyric(songId);
    }

    public onStatusChanged(callback: (status: INeteaseAccountStatus) => void): () => void {
        const bridge = neteaseBridge();
        if (!bridge) return () => {};
        return bridge.onStatusChanged(callback);
    }
}

const neteaseAccount = new NeteaseAccountRenderer();
export default neteaseAccount;

/**
 * React Hook: 监听网易云音乐账号状态
 */
export function useNeteaseAccountStatus(): INeteaseAccountStatus {
    const [status, setStatus] = useState<INeteaseAccountStatus>({
        connected: false,
        profile: null,
    });

    useEffect(() => {
        let mounted = true;
        void neteaseAccount.getStatus().then((res) => {
            if (mounted) setStatus(res);
        });

        const unsub = neteaseAccount.onStatusChanged((newStatus) => {
            if (mounted) setStatus(newStatus);
        });

        return () => {
            mounted = false;
            unsub();
        };
    }, []);

    return status;
}
