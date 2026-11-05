import { useCallback, useMemo } from 'react';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { Blocks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** 提取为模块常量，避免每次渲染创建新数组引用 */
const DND_MODIFIERS = [restrictToVerticalAxis];
import pluginManager from '@infra/pluginManager/renderer';
import {
    usePlugins,
    usePluginMeta,
    usePluginAvailability,
} from '@infra/pluginManager/renderer/hooks';
import { sortByPluginOrder } from '@infra/pluginManager/common/sortByOrder';
import {
    pluginGroupKey,
    pluginPlatformLabel,
    pluginScriptLabel,
} from '@infra/pluginManager/common/pluginIdentity';
import { StatusPlaceholder } from '@renderer/mainWindow/components/ui/StatusPlaceholder';
import { RequestStatus, LOCAL_PLUGIN_HASH } from '@common/constant';
import PluginItem from './PluginItem';
import PluginGroup, { type PluginGroupData } from './PluginGroup';

function buildGroups(plugins: IPlugin.IPluginDelegate[]): PluginGroupData[] {
    const groups: PluginGroupData[] = [];
    const indexByKey = new Map<string, number>();

    for (const plugin of plugins) {
        const key = pluginGroupKey(plugin);
        const existing = indexByKey.get(key);
        if (existing == null) {
            indexByKey.set(key, groups.length);
            groups.push({
                id: key,
                scriptName: plugin.scriptName?.trim() || plugin.platform,
                plugins: [plugin],
                platforms: [pluginPlatformLabel(plugin)],
            });
        } else {
            groups[existing].plugins.push(plugin);
            groups[existing].platforms.push(pluginPlatformLabel(plugin));
        }
    }

    return groups;
}

/** 多平台，或脚本名和平台名不同，才显示组标题 */
function isScriptGroup(group: PluginGroupData): boolean {
    if (group.plugins.length > 1) return true;
    return pluginScriptLabel(group.plugins[0]) != null;
}

/**
 * PluginList — 可拖拽排序的插件列表
 *
 * 同一脚本的多个平台收成一组。组的位置取组内最靠前的一项，
 * 拖动组标题时整组一起移动。
 */
export default function PluginList() {
    const { t } = useTranslation();
    const plugins = usePlugins();
    const meta = usePluginMeta();
    const availability = usePluginAvailability();

    const sortedPlugins = useMemo(() => {
        const filtered = plugins.filter((p) => p.hash !== LOCAL_PLUGIN_HASH);
        return sortByPluginOrder(filtered, meta);
    }, [plugins, meta]);

    const groups = useMemo(() => buildGroups(sortedPlugins), [sortedPlugins]);

    const sortableIds = useMemo(
        () => groups.map((group) => (isScriptGroup(group) ? group.id : group.plugins[0].hash)),
        [groups],
    );

    const sensors = useSensors(useSensor(PointerSensor));

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) return;

            const oldIndex = sortableIds.indexOf(String(active.id));
            const newIndex = sortableIds.indexOf(String(over.id));
            if (oldIndex === -1 || newIndex === -1) return;

            const reordered = arrayMove(groups, oldIndex, newIndex).flatMap(
                (group) => group.plugins,
            );
            const updates = reordered.map((plugin, index) => ({
                hash: plugin.hash,
                meta: { order: index },
            }));
            pluginManager.batchSetPluginMeta(updates);
        },
        [groups, sortableIds],
    );

    const handleToggleEnabled = useCallback((hash: string, enabled: boolean) => {
        pluginManager.setPluginMeta(hash, { enabled });
    }, []);

    if (sortedPlugins.length === 0) {
        return (
            <StatusPlaceholder
                status={RequestStatus.Done}
                isEmpty
                emptyIcon={Blocks}
                emptyTitle={t('plugin.info_hint_you_have_no_plugin')}
            />
        );
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={DND_MODIFIERS}
            onDragEnd={handleDragEnd}
        >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <div className="p-plugin-manager__list">
                    {groups.map((group) =>
                        isScriptGroup(group) ? (
                            <PluginGroup
                                key={group.id}
                                group={group}
                                meta={meta}
                                availability={availability}
                                onToggleEnabled={handleToggleEnabled}
                            />
                        ) : (
                            <PluginItem
                                key={group.plugins[0].hash}
                                plugin={group.plugins[0]}
                                enabled={meta[group.plugins[0].hash]?.enabled !== false}
                                availability={availability[group.plugins[0].hash]}
                                sourceRedirectPlatform={
                                    meta[group.plugins[0].hash]?.sourceRedirectPlatform ?? null
                                }
                                groupPlatforms={group.platforms}
                                onToggleEnabled={handleToggleEnabled}
                            />
                        ),
                    )}
                </div>
            </SortableContext>
        </DndContext>
    );
}
