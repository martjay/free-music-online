/**
 * 专辑、作者、排行榜收藏。
 * 存储：<userData>/anhe-player-data/library.json
 */

import type { ILibraryEntry } from '@infra/library/types';
import { JsonFileStore } from './jsonFile';
import { joinPath } from './pathUtils';
import { getUserDataDir } from './tauriFs';

interface ILibraryData {
    entries: ILibraryEntry[];
}

function sameEntry(left: ILibraryEntry, right: Pick<ILibraryEntry, 'kind' | 'platform' | 'id'>) {
    return left.kind === right.kind && left.platform === right.platform && left.id === right.id;
}

class LibraryStore {
    private file = new JsonFileStore<ILibraryData>(
        () => joinPath(getUserDataDir(), 'anhe-player-data/library.json'),
        () => ({ entries: [] }),
    );

    async load(): Promise<ILibraryEntry[]> {
        const data = await this.file.load();
        return [...data.entries].sort((a, b) => b.starredAt - a.starredAt);
    }

    async toggle(entry: Omit<ILibraryEntry, 'starredAt'>): Promise<ILibraryEntry[]> {
        const data = await this.file.load();
        const index = data.entries.findIndex((item) => sameEntry(item, entry));
        if (index >= 0) {
            data.entries.splice(index, 1);
        } else if (entry.platform && entry.id) {
            data.entries.unshift({ ...entry, starredAt: Date.now() });
        }
        this.file.scheduleSave();
        return [...data.entries].sort((a, b) => b.starredAt - a.starredAt);
    }

    /** 只补还没有的收藏，已经在库里的保持原样。 */
    async merge(entries: ILibraryEntry[]): Promise<{ entries: ILibraryEntry[]; added: number }> {
        const data = await this.file.load();
        let added = 0;
        for (const entry of entries) {
            if (!entry?.platform || !entry.id || !entry.kind) continue;
            if (entry.kind !== 'album' && entry.kind !== 'artist' && entry.kind !== 'chart')
                continue;
            const next = {
                kind: entry.kind,
                platform: entry.platform,
                id: String(entry.id),
                title: entry.title || '',
                artwork: entry.artwork || null,
                raw: entry.raw || '{}',
                starredAt: Number(entry.starredAt) || Date.now(),
            };
            if (data.entries.some((item) => sameEntry(item, next))) continue;
            data.entries.unshift(next);
            added += 1;
        }
        if (added > 0) this.file.scheduleSave();
        return {
            added,
            entries: [...data.entries].sort((a, b) => b.starredAt - a.starredAt),
        };
    }
}

export const libraryStore = new LibraryStore();
