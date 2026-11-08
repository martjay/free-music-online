import { memo, useCallback, useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Activity, ChevronDown, GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import pluginManager, { type IPluginAvailabilityResult } from '@infra/pluginManager/renderer';
import type { IPluginMetaAll } from '@appTypes/infra/pluginManager';
import { cn } from '@common/cn';
import { Button } from '@renderer/mainWindow/components/ui/Button';
import { showToast } from '@renderer/mainWindow/components/ui/Toast';
import { PluginItemCard } from './PluginItem';

const noAnimateLayoutChanges = () => false;

/** 版本号交给文案加 v。日期单独显示，避免和「更新于」重复。 */
function displayVersion(version?: string, updatedAt?: string): string | undefined {
    if (!version) return undefined;
    let text = version.trim();
    if (updatedAt && text.includes(updatedAt)) {
        text = text
            .replace(updatedAt, '')
            .replace(/\s*[|｜]\s*$/, '')
            .trim();
    }
    text = text.replace(/^v/i, '');
    return text || undefined;
}
const EXPANDED_GROUPS_KEY = 'plugin-group-expanded:v1';

function readExpandedGroups(): Set<string> {
    try {
        const raw = localStorage.getItem(EXPANDED_GROUPS_KEY);
        const ids: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(ids)) return new Set();
        return new Set(ids.filter((id): id is string => typeof id === 'string'));
    } catch {
        return new Set();
    }
}

function writeExpandedGroup(id: string, expanded: boolean): void {
    const ids = readExpandedGroups();
    if (expanded) ids.add(id);
    else ids.delete(id);
    try {
        localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify([...ids]));
    } catch {
        // 隐私模式或配额不足时只保留这次打开的状态
    }
}

export interface PluginGroupData {
    id: string;
    scriptName: string;
    plugins: IPlugin.IPluginDelegate[];
    platforms: string[];
}

interface PluginGroupProps {
    group: PluginGroupData;
    meta: IPluginMetaAll;
    availability: Record<string, IPluginAvailabilityResult | undefined>;
    onToggleEnabled: (hash: string, enabled: boolean) => void;
}

/** 同一脚本的多个平台。拖动标题时整组移动，组内顺序保持不变。 */
function PluginGroup({ group, meta, availability, onToggleEnabled }: PluginGroupProps) {
    const { t } = useTranslation();
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: group.id,
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

    const author = group.plugins.find((plugin) => plugin.author)?.author;
    const updatedAt = group.plugins.find((plugin) => plugin.updatedAt)?.updatedAt;
    const rawVersion = group.plugins.find((plugin) => plugin.version)?.version;
    const version = displayVersion(rawVersion, updatedAt);
    const activeCount = group.plugins.filter(
        (plugin) => meta[plugin.hash]?.enabled !== false,
    ).length;
    const [collapsed, setCollapsed] = useState(() => !readExpandedGroups().has(group.id));
    const [checking, setChecking] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const toggleCollapsed = useCallback(() => {
        setCollapsed((current) => {
            const next = !current;
            writeExpandedGroup(group.id, !next);
            return next;
        });
    }, [group.id]);
    const handleCheckAll = useCallback(async () => {
        const hashes = group.plugins.map((plugin) => plugin.hash);
        if (hashes.length === 0) return;
        setChecking(true);
        setProgress(null);
        try {
            const summary = await pluginManager.checkPluginsAvailability(hashes, {
                includeDisabled: true,
                onProgress: (done, total) => setProgress({ done, total }),
            });
            showToast(t('plugin.source_check_summary', summary));
        } finally {
            setChecking(false);
            setProgress(null);
        }
    }, [group.plugins, t]);
    const checkLabel =
        checking && progress && progress.total > 0
            ? t('plugin.check_plugin_platforms_progress', progress)
            : t('plugin.check_plugin_platforms');

    return (
        <section
            ref={setNodeRef}
            style={style}
            className={cn('p-plugin-manager__group', isDragging && 'is-dragging')}
        >
            <div className="p-plugin-manager__group-header">
                <div
                    role="button"
                    tabIndex={-1}
                    ref={setActivatorNodeRef}
                    className="p-plugin-manager__drag-handle"
                    aria-label={t('plugin.drag_sort')}
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical size={16} />
                </div>
                <div className="p-plugin-manager__group-info">
                    <div className="p-plugin-manager__item-title-row">
                        <h3 className="p-plugin-manager__item-name">{group.scriptName}</h3>
                        {version && (
                            <span className="p-plugin-manager__item-version">
                                {t('plugin.version_label', { version })}
                            </span>
                        )}
                    </div>
                    <p className="p-plugin-manager__item-meta p-plugin-manager__group-meta">
                        {author && <span>{author}</span>}
                        {author && <span> · </span>}
                        <span>
                            {t('plugin.active_platform_count', {
                                active: activeCount,
                                total: group.plugins.length,
                            })}
                        </span>
                        {updatedAt && (
                            <>
                                <span> · </span>
                                <span>{t('plugin.updated_at', { date: updatedAt })}</span>
                            </>
                        )}
                    </p>
                </div>
                <div className="p-plugin-manager__group-actions">
                    <Button
                        variant="secondary"
                        size="sm"
                        icon={<Activity size={14} />}
                        loading={checking}
                        onClick={handleCheckAll}
                    >
                        {checkLabel}
                    </Button>
                    <button
                        type="button"
                        className={cn(
                            'p-plugin-manager__group-toggle',
                            collapsed && 'is-collapsed',
                        )}
                        aria-expanded={!collapsed}
                        aria-label={t(
                            collapsed ? 'plugin.expand_sources' : 'plugin.collapse_sources',
                        )}
                        title={t(collapsed ? 'plugin.expand_sources' : 'plugin.collapse_sources')}
                        onClick={toggleCollapsed}
                    >
                        <ChevronDown size={16} />
                    </button>
                </div>
            </div>
            {!collapsed && (
                <div className="p-plugin-manager__group-body">
                    {group.plugins.map((plugin) => (
                        <PluginItemCard
                            key={plugin.hash}
                            plugin={plugin}
                            enabled={meta[plugin.hash]?.enabled !== false}
                            availability={availability[plugin.hash]}
                            sourceRedirectPlatform={
                                meta[plugin.hash]?.sourceRedirectPlatform ?? null
                            }
                            groupPlatforms={group.platforms}
                            onToggleEnabled={onToggleEnabled}
                            embedded
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

export default memo(PluginGroup);
