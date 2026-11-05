import { useState, useCallback, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { RequestStatus } from '@common/constant';
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
    pluginHash: string;
}

/**
 * RecommendSheetsBody — 单个插件的推荐歌单内容
 *
 * 标签筛选栏 + MediaGrid 歌单卡片网格 + 分页加载
 */
export function RecommendSheetsBody({ pluginHash }: RecommendSheetsBodyProps) {
    const { t } = useTranslation();
    const { tags, status: tagsStatus } = useRecommendTags(pluginHash);
    const [selectedTag, setSelectedTag] = useState<IMedia.IUnique>(() => {
        const saved = readListView(RECOMMEND_SHEETS_VIEW);
        return saved?.pluginHash === pluginHash && saved.tag ? saved.tag : DEFAULT_TAG;
    });
    const navigate = useNavigate();
    const restoredRef = useRef(false);

    const { sheets, requestStatus, isEnd, loadMore, retry } = useRecommendSheets(
        pluginHash,
        selectedTag,
    );

    useLayoutEffect(() => {
        if (restoredRef.current) return;
        if (tagsStatus === RequestStatus.Pending && !tags) return;
        if (sheets.length === 0) return;
        const saved = readListView(RECOMMEND_SHEETS_VIEW);
        if (!saved || saved.pluginHash !== pluginHash) return;
        restoredRef.current = true;
        setContentScroll(saved.scrollTop);
    }, [pluginHash, sheets.length, tags, tagsStatus]);

    const handleTagChange = useCallback(
        (tag: IMedia.IUnique) => {
            setSelectedTag(tag);
            writeListView(RECOMMEND_SHEETS_VIEW, { pluginHash, tag, scrollTop: 0 });
            setContentScroll(0);
        },
        [pluginHash],
    );

    const handleItemClick = useCallback(
        (item: IMusic.IMusicSheetItem) => {
            writeListView(RECOMMEND_SHEETS_VIEW, {
                pluginHash,
                tag: selectedTag,
                scrollTop: readContentScroll(),
            });
            navigate(musicSheetRoute(item.platform, item.id), {
                state: { sheetItem: item },
            });
        },
        [navigate, pluginHash, selectedTag],
    );

    // 标签加载中
    if (tagsStatus === RequestStatus.Pending && !tags) {
        return <StatusPlaceholder status={RequestStatus.Pending} />;
    }

    return (
        <div className="p-recommend-sheets__body">
            <TagFilter tags={tags} selectedTag={selectedTag} onTagChange={handleTagChange} />

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
