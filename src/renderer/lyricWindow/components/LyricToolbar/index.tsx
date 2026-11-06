// ============================================================================
// LyricToolbar — 歌词窗口操控栏
// ============================================================================

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    SkipBack,
    SkipForward,
    Play,
    Pause,
    Lock,
    Unlock,
    X,
    Pin,
    PinOff,
    AArrowUp,
    AArrowDown,
    Palette,
    ListMusic,
} from 'lucide-react';
import { cn } from '@common/cn';
import { PlayerState } from '@common/constant';
import appSyncAuxiliary, { useAppStatePartial } from '@infra/appSync/renderer/auxiliary';
import appConfig from '@infra/appConfig/renderer';
import { LYRIC_COLOR_SWATCHES, activeLyricStroke } from '@renderer/common/lyricColors';
import { useConfigValue } from '@renderer/common/hooks/useConfigValue';
import { tauriInvoke } from '@infra/tauriBridge/ipc';

import './index.scss';

interface LyricToolbarProps {
    visible: boolean;
}

export default function LyricToolbar({ visible }: LyricToolbarProps) {
    return <UnlockedToolbar visible={visible} />;
}

function toColorInputValue(value: string): string {
    const hex = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
    if (/^#[0-9a-f]{3}$/.test(hex)) {
        return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    return '#ffffff';
}

function CustomColor({
    value,
    selected,
    onChange,
}: {
    value: string;
    selected: boolean;
    onChange: (color: string) => void;
}) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const restoreTopmost = () => {
        const onTop = appConfig.getConfigByKey('lyric.alwaysOnTop');
        void tauriInvoke('set_lyric_topmost', { topmost: onTop !== false });
    };
    return (
        <>
            <button
                type="button"
                className={cn(
                    'lyric-toolbar__swatch',
                    'lyric-toolbar__swatch--custom',
                    selected && 'is-selected',
                )}
                title={t('lyric.custom_color')}
                aria-label={t('lyric.custom_color')}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    void tauriInvoke('set_lyric_topmost', { topmost: false });
                }}
                onClick={() => {
                    const input = inputRef.current;
                    if (!input) return;
                    try {
                        input.showPicker();
                    } catch {
                        input.click();
                    }
                }}
            />
            <input
                ref={inputRef}
                type="color"
                className="lyric-toolbar__color-input"
                tabIndex={-1}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onBlur={restoreTopmost}
            />
        </>
    );
}

function ColorSwatches({
    label,
    value,
    allowNone = false,
    onChange,
}: {
    label: string;
    value: string;
    allowNone?: boolean;
    onChange: (color: string) => void;
}) {
    const { t } = useTranslation();
    const none = allowNone && !activeLyricStroke(value);
    const current = none ? '' : toColorInputValue(value);
    const isPreset = LYRIC_COLOR_SWATCHES.some((color) => color === current);
    return (
        <div className="lyric-toolbar__swatches" role="listbox" aria-label={label}>
            <span className="lyric-toolbar__swatch-label">{label}</span>
            {allowNone && (
                <button
                    type="button"
                    role="option"
                    aria-selected={none}
                    className={cn(
                        'lyric-toolbar__swatch',
                        'lyric-toolbar__swatch--none',
                        none && 'is-selected',
                    )}
                    title={t('lyric.no_stroke')}
                    aria-label={t('lyric.no_stroke')}
                    onClick={() => onChange('')}
                />
            )}
            {LYRIC_COLOR_SWATCHES.map((color) => (
                <button
                    key={color}
                    type="button"
                    role="option"
                    aria-selected={current === color}
                    className={cn('lyric-toolbar__swatch', current === color && 'is-selected')}
                    style={{ backgroundColor: color }}
                    title={color}
                    onClick={() => onChange(color)}
                />
            ))}
            <CustomColor
                value={current || '#f5c542'}
                selected={!none && !isPreset}
                onChange={onChange}
            />
        </div>
    );
}

/** 锁定后悬浮出现的解锁按钮 */
export function LockedToolbar({ visible }: LyricToolbarProps) {
    const { t } = useTranslation();
    return (
        <div
            className={cn('lyric-toolbar', visible && 'is-visible')}
            aria-hidden={!visible}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <button
                className="lyric-toolbar__btn lyric-toolbar__btn--unlock"
                type="button"
                {...(visible ? { 'data-lyric-unlock': '' } : {})}
                title={t('lyric.unlock_desktop')}
                onClick={() => {
                    appConfig.setConfig({ 'lyric.lockLyric': false });
                }}
            >
                <Unlock size={16} />
            </button>
        </div>
    );
}

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 80;
const FONT_SIZE_STEP = 2;

