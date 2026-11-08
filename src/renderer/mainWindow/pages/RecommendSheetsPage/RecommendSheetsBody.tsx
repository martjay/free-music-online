import { useState, useCallback, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { RequestStatus } from '@common/constant';
import { catalogPlatform, type MusicCatalogSource } from '@common/musicCatalog';
import { MediaGrid } from '../../components/ui/MediaGrid';
import { StatusPlaceholder } from '../../components/ui/StatusPlaceholder';
import {
    RECOMMEND_SHEETS_VIEW,
    readContentScroll,
    readListView,
    setContentScroll,
    writeListView,
} from '../../core/listViewMemory';
import { musicSheetRoute } from '../../routes';
import { TagFilter, DEFAULT_TAG } from './TagFilter';
import { useRecommendTags } from './useRecommendTags';
import { useRecommendSheets } from './useRecommendSheets';

interface RecommendSheetsBodyProps {
    source: MusicCatalogSource;
}

/**
 * RecommendSheetsBody — 一个音乐平台的推荐歌单
 *
 * 标签筛选栏 + MediaGrid 歌单卡片网格 + 分页加载
 */
export function RecommendSheetsBody({ source }: RecommendSheetsBodyProps) {
    const { t } = useTranslation();
    const platform = catalogPlatform(source);
    const { tags, status: tagsStatus } = useRecommendTags(platform);
    const [selectedTag, setSelectedTag] = useState<IMedia.IUnique>(() => {
        const saved = readListView(RECOMMEND_SHEETS_VIEW);
        return saved?.pluginHash === source && saved.tag ? saved.tag : DEFAULT_TAG;
    });
    const [selectedSort, setSelectedSort] = useState('');
    const sorts = tags?.sorts ?? [];
    const sortId = sorts.some((sort) => sort.id === selectedSort)
        ? selectedSort
        : (sorts[0]?.id ?? '');
    const navigate = useNavigate();
    const restoredRef = useRef(false);

    const { sheets, requestStatus, isEnd, loadMore, retry } = useRecommendSheets(
        platform,
        selectedTag,
        sortId,
    );

    useLayoutEffect(() => {
        if (restoredRef.current) return;
        if (tagsStatus === RequestStatus.Pending && !tags) return;
        if (sheets.length === 0) return;
        const saved = readListView(RECOMMEND_SHEETS_VIEW);
        if (!saved || saved.pluginHash !== source) return;
        restoredRef.current = true;
        setContentScroll(saved.scrollTop);
    }, [source, sheets.length, tags, tagsStatus]);

    const handleTagChange = useCallback(
        (tag: IMedia.IUnique) => {
            setSelectedTag(tag);
            writeListView(RECOMMEND_SHEETS_VIEW, { pluginHash: source, tag, scrollTop: 0 });
            setContentScroll(0);
        },
        [source],
    );

    const handleItemClick = useCallback(
        (item: IMusic.IMusicSheetItem) => {
            writeListView(RECOMMEND_SHEETS_VIEW, {
                pluginHash: source,
                tag: selectedTag,
                scrollTop: readContentScroll(),
            });
            navigate(musicSheetRoute(item.platform || platform, item.id), {
                state: { sheetItem: { ...item, platform: item.platform || platform } },
            });
        },
        [navigate, platform, source, selectedTag],
    );

    // 标签加载中
    if (tagsStatus === RequestStatus.Pending && !tags) {
        return <StatusPlaceholder status={RequestStatus.Pending} />;
    }

    return (
        <div className="p-recommend-sheets__body">
            <TagFilter
                tags={tags}
                selectedTag={selectedTag}
                onTagChange={handleTagChange}
                sorts={sorts}
                selectedSort={sortId}
                onSortChange={setSelectedSort}
            />

            <MediaGrid
                className="p-recommend-sheets__grid"
                data={sheets}
                requestStatus={requestStatus}
                onRetry={retry}
                onItemClick={handleItemClick}
                enableLoadMore={!isEnd && sheets.length > 0}
                loadMoreStatus={requestStatus}
                onLoadMore={loadMore}
                onLoadMoreRetry={retry}
                emptyTitle={t('playlist.recommend_empty')}
            />
        </div>
    );
}
