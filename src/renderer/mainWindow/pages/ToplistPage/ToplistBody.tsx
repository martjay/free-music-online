import { useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import { safeStringify } from '@common/safeSerialize';
import { toggleLibraryEntry, useIsLibraryEntry } from '@infra/library/renderer';
import { RequestStatus } from '@common/constant';
import { catalogPlatform, type MusicCatalogSource } from '@common/musicCatalog';
import { Artwork } from '../../components/ui/Artwork';
import { StatusPlaceholder } from '../../components/ui/StatusPlaceholder';
import {
    TOPLIST_VIEW,
    readContentScroll,
    readListView,
    setContentScroll,
    writeListView,
} from '../../core/listViewMemory';
import { toplistDetailRoute } from '../../routes';
import { useTopLists } from './useTopLists';
import './index.scss';

interface ToplistBodyProps {
    source: MusicCatalogSource;
}

/**
 * ToplistBody — 一个音乐平台的排行榜卡片网格
 *
 * 按分组（IMusicSheetGroupItem）展示榜单卡片；
 * 卡片采用纵向布局：封面 + 标题 header + 预览占位文字。
 * 点击卡片跳转到排行榜详情页。
 */
export function ToplistBody({ source }: ToplistBodyProps) {
    const { t } = useTranslation();
    const platform = catalogPlatform(source);
    const { status, data, fetch, retry, syncFromCache } = useTopLists(platform);
    const navigate = useNavigate();
    const restoredRef = useRef(false);

    useEffect(() => {
        syncFromCache();
        fetch();
    }, [platform]);

    useLayoutEffect(() => {
        if (restoredRef.current || data.length === 0) return;
        const saved = readListView(TOPLIST_VIEW);
        if (!saved || saved.pluginHash !== source) return;
        restoredRef.current = true;
        setContentScroll(saved.scrollTop);
    }, [data.length, source]);

    const handleCardClick = useCallback(
        (item: IMusic.IMusicSheetItem) => {
            writeListView(TOPLIST_VIEW, { pluginHash: source, scrollTop: readContentScroll() });
            navigate(toplistDetailRoute(platform), {
                state: {
                    topListItem: {
                        ...item,
                        platform,
                    },
                },
            });
        },
        [navigate, platform, source],
    );

    // 加载中 / 错误 / 空态
    if (data.length === 0) {
        if (status === RequestStatus.Pending || status === RequestStatus.Idle) {
            return <StatusPlaceholder status={RequestStatus.Pending} />;
        }
        if (status === RequestStatus.Error) {
            return (
                <StatusPlaceholder
                    status={RequestStatus.Error}
                    errorTitle={t('toplist.load_error')}
                    onRetry={retry}
                />
            );
        }
        if (status === RequestStatus.Done) {
            return (
                <StatusPlaceholder
                    status={RequestStatus.Done}
                    isEmpty
                    emptyTitle={t('toplist.empty')}
                />
            );
        }
    }

    return (
        <div className="p-toplist__body">
            {data.map((group, groupIdx) => (
                <div className="p-toplist__group" key={groupIdx}>
                    {group.title && (
                        <h3 className="p-toplist__group-title" title={group.title}>
                            {group.title}
                        </h3>
                    )}
                    <div className="p-toplist__grid">
                        {(group.data ?? []).map((item) => (
                            <ToplistCard
                                key={item.id}
                                item={{ ...item, platform }}
                                onOpen={handleCardClick}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ToplistCard({
    item,
    onOpen,
}: {
    item: IMusic.IMusicSheetItem;
    onOpen: (item: IMusic.IMusicSheetItem) => void;
}) {
    return (
        <div className="p-toplist__card">
            <button type="button" className="p-toplist__card-open" onClick={() => onOpen(item)}>
                <div className="p-toplist__card-header">
                    <div className="p-toplist__card-cover">
                        <Artwork src={item.artwork} alt={item.title} size="sm" rounded="sm" />
                    </div>
                    <div className="p-toplist__card-title" title={item.title}>
                        {item.title}
                    </div>
                </div>
            </button>
            <ChartStar item={item} />
        </div>
    );
}

function ChartStar({ item }: { item: IMusic.IMusicSheetItem }) {
    const { t } = useTranslation();
    const collected = useIsLibraryEntry('chart', item.platform, String(item.id));
    return (
        <button
            type="button"
            className={`p-toplist__star${collected ? ' is-on' : ''}`}
            title={collected ? t('playlist.unstar') : t('playlist.star')}
            aria-label={collected ? t('playlist.unstar') : t('playlist.star')}
            onClick={() => {
                void toggleLibraryEntry({
                    kind: 'chart',
                    platform: item.platform,
                    id: String(item.id),
                    title: item.title,
                    artwork: item.artwork || null,
                    raw: safeStringify(item),
                });
            }}
        >
            <Heart size={15} fill={collected ? 'currentColor' : 'none'} />
        </button>
    );
}
