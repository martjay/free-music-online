import { useAtomValue } from 'jotai/react';
import { closeMobileNav, mobileNavOpenAtom } from '../MobileTabBar/mobileNavState';
import Sidebar from '../Sidebar';
import './index.scss';

export default function MobileNavDrawer() {
    const open = useAtomValue(mobileNavOpenAtom);

    return (
        <div className={`l-mobile-nav${open ? ' is-open' : ''}`}>
            <button
                className="l-mobile-nav__backdrop"
                type="button"
                aria-label="Close"
                onClick={closeMobileNav}
            />
            <div
                className="l-mobile-nav__panel"
                onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.closest('button, a')) {
                        window.setTimeout(closeMobileNav, 0);
                    }
                }}
            >
                <Sidebar />
            </div>
        </div>
    );
}
