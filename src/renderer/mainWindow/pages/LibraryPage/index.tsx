import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Heart, ListMusic, User } from 'lucide-react';
import { RequestStatus } from '@common/constant';
import { safeParse } from '@common/safeSerialize';
import { shortPlatformName } from '@infra/pluginManager/common/pluginIdentity';
import { useLibraryEntries, toggleLibraryEntry } from '@infra/library/renderer';
import type { ILibraryEntry, LibraryKind } from '@infra/library/types';
import musicSheet, { useStarredSheets } from '@infra/musicSheet/renderer';
import type { IStarredSheetItem } from '@appTypes/infra/musicSheet';
import { Artwork } from '../../components/ui/Artwork';
import { TabBar } from '../../components/ui/TabBar';
import { StatusPlaceholder } from '../../components/ui/StatusPlaceholder';
import { albumRoute, artistRoute, musicSheetRoute, toplistDetailRoute } from '../../routes';
import './index.scss';

type LibraryFilter = 'sheet' | LibraryKind;

interface LibraryCard {
    key: string;
    kind: LibraryFilter;
    title: string;
    artwork: string;
    platform: string;
    round: boolean;
    open: () => void;
    remove: () => void;
}

export default function LibraryPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const starredSheets = useStarredSheets();
    const entries = useLibraryEntries();
    const [filter, setFilter] = useState<LibraryFilter>('sheet');

    const cards = useMemo(() => {
        const sheets: LibraryCard[] = starredSheets.map((item) => ({
            key: `sheet\0${item.platform}\0${item.id}`,
            kind: 'sheet',
            title: item.title || t('playlist.empty_title'),
            artwork: item.artwork || '',
            platform: item.platform,
            round: false,
            open: () => openStarredSheet(navigate, item),
            remove: () => {
                void musicSheet.unstarMusicSheet({ platform: item.platform, id: item.id });
            },
        }));
        const collected: LibraryCard[] = entries.map((entry) => ({
            key: `${entry.kind}\0${entry.platform}\0${entry.id}`,
            kind: entry.kind,
            title: entry.title,
            artwork: entry.artwork || '',
            platform: entry.platform,
            round: entry.kind === 'artist',
            open: () => openLibraryEntry(navigate, entry),
            remove: () => {
                void toggleLibraryEntry(entry);
            },
        }));
        return [...sheets, ...collected].filter((card) => card.kind === filter);
    }, [entries, filter, navigate, starredSheets, t]);

    const tabs = [
        { key: 'sheet', label: t('media.type_sheet') },
        { key: 'album', label: t('media.type_album') },
        { key: 'artist', label: t('media.type_artist') },
        { key: 'chart', label: t('toplist.title') },
    ];

    return (
        <div className="p-library">
            <div className="p-library__head">
                <h2 className="p-library__title">{t('playlist.library')}</h2>
                <span className="p-library__count">
                    {t('playlist.library_count', { count: cards.length })}
                </span>
            </div>
            <TabBar
                items={tabs}
                activeKey={filter}
                onChange={(key) => setFilter(key as LibraryFilter)}
            />
            {cards.length === 0 ? (
                <StatusPlaceholder
                    status={RequestStatus.Done}
                    isEmpty
                    emptyTitle={t('playlist.library_empty')}
                />
            ) : (
                <div className="p-library__grid">
                    {cards.map((card) => (
                        <article className="p-library__card" key={card.key}>
                            <button type="button" className="p-library__open" onClick={card.open}>
                                <Artwork
                                    className={card.round ? 'p-library__avatar' : undefined}
                                    src={card.artwork}
                                    alt={card.title}
                                    size="auto"
                                    rounded={card.round ? 'lg' : 'md'}
                                    fallback={
                                        card.round ? <User size={28} /> : <ListMusic size={28} />
                                    }
                                />
                                <span className="p-library__name" title={card.title}>
                                    {card.title}
                                </span>
                                <span className="p-library__meta">
                                    {shortPlatformName(card.platform) || card.platform}
                                </span>
                            </button>
                            <button
                                type="button"
                                className="p-library__unstar"
                                title={t('playlist.unstar')}
                                aria-label={t('playlist.unstar')}
                                onClick={card.remove}
                            >
                                <Heart size={15} fill="currentColor" />
                            </button>
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}

function openStarredSheet(navigate: ReturnType<typeof useNavigate>, item: IStarredSheetItem) {
    const sheetItem = safeParse<IMusic.IMusicSheetItem>(item.raw) ?? {
        platform: item.platform,
        id: item.id,
        title: item.title ?? '',
        artwork: item.artwork ?? undefined,
    };
    navigate(musicSheetRoute(item.platform, item.id), { state: { sheetItem } });
}

function openLibraryEntry(navigate: ReturnType<typeof useNavigate>, entry: ILibraryEntry) {
    if (entry.kind === 'album') {
        const albumItem = safeParse<IAlbum.IAlbumItem>(entry.raw) ?? {
            platform: entry.platform,
            id: entry.id,
            title: entry.title,
            artwork: entry.artwork ?? undefined,
        };
        navigate(albumRoute(entry.platform, entry.id), { state: { albumItem } });
        return;
    }
    if (entry.kind === 'artist') {
        const artistItem = safeParse<IArtist.IArtistItem>(entry.raw) ?? {
            platform: entry.platform,
            id: entry.id,
            name: entry.title,
            avatar: entry.artwork ?? '',
        };
        navigate(artistRoute(entry.platform, entry.id), { state: { artistItem } });
        return;
    }
    const topListItem = safeParse<IMusic.IMusicSheetItem>(entry.raw) ?? {
        platform: entry.platform,
        id: entry.id,
        title: entry.title,
        artwork: entry.artwork ?? undefined,
    };
    navigate(toplistDetailRoute(entry.platform), { state: { topListItem } });
}
