/**
 * ToplistPage — 排行榜页
 *
 * 路由: /toplist
 *
 * 布局：
 *   平台行  酷我 / 酷狗 / QQ / 网易云 / 咪咕
 *   Body    当前平台的榜单卡片
 */

import { useState, useCallback } from 'react';
import {
    isMusicCatalogSource,
    MUSIC_CATALOG_SOURCES,
    type MusicCatalogSource,
} from '@common/musicCatalog';
import { CatalogSourceNav } from '../../components/business/CatalogSourceNav';
import {
    TOPLIST_VIEW,
    readListView,
    setContentScroll,
    writeListView,
} from '../../core/listViewMemory';
import { ToplistBody } from './ToplistBody';
import './index.scss';

function rememberedSource(): MusicCatalogSource {
    const saved = readListView(TOPLIST_VIEW)?.pluginHash ?? '';
    return isMusicCatalogSource(saved) ? saved : MUSIC_CATALOG_SOURCES[0];
}

export default function ToplistPage() {
    const [source, setSource] = useState(rememberedSource);

    const handleTabChange = useCallback(
        (next: MusicCatalogSource) => {
            if (next !== source) {
                writeListView(TOPLIST_VIEW, { pluginHash: next, scrollTop: 0 });
                setContentScroll(0);
            }
            setSource(next);
        },
        [source],
    );

    return (
        <div className="p-toplist">
            <div className="p-toplist__tabs">
                <CatalogSourceNav activeKey={source} onChange={handleTabChange} />
            </div>
            <ToplistBody key={source} source={source} />
        </div>
    );
}
