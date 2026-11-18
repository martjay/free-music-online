import { Bookmark, Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@common/cn';
import musicSheet, { useRadioIsFavorite } from '@infra/musicSheet/renderer';
import { Artwork } from '../../ui/Artwork';
import { Marquee } from '../../ui/Marquee';
import {
    radioAudioPlayer,
    useRadioCurrentStation,
    useRadioPlaybackState,
} from '@renderer/mainWindow/pages/RadioPage/services/radioAudioPlayer';
import {
    formatCountryName,
    formatLanguageName,
} from '@renderer/mainWindow/pages/RadioPage/utils/geoLanguageMap';
import '../PlayerBar/index.scss';
import './index.scss';

/**
 * RadioPlayerBar — 电台页专用底栏，不接 trackPlayer。
 */
export default function RadioPlayerBar() {
    const { t } = useTranslation();
    const station = useRadioCurrentStation();
    const radioState = useRadioPlaybackState();
    const isFavorite = useRadioIsFavorite(station ?? { platform: 'radio-browser', id: '' });
    const isPlaying = radioState === 'playing';
    const isBuffering = radioState === 'buffering';
    const subtitle = station
        ? [
              formatCountryName(station.radioBrowser.countryCode, station.radioBrowser.country),
              formatLanguageName(station.radioBrowser.language),
          ]
              .filter(Boolean)
              .join(' · ')
        : '';

    return (
        <footer className="l-player-bar l-radio-player-bar">
            <div className="l-radio-player-bar__live" aria-hidden={!isPlaying}>
                <span className={cn('l-radio-player-bar__live-dot', isPlaying && 'is-on')} />
                <span>{isPlaying ? t('radio.live') : t('radio.title')}</span>
            </div>

            <div className="l-player-bar__body">
                <div className="l-player-bar__left">
                    <Artwork
                        src={station?.artwork}
                        size="sm"
                        rounded="sm"
                        className="l-player-bar__cover"
                    />
                    <div className="l-player-bar__info">
                        {station ? (
                            <>
                                <Marquee className="l-player-bar__info-row" title={station.title}>
                                    <span className="l-player-bar__title">{station.title}</span>
                                </Marquee>
                                {subtitle ? (
                                    <span className="l-player-bar__artist">{subtitle}</span>
                                ) : null}
                            </>
                        ) : (
                            <span className="l-player-bar__empty-hint">{t('radio.title')}</span>
                        )}
                    </div>
                </div>

                <div className="l-player-bar__center">
                    <button
                        className="l-player-bar__ctrl-btn l-player-bar__ctrl-btn--lg"
                        type="button"
                        title={t('playback.previous')}
                        disabled={!station}
                        onClick={() => radioAudioPlayer.skip(-1)}
                    >
                        <SkipBack size={17} fill="currentColor" />
                    </button>
                    <button
                        className="l-player-bar__ctrl-btn l-player-bar__ctrl-btn--play"
                        type="button"
                        title={isPlaying || isBuffering ? t('playback.pause') : t('playback.play')}
                        onClick={() => radioAudioPlayer.togglePlayPause()}
                    >
                        {isBuffering ? (
                            <Loader2 size={18} className="l-radio-player-bar__spin" />
                        ) : isPlaying ? (
                            <Pause size={18} fill="currentColor" />
                        ) : (
                            <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />
                        )}
                    </button>
                    <button
                        className="l-player-bar__ctrl-btn l-player-bar__ctrl-btn--lg"
                        type="button"
                        title={t('playback.next')}
                        disabled={!station}
                        onClick={() => radioAudioPlayer.skip(1)}
                    >
                        <SkipForward size={17} fill="currentColor" />
                    </button>
                </div>

                <div className="l-player-bar__right">
                    <button
                        className={cn('l-player-bar__ctrl-btn', isFavorite && 'is-active')}
                        type="button"
                        disabled={!station}
                        title={isFavorite ? t('radio.remove_favorite') : t('radio.add_favorite')}
                        onClick={() => {
                            if (!station) return;
                            if (isFavorite) musicSheet.removeRadioFavorite(station);
                            else musicSheet.addRadioFavorite(station);
                        }}
                    >
                        <Bookmark size={15} fill={isFavorite ? 'currentColor' : 'none'} />
                    </button>
                </div>
            </div>
        </footer>
    );
}
