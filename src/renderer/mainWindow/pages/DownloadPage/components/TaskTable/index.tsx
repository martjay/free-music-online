import { memo, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { RequestStatus } from '@common/constant';
import formatFileSize from '@common/formatFileSize';
import { useColumnWidths } from '@renderer/common/hooks/useColumnWidths';
import { StatusPlaceholder } from '../../../../components/ui/StatusPlaceholder';
import { showToast } from '../../../../components/ui/Toast';
import { showContextMenu } from '../../../../components/ui/ContextMenu/contextMenuManager';
import { DownloadProgressCell } from '../DownloadProgressCell';
import { TaskActions } from '../TaskActions';
import type { IDownloadTask } from '@appTypes/infra/downloadManager';
import './index.scss';

const QUEUE_LAYOUT_KEY = 'download-queue-columns:v1';

function CopyCell({ text, children }: { text: string; children?: ReactNode }) {
    const { t } = useTranslation();
    const timerRef = useRef<number | null>(null);
    const value = text.trim();
    if (!value) return children ?? text;

    return (
        <span
            className="p-download__copy"
            title={value}
            onClick={(event) => {
                event.stopPropagation();
                if (timerRef.current != null) window.clearTimeout(timerRef.current);
                timerRef.current = window.setTimeout(() => {
                    timerRef.current = null;
                    void navigator.clipboard.writeText(value).then(
                        () => showToast(t('common.copied')),
                        () => showToast(t('common.copied')),
                    );
                }, 220);
            }}
            onDoubleClick={() => {
                if (timerRef.current != null) {
                    window.clearTimeout(timerRef.current);
                    timerRef.current = null;
                }
            }}
        >
            {children ?? value}
        </span>
    );
}

// ─── 子组件：任务行 ───

const TaskRow = memo(function TaskRow({ task }: { task: IDownloadTask }) {
    const { t } = useTranslation();
    const isActive = task.status === 'downloading' || task.status === 'paused';
    const errorText = task.status === 'error' ? task.error || t('download.failed') : '';

    const handleContextMenu = (event: ReactMouseEvent) => {
        event.preventDefault();
        showContextMenu(
            'MusicItemMenu',
            { x: event.clientX, y: event.clientY },
            {
                musicItems: [
                    {
                        platform: task.platform,
                        id: task.musicId,
                        title: task.title,
                        artist: task.artist,
                        album: task.album,
                    } as IMusic.IMusicItem,
                ],
            },
        );
    };

    return (
        <tr className="p-download__row" onContextMenu={handleContextMenu}>
            <td className="p-download__cell p-download__cell--title">
                <div className="p-download__title-wrapper">
                    <CopyCell text={task.title}>
                        <span className="p-download__song-title">{task.title}</span>
                    </CopyCell>
                </div>
            </td>
            <td className="p-download__cell p-download__cell--artist">
                <CopyCell text={task.artist} />
            </td>
            <td className="p-download__cell p-download__cell--album">
                <CopyCell text={task.album} />
            </td>
            <td className="p-download__cell p-download__cell--size">
                {task.totalBytes > 0 ? formatFileSize(task.totalBytes) : '-'}
            </td>
            <td className="p-download__cell p-download__cell--status">
                {isActive ? (
                    <DownloadProgressCell task={task} />
                ) : task.status === 'pending' ? (
                    <span className="p-download__status-text p-download__status-text--pending">
                        {t('download.waiting')}
                    </span>
                ) : task.status === 'error' ? (
                    <span className="p-download__status-text p-download__status-text--error">
                        <CopyCell text={errorText} />
                    </span>
                ) : null}
            </td>
            <td className="p-download__cell p-download__cell--actions">
                <TaskActions task={task} />
            </td>
        </tr>
    );
});

// ─── 主组件：任务表格 ───

interface TaskTableProps {
    /** 任务列表 */
    tasks: IDownloadTask[];
}

/**
 * TaskTable — 下载队列表格
 *
 * 混合展示所有未完成任务（pending/downloading/paused/error）。
 */
export function TaskTable({ tasks }: TaskTableProps) {
    const { t } = useTranslation();
    const { widths, onResizeStart } = useColumnWidths(QUEUE_LAYOUT_KEY);

    const colWidth = (id: string, fallback: string) =>
        widths[id] != null ? `${widths[id]}px` : fallback;

    if (tasks.length === 0) {
        return (
            <StatusPlaceholder
                status={RequestStatus.Done}
                isEmpty
                emptyIcon={Download}
                emptyTitle={t('download.empty_queue')}
            />
        );
    }

    return (
        <table className="p-download__table">
            <colgroup>
                <col data-col="title" style={{ width: colWidth('title', '22%') }} />
                <col data-col="artist" style={{ width: colWidth('artist', '16%') }} />
                <col data-col="album" style={{ width: colWidth('album', '28%') }} />
                <col data-col="size" style={{ width: colWidth('size', '96px') }} />
                <col data-col="status" style={{ width: colWidth('status', '22%') }} />
                <col data-col="actions" style={{ width: '100px' }} />
            </colgroup>
            <thead>
                <tr className="p-download__header-row">
                    <th className="p-download__header-cell">
                        {t('download.col_title')}
                        <span
                            className="p-download__resize"
                            onMouseDown={(event) => onResizeStart(event, 'title')}
                        />
                    </th>
                    <th className="p-download__header-cell">
                        {t('download.col_artist')}
                        <span
                            className="p-download__resize"
                            onMouseDown={(event) => onResizeStart(event, 'artist')}
                        />
                    </th>
                    <th className="p-download__header-cell">
                        {t('download.col_album')}
                        <span
                            className="p-download__resize"
                            onMouseDown={(event) => onResizeStart(event, 'album')}
                        />
                    </th>
                    <th className="p-download__header-cell">
                        {t('download.col_size')}
                        <span
                            className="p-download__resize"
                            onMouseDown={(event) => onResizeStart(event, 'size')}
                        />
                    </th>
                    <th className="p-download__header-cell">
                        {t('download.col_status')}
                        <span
                            className="p-download__resize"
                            onMouseDown={(event) => onResizeStart(event, 'status')}
                        />
                    </th>
                    <th className="p-download__header-cell p-download__header-cell--actions">
                        {t('download.col_actions')}
                    </th>
                </tr>
            </thead>
            <tbody>
                {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} />
                ))}
            </tbody>
        </table>
    );
}
