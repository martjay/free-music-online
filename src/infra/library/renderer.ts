import { atom, getDefaultStore } from 'jotai';
import { useAtomValue } from 'jotai/react';
import {
    LIBRARY_BRIDGE_KEY,
    type ILibraryBridge,
    type ILibraryEntry,
    type LibraryKind,
} from './types';

const store = getDefaultStore();
const libraryAtom = atom<ILibraryEntry[]>([]);

function bridge(): ILibraryBridge {
    return (window as unknown as Record<string, ILibraryBridge>)[LIBRARY_BRIDGE_KEY];
}

export async function setup(): Promise<void> {
    try {
        store.set(libraryAtom, await bridge().load());
    } catch (error) {
        console.error('[library] load failed:', error);
    }
}

export function useLibraryEntries(): ILibraryEntry[] {
    return useAtomValue(libraryAtom);
}

export function useIsLibraryEntry(kind: LibraryKind, platform: string, id: string): boolean {
    const entries = useAtomValue(libraryAtom);
    return entries.some(
        (entry) => entry.kind === kind && entry.platform === platform && entry.id === String(id),
    );
}

export async function mergeLibraryEntries(entries: ILibraryEntry[]): Promise<number> {
    const result = await bridge().merge(entries);
    store.set(libraryAtom, result.entries);
    return result.added;
}

export async function toggleLibraryEntry(entry: Omit<ILibraryEntry, 'starredAt'>): Promise<void> {
    const next = await bridge().toggle({
        ...entry,
        id: String(entry.id),
        title: entry.title || '',
        artwork: entry.artwork || null,
        raw: entry.raw || '{}',
    });
    store.set(libraryAtom, next);
}
