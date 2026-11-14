import { memo, useCallback, useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DraggableAttributes } from '@dnd-kit/core';
import {
    GripVertical,
    HelpCircle,
    ArrowUpCircle,
    ArrowRightLeft,
    Sparkles,
    ListPlus,
    SlidersHorizontal,
    Trash2,
    Activity,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/mainWindow/components/ui/Button';
import { Badge } from '@renderer/mainWindow/components/ui/Badge';
import { Toggle } from '@renderer/mainWindow/components/ui/Toggle';
import { showModal } from '@renderer/mainWindow/components/ui/Modal/modalManager';
import { showToast } from '@renderer/mainWindow/components/ui/Toast';
import pluginManager from '@infra/pluginManager/renderer';
import { pluginPlatformLabel } from '@infra/pluginManager/common/pluginIdentity';
import type { IPluginAvailabilityResult } from '@infra/pluginManager/renderer';
import { cn } from '@common/cn';

// ── 方法名到 i18n key 的映射 ──

const METHOD_LABEL_MAP: Record<string, string> = {
    search: 'plugin.method_search',
    importMusicItem: 'plugin.method_import_music_item',
    importMusicSheet: 'plugin.method_import_music_sheet',
    getTopLists: 'plugin.method_get_top_lists',
    getLyric: 'plugin.method_get_lyric',
    getRecommendSheetTags: 'plugin.method_get_recommend_sheet_tags',
};

/** 提取为模块常量，避免每次渲染创建新的函数引用 */
const noAnimateLayoutChanges = () => false;

export interface PluginItemCardProps {
    plugin: IPlugin.IPluginDelegate;
    enabled: boolean;
    /** 音源可用性检测结果；undefined 表示尚未检测 */
    availability?: IPluginAvailabilityResult;
    sourceRedirectPlatform?: string | null;
    /** 同一脚本下的全部平台名。多于一个时，卸载会一并移除。 */
    groupPlatforms: string[];
    onToggleEnabled: (hash: string, enabled: boolean) => void;
    /** 分组卡片里由组标题拖拽，行内不再放手柄 */
    embedded?: boolean;
    dragRef?: (element: HTMLElement | null) => void;
    dragAttributes?: DraggableAttributes;
    dragListeners?: ReturnType<typeof useSortable>['listeners'];
}

function formatLatency(latencyMs: number): string {
    if (latencyMs < 1000) return `${latencyMs}ms`;
    return `${(latencyMs / 1000).toFixed(1)}s`;
}

/** 音源可用性状态徽章 */
function AvailabilityBadge({ availability }: { availability?: IPluginAvailabilityResult }) {
    const { t } = useTranslation();

    switch (availability?.state) {
        case 'available':
            return (
                <Badge variant="tint">
                    {availability.latencyMs != null
                        ? t('plugin.source_available_latency', {
                              latency: formatLatency(availability.latencyMs),
                          })
                        : t('plugin.source_available')}
                </Badge>
            );
        case 'unavailable':
            return (
                <Badge variant="tint" colorScheme="danger">
                    {t('plugin.source_unavailable')}
                </Badge>
            );
        case 'checking':
            return (
                <Badge variant="outline" colorScheme="warn">
                    {t('plugin.source_checking')}
                </Badge>
            );
        case 'unsupported':
            return (
                <Badge variant="outline" colorScheme="warn">
                    {t('plugin.source_unsupported')}
                </Badge>
            );
        default:
            return <Badge variant="outline">{t('plugin.source_unchecked')}</Badge>;
    }
}

/**
 * 平台行内容。拖拽由外层决定：单独一行自己排序，分组里跟组标题走。
 */
export const PluginItemCard = memo(function PluginItemCard({
    plugin,
    enabled,
    availability,
    sourceRedirectPlatform,
    groupPlatforms,
    onToggleEnabled,
    embedded = false,
    dragRef,
    dragAttributes,
    dragListeners,
}: PluginItemCardProps) {
    const { t } = useTranslation();

    const capabilities = useMemo(() => {
        const labels = plugin.supportedMethod
            .filter((m) => m in METHOD_LABEL_MAP)
            .map((m) => t(METHOD_LABEL_MAP[m]));
        if (labels.length === 0) return '';
        return t('plugin.supports_features', { features: labels.join('/') });
    }, [plugin.supportedMethod, t]);

    const handleDescription = useCallback(() => {
        showModal('PluginDescriptionModal', { plugin });
    }, [plugin]);

    const failReason =
        availability?.state === 'unavailable' && availability.message ? availability.message : '';

    return (
        <div
            className={cn(
                'p-plugin-manager__item',
                !enabled && 'is-disabled',
                embedded && 'is-embedded',
            )}
        >
            <div className="p-plugin-manager__item-main">
                {!embedded && (
                    <div
                        role="button"
                        tabIndex={-1}
                        ref={dragRef}
                        className="p-plugin-manager__drag-handle"
                        aria-label={t('plugin.drag_sort')}
                        {...dragAttributes}
                        {...dragListeners}
                    >
                        <GripVertical size={16} />
                    </div>
                )}

                <div className="p-plugin-manager__item-info">
                    <div className="p-plugin-manager__item-title-row">
                        <h3 className="p-plugin-manager__item-name">
                            {pluginPlatformLabel(plugin)}
                        </h3>
                        <AvailabilityBadge availability={availability} />
                        {plugin.version && (
                            <span className="p-plugin-manager__item-version">
                                {t('plugin.version_label', {
                                    version: plugin.version,
                                })}
                            </span>
                        )}
                        {plugin.description && (
                            <button
                                type="button"
                                className="p-plugin-manager__help-btn"
                                onClick={handleDescription}
                                aria-label={t('plugin.plugin_description')}
                            >
                                <HelpCircle size={16} />
                            </button>
                        )}
                        {sourceRedirectPlatform && (
                            <Badge variant="tint">
                                {t('plugin.source_redirect_to', {
                                    target: sourceRedirectPlatform,
                                })}
                            </Badge>
                        )}
                    </div>
                    <p className="p-plugin-manager__item-meta">
                        {failReason ? (
                            <span className="p-plugin-manager__item-reason" title={failReason}>
                                {failReason}
                            </span>
                        ) : (
                            <>
                                {plugin.author && <span>{plugin.author}</span>}
                                {plugin.author && capabilities && <span> · </span>}
                                {capabilities && <span>{capabilities}</span>}
                            </>
                        )}
                    </p>
                </div>

                <div className="p-plugin-manager__item-right">
                    <Toggle
                        checked={enabled}
                        onChange={(checked) => onToggleEnabled(plugin.hash, checked)}
                        aria-label={t('plugin.toggle_enable')}
                        title={t('plugin.toggle_hint')}
                    />
                </div>
            </div>

            <PluginItemActions
                plugin={plugin}
                groupPlatforms={groupPlatforms}
                embedded={embedded}
                checking={availability?.state === 'checking'}
            />
        </div>
    );
});

const PluginItemActions = memo(function PluginItemActions({
    plugin,
    groupPlatforms,
    embedded,
    checking,
}: {
    plugin: IPlugin.IPluginDelegate;
    groupPlatforms: string[];
    embedded: boolean;
    checking: boolean;
}) {
    const { t } = useTranslation();
    const hasUpdateSource = !!plugin.srcUrl;
    const [updating, setUpdating] = useState(false);
    const canCheck = plugin.supportedMethod.includes('getMediaSource');

    const handleCheck = useCallback(async () => {
        await pluginManager.checkPluginsAvailability([plugin.hash], { includeDisabled: true });
    }, [plugin.hash]);

    const handleUpdate = useCallback(async () => {
        setUpdating(true);
        try {
            const result = await pluginManager.updatePlugin(plugin.hash);
            if (result.success) {
                showToast(t('plugin.toast_plugin_updated', { plugin: plugin.platform }));
            } else {
                showToast(
                    t('plugin.toast_plugin_already_latest', {
                        plugin: plugin.platform,
                    }),
                );
            }
        } catch {
            showToast(t('plugin.update_failed'), { type: 'warn' });
        } finally {
            setUpdating(false);
        }
    }, [plugin.hash, plugin.platform, t]);

    const handleUninstall = useCallback(() => {
        const script = plugin.scriptName || plugin.platform;
        const removesGroup = groupPlatforms.length > 1;
        showModal('ConfirmModal', {
            title: t('plugin.uninstall_plugin'),
            message: removesGroup
                ? t('plugin.confirm_uninstall_script', {
                      script,
                      platforms: groupPlatforms.join('、'),
                  })
                : t('plugin.confirm_text_uninstall_plugin', {
                      plugin: plugin.platform,
                  }),
            description: t('plugin.uninstall_warning'),
            confirmText: t('plugin.confirm_uninstall'),
            confirmDanger: true,
            onConfirm: async () => {
                const result = await pluginManager.uninstallPlugin(plugin.hash);
                if (result.success) {
                    showToast(
                        t('plugin.uninstall_successfully', {
                            plugin: removesGroup ? script : plugin.platform,
                        }),
                    );
                } else {
                    showToast(result.message ?? t('plugin.uninstall_failed'), {
                        type: 'warn',
                    });
                    throw new Error('uninstall failed');
                }
            },
        });
    }, [groupPlatforms, plugin, t]);

    const handleImportTrack = useCallback(() => {
        showModal('PluginImportModal', { plugin, type: 'importMusicItem' });
    }, [plugin]);

    const handleImportSheet = useCallback(() => {
        showModal('PluginImportModal', { plugin, type: 'importMusicSheet' });
    }, [plugin]);

    const handleUserVariables = useCallback(() => {
        showModal('PluginUserVariableModal', { plugin });
    }, [plugin]);

    const handleSourceRedirect = useCallback(() => {
        showModal('PluginSourceRedirectModal', { plugin });
    }, [plugin]);

    return (
        <div className={cn('p-plugin-manager__item-actions', embedded && 'is-embedded')}>
            {canCheck && (
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<Activity size={14} />}
                    onClick={handleCheck}
                    loading={checking}
                >
                    {t('plugin.check_platform')}
                </Button>
            )}
            {canCheck && (
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<ArrowRightLeft size={14} />}
                    onClick={handleSourceRedirect}
                >
                    {t('plugin.source_redirect')}
                </Button>
            )}
            {hasUpdateSource && (
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<ArrowUpCircle size={14} />}
                    onClick={handleUpdate}
                    loading={updating}
                >
                    {t('plugin.update')}
                </Button>
            )}
            {plugin.supportedMethod.includes('importMusicItem') && (
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<Sparkles size={14} />}
                    onClick={handleImportTrack}
                >
                    {t('plugin.method_import_music_item')}
                </Button>
            )}
            {plugin.supportedMethod.includes('importMusicSheet') && (
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<ListPlus size={14} />}
                    onClick={handleImportSheet}
                >
                    {t('plugin.method_import_music_sheet')}
                </Button>
            )}
            {(plugin.userVariables?.length ?? 0) > 0 && (
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<SlidersHorizontal size={14} />}
                    onClick={handleUserVariables}
                >
                    {t('plugin.prop_user_variable')}
                </Button>
            )}
            <Button
                variant="secondary"
                size="sm"
                danger
                icon={<Trash2 size={14} />}
                onClick={handleUninstall}
            >
                {t('plugin.uninstall')}
            </Button>
        </div>
    );
});

