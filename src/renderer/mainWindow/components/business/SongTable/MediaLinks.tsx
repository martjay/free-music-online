import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { albumRoute, artistRoute } from '../../../routes';
import {
    musicForMediaLink,
    resolveCatalogAlbum,
    resolveCatalogArtist,
    splitArtistNames,
} from '../../../core/mediaLink';
import { showToast } from '../../ui/Toast';

function canOpen(item: IMusic.IMusicItemBase) {
    return !!item.platform && item.platform !== 'local';
}

function stopRow(event: MouseEvent) {
    event.stopPropagation();
}

export function ArtistLinks({ item }: { item: IMusic.IMusicItemBase }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const names = splitArtistNames(item.artist ?? '');
    if (!canOpen(item) || names.length === 0) return <>{item.artist}</>;

    return names.map((name, index) => (
        <span key={`${name}\0${index}`}>
            {index > 0 && <span className="song-table__name-sep"> / </span>}
            <button
                type="button"
                className="song-table__name-link"
                onClick={(event) => {
                    stopRow(event);
                    void musicForMediaLink(item)
                        .then((linked) =>
                            resolveCatalogArtist({
                                platform: linked.platform,
                                artist: name,
                                artistId: linked.artistId,
                                raw: linked.raw,
                                artistIndex: index,
                                artistCount: names.length,
                            }),
                        )
                        .then((artist) => {
                            if (!artist?.id) {
                                showToast(t('media.artist_link_missing'));
                                return;
                            }
                            navigate(artistRoute(item.platform, artist.id), {
                                state: { artistItem: { ...artist, name: artist.name || name } },
                            });
                        });
                }}
                onDoubleClick={stopRow}
            >
                {name}
            </button>
        </span>
    ));
}

export function AlbumLink({ item }: { item: IMusic.IMusicItemBase }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    if (!item.album) return null;
    if (!canOpen(item)) return <>{item.album}</>;

    return (
        <button
            type="button"
            className="song-table__name-link"
            onClick={(event) => {
                stopRow(event);
                void musicForMediaLink(item)
                    .then((linked) =>
                        resolveCatalogAlbum({
                            platform: linked.platform,
                            artist: linked.artist,
                            album: linked.album ?? '',
                            artwork: linked.artwork,
                            albumId: linked.albumId,
                            raw: linked.raw,
                        }),
                    )
                    .then((album) => {
                        if (!album?.id) {
                            showToast(t('media.album_link_missing'));
                            return;
                        }
                        navigate(albumRoute(item.platform, album.id), {
                            state: { albumItem: album },
                        });
                    });
            }}
            onDoubleClick={stopRow}
        >
            {item.album}
        </button>
    );
}
