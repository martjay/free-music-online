// ============================================================================
// App — 应用根布局
// ============================================================================
//
// 布局结构:
//   ┌────────────┬──────────────────────────────────┐
//   │  Sidebar   │  TopBar (nav + search)  [winctrls]│
//   │  260px     ├──────────────────────────────────┤
//   │  全高       │  Content / <Outlet />            │
//   │            │  (flex-1, scrollable)            │
//   │            ├──────────────────────────────────┤
//   │            │  PlayerBar (72px, fixed 底部)     │
//   └────────────┴──────────────────────────────────┘
//   PlayerBar 从 sidebar 右侧开始，不覆盖 sidebar

import { Outlet, useLocation } from 'react-router';
import { cn } from '@common/cn';
import { isMobileApp } from '@common/runtimePlatform';
import { RoutePaths } from './routes';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import PlayerBar from './components/layout/PlayerBar';
import RadioPlayerBar from './components/layout/RadioPlayerBar';
import MobileTabBar from './components/layout/MobileTabBar';
import MobileNavDrawer from './components/layout/MobileNavDrawer';
import QueueDrawer from './components/layout/QueueDrawer';
import FullscreenPlayer from './components/layout/FullscreenPlayer';
import { ToastContainer } from './components/ui/Toast';
import { ModalContainer } from './components/ui/Modal/ModalContainer';
import { ContextMenuContainer } from './components/ui/ContextMenu/ContextMenuContainer';

// 注册业务弹窗 & 右键菜单模板
import './components/business/modals';
import './components/business/contextMenus';

import './App.scss';
import './mobileApp.scss';

export default function App() {
    const location = useLocation();
    const isRadioPage = location.pathname.split('/')[1] === RoutePaths.Radio;
    const mobile = isMobileApp();

    return (
        <div
            className={cn(
                'l-app-shell',
                mobile && 'l-app-shell--mobile',
                isRadioPage && !mobile && 'l-app-shell--immersive-radio',
                isRadioPage && mobile && 'l-app-shell--mobile-radio',
            )}
        >
            {mobile ? <MobileNavDrawer /> : <Sidebar />}
            <main className="l-app-shell__main">
                <TopBar />
                <div
                    className={cn(
                        'l-app-shell__content',
                        isRadioPage && 'l-app-shell__content--immersive',
                    )}
                >
                    <Outlet />
                </div>
            </main>
            {isRadioPage ? mobile ? <RadioPlayerBar /> : null : <PlayerBar />}
            {mobile ? <MobileTabBar /> : null}
            <QueueDrawer />
            <FullscreenPlayer />
            <ToastContainer />
            <ModalContainer />
            <ContextMenuContainer />
        </div>
    );
}
