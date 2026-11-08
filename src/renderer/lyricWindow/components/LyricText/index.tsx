// ============================================================================
// LyricText — 歌词文字渲染
// ============================================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@common/cn';
import { toTraditional } from '@common/s2t';
import appSyncAuxiliary, { useAppStatePartial } from '@infra/appSync/renderer/auxiliary';
import { useConfigValue } from '@renderer/common/hooks/useConfigValue';
import { activeLyricStroke } from '@renderer/common/lyricColors';
import type { IAppState } from '@appTypes/infra/appSync';

import './index.scss';

// ── 滚动平滑过渡时长（ms） ──
const SCROLL_TRANSITION_MS = 900;

type LineContent = 'original' | 'translation' | 'both';

function lineContentMode(value: string | null | undefined): LineContent {
    if (value === 'translation' || value === 'both') return value;
    return 'original';
}

/** 按显示模式取出一行的主文本和附带翻译。没有翻译时退回原文，避免空白。 */
function resolveLyricLine(
    lrc: string,
    translation: string | undefined,
    mode: LineContent,
    traditional: boolean,
) {
    const convert = (text: string) => (traditional ? toTraditional(text) : text);
    const original = convert(lrc.trim());
    const translated = convert(translation?.trim() ?? '');
    if (mode === 'translation') {
        return { primary: translated || original, secondary: '' };
    }
    if (mode === 'both' && translated && translated !== original) {
        return { primary: original, secondary: translated };
    }
    return { primary: original, secondary: '' };
}

const LyricLine = memo(function LyricLine() {
    const { t } = useTranslation();
    const currentMusic = useAppStatePartial('musicItem');
    const currentLrc = useAppStatePartial('currentLrc');
    const fullLyric = useAppStatePartial('fullLyric');
    const progress = useAppStatePartial('progress');

    const [fontData] = useConfigValue('lyric.fontData');
    const [fontSize] = useConfigValue('lyric.fontSize');
    const [fontColor] = useConfigValue('lyric.fontColor');
    const [strokeColor] = useConfigValue('lyric.strokeColor');
    const [lineContent] = useConfigValue('lyric.lineContent');
    const [traditional] = useConfigValue('lyric.traditional');
    const contentMode = lineContentMode(lineContent);
    const traditionalOn = traditional === true;

    const fontFamily = fontData?.family || undefined;
    const resolvedFontSize = fontSize ?? 54;

    // musicItem 同步前为 undefined，同步后为 IMusicItemSlim | null，
    // 因此 undefined 可靠地表示“状态尚未从主窗口同步”
    const isStateReady = currentMusic !== undefined;

    const lyricLine = useMemo(() => {
        const source =
            currentLrc ??
            (() => {
                if (!fullLyric?.length) return null;
                const time = progress?.currentTime ?? 0;
                let line = fullLyric[0];
                for (const item of fullLyric) {
                    if (item.time <= time) line = item;
                    else break;
                }
                return line;
            })();
        if (!source) return { primary: '', secondary: '' };
        return resolveLyricLine(source.lrc, source.translation, contentMode, traditionalOn);
    }, [contentMode, currentLrc, fullLyric, progress, traditionalOn]);

    const fallbackText = currentMusic
        ? `${currentMusic.title} - ${currentMusic.artist ?? ''}`
        : t('lyric.no_lyric');
    // 歌词文本：状态未就绪前显示空白，避免闪烁 "no_lyric"
    const primaryText = !isStateReady ? '' : lyricLine.primary || fallbackText;
    const secondaryText = !isStateReady ? '' : lyricLine.secondary;

    // ── DOM 测量：用实际渲染宽度判断是否需要滚动 ──
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const [textWidth, setTextWidth] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);

    const measureWidths = useCallback(() => {
        const content = contentRef.current;
        const container = containerRef.current;
        if (!content || !container) return;
        setTextWidth(content.scrollWidth);
        setContainerWidth(container.clientWidth);
    }, []);

    // 容器尺寸变化时重新测量
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const ro = new ResizeObserver(measureWidths);
        ro.observe(container);
        measureWidths();

        return () => ro.disconnect();
    }, [measureWidths]);

    // 文本或字体变化时重新测量
    useLayoutEffect(measureWidths, [
        primaryText,
        secondaryText,
        resolvedFontSize,
        fontFamily,
        measureWidths,
    ]);

    // 滚动状态
    const [left, setLeft] = useState<number | null>(null);
    const [enableTransition, setEnableTransition] = useState(false);

    // 歌词切换时重置滚动位置
    useLayoutEffect(() => {
        if (textWidth > containerWidth) {
            setEnableTransition(false);
            setLeft(0);
        } else {
            setLeft(null);
        }
    }, [textWidth, containerWidth]);

    // 监听 progress 变化实现平滑滚动
    const currentLrcRef = useRef(currentLrc);
    currentLrcRef.current = currentLrc;

    // 全量歌词用于计算当前行的真实时长，避免用固定值估算滚动速度
    const fullLyricRef = useRef(fullLyric);
    fullLyricRef.current = fullLyric;

    useEffect(() => {
        if (textWidth <= containerWidth) return;

        const handler = (_state: Partial<IAppState>, changed: Partial<IAppState>) => {
            if (!changed.progress) return;
            const lrc = currentLrcRef.current;
            if (!lrc || lrc.index < 0) return;

            const progress = changed.progress.currentTime;
            const nextLine = fullLyricRef.current?.[lrc.index + 1];
            const lineDuration =
                nextLine && nextLine.time > lrc.time ? nextLine.time - lrc.time : 5;
            const virtualPointer = ((progress - lrc.time) / lineDuration) * textWidth;

            if (virtualPointer > containerWidth * 0.5) {
                setEnableTransition(true);
                setLeft(
                    -Math.min(
                        (virtualPointer - containerWidth * 0.5) * 1.1,
                        textWidth - containerWidth,
                    ),
                );
            } else {
                setEnableTransition(false);
                setLeft(0);
            }
        };

        const dispose = appSyncAuxiliary.onStateChange(handler);
        return dispose;
    }, [textWidth, containerWidth]);

    // 缓存 style 对象避免每次渲染重建
    const contentStyle = useMemo(
        () => ({
            color: fontColor ?? '#ffffff',
            WebkitTextStrokeWidth: activeLyricStroke(strokeColor) ? '1px' : '0px',
            WebkitTextStrokeColor: activeLyricStroke(strokeColor) ?? 'transparent',
            fontSize: resolvedFontSize,
            fontFamily,
            left: left ?? undefined,
            transition: enableTransition ? `left ${SCROLL_TRANSITION_MS}ms linear` : 'none',
            position: (left != null ? 'relative' : undefined) as 'relative' | undefined,
        }),
        [fontColor, strokeColor, resolvedFontSize, fontFamily, left, enableTransition],
    );

    const needsScroll = textWidth > containerWidth;

    return (
        <div
            ref={containerRef}
            className={cn('lyric-text', needsScroll && 'is-scrollable')}
            data-lyric-hit
            data-tauri-drag-region
        >
            <div
                ref={contentRef}
                className="lyric-text__content"
                style={contentStyle}
                data-tauri-drag-region
            >
                <span className="lyric-text__primary">{primaryText}</span>
                {secondaryText ? (
                    <span className="lyric-text__secondary">{secondaryText}</span>
                ) : null}
            </div>
        </div>
    );
});

