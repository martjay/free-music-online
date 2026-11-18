import { forwardRef, useCallback, useRef, type HTMLAttributes, type PointerEvent } from 'react';
import { cn } from '@common/cn';
import './index.scss';

export type ProgressBarVariant = 'slim' | 'thick' | 'labeled';

export interface ProgressBarProps extends Omit<
    HTMLAttributes<HTMLDivElement>,
    'onChange' | 'onDragStart' | 'onDragEnd'
> {
    /** 进度值 0–100 */
    value?: number;
    /** 缓冲进度 0–100（仅 slim 变体可见） */
    buffered?: number;
    /** 变体 */
    variant?: ProgressBarVariant;
    /** 是否可交互（拖拽/点击） */
    interactive?: boolean;
    /** 进度变化回调，值 0–100 */
    onChange?: (value: number) => void;
    /** 拖拽开始 */
    onDragStart?: () => void;
    /** 拖拽结束 */
    onDragEnd?: (value: number) => void;
}

/**
 * ProgressBar — 原子组件
 *
 * 三种变体：
 *   - `slim`    — 纤细轨道 3px → hover 5px，有 thumb，支持缓冲条
 *   - `thick`   — 粗轨道 6px，无 thumb，无 hover 效果
 *   - `labeled` — 中等轨道 4px，无 thumb，附带百分比文字
 */
const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
    (
        {
            value = 0,
            buffered = 0,
            variant = 'slim',
            interactive = true,
            onChange,
            onDragStart,
            onDragEnd,
            className,
            ...rest
        },
        ref,
    ) => {
        const trackRef = useRef<HTMLDivElement>(null);
        const draggingRef = useRef(false);

        const clamp = (v: number) => Math.max(0, Math.min(100, v));
        const safeValue = clamp(value);
        const safeBuffered = clamp(buffered);

        const getValueFromEvent = useCallback((clientX: number): number => {
            if (!trackRef.current) return 0;
            const rect = trackRef.current.getBoundingClientRect();
            const pct = ((clientX - rect.left) / rect.width) * 100;
            return clamp(Math.round(pct));
        }, []);

        const handlePointerDown = useCallback(
            (e: PointerEvent<HTMLDivElement>) => {
                if (!interactive) return;
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                e.preventDefault();
                draggingRef.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                onDragStart?.();
                onChange?.(getValueFromEvent(e.clientX));
            },
            [interactive, onChange, onDragStart, getValueFromEvent],
        );

        const handlePointerMove = useCallback(
            (e: PointerEvent<HTMLDivElement>) => {
                if (!interactive || !draggingRef.current) return;
                onChange?.(getValueFromEvent(e.clientX));
            },
            [interactive, onChange, getValueFromEvent],
        );

        const handlePointerUp = useCallback(
            (e: PointerEvent<HTMLDivElement>) => {
                if (!interactive || !draggingRef.current) return;
                draggingRef.current = false;
                onDragEnd?.(getValueFromEvent(e.clientX));
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }
            },
            [interactive, onDragEnd, getValueFromEvent],
        );

        const wrapperClassNames = cn(
            'progress-bar',
            `progress-bar--${variant}`,
            interactive && 'progress-bar--interactive',
            className,
        );

        return (
            <div
                ref={ref}
                className={wrapperClassNames}
                {...rest}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <div ref={trackRef} className="progress-bar__track">
                    {/* 缓冲条（仅 slim） */}
                    {variant === 'slim' && safeBuffered > 0 && (
                        <div
                            className="progress-bar__buffered"
                            style={{ width: `${safeBuffered}%` }}
                        />
                    )}
                    {/* 填充条 */}
                    <div className="progress-bar__fill" style={{ width: `${safeValue}%` }} />
                    {/* Thumb（仅 slim 变体） */}
                    {variant === 'slim' && (
                        <div className="progress-bar__thumb" style={{ left: `${safeValue}%` }} />
                    )}
                </div>
                {/* 百分比文字（仅 labeled 变体） */}
                {variant === 'labeled' && (
                    <span className="progress-bar__text">{Math.round(safeValue)}%</span>
                )}
            </div>
        );
    },
);

ProgressBar.displayName = 'ProgressBar';

export { ProgressBar };
