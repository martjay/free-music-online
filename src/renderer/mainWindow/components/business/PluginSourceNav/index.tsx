import { useMemo } from 'react';
import { pluginGroupKey, pluginPlatformLabel } from '@infra/pluginManager/common/pluginIdentity';
import { TabBar } from '../../ui/TabBar';
import './index.scss';

interface PluginSourceNavProps {
    plugins: IPlugin.IPluginDelegate[];
    activeHash: string;
    onChange: (hash: string) => void;
}

interface SourceGroup {
    id: string;
    label: string;
    plugins: IPlugin.IPluginDelegate[];
}

function buildSourceGroups(plugins: IPlugin.IPluginDelegate[]): SourceGroup[] {
    const groups: SourceGroup[] = [];
    const indexByKey = new Map<string, number>();

    for (const plugin of plugins) {
        const id = pluginGroupKey(plugin);
        const existing = indexByKey.get(id);
        if (existing == null) {
            indexByKey.set(id, groups.length);
            groups.push({
                id,
                label: plugin.scriptName?.trim() || pluginPlatformLabel(plugin),
                plugins: [plugin],
            });
        } else {
            groups[existing].plugins.push(plugin);
        }
    }

    return groups;
}

/**
 * 先选插件，再选这个插件里已开启的平台。
 * 两行都按内容宽度排列，放不下时横向滚动。
 */
export function PluginSourceNav({ plugins, activeHash, onChange }: PluginSourceNavProps) {
    const groups = useMemo(() => buildSourceGroups(plugins), [plugins]);
    const activeGroup =
        groups.find((group) => group.plugins.some((plugin) => plugin.hash === activeHash)) ??
        groups[0];

    const scriptItems = useMemo(
        () => groups.map((group) => ({ key: group.id, label: group.label })),
        [groups],
    );
    const platformItems = useMemo(
        () =>
            (activeGroup?.plugins ?? []).map((plugin) => ({
                key: plugin.hash,
                label: pluginPlatformLabel(plugin),
            })),
        [activeGroup],
    );

    const handleScriptChange = (scriptId: string) => {
        const group = groups.find((item) => item.id === scriptId);
        if (!group || group.plugins.some((plugin) => plugin.hash === activeHash)) return;
        onChange(group.plugins[0].hash);
    };

    if (!activeGroup) return null;

    return (
        <div className="plugin-source-nav">
            <TabBar
                mode="scroll"
                items={scriptItems}
                activeKey={activeGroup.id}
                onChange={handleScriptChange}
            />
            <TabBar
                mode="scroll"
                className="plugin-source-nav__platforms"
                items={platformItems}
                activeKey={activeHash}
                onChange={onChange}
            />
        </div>
    );
}
