import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import { safeStringify } from '@common/safeSerialize';
import type { LibraryKind } from '@infra/library/types';
import { toggleLibraryEntry, useIsLibraryEntry } from '@infra/library/renderer';
import { Button } from '../../ui/Button';

interface CollectTarget {
    platform: string;
    id: string;
    title: string;
    artwork?: string | null;
    raw?: unknown;
}

export function CollectButton({
    kind,
    target,
    starLabel,
    unstarLabel,
}: {
    kind: LibraryKind;
    target: CollectTarget;
    starLabel?: string;
    unstarLabel?: string;
}) {
    const { t } = useTranslation();
    const collected = useIsLibraryEntry(kind, target.platform, target.id);
    const handleClick = useCallback(() => {
        if (!target.platform || !target.id) return;
        void toggleLibraryEntry({
            kind,
            platform: target.platform,
            id: String(target.id),
            title: target.title,
            artwork: target.artwork || null,
            raw: target.raw ? safeStringify(target.raw) : safeStringify(target),
        });
    }, [kind, target]);

    return (
        <Button
            className="always-enabled"
            variant="secondary"
            size="md"
            icon={
                <Heart
                    size={16}
                    color={collected ? 'var(--color-favorite)' : 'currentColor'}
                    fill={collected ? 'var(--color-favorite)' : 'none'}
                />
            }
            onClick={handleClick}
        >
            {collected ? (unstarLabel ?? t('playlist.unstar')) : (starLabel ?? t('playlist.star'))}
        </Button>
    );
}
