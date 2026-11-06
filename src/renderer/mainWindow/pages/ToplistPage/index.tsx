/**
 * ToplistPage — 排行榜页
 *
 * 路由: /toplist
 *
 * 布局：
 *   官方榜  固定在最前面，不依赖插件
 *   TabBar  支持 getTopLists 的插件列表
 *   Body    当前插件的分组榜单卡片网格
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useSortedSupportedPlugins } from '@infra/pluginManager/renderer/hooks';
import { PluginSourceNav } from '../../components/business/PluginSourceNav';
import {
    TOPLIST_VIEW,
    readListView,
    setContentScroll,
    writeListView,
} from '../../core/listViewMemory';
import { toplistDetailRoute } from '../../routes';
import { ToplistBody } from './ToplistBody';
import { OFFICIAL_CHARTS, OFFICIAL_CHART_PLATFORM } from './officialCharts';
import './index.scss';

export default function ToplistPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
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

    const openOfficialChart = useCallback(
        (chartId: string, title: string) => {
            navigate(toplistDetailRoute(OFFICIAL_CHART_PLATFORM), {
                state: {
                    openedAt: Date.now(),
                    topListItem: {
                        id: chartId,
                        title,
                        platform: OFFICIAL_CHART_PLATFORM,
                    },
                },
            });
        },
        [navigate],
    );

    const officialCharts = (
        <div className="p-toplist__official">
            <h3 className="p-toplist__group-title">{t('toplist.official')}</h3>
            <div className="p-toplist__grid">
                {OFFICIAL_CHARTS.map((chart) => {
                    const title = t(chart.titleKey);
                    return (
                        <button
                            type="button"
                            key={chart.id}
                            className="p-toplist__card"
                            onClick={() => openOfficialChart(chart.id, title)}
                        >
                            <div className="p-toplist__card-header">
                                <div className="p-toplist__card-title" title={title}>
                                    {title}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    // 官方榜不依赖插件。插件榜只在有音源实现 getTopLists 时出现。
    if (availablePlugins.length === 0) {
        return <div className="p-toplist">{officialCharts}</div>;
    }

    return (
        <div className="p-toplist">
            {officialCharts}
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
