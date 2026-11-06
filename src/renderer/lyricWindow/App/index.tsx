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
    const [resizing, setResizing] = useState(false);

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

    // 拖拽改窗口大小时鼠标在边框上，网页收不到悬停，底色会消失。
    // 尺寸变化期间补上底色，方便看出歌词区边界。
    useEffect(() => {
        if (isLocked) {
            setResizing(false);
            return;
        }
        let timer = 0;
        let lastWidth = window.innerWidth;
        let lastHeight = window.innerHeight;
        const onResize = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            const changed = width !== lastWidth || height !== lastHeight;
            lastWidth = width;
            lastHeight = height;
            if (!changed) return;
            setResizing(true);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setResizing(false), 600);
        };
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            window.clearTimeout(timer);
        };
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

    // 锁定后文字保持穿透。这里只上报区域：文字用来显示解锁按钮，按钮本身才接收点击。
    useEffect(() => {
        if (!isLocked) {
            void tauriInvoke('set_lyric_hover_rects', { rects: [] });
            return;
        }
        const report = () => {
            const rects = Array.from(
                document.querySelectorAll<HTMLElement>('[data-lyric-hit], [data-lyric-unlock]'),
            )
                .map((node) => {
                    const box = node.getBoundingClientRect();
                    return {
                        x: box.left,
                        y: box.top,
                        width: box.width,
                        height: box.height,
                        kind: node.hasAttribute('data-lyric-unlock') ? 'unlock' : 'reveal',
                    };
                })
                .filter((rect) => rect.width >= 2 && rect.height >= 2);
            void tauriInvoke('set_lyric_hover_rects', { rects });
        };
        report();
        const observer = new ResizeObserver(report);
        document.querySelectorAll<HTMLElement>('[data-lyric-hit]').forEach((node) => {
            observer.observe(node);
        });
        window.addEventListener('resize', report);
        const timer = window.setInterval(report, 400);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', report);
            window.clearInterval(timer);
            void tauriInvoke('set_lyric_hover_rects', { rects: [] });
        };
    }, [isLocked, lockedHover]);

    return (
        <div
            className={cn(
                'l-lyric-shell',
                isLocked ? 'is-locked' : 'is-unlocked',
                !isLocked && showToolbar && 'is-hovered',
                !isLocked && resizing && 'is-resizing',
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
