import { Activity, ArrowUpCircle, Download, Plus, Upload } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/mainWindow/components/ui/Button';
import { showModal } from '@renderer/mainWindow/components/ui/Modal/modalManager';
import { showToast } from '@renderer/mainWindow/components/ui/Toast';
import { usePlugins } from '@infra/pluginManager/renderer/hooks';
import pluginManager, { type IPluginVersionProgress } from '@infra/pluginManager/renderer';
import {
    importPluginSettingsText,
    readPluginSettingsFile,
    writePluginSettingsFile,
} from '@infra/pluginManager/renderer/pluginSettingsTransfer';
import systemUtil from '@infra/systemUtil/renderer';
import { isMobileApp } from '@common/runtimePlatform';
import { pluginGroupKey } from '@infra/pluginManager/common/pluginIdentity';
import { LOCAL_PLUGIN_HASH } from '@common/constant';
import PluginList from './components/PluginList';
import './index.scss';

function formatDate(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}${month}${day}`;
}

/**
 * PluginManagerPage — 插件管理页面
 *
 * 顶部固定标题 + 操作栏，下方为可拖拽排序的插件列表。
 * 设计稿还原：Plugins.tsx (设计稿)
 */
export default function PluginManagerPage() {
    const { t } = useTranslation();
    const plugins = usePlugins();
    const installed = useMemo(
        () => plugins.filter((plugin) => plugin.hash !== LOCAL_PLUGIN_HASH),
        [plugins],
    );
    const scriptCount = useMemo(() => new Set(installed.map(pluginGroupKey)).size, [installed]);
    const [checking, setChecking] = useState(false);
    const [updatingPlugins, setUpdatingPlugins] = useState(false);
    const [transferring, setTransferring] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [updateProgress, setUpdateProgress] = useState<IPluginVersionProgress | null>(null);

    const handleCheckVersions = useCallback(async () => {
        if (updatingPlugins) {
            pluginManager.cancelPluginVersionCheck();
            return;
        }
        setUpdatingPlugins(true);
        setUpdateProgress(null);
        try {
            const report = await pluginManager.checkPluginVersions(setUpdateProgress);
            if (report.cancelled) {
                showToast(t('plugin.plugin_update_cancelled'));
                return;
            }
            if (report.updated.length > 0) {
                const detail = report.updated
                    .map((item) => `${item.name} ${item.from} → ${item.to}`)
                    .join('，');
                showToast(
                    t('plugin.plugin_update_summary', { count: report.updated.length, detail }),
                );
            } else if (!report.catalog) {
                showToast(t('plugin.plugin_update_offline'), { type: 'warn' });
            } else {
                showToast(t('plugin.plugin_update_none'));
            }
        } catch {
            showToast(t('plugin.plugin_update_offline'), { type: 'warn' });
        } finally {
            setUpdatingPlugins(false);
            setUpdateProgress(null);
        }
    }, [t, updatingPlugins]);

    /** 检测已开启的平台。关闭的平台由检测函数跳过。 */
    const handleCheckSources = useCallback(async () => {
        if (checking) {
            pluginManager.cancelPluginAvailabilityCheck();
            return;
        }
        const hashes = installed.map((plugin) => plugin.hash);
        if (hashes.length === 0) return;

        setChecking(true);
        setProgress(null);
        try {
            const summary = await pluginManager.checkPluginsAvailability(hashes, {
                onProgress: (done, total) => setProgress({ done, total }),
            });
            if (summary.cancelled) {
                showToast(t('plugin.source_check_cancelled'));
                return;
            }
            showToast(
                t('plugin.source_check_summary', {
                    available: summary.available,
                    unavailable: summary.unavailable,
                    unsupported: summary.unsupported,
                    skipped: summary.skipped,
                }),
            );
        } finally {
            setChecking(false);
            setProgress(null);
        }
    }, [checking, installed, t]);

    const handleExport = useCallback(async () => {
        const dialogResult = await systemUtil.showSaveDialog({
            title: t('plugin.export_plugins'),
            defaultPath: `FreeMusicOnlinePlugins_${formatDate()}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (dialogResult.canceled || !dialogResult.filePath) return;
        setTransferring(true);
        try {
            const exported = await writePluginSettingsFile(dialogResult.filePath);
            showToast(
                t('plugin.export_plugins_success', {
                    count: exported.plugins,
                    favorites: exported.favorites,
                    library: exported.library,
                }),
            );
        } catch (error) {
            console.error('[plugin export]', error);
            showToast(t('plugin.export_plugins_fail', { reason: t('common.action_failed') }), {
                type: 'warn',
            });
        } finally {
            setTransferring(false);
        }
    }, [t]);

    const handleImportResult = useCallback(
        (result: Awaited<ReturnType<typeof readPluginSettingsFile>>) => {
            if (result.favoritesAdded > 0 || result.libraryAdded > 0) {
                showToast(
                    t('plugin.import_library_merged', {
                        favorites: result.favoritesAdded,
                        library: result.libraryAdded,
                    }),
                );
            }
            if (result.installed > 0 && result.applied > 0) {
                showToast(
                    t('plugin.import_plugins_installed', {
                        scripts: result.installed,
                        count: result.applied,
                    }),
                );
                return;
            }
            if (result.installed > 0) {
                showToast(t('plugin.import_plugins_scripts_only', { scripts: result.installed }));
                return;
            }
            if (result.failed > 0) {
                showToast(
                    t('plugin.import_plugins_fail', {
                        reason: result.error || t('plugin.import_plugins_none'),
                    }),
                    { type: 'warn' },
                );
                return;
            }
            if (result.applied === 0) {
                showToast(
                    result.hasScripts
                        ? t('plugin.import_plugins_none')
                        : t('plugin.import_plugins_none'),
                    { type: 'warn' },
                );
                return;
            }
            if (result.skipped > 0) {
                showToast(
                    t('plugin.import_plugins_partial', {
                        count: result.applied,
                        skipped: result.skipped,
                    }),
                );
                return;
            }
            showToast(t('plugin.import_plugins_success', { count: result.applied }));
        },
        [t],
    );

    const handleImport = useCallback(async () => {
        setTransferring(true);
        try {
            if (isMobileApp()) {
                const text = await new Promise<string | null>((resolve, reject) => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'application/json,.json,text/plain,*/*';
                    input.onchange = async () => {
                        const file = input.files?.[0];
                        if (!file) {
                            resolve(null);
                            return;
                        }
                        try {
                            resolve(await file.text());
                        } catch (error) {
                            reject(error);
                        }
                    };
                    input.oncancel = () => resolve(null);
                    input.click();
                });
                if (!text) return;
                handleImportResult(await importPluginSettingsText(text));
                return;
            }

            const dialogResult = await systemUtil.showOpenDialog({
                title: t('plugin.import_plugins'),
                filters: [{ name: 'JSON', extensions: ['json'] }],
                properties: ['openFile'],
            });
            const filePath = dialogResult.filePaths?.[0];
            if (dialogResult.canceled || !filePath) return;
            handleImportResult(await readPluginSettingsFile(filePath));
        } catch {
            showToast(t('plugin.import_plugins_invalid'), { type: 'warn' });
        } finally {
            setTransferring(false);
        }
    }, [handleImportResult, t]);

    const checkLabel = checking
        ? progress && progress.total > 0
            ? t('plugin.check_source_stop_progress', progress)
            : t('plugin.check_source_stop')
        : t('plugin.check_source');
    const updateLabel = !updatingPlugins
        ? t('plugin.check_plugin_update')
        : !updateProgress || updateProgress.total <= 0
          ? updateProgress?.phase === 'catalog'
              ? t('plugin.check_plugin_update_catalog')
              : t('plugin.check_plugin_update_stop')
          : t(
                updateProgress.phase === 'catalog'
                    ? 'plugin.check_plugin_update_catalog_progress'
                    : 'plugin.check_plugin_update_stop_progress',
                updateProgress,
            );

    return (
        <div className="p-plugin-manager">
            {/* 头部：标题 + 操作按钮 */}
            <div className="p-plugin-manager__header">
                <div className="p-plugin-manager__header-row">
                    <div className="p-plugin-manager__title-group">
                        <h2 className="p-plugin-manager__title">{t('plugin.plugin_management')}</h2>
                        {installed.length > 0 && (
                            <span className="p-plugin-manager__count">
                                {t('plugin.plugin_count', {
                                    plugins: scriptCount,
                                    platforms: installed.length,
                                })}
                            </span>
                        )}
                    </div>
                    <div className="p-plugin-manager__header-actions">
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<Download size={16} />}
                            loading={transferring}
                            disabled={installed.length === 0}
                            onClick={handleExport}
                        >
                            {t('plugin.export_plugins')}
                        </Button>
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<Upload size={16} />}
                            loading={transferring}
                            onClick={handleImport}
                        >
                            {t('plugin.import_plugins')}
                        </Button>
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<ArrowUpCircle size={16} />}
                            busy={updatingPlugins}
                            disabled={installed.length === 0 || transferring}
                            onClick={handleCheckVersions}
                        >
                            {updateLabel}
                        </Button>
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<Activity size={16} />}
                            busy={checking}
                            disabled={installed.length === 0 || transferring}
                            onClick={handleCheckSources}
                        >
                            {checkLabel}
                        </Button>
                        <Button
                            variant="primary"
                            size="md"
                            icon={<Plus size={16} />}
                            onClick={() => showModal('PluginInstallModal')}
                        >
                            {t('plugin.install_plugin')}
                        </Button>
                    </div>
                </div>
                <p className="p-plugin-manager__hint">{t('plugin.lx_source_hint')}</p>
                {installed.length > 0 && (
                    <p className="p-plugin-manager__hint">{t('plugin.toggle_hint')}</p>
                )}
            </div>

            {/* 插件列表 */}
            <div className="p-plugin-manager__body">
                <PluginList />
            </div>
        </div>
    );
}
