import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '@renderer/mainWindow/components/ui/Modal';
import { Button } from '@renderer/mainWindow/components/ui/Button';
import { CheckboxGroup } from '@renderer/mainWindow/components/ui/CheckboxGroup';
import { syncKV } from '@renderer/common/kvStore';
import systemUtil from '@infra/systemUtil/renderer';
import {
    APP_RELEASES_URL,
    appInstallerUrl,
    withDownloadMirrors,
} from '@infra/systemUtil/common/constant';
import type { IUpdateInfo } from '@appTypes/infra/systemUtil';
import { clearPendingUpdate } from '@renderer/mainWindow/common/updateNotice';
import { tauriInvoke, tauriListen } from '@infra/tauriBridge/ipc';
import './index.scss';

export interface UpdateModalProps {
    close: () => void;
    /** 更新详情（version / changeLog / download） */
    updateInfo: NonNullable<IUpdateInfo['update']>;
}

type UpdatePhase = 'idle' | 'downloading' | 'installing' | 'failed';

const UPDATE_TASK_ID = 'app-update';

/**
 * UpdateModal — 软件更新提示弹窗（业务组件）
 *
 * 启动时检测到新版本后弹出，展示版本号和更新日志。
 * 可以打开发布页，也可以在当前窗口下载安装包并自动重启安装。
 */
export default function UpdateModal({ close, updateInfo }: UpdateModalProps) {
    const { t } = useTranslation();
    const { version, changeLog, download } = updateInfo;
    const [phase, setPhase] = useState<UpdatePhase>('idle');
    const [percent, setPercent] = useState(0);

    const [skipChecked, setSkipChecked] = useState(
        () => syncKV.get('update.skipVersion') === version,
    );

    useEffect(() => {
        if (phase !== 'downloading') return;
        let unlisten = () => {};
        let disposed = false;
        tauriListen<{ taskId: string; downloadedBytes: number; totalBytes?: number | null }>(
            'tauri-download-progress',
            (payload) => {
                if (payload.taskId !== UPDATE_TASK_ID || !payload.totalBytes) return;
                const next = Math.min(
                    100,
                    Math.round((payload.downloadedBytes / payload.totalBytes) * 100),
                );
                setPercent(next);
            },
        ).then((stop) => {
            if (disposed) stop();
            else unlisten = stop;
        });
        return () => {
            disposed = true;
            unlisten();
        };
    }, [phase]);

    const handleSkipChange = useCallback(
        (value: string[]) => {
            const checked = value.includes('skip');
            setSkipChecked(checked);
            if (checked) {
                syncKV.set('update.skipVersion', version);
                clearPendingUpdate();
            } else {
                syncKV.remove('update.skipVersion');
            }
        },
        [version],
    );

    const handleOpenRelease = useCallback(() => {
        const page = download?.find((item) => /^https?:\/\//.test(item) && !item.endsWith('.exe'));
        systemUtil.openExternal(page || APP_RELEASES_URL);
    }, [download]);

    const handleInstall = useCallback(async () => {
        if (phase === 'downloading' || phase === 'installing') return;
        setPhase('downloading');
        setPercent(0);
        try {
            const direct = (download ?? []).filter((item) => /\.exe($|\?)/i.test(item));
            const candidates = (direct.length > 0 ? direct : [appInstallerUrl(version)]).flatMap(
                withDownloadMirrors,
            );
            const path = await tauriInvoke<string>('app_update_installer_path', { version });
            if (!path) throw new Error('missing path');

            let saved = false;
            for (const url of candidates) {
                try {
                    await tauriInvoke('download_file', {
                        taskId: UPDATE_TASK_ID,
                        url,
                        path,
                        resume: false,
                        proxy: 'system',
                    });
                    const valid = await tauriInvoke<boolean>('app_update_installer_valid', {
                        installerPath: path,
                    });
                    if (!valid) continue;
                    saved = true;
                    break;
                } catch {
                    saved = false;
                }
            }
            if (!saved) throw new Error('download failed');

            setPercent(100);
            setPhase('installing');
            clearPendingUpdate();
            await tauriInvoke('apply_app_update', { installerPath: path });
        } catch {
            setPhase('failed');
        }
    }, [download, phase, version]);

    const handleClose = useCallback(() => {
        if (phase === 'installing') return;
        if (phase === 'downloading') {
            tauriInvoke('download_cancel', { taskId: UPDATE_TASK_ID }).catch(() => {});
        }
        close();
    }, [close, phase]);

    const busy = phase === 'downloading' || phase === 'installing';

    return (
        <Modal
            open
            onClose={handleClose}
            title={t('app.new_version_found', { version })}
            size="sm"
            footer={
                <div className="update-modal__footer">
                    <CheckboxGroup
                        value={skipChecked ? ['skip'] : []}
                        options={[{ value: 'skip', label: t('app.skip_version') }]}
                        onChange={handleSkipChange}
                    />
                    <div className="update-modal__actions">
                        <Button variant="secondary" size="sm" onClick={handleOpenRelease} disabled={busy}>
                            {t('app.go_download')}
                        </Button>
                        <Button variant="primary" size="sm" onClick={handleInstall} loading={busy} disabled={busy}>
                            {t('app.update_now')}
                        </Button>
                    </div>
                </div>
            }
        >
            {changeLog && changeLog.length > 0 && (
                <ul className="update-modal__changelog">
                    {changeLog.map((item, i) => (
                        <li key={i} className="update-modal__changelog-item">
                            {item}
                        </li>
                    ))}
                </ul>
            )}
            {phase !== 'idle' && (
                <div className="update-modal__progress" aria-live="polite">
                    <div className="update-modal__progress-track">
                        <div
                            className="update-modal__progress-bar"
                            style={{ width: phase === 'installing' ? '100%' : `${percent}%` }}
                        />
                    </div>
                    <span>
                        {phase === 'failed'
                            ? t('app.update_failed')
                            : phase === 'installing'
                              ? t('app.update_installing')
                              : t('app.update_downloading', { percent })}
                    </span>
                </div>
            )}
        </Modal>
    );
}
