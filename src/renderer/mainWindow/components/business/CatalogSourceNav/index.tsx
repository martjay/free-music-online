import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MUSIC_CATALOG_SOURCES, type MusicCatalogSource } from '@common/musicCatalog';
import { TabBar } from '../../ui/TabBar';

interface CatalogSourceNavProps {
    activeKey: string;
    onChange: (source: MusicCatalogSource) => void;
}

/** 排行榜和歌单的平台行。五个平台固定都在，不看插件开关。 */
export function CatalogSourceNav({ activeKey, onChange }: CatalogSourceNavProps) {
    const { t } = useTranslation();
    const items = useMemo(
        () =>
            MUSIC_CATALOG_SOURCES.map((source) => ({
                key: source,
                label: t(`catalog.${source}`),
            })),
        [t],
    );

    return (
        <TabBar
            mode="scroll"
            items={items}
            activeKey={activeKey}
            onChange={(key) => {
                if (key === 'kw' || key === 'kg' || key === 'tx' || key === 'wy' || key === 'mg') {
                    onChange(key);
                }
            }}
        />
    );
}
