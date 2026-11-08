import { Activity, ArrowUpCircle, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/mainWindow/components/ui/Button';
import { showModal } from '@renderer/mainWindow/components/ui/Modal/modalManager';
import { showToast } from '@renderer/mainWindow/components/ui/Toast';
import { usePlugins } from '@infra/pluginManager/renderer/hooks';
import pluginManager from '@infra/pluginManager/renderer';
import { pluginGroupKey } from '@infra/pluginManager/common/pluginIdentity';
import { LOCAL_PLUGIN_HASH } from '@common/constant';
import PluginList from './components/PluginList';
import './index.scss';

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
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    const handleCheckVersions = useCallback(async () => {
        setUpdatingPlugins(true);
        try {
            const report = await pluginManager.checkPluginVersions();
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
        }
    }, [t]);

    /** 检测已开启的平台。关闭的平台由检测函数跳过。 */
    const handleCheckSources = useCallback(async () => {
        const hashes = installed.map((plugin) => plugin.hash);
        if (hashes.length === 0) return;

        setChecking(true);
        setProgress(null);
        try {
            const summary = await pluginManager.checkPluginsAvailability(hashes, {
                onProgress: (done, total) => setProgress({ done, total }),
            });
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
    }, [installed, t]);

    const checkLabel =
        checking && progress && progress.total > 0
            ? t('plugin.source_check_progress', progress)
            : t('plugin.check_source');

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
                            icon={<ArrowUpCircle size={16} />}
                            loading={updatingPlugins}
                            disabled={installed.length === 0 || checking}
                            onClick={handleCheckVersions}
                        >
                            {updatingPlugins
                                ? t('plugin.check_plugin_update_progress')
                                : t('plugin.check_plugin_update')}
                        </Button>
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<Activity size={16} />}
                            loading={checking}
                            disabled={installed.length === 0 || updatingPlugins}
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
