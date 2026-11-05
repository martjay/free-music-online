/**
 * Command Handlers — 非 TrackPlayer 的 appSync 指令处理
 *
 * 注册 toggle-desktop-lyric、toggle-minimode 等快捷键指令的 renderer 端 handler。
 * 在 bootstrap 中 trackPlayer.setup() 之后调用。
 */
import { isRadioBrowserMedia } from '@common/radioBrowser';
import appConfig from '@infra/appConfig/renderer';
import appSync from '@infra/appSync/renderer/main';
import downloadManager from '@infra/downloadManager/renderer';
import systemUtil from '@infra/systemUtil/renderer';
import i18n from '@infra/i18n/renderer';
import { showToast } from '@renderer/mainWindow/components/ui/Toast';
import { openFullscreenPlayer } from '@renderer/mainWindow/components/layout/FullscreenPlayer/fullscreenPlayerState';
import router from '@renderer/mainWindow/router';
import { currentMusicAtom, store } from '@renderer/mainWindow/core/trackPlayer/store';

export function setupCommandHandlers(): void {
    appSync.onCommand('toggle-desktop-lyric', () => {
        const current = appConfig.getConfigByKey('lyric.enableDesktopLyric');
        appConfig.setConfig({ 'lyric.enableDesktopLyric': !current });
    });

    appSync.onCommand('toggle-minimode', () => {
        systemUtil.toggleMinimode();
    });

    appSync.onCommand('open-music-detail', () => {
        openFullscreenPlayer();
    });

    appSync.onCommand('navigate', (path) => {
        router.navigate('/' + path);
    });

    appSync.onCommand('download-music', (quality) => {
        const music = store.get(currentMusicAtom);
        if (!music || isRadioBrowserMedia(music)) return;
        downloadManager.addTask({ musicItem: music, quality }).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : '';
            if (message.includes('已下载')) {
                showToast(i18n.t('download.already_downloaded'), { type: 'warn' });
            } else if (message) {
                showToast(message, { type: 'warn' });
            }
        });
    });
}
