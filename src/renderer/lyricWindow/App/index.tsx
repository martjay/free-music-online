// ============================================================================
// App — 歌词窗口根组件
// ============================================================================

import { useCallback, useEffect, useState } from 'react';

import { cn } from '@common/cn';
import appSyncAuxiliary from '@infra/appSync/renderer/auxiliary';
import { tauriInvoke, tauriListen } from '@infra/tauriBridge/ipc';
import { useConfigValue } from '@renderer/common/hooks/useConfigValue';

import LyricToolbar, { LockedToolbar } from '../components/LyricToolbar';
import LyricText from '../components/LyricText';

import './index.scss';

export default function App() {
    const [locked] = useConfigValue('lyric.lockLyric');
    const isLocked = locked ?? false;

    const [showToolbar, setShowToolbar] = useState(false);
    const [lockedHover, setLockedHover] = useState(false);

    // 锁定后整窗穿透，WebView 收不到鼠标。系统侧轮询光标，停留后暂时取消穿透。
    useEffect(() => {
        if (!isLocked) {
            setLockedHover(false);
            return;
        }
        let unlisten: (() => void) | undefined;
        let disposed = false;
        void tauriListen<boolean>('lyric-hover', (inside) => {
            if (!disposed) setLockedHover(!!inside);
        }).then((stop) => {
            if (disposed) void stop();
            else unlisten = stop;
        });
        return () => {
            disposed = true;
            void unlisten?.();
        };
    }, [isLocked]);

    const handleMouseOver = useCallback(() => {
        if (!isLocked) setShowToolbar(true);
    }, [isLocked]);

    const handleMouseLeave = useCallback(() => {
        if (!isLocked) setShowToolbar(false);
    }, [isLocked]);

    useEffect(() => {
        if (isLocked) return;
        const onDocLeave = () => setShowToolbar(false);
        document.addEventListener('mouseleave', onDocLeave);
        return () => document.removeEventListener('mouseleave', onDocLeave);
    }, [isLocked]);

    useEffect(() => {
        setShowToolbar(false);
    }, [isLocked]);

    const handlePointerDown = useCallback(
        (event: React.PointerEvent) => {
            if (isLocked || event.button !== 0) return;
            const target = event.target;
            if (!(target instanceof Element) || target.closest('button')) return;
            void tauriInvoke('plugin:window|start_dragging');
        },
        [isLocked],
    );

    useEffect(() => {
        appSyncAuxiliary.subscribeAppState([
            'musicItem',
            'playerState',
            'currentLrc',
            'fullLyric',
            'progress',
        ]);
    }, []);

    return (
        <div
            className={cn(
                'l-lyric-shell',
                isLocked ? 'is-locked' : 'is-unlocked',
                (isLocked ? lockedHover : showToolbar) && 'is-hovered',
            )}
            onMouseOver={handleMouseOver}
            onMouseLeave={handleMouseLeave}
            onPointerDown={handlePointerDown}
        >
            {isLocked ? (
                <LockedToolbar visible={lockedHover} />
            ) : (
                <LyricToolbar visible={showToolbar} />
            )}
            <LyricText />
        </div>
    );
}
