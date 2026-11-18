import { Flame, Trophy, Podcast, UserRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { useAtomValue } from 'jotai/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@common/cn';
import { RoutePaths } from '../../../routes';
import { closeMobileNav, mobileNavOpenAtom, toggleMobileNav } from './mobileNavState';
import './index.scss';

const DISCOVER_ROUTES = new Set<string>([
    RoutePaths.RecommendSheets,
    RoutePaths.NeteaseRecommend,
    RoutePaths.Search,
]);

export default function MobileTabBar() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const navOpen = useAtomValue(mobileNavOpenAtom);
    const segment = location.pathname.split('/')[1] ?? '';
    const onCharts = segment === RoutePaths.Toplist || segment === RoutePaths.ToplistDetail;
    const onRadio = segment === RoutePaths.Radio;
    const onDiscover = DISCOVER_ROUTES.has(segment);

    const go = (route: string) => {
        closeMobileNav();
        navigate(`/${route}`);
    };

    return (
        <nav className="l-mobile-tabbar" aria-label={t('app.nav_main')}>
            <TabButton
                icon={Flame}
                label={t('app.mobile_tab_discover')}
                active={onDiscover}
                onClick={() => go(RoutePaths.RecommendSheets)}
            />
            <TabButton
                icon={Trophy}
                label={t('app.mobile_tab_charts')}
                active={onCharts}
                onClick={() => go(RoutePaths.Toplist)}
            />
            <TabButton
                icon={Podcast}
                label={t('radio.title')}
                active={onRadio}
                onClick={() => go(RoutePaths.Radio)}
            />
            <TabButton
                icon={UserRound}
                label={t('app.mobile_tab_library')}
                active={navOpen || (!onDiscover && !onCharts && !onRadio)}
                onClick={toggleMobileNav}
            />
        </nav>
    );
}

function TabButton({
    icon: Icon,
    label,
    active,
    onClick,
}: {
    icon: typeof Flame;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            className={cn('l-mobile-tabbar__item', active && 'is-active')}
            type="button"
            onClick={onClick}
        >
            <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
            <span>{label}</span>
        </button>
    );
}
