import { memo, useCallback, useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IPluginAvailabilityResult } from '@infra/pluginManager/renderer';
import type { IPluginMetaAll } from '@appTypes/infra/pluginManager';
import { cn } from '@common/cn';
import { PluginItemCard } from './PluginItem';

const noAnimateLayoutChanges = () => false;
const COLLAPSED_GROUPS_KEY = 'plugin-group-collapsed:v1';

function readCollapsedGroups(): Set<string> {
    try {
        const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
        const ids: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(ids)) return new Set();
        return new Set(ids.filter((id): id is string => typeof id === 'string'));
    } catch {
        return new Set();
    }
}

function writeCollapsedGroup(id: string, collapsed: boolean): void {
    const ids = readCollapsedGroups();
    if (collapsed) ids.add(id);
    else ids.delete(id);
    try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...ids]));
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
    const version = group.plugins.find((plugin) => plugin.version)?.version;
    const [collapsed, setCollapsed] = useState(() => readCollapsedGroups().has(group.id));
    const toggleCollapsed = useCallback(() => {
        setCollapsed((current) => {
            const next = !current;
            writeCollapsedGroup(group.id, next);
            return next;
        });
    }, [group.id]);

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
                    <p className="p-plugin-manager__item-meta">
                        {author && <span>{author}</span>}
                        {author && <span> · </span>}
                        <span>{t('plugin.platform_count', { count: group.plugins.length })}</span>
                    </p>
                </div>
                <button
                    type="button"
                    className={cn('p-plugin-manager__group-toggle', collapsed && 'is-collapsed')}
                    aria-expanded={!collapsed}
                    aria-label={t(collapsed ? 'plugin.expand_sources' : 'plugin.collapse_sources')}
                    title={t(collapsed ? 'plugin.expand_sources' : 'plugin.collapse_sources')}
                    onClick={toggleCollapsed}
                >
                    <ChevronDown size={16} />
                </button>
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
