import { atom, getDefaultStore } from 'jotai';

export const mobileNavOpenAtom = atom(false);

const store = getDefaultStore();

export function openMobileNav(): void {
    store.set(mobileNavOpenAtom, true);
}

export function closeMobileNav(): void {
    store.set(mobileNavOpenAtom, false);
}

export function toggleMobileNav(): void {
    store.set(mobileNavOpenAtom, (open) => !open);
}
