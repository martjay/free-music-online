export const LIBRARY_BRIDGE_KEY = 'library';

export type LibraryKind = 'album' | 'artist' | 'chart';

export interface ILibraryEntry {
    kind: LibraryKind;
    platform: string;
    id: string;
    title: string;
    artwork: string | null;
    raw: string;
    starredAt: number;
}

export interface ILibraryBridge {
    load(): Promise<ILibraryEntry[]>;
    toggle(entry: Omit<ILibraryEntry, 'starredAt'>): Promise<ILibraryEntry[]>;
    merge(entries: ILibraryEntry[]): Promise<{ entries: ILibraryEntry[]; added: number }>;
}
