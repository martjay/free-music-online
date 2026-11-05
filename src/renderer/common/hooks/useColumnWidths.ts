import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react';

const MIN_COLUMN_WIDTH = 72;

function readWidths(storageKey: string): Record<string, number> {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') return {};
        const widths: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'number' && Number.isFinite(value)) widths[key] = value;
        }
        return widths;
    } catch {
        return {};
    }
}

/** 记住表格列宽。拖动时直接改 col 宽度，松开后再写入本地。 */
export function useColumnWidths(storageKey: string) {
    const [widths, setWidths] = useState<Record<string, number>>(() =>
        storageKey ? readWidths(storageKey) : {},
    );

    const onResizeStart = useCallback(
        (event: ReactMouseEvent, colId: string) => {
            event.preventDefault();
            event.stopPropagation();
            const col = (event.currentTarget as HTMLElement)
                .closest('table')
                ?.querySelector<HTMLElement>(`col[data-col="${colId}"]`);
            if (!col) return;

            const startX = event.clientX;
            const startWidth = col.getBoundingClientRect().width;

            const onMove = (ev: MouseEvent) => {
                const next = Math.max(
                    MIN_COLUMN_WIDTH,
                    Math.round(startWidth + ev.clientX - startX),
                );
                col.style.width = `${next}px`;
            };
            const onUp = (ev: MouseEvent) => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                const next = Math.max(
                    MIN_COLUMN_WIDTH,
                    Math.round(startWidth + ev.clientX - startX),
                );
                setWidths((prev) => {
                    const updated = { ...prev, [colId]: next };
                    if (!storageKey) return updated;
                    try {
                        localStorage.setItem(storageKey, JSON.stringify(updated));
                    } catch {
                        // 无痕模式或配额用尽时只保留本次会话
                    }
                    return updated;
                });
            };

            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        },
        [storageKey],
    );

    return { widths, onResizeStart };
}
