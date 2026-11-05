// ============================================================================
// App — 迷你模式根组件
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    SkipBack,
    SkipForward,
    Play,
    Pause,
    Heart,
    Maximize2,
    Download,
    CircleCheckBig,
    LoaderCircle,
    CircleAlert,
    Pin,
} from 'lucide-react';
import { DesktopLyric } from '@renderer/common/icons';
import { REPEAT_MODE_MAP } from '@renderer/common/repeatModeMap';
import { PlayerState, QUALITY_KEYS, RepeatMode } from '@common/constant';
import { isRadioBrowserMedia } from '@common/radioBrowser';
import appSyncAuxiliary, { useAppStatePartial } from '@infra/appSync/renderer/auxiliary';
import appConfig from '@infra/appConfig/renderer';
import systemUtil from '@infra/systemUtil/renderer';
import { tauriInvoke } from '@infra/tauriBridge/ipc';
import { useConfigValue } from '@renderer/common/hooks/useConfigValue';
import albumImg from '@assets/imgs/album-cover.jpg';
import './index.scss';

/**
 * MiniMode App — 迷你模式窗口根组件
 * @layer layout
 *
 * 不透明卡片。空白处可拖动窗口，按钮除外。
 */
export default function App() {
    const { t } = useTranslation();
    const musicItem = useAppStatePartial('musicItem');
    const playerState = useAppStatePartial('playerState');
    const repeatMode = useAppStatePartial('repeatMode');
    const progress = useAppStatePartial('progress');
    const isFavorite = useAppStatePartial('isFavorite');
    const downloadStatus = useAppStatePartial('downloadStatus');

    const [enableDesktopLyric] = useConfigValue('lyric.enableDesktopLyric');
    const [qualityOpen, setQualityOpen] = useState(false);
    const [pinned, setPinned] = useState(true);

    const isPlaying = playerState === PlayerState.Playing;
    const isLive = isRadioBrowserMedia(musicItem);
    const currentRepeatMode = repeatMode ?? RepeatMode.Queue;
    const { Icon: RepeatIcon, next: nextRepeatMode } = REPEAT_MODE_MAP[currentRepeatMode];

    // 进度百分比
    const progressPercent =
        progress && progress.duration > 0 && isFinite(progress.duration)
            ? (progress.currentTime / progress.duration) * 100
            : 0;

    // 订阅应用状态
    useEffect(() => {
        appSyncAuxiliary.subscribeAppState([
            'musicItem',
            'playerState',
            'repeatMode',
            'progress',
            'isFavorite',
            'downloadStatus',
        ]);
    }, []);

    useEffect(() => {
        const size = { Logical: { width: 408, height: 148 } };
        void tauriInvoke('plugin:window|set_min_size', { value: size })
            .catch(() => {})
            .then(() => tauriInvoke('plugin:window|set_max_size', { value: size }))
            .catch(() => {})
            .then(() => tauriInvoke('plugin:window|set_size', { value: size }))
            .catch(() => {});
    }, []);

    useEffect(() => {
        tauriInvoke<boolean>('plugin:window|is_always_on_top')
            .then((value) => {
                if (typeof value === 'boolean') setPinned(value);
            })
            .catch(() => {});
    }, []);

    // ─── 事件处理 ───

    const handleShowMainWindow = useCallback(() => {
        systemUtil.exitMinimode();
    }, []);

    const handlePlayPause = useCallback(() => {
        appSyncAuxiliary.sendCommand('play/pause');
    }, []);

    const handleSkipPrev = useCallback(() => {
        appSyncAuxiliary.sendCommand('skip-previous');
    }, []);

    const handleSkipNext = useCallback(() => {
        appSyncAuxiliary.sendCommand('skip-next');
    }, []);

    const handleToggleFavorite = useCallback(() => {
        appSyncAuxiliary.sendCommand('like/dislike');
    }, []);

    const handleToggleDesktopLyric = useCallback(() => {
        const current = appConfig.getConfigByKey('lyric.enableDesktopLyric');
        appConfig.setConfig({
            'lyric.enableDesktopLyric': !current,
        });
    }, []);

    const handleToggleRepeatMode = useCallback(() => {
        appSyncAuxiliary.sendCommand('set-repeat-mode', nextRepeatMode);
    }, [nextRepeatMode]);

    const handleTogglePin = useCallback(() => {
        const next = !pinned;
        setPinned(next);
        tauriInvoke('plugin:window|set_always_on_top', { value: next }).catch(() => {
            setPinned(!next);
        });
    }, [pinned]);

    const handlePickQuality = useCallback((quality: IMusic.IQualityKey) => {
        setQualityOpen(false);
        appSyncAuxiliary.sendCommand('download-music', quality);
    }, []);

    const handleDragStart = useCallback((event: React.PointerEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button')) return;
        setQualityOpen(false);
        tauriInvoke('plugin:window|start_dragging').catch(() => {});
    }, []);

    const isDownloading = downloadStatus === 'pending' || downloadStatus === 'downloading';
    const isDownloaded = downloadStatus === 'completed';
    const downloadLabel = isDownloaded
        ? t('common.downloaded')
        : isDownloading
          ? t('common.downloading')
          : downloadStatus === 'error'
            ? t('download.failed_retry')
            : t('download.choose_quality');

    return (
        <div className="l-minimode" onPointerDown={handleDragStart}>
            {/* ── 封面（点击回到主窗口） ── */}
            <button
                type="button"
                className="l-minimode__artwork"
                title={t('playback.expand_main_window')}
                onClick={handleShowMainWindow}
            >
                <img
                    className="l-minimode__artwork-img"
                    src={musicItem?.artwork || albumImg}
                    alt=""
                    draggable={false}
                    onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        if (!img.src.endsWith(albumImg)) {
                            img.src = albumImg;
                        }
                    }}
                />
                <span className="l-minimode__artwork-overlay">
                    <Maximize2 size={20} />
                </span>
            </button>

            <div className="l-minimode__main">
                <div className="l-minimode__title">
                    {musicItem?.title || (!musicItem ? t('playback.not_playing') : '')}
                </div>
                <div className="l-minimode__subtitle">
                    {[musicItem?.artist, musicItem?.album, isLive ? t('radio.live') : null]
                        .filter(Boolean)
                        .join(' · ')}
                </div>
                {!isLive && (
                    <div className="l-minimode__progress">
                        <div
                            className="l-minimode__progress-fill"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                )}
                <div className="l-minimode__tools">
                    <button
                        type="button"
                        className={`l-minimode__tool${isFavorite ? ' is-favorite' : ''}`}
                        title={t(
                            isFavorite
                                ? 'playlist.remove_from_favorites'
                                : 'playlist.add_to_favorites',
                        )}
                        onClick={handleToggleFavorite}
                    >
                        <Heart size={15} fill={isFavorite ? 'currentColor' : 'none'} />
                    </button>
                    {musicItem && !isLive && (
                        <button
                            type="button"
                            className={`l-minimode__tool l-minimode__tool--download${
                                isDownloaded ? ' is-done' : ''
                            }${isDownloading ? ' is-busy' : ''}${
                                downloadStatus === 'error' ? ' is-error' : ''
                            }`}
                            title={downloadLabel}
                            aria-label={downloadLabel}
                            aria-expanded={qualityOpen}
                            onClick={() => {
                                if (isDownloading) return;
                                setQualityOpen((open) => !open);
                            }}
                        >
                            {isDownloaded ? (
                                <CircleCheckBig size={15} />
                            ) : isDownloading ? (
                                <LoaderCircle size={15} className="is-spin" />
                            ) : downloadStatus === 'error' ? (
                                <CircleAlert size={15} />
                            ) : (
                                <Download size={15} />
                            )}
                        </button>
                    )}
                    <button
                        type="button"
                        className={`l-minimode__tool${pinned ? ' is-active' : ''}`}
                        title={t(pinned ? 'app.unpin_window' : 'app.pin_window')}
                        aria-pressed={pinned}
                        onClick={handleTogglePin}
                    >
                        <Pin size={15} />
                    </button>
                    {!isLive && (
                        <>
                            <button
                                type="button"
                                className={`l-minimode__tool${enableDesktopLyric ? ' is-active' : ''}`}
                                title={t('playback.desktop_lyric')}
                                onClick={handleToggleDesktopLyric}
                            >
                                <DesktopLyric size={15} />
                            </button>
                            <button
                                type="button"
                                className="l-minimode__tool"
                                title={t(REPEAT_MODE_MAP[currentRepeatMode].tipKey)}
                                onClick={handleToggleRepeatMode}
                            >
                                <RepeatIcon size={15} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="l-minimode__side">
                <button
                    type="button"
                    className="l-minimode__expand"
                    title={t('playback.expand_main_window')}
                    onClick={handleShowMainWindow}
                >
                    <Maximize2 size={14} />
                </button>
                <div className="l-minimode__playback">
                    <button
                        type="button"
                        className="l-minimode__ctrl-btn"
                        title={t('playback.previous')}
                        onClick={handleSkipPrev}
                    >
                        <SkipBack size={16} fill="currentColor" />
                    </button>
                    <button
                        type="button"
                        className="l-minimode__ctrl-btn l-minimode__ctrl-btn--play"
                        title={isPlaying ? t('playback.pause') : t('playback.play')}
                        onClick={handlePlayPause}
                    >
                        {isPlaying ? (
                            <Pause size={16} fill="currentColor" />
                        ) : (
                            <Play size={16} fill="currentColor" style={{ marginLeft: 1 }} />
                        )}
                    </button>
                    <button
                        type="button"
                        className="l-minimode__ctrl-btn"
                        title={t('playback.next')}
                        onClick={handleSkipNext}
                    >
                        <SkipForward size={16} fill="currentColor" />
                    </button>
                </div>
            </div>
            {qualityOpen && (
                <div
                    className="l-minimode__qualities"
                    role="menu"
                    aria-label={t('download.choose_quality')}
                >
                    {[...QUALITY_KEYS].reverse().map((quality) => (
                        <button
                            key={quality}
                            type="button"
                            role="menuitem"
                            className="l-minimode__quality"
                            onClick={() => handlePickQuality(quality)}
                        >
                            {t(`quality.${quality}`)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