/** 工具栏：播放控制 + 置顶/字号/颜色 + 锁定 + 关闭 */
function UnlockedToolbar({ visible }: { visible: boolean }) {
    const { t } = useTranslation();
    const playerState = useAppStatePartial('playerState');
    const isPlaying = playerState === PlayerState.Playing;
    const [paletteOpen, setPaletteOpen] = useState(false);

    const [alwaysOnTop] = useConfigValue('lyric.alwaysOnTop');
    const isOnTop = alwaysOnTop ?? true;

    const [fontSize] = useConfigValue('lyric.fontSize');
    const currentSize = fontSize ?? 54;

    const [fontColor] = useConfigValue('lyric.fontColor');
    const [strokeColor] = useConfigValue('lyric.strokeColor');
    const [multiLine] = useConfigValue('lyric.multiLine');
    const isMultiLine = multiLine ?? false;
    const [lineContent] = useConfigValue('lyric.lineContent');
    const contentMode =
        lineContent === 'translation' || lineContent === 'both' ? lineContent : 'original';
    const nextContentMode =
        contentMode === 'original'
            ? 'translation'
            : contentMode === 'translation'
              ? 'both'
              : 'original';
    const contentTitle =
        contentMode === 'translation'
            ? t('lyric.content_translation')
            : contentMode === 'both'
              ? t('lyric.content_both')
              : t('lyric.content_original');
    const contentMark =
        contentMode === 'translation'
            ? t('lyric.content_translation_mark')
            : contentMode === 'both'
              ? t('lyric.content_both_mark')
              : t('lyric.content_original_mark');

    return (
        <div
            className={cn('lyric-toolbar', visible && 'is-visible', paletteOpen && 'is-palette')}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {paletteOpen && (
                <div className="lyric-toolbar__palette">
                    <ColorSwatches
                        label={t('settings.lyric.font_color_label')}
                        value={fontColor || '#ffffff'}
                        onChange={(color) => appConfig.setConfig({ 'lyric.fontColor': color })}
                    />
                    <ColorSwatches
                        label={t('settings.lyric.stroke_color_label')}
                        value={strokeColor || ''}
                        allowNone
                        onChange={(color) => appConfig.setConfig({ 'lyric.strokeColor': color })}
                    />
                </div>
            )}
            {/* ── 置顶 ── */}
            <button
                className={cn('lyric-toolbar__btn', isOnTop && 'is-active')}
                type="button"
                title={t('settings.lyric.always_on_top_label')}
                onClick={() => {
                    appConfig.setConfig({ 'lyric.alwaysOnTop': !isOnTop });
                }}
            >
                {isOnTop ? <Pin size={16} fill="currentColor" /> : <PinOff size={16} />}
            </button>

            <span className="lyric-toolbar__sep" />

            {/* ── 字号调整 ── */}
            <button
                className="lyric-toolbar__btn"
                type="button"
                title={t('lyric.font_scale')}
                disabled={currentSize <= FONT_SIZE_MIN}
                onClick={() => {
                    const next = Math.max(FONT_SIZE_MIN, currentSize - FONT_SIZE_STEP);
                    appConfig.setConfig({ 'lyric.fontSize': next });
                }}
            >
                <AArrowDown size={16} />
            </button>
            <button
                className="lyric-toolbar__btn"
                type="button"
                title={t('lyric.font_scale')}
                disabled={currentSize >= FONT_SIZE_MAX}
                onClick={() => {
                    const next = Math.min(FONT_SIZE_MAX, currentSize + FONT_SIZE_STEP);
                    appConfig.setConfig({ 'lyric.fontSize': next });
                }}
            >
                <AArrowUp size={16} />
            </button>
            <button
                className={cn('lyric-toolbar__btn', paletteOpen && 'is-active')}
                type="button"
                title={t('settings.lyric.font_color_label')}
                onClick={() => setPaletteOpen((open) => !open)}
            >
                <Palette size={16} />
            </button>
            <button
                className={cn('lyric-toolbar__btn', isMultiLine && 'is-active')}
                type="button"
                title={isMultiLine ? t('lyric.single_line') : t('lyric.multi_line')}
                aria-pressed={isMultiLine}
                onClick={() => {
                    const next = !isMultiLine;
                    appConfig.setConfig({ 'lyric.multiLine': next });
                    void tauriInvoke('set_lyric_display_span', { multiLine: next });
                }}
            >
                <ListMusic size={16} />
            </button>
            <button
                className={cn(
                    'lyric-toolbar__btn',
                    'lyric-toolbar__btn--mark',
                    contentMode !== 'original' && 'is-active',
                )}
                type="button"
                title={contentTitle}
                aria-pressed={contentMode !== 'original'}
                onClick={() => {
                    appConfig.setConfig({ 'lyric.lineContent': nextContentMode });
                }}
            >
                {contentMark}
            </button>

            <span className="lyric-toolbar__sep" />

            {/* ── 播放控制 ── */}
            <button
                className="lyric-toolbar__btn"
                type="button"
                title={t('playback.previous')}
                onClick={() => {
                    appSyncAuxiliary.sendCommand('skip-previous');
                }}
            >
                <SkipBack size={16} fill="currentColor" />
            </button>
            <button
                className="lyric-toolbar__btn"
                type="button"
                title={isPlaying ? t('playback.pause') : t('playback.play')}
                onClick={() => {
                    appSyncAuxiliary.sendCommand('play/pause');
                }}
            >
                {isPlaying ? (
                    <Pause size={16} fill="currentColor" />
                ) : (
                    <Play size={16} fill="currentColor" />
                )}
            </button>
            <button
                className="lyric-toolbar__btn"
                type="button"
                title={t('playback.next')}
                onClick={() => {
                    appSyncAuxiliary.sendCommand('skip-next');
                }}
            >
                <SkipForward size={16} fill="currentColor" />
            </button>

            <span className="lyric-toolbar__sep" />

            {/* ── 锁定 & 关闭 ── */}
            <button
                className="lyric-toolbar__btn"
                type="button"
                title={t('lyric.lock_desktop')}
                onClick={() => {
                    appConfig.setConfig({ 'lyric.lockLyric': true });
                }}
            >
                <Lock size={16} />
            </button>
            <button
                className="lyric-toolbar__btn"
                type="button"
                title={t('lyric.close_desktop')}
                onClick={() => {
                    appConfig.setConfig({ 'lyric.enableDesktopLyric': false });
                }}
            >
                <X size={16} />
            </button>
        </div>
    );
}
