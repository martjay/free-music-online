import type { ReactNode } from 'react';
import { cn } from '@common/cn';

interface SettingRowProps {
    /** 设置项标签 */
    label: string;
    /** 设置项描述 */
    description?: string;
    /** 右侧控件 */
    control: ReactNode;
    /** 仅桌面有意义的项（窗口关闭、桌面歌词等），手机端不渲染 */
    desktopOnly?: boolean;
}

/**
 * SettingRow — 设置项单行
 *
 * 设计稿: grid-cols-[220px_1fr] gap-6, 左侧文本 + 右侧控件。
 */
export function SettingRow({ label, description, control, desktopOnly = false }: SettingRowProps) {
    return (
        <div className={cn('p-setting__row', desktopOnly && 'p-setting__row--desktop-only')}>
            <div>
                <div className="p-setting__row-label">{label}</div>
                {description && <div className="p-setting__row-desc">{description}</div>}
            </div>
            <div className="p-setting__row-control">{control}</div>
        </div>
    );
}