type SortablePluginItemProps = Omit<
    PluginItemCardProps,
    'embedded' | 'dragRef' | 'dragAttributes' | 'dragListeners'
>;

/** 单独成组的平台：整行可拖拽排序 */
function SortablePluginItem(props: SortablePluginItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: props.plugin.hash,
        animateLayoutChanges: noAnimateLayoutChanges,
    });

    const style = useMemo(
        () => ({
            transform: CSS.Transform.toString(
                transform ? { ...transform, scaleX: 1, scaleY: 1 } : null,
            ),
            transition,
            zIndex: isDragging ? 10 : undefined,
            opacity: isDragging ? 0.6 : 1,
        }),
        [transform, transition, isDragging],
    );

    return (
        <div ref={setNodeRef} style={style}>
            <PluginItemCard
                {...props}
                dragRef={setActivatorNodeRef}
                dragAttributes={attributes}
                dragListeners={listeners}
            />
        </div>
    );
}

export default memo(SortablePluginItem, (prev, next) => {
    return (
        prev.plugin === next.plugin &&
        prev.enabled === next.enabled &&
        prev.availability === next.availability &&
        prev.sourceRedirectPlatform === next.sourceRedirectPlatform &&
        prev.groupPlatforms === next.groupPlatforms &&
        prev.onToggleEnabled === next.onToggleEnabled
    );
});
