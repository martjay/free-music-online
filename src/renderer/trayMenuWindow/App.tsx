import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { PlayerState } from '@common/constant';
import appConfig from '@infra/appConfig/renderer';
import { tauriInvoke, tauriListen } from '@infra/tauriBridge/ipc';
import './index.scss';

type MenuAction =
    | 'previous'
    | 'play-pause'
    | 'next'
    | 'show'
    | 'desktop-lyric'
    | 'lock-lyric'
    | 'exit';

function useLyricFlag(key: 'lyric.enableDesktopLyric' | 'lyric.lockLyric') {
    const [enabled, setEnabled] = useState(() => Boolean(appConfig.getConfigByKey(key)));
    useEffect(() => {
        const sync = () => setEnabled(Boolean(appConfig.getConfigByKey(key)));
        appConfig.onConfigUpdated(sync);
        return () => appConfig.offConfigUpdated(sync);
    }, [key]);
    return enabled;
}

export default function App() {
    const { t } = useTranslation();
    const desktopLyric = useLyricFlag('lyric.enableDesktopLyric');
    const lyricLocked = useLyricFlag('lyric.lockLyric');
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        let disposed = false;
        const unlistenState = tauriListen<PlayerState>('tray-player-state', (state) => {
            if (!disposed) {
                setPlaying(state === PlayerState.Playing || state === PlayerState.Buffering);
            }
        });
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') void tauriInvoke('tray_menu_click', { action: 'dismiss' });
        };
        window.addEventListener('keydown', onKey);
        return () => {
            disposed = true;
            window.removeEventListener('keydown', onKey);
            void unlistenState.then((stop) => stop());
        };
    }, []);

    const run = (action: MenuAction) => {
        void tauriInvoke('tray_menu_click', { action });
    };

    return (
        <div className="tray-menu">
            <div className="tray-menu__transport">
                <button
                    type="button"
                    title={t('playback.previous')}
                    onClick={() => run('previous')}
                >
                    <SkipBack size={15} fill="currentColor" />
                </button>
                <button
                    type="button"
                    className="is-primary"
                    title={playing ? t('playback.pause') : t('playback.play')}
                    onClick={() => run('play-pause')}
                >
                    {playing ? (
                        <Pause size={15} fill="currentColor" />
                    ) : (
                        <Play size={15} fill="currentColor" style={{ marginLeft: 2 }} />
                    )}
                </button>
                <button type="button" title={t('playback.next')} onClick={() => run('next')}>
                    <SkipForward size={15} fill="currentColor" />
                </button>
            </div>
            <div className="tray-menu__sep" />
            <button type="button" className="tray-menu__item" onClick={() => run('show')}>
                <span>{t('app.show_main_window')}</span>
            </button>
            <button type="button" className="tray-menu__item" onClick={() => run('desktop-lyric')}>
                <span>{t('playback.desktop_lyric')}</span>
                {desktopLyric ? <span className="tray-menu__mark">✓</span> : null}
            </button>
            <button type="button" className="tray-menu__item" onClick={() => run('lock-lyric')}>
                <span>{t('lyric.lock_desktop')}</span>
                {lyricLocked ? <span className="tray-menu__mark">✓</span> : null}
            </button>
            <div className="tray-menu__sep" />
            <button type="button" className="tray-menu__item" onClick={() => run('exit')}>
                <span>{t('common.exit')}</span>
            </button>
        </div>
    );
}
