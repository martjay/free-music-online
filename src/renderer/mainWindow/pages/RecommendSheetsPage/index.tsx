/**
 * RecommendSheetsPage — 热门歌单页
 *
 * 路由: /recommend-sheets
 *
 * 布局：
 *   平台行  酷我 / 酷狗 / QQ / 网易云 / 咪咕，不看插件开关
 *   TagFilter  标签筛选栏（默认 + pinned + 下拉面板）
 *   MediaGrid  歌单卡片网格（支持分页加载）
 */

import { useState, useCallback } from 'react';
import {
    isMusicCatalogSource,
    MUSIC_CATALOG_SOURCES,
    type MusicCatalogSource,
} from '@common/musicCatalog';
import { CatalogSourceNav } from '../../components/business/CatalogSourceNav';
import {
    RECOMMEND_SHEETS_VIEW,
    readListView,
    setContentScroll,
    writeListView,
} from '../../core/listViewMemory';
import { DEFAULT_TAG } from './TagFilter';
import { RecommendSheetsBody } from './RecommendSheetsBody';
import './index.scss';

function rememberedSource(): MusicCatalogSource {
    const saved = readListView(RECOMMEND_SHEETS_VIEW)?.pluginHash ?? '';
    return isMusicCatalogSource(saved) ? saved : MUSIC_CATALOG_SOURCES[0];
}

export default function RecommendSheetsPage() {
    const [source, setSource] = useState(rememberedSource);

    const handleTabChange = useCallback(
        (next: MusicCatalogSource) => {
            if (next !== source) {
                writeListView(RECOMMEND_SHEETS_VIEW, {
                    pluginHash: next,
                    tag: DEFAULT_TAG,
                    scrollTop: 0,
                });
                setContentScroll(0);
            }
            setSource(next);
        },
        [source],
    );

    return (
        <div className="p-recommend-sheets">
            <div className="p-recommend-sheets__tabs">
                <CatalogSourceNav activeKey={source} onChange={handleTabChange} />
            </div>

            <RecommendSheetsBody key={source} source={source} />
        </div>
    );
}
