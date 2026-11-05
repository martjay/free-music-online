/**
 * 记住列表页离开前的音源、筛选和滚动位置。
 * 页面跳到详情后会卸载，返回时用这份记忆恢复，而不是回到第一个源的顶部。
 */

export const RECOMMEND_SHEETS_VIEW = 'recommend-sheets';
export const TOPLIST_VIEW = 'toplist';

const CONTENT_SELECTOR = '.l-app-shell__content';

export interface ListViewMemory {
    pluginHash: string;
    tag?: IMedia.IUnique;
    scrollTop: number;
}

const views = new Map<string, ListViewMemory>();

export function readListView(key: string): ListViewMemory | undefined {
    return views.get(key);
}

export function writeListView(key: string, view: ListViewMemory): void {
    views.set(key, view);
}

function contentElement(): HTMLElement | null {
    const el = document.querySelector(CONTENT_SELECTOR);
    return el instanceof HTMLElement ? el : null;
}

export function readContentScroll(): number {
    return contentElement()?.scrollTop ?? 0;
}

export function setContentScroll(top: number): void {
    const el = contentElement();
    if (!el) return;
    el.scrollTop = Math.max(0, top);
}
