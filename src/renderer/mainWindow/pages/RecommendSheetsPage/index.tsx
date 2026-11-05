/**
 * RecommendSheetsPage — 热门歌单页
 *
 * 路由: /recommend-sheets
 *
 * 布局：
 *   标题  "热门歌单"
 *   TabBar  支持 getRecommendSheetsByTag 的插件列表
 *   TagFilter  标签筛选栏（默认 + pinned + 下拉面板）
 *   MediaGrid  歌单卡片网格（支持分页加载）
 *
 * 无可用插件时展示 PluginFeatureUnavailable。
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortedSupportedPlugins } from '@infra/pluginManager/renderer/hooks';
import { PluginFeatureUnavailable } from '../../components/business/PluginFeatureUnavailable';
import { PluginSourceNav } from '../../components/business/PluginSourceNav';
import {
    RECOMMEND_SHEETS_VIEW,
    readListView,
    setContentScroll,
    writeListView,
} from '../../core/listViewMemory';
import { DEFAULT_TAG } from './TagFilter';
import { RecommendSheetsBody } from './RecommendSheetsBody';
import './index.scss';

export default function RecommendSheetsPage() {
    const { t } = useTranslation();
    const availablePlugins = useSortedSupportedPlugins('getRecommendSheetsByTag');
    const [activeHash, setActiveHash] = useState(
        () => readListView(RECOMMEND_SHEETS_VIEW)?.pluginHash ?? '',
    );

    const currentHash = useMemo(() => {
        if (activeHash && availablePlugins.some((p) => p.hash === activeHash)) {
            return activeHash;
        }
        if (availablePlugins.length === 0) return '';
        const saved = readListView(RECOMMEND_SHEETS_VIEW)?.pluginHash;
        if (saved && availablePlugins.some((p) => p.hash === saved)) return saved;
        return availablePlugins[0]?.hash ?? '';
    }, [activeHash, availablePlugins]);

    useEffect(() => {
        if (!currentHash) return;
        const prev = readListView(RECOMMEND_SHEETS_VIEW);
        if (prev?.pluginHash === currentHash) return;
        writeListView(RECOMMEND_SHEETS_VIEW, {
            pluginHash: currentHash,
            tag: DEFAULT_TAG,
            scrollTop: 0,
        });
    }, [currentHash]);

    const handleTabChange = useCallback(
        (key: string) => {
            if (key !== currentHash) {
                writeListView(RECOMMEND_SHEETS_VIEW, {
                    pluginHash: key,
                    tag: DEFAULT_TAG,
                    scrollTop: 0,
                });
                setContentScroll(0);
            }
            setActiveHash(key);
        },
        [currentHash],
    );

    // 无插件支持此功能
    if (availablePlugins.length === 0) {
        return (
            <div className="p-recommend-sheets">
                <PluginFeatureUnavailable featureName={t('playlist.recommend')} />
            </div>
        );
    }

    return (
        <div className="p-recommend-sheets">
            <div className="p-recommend-sheets__tabs">
                <PluginSourceNav
                    plugins={availablePlugins}
                    activeHash={currentHash}
                    onChange={handleTabChange}
                />
            </div>

            <RecommendSheetsBody key={currentHash} pluginHash={currentHash} />
        </div>
    );
}