const LyricLines = memo(function LyricLines() {
    const { t } = useTranslation();
    const currentMusic = useAppStatePartial('musicItem');
    const currentLrc = useAppStatePartial('currentLrc');
    const fullLyric = useAppStatePartial('fullLyric');

    const [fontData] = useConfigValue('lyric.fontData');
    const [fontSize] = useConfigValue('lyric.fontSize');
    const [fontColor] = useConfigValue('lyric.fontColor');
    const [strokeColor] = useConfigValue('lyric.strokeColor');
    const [lineContent] = useConfigValue('lyric.lineContent');
    const [traditional] = useConfigValue('lyric.traditional');
    const contentMode = lineContentMode(lineContent);
    const traditionalOn = traditional === true;

    const fontFamily = fontData?.family || undefined;
    // 单行歌词通常很大，多行按它的比例缩小，一屏才能放下截图里那种一列歌词。
    const resolvedFontSize = Math.max(16, Math.min(40, Math.round((fontSize ?? 48) * 0.55)));
    const scrollRef = useRef<HTMLDivElement>(null);
    const activeIndex = currentLrc?.index ?? -1;

    const lines = useMemo(
        () => (fullLyric ?? []).filter((item) => item.lrc.trim() || item.translation?.trim()),
        [fullLyric],
    );

    const heading =
        currentMusic && currentMusic.title
            ? `${currentMusic.title}${currentMusic.artist ? ` - ${currentMusic.artist}` : ''}`
            : '';

    useLayoutEffect(() => {
        const scroll = scrollRef.current;
        if (!scroll || activeIndex < 0) return;
        const active = scroll.querySelector<HTMLElement>(`[data-lyric-index="${activeIndex}"]`);
        if (!active) return;
        const top = active.offsetTop - scroll.clientHeight / 2 + active.offsetHeight / 2;
        scroll.scrollTo({ top, behavior: 'smooth' });
    }, [activeIndex]);

    const color = fontColor ?? '#ffffff';
    const stroke = activeLyricStroke(strokeColor);
    const strokeStyle = {
        WebkitTextStrokeWidth: stroke ? '1px' : '0px',
        WebkitTextStrokeColor: stroke ?? 'transparent',
    };

    return (
        <div className="lyric-text lyric-text--multi">
            <div ref={scrollRef} className="lyric-text__scroll">
                <div className="lyric-text__stack" data-lyric-hit data-tauri-drag-region>
                    {lines.length > 0 && heading && (
                        <p
                            className="lyric-text__heading"
                            style={{
                                color,
                                ...strokeStyle,
                                fontSize: Math.max(16, Math.round(resolvedFontSize * 0.72)),
                                fontFamily,
                            }}
                        >
                            {heading}
                        </p>
                    )}
                    {lines.length === 0 ? (
                        <p
                            className="lyric-text__line is-active"
                            style={{
                                color,
                                ...strokeStyle,
                                fontSize: resolvedFontSize,
                                fontFamily,
                            }}
                        >
                            {currentMusic === undefined ? '' : heading || t('lyric.no_lyric')}
                        </p>
                    ) : (
                        lines.map((item) => {
                            const shown = resolveLyricLine(
                                item.lrc,
                                item.translation,
                                contentMode,
                                traditionalOn,
                            );
                            return (
                                <p
                                    key={item.index}
                                    data-lyric-index={item.index}
                                    className={cn(
                                        'lyric-text__line',
                                        item.index === activeIndex && 'is-active',
                                    )}
                                    style={{
                                        color,
                                        ...strokeStyle,
                                        fontSize: resolvedFontSize,
                                        fontFamily,
                                    }}
                                >
                                    {shown.primary}
                                    {shown.secondary ? (
                                        <span className="lyric-text__translation">
                                            {shown.secondary}
                                        </span>
                                    ) : null}
                                </p>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
});

export default memo(function LyricText() {
    const [multiLine] = useConfigValue('lyric.multiLine');
    if (multiLine) return <LyricLines />;
    return <LyricLine />;
});
