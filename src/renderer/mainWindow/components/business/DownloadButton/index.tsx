import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type HTMLAttributes,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Download, CircleCheckBig, LoaderCircle, CircleAlert } from 'lucide-react';
import { cn } from '@common/cn';
import { isRadioBrowserMedia } from '@common/radioBrowser';
import { LOCAL_PLUGIN_NAME, QUALITY_KEYS } from '@common/constant';
import downloadManager, {
    useMusicDownloaded,
    useMusicDownloadTask,
} from '@infra/downloadManager/renderer';
import { useConfigValue } from '@renderer/common/hooks/useConfigValue';
import { showToast } from '@renderer/mainWindow/components/ui/Toast';
import type { IMusicItemSlim } from '@appTypes/infra/musicSheet';
import './index.scss';

const QUALITY_I18N_KEYS: Record<IMusic.IQualityKey, string> = {
    low: 'quality.low',
    standard: 'quality.standard',
    high: 'quality.high',
    super: 'quality.super',
};

/** 从高到低，菜单自上而下为高音质到低音质 */
const QUALITY_OPTIONS = [...QUALITY_KEYS].reverse();

/** DownloadButton 尺寸预设 */
export type DownloadButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface DownloadButtonProps extends Omit<
    HTMLAttributes<HTMLButtonElement>,
    'onClick' | 'children'
> {
    /** 歌曲数据（完整或精简均可） */
    musicItem: IMusic.IMusicItem | IMusicItemSlim;
    /** 图标尺寸 */
    size?: DownloadButtonSize;
    /** 点击先弹出音质菜单，选中后再下载 */
    selectQuality?: boolean;
}

/**
 * DownloadButton — 业务组件
 *
 * 下载按钮，根据歌曲下载状态切换图标。
 * - 未下载：显示下载图标，点击触发下载
 * - 下载中：显示旋转加载图标
 * - 下载失败：显示错误图标，点击重试
 * - 已下载 / 本地歌曲：显示对勾图标，禁用点击
 *
 * 设计稿还原（像素级）：
 *   容器: inline-flex, items-center, justify-center, rounded-pill
 *   默认: bg transparent, color text-secondary
 *   hover: bg fill-subtle-hover, color text-primary
 *   已下载: color status-success-text, opacity disabled, cursor default
 *   下载中: color text-brand, icon spin
 *   下载失败: color status-danger-text, hover 可点击重试
 *   active: opacity 0.6
 *   尺寸: sm(--icon-sm) md(--icon-md) lg(--icon-lg) xl(--icon-xl)
 */
export function DownloadButton({
    musicItem,
    size = 'lg',
    selectQuality = false,
    className,
    ...rest
}: DownloadButtonProps) {
    const { t } = useTranslation();
    const isLocal = musicItem.platform === LOCAL_PLUGIN_NAME;
    const isRadio = isRadioBrowserMedia(musicItem);
    const downloaded = useMusicDownloaded(musicItem);
    const taskStatus = useMusicDownloadTask(musicItem);
    const [defaultQuality] = useConfigValue('download.defaultQuality');
    const isError = taskStatus === 'error';
    const isDownloading =
        taskStatus === 'pending' || taskStatus === 'downloading' || taskStatus === 'paused';
    const isCompleted = !isError && !isDownloading && (isLocal || downloaded !== null);
    const canChooseQuality = selectQuality && !isLocal && !isDownloading;
    const isInactive = !canChooseQuality && (isCompleted || isDownloading);
    const lockRef = useRef(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

    const closeMenu = useCallback(() => setMenuPos(null), []);

    const startDownload = useCallback(
        async (quality?: IMusic.IQualityKey) => {
            if (lockRef.current) return;
            lockRef.current = true;
            try {
                if (isError && !quality) {
                    await downloadManager.retryByMusicItem(musicItem);
                } else {
                    await downloadManager.addTask({ musicItem, quality });
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : '';
                if (message.includes('已下载')) {
                    showToast(t('download.already_downloaded'), { type: 'warn' });
                } else {
                    showToast(message || t('download.failed'), { type: 'warn' });
                }
            } finally {
                lockRef.current = false;
            }
        },
        [isError, musicItem, t],
    );

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isInactive) return;
            if (!canChooseQuality) {
                void startDownload();
                return;
            }
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect) return;
            const menuHeight = QUALITY_OPTIONS.length * 28 + 12;
            const openUp = rect.bottom + menuHeight > window.innerHeight - 8;
            setMenuPos({
                top: openUp ? rect.top - menuHeight - 6 : rect.bottom + 6,
                left: Math.max(8, Math.min(rect.left, window.innerWidth - 128)),
            });
        },
        [canChooseQuality, isInactive, startDownload],
    );

    useEffect(() => {
        if (!menuPos) return;
        const onPointer = (event: PointerEvent) => {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            closeMenu();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeMenu();
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', closeMenu, true);
        window.addEventListener('resize', closeMenu);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('resize', closeMenu);
        };
    }, [menuPos, closeMenu]);

    if (isRadio) return null;

    let ariaLabel: string;
    let icon: ReactNode;

    if (isCompleted && !canChooseQuality) {
        ariaLabel = t('common.downloaded');
        icon = <CircleCheckBig size="100%" />;
    } else if (isDownloading) {
        ariaLabel = t('common.downloading');
        icon = <LoaderCircle size="100%" />;
    } else if (isError) {
        ariaLabel = t('download.failed_retry');
        icon = <CircleAlert size="100%" />;
    } else {
        ariaLabel = canChooseQuality ? t('download.choose_quality') : t('common.download');
        icon = <Download size="100%" />;
    }

    const markedQuality = downloaded?.quality ?? defaultQuality ?? 'standard';

    return (
        <>
            <button
                {...rest}
                ref={buttonRef}
                type="button"
                className={cn(
                    'download-btn',
                    `download-btn--${size}`,
                    isCompleted && !canChooseQuality && 'is-completed',
                    isDownloading && 'is-downloading',
                    isError && 'is-error',
                    menuPos && 'is-open',
                    className,
                )}
                disabled={isInactive}
                aria-label={ariaLabel}
                aria-expanded={canChooseQuality ? menuPos != null : undefined}
                aria-haspopup={canChooseQuality ? 'menu' : undefined}
                title={ariaLabel}
                onClick={handleClick}
                onDoubleClick={(e) => e.stopPropagation()}
            >
                {icon}
            </button>
            {menuPos &&
                createPortal(
                    <div
                        ref={menuRef}
                        className="download-quality-menu"
                        style={{ top: menuPos.top, left: menuPos.left }}
                        role="menu"
                        aria-label={t('download.choose_quality')}
                    >
                        {QUALITY_OPTIONS.map((quality) => {
                            const marked = quality === markedQuality;
                            return (
                                <button
                                    key={quality}
                                    type="button"
                                    role="menuitem"
                                    className={cn(
                                        'download-quality-menu__option',
                                        marked && 'is-marked',
                                    )}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        closeMenu();
                                        void startDownload(quality);
                                    }}
                                >
                                    <span>{t(QUALITY_I18N_KEYS[quality])}</span>
                                    {marked && <Check size={12} />}
                                </button>
                            );
                        })}
                    </div>,
                    document.body,
                )}
        </>
    );
}

export default DownloadButton;
