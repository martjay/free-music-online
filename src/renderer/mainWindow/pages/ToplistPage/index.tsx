/**
 * ToplistPage — 排行榜页
 *
 * 路由: /toplist
 *
 * 布局：
 *   标题  "排行榜"
 *   TabBar  支持 getTopLists 的插件列表
 *   Body    当前插件的分组榜单卡片网格
 *
 * 无可用插件时展示 PluginFeatureUnavailable。
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortedSupportedPlugins } from '@infra/pluginManager/renderer/hooks';
import { PluginFeatureUnavailable } from '../../components/business/PluginFeatureUnavailable';
import { PluginSourceNav } from '../../components/business/PluginSourceNav';
import {
    TOPLIST_VIEW,
    readListView,
    setContentScroll,
    writeListView,
} from '../../core/listViewMemory';
import { ToplistBody } from './ToplistBody';
import './index.scss';

export default function ToplistPage() {
    const { t } = useTranslation();
    const availablePlugins = useSortedSupportedPlugins('getTopLists');
    const [activeHash, setActiveHash] = useState(
        () => readListView(TOPLIST_VIEW)?.pluginHash ?? '',
    );

    // 确保 activeHash 有效
    const currentHash = useMemo(() => {
        if (activeHash && availablePlugins.some((p) => p.hash === activeHash)) {
            return activeHash;
        }
        if (availablePlugins.length === 0) return '';
        const saved = readListView(TOPLIST_VIEW)?.pluginHash;
        if (saved && availablePlugins.some((p) => p.hash === saved)) return saved;
        return availablePlugins[0]?.hash ?? '';
    }, [activeHash, availablePlugins]);

    useEffect(() => {
        if (!currentHash) return;
        const prev = readListView(TOPLIST_VIEW);
        if (prev?.pluginHash === currentHash) return;
        writeListView(TOPLIST_VIEW, { pluginHash: currentHash, scrollTop: 0 });
    }, [currentHash]);

    const currentPlugin = useMemo(
        () => availablePlugins.find((p) => p.hash === currentHash),
        [availablePlugins, currentHash],
    );

    const handleTabChange = useCallback(
        (key: string) => {
            if (key !== currentHash) {
                writeListView(TOPLIST_VIEW, { pluginHash: key, scrollTop: 0 });
                setContentScroll(0);
            }
            setActiveHash(key);
        },
        [currentHash],
    );

    // 无插件支持此功能
    if (availablePlugins.length === 0) {
        return (
            <div className="p-toplist">
                <PluginFeatureUnavailable featureName={t('toplist.title')} />
            </div>
        );
    }

    return (
        <div className="p-toplist">
            <div className="p-toplist__tabs">
                <PluginSourceNav
                    plugins={availablePlugins}
                    activeHash={currentHash}
                    onChange={handleTabChange}
                />
            </div>

            {currentPlugin && (
                <ToplistBody pluginHash={currentHash} pluginPlatform={currentPlugin.platform} />
            )}
        </div>
    );
}
