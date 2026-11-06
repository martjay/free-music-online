/**
 * LyricManager — 歌词获取 & 逐行追踪
 *
 * 通过 pluginManager 获取歌词源，使用 LyricParser 解析，
 * 播放进度变化时更新当前歌词行并写入 jotai atom。
 */
import LyricParser from '@common/lyricParser';
import { compositeKey } from '@common/mediaKey';
import pluginManager from '@infra/pluginManager/renderer';
import mediaMeta from '@infra/mediaMeta/renderer';
import neteaseAccount from '@infra/neteaseAccount/renderer';
import { store, currentLyricAtom, progressAtom, associatedLyricAtom } from './store';

/** 歌词偏移写入 mediaMeta 的防抖延迟（ms） */
const OFFSET_PERSIST_DELAY = 500;

class LyricManager {
    private parser: LyricParser | null = null;
    private currentMusicKey: string | null = null;
    /** 只允许最新一次取词写回，避免后返回的空结果把歌词清掉 */
    private requestSeq = 0;
    private pendingKey: string | null = null;
    private pending: Promise<void> | null = null;
    /** 当前歌曲的 platform + musicId，用于写入 mediaMeta */
    private currentPlatform: string | null = null;
    private currentMusicId: string | null = null;
    /** 用户调整的歌词偏移（秒），正值表示歌词提前，负值表示歌词延后 */
    private userOffset = 0;
    /** 防抖写入 mediaMeta 的定时器 */
    private persistTimer: ReturnType<typeof setTimeout> | undefined = undefined;

    /** 当前歌曲是否已经有可显示的歌词 */
    hasLyric(): boolean {
        return (this.parser?.getLyricItems().length ?? 0) > 0;
    }

    /** 获取并解析歌词。同一首歌的重复调用会并到同一次请求上。 */
    fetchLyric(musicItem: IMusic.IMusicItem): Promise<void> {
        const key = compositeKey(musicItem.platform, musicItem.id);
        if (this.pending && this.pendingKey === key) return this.pending;

        const seq = ++this.requestSeq;
        this.currentMusicKey = key;
        this.currentPlatform = musicItem.platform;
        this.currentMusicId = String(musicItem.id);
        this.pendingKey = key;
        this.pending = this.loadLyric(musicItem, key, seq).finally(() => {
            if (this.requestSeq === seq) {
                this.pending = null;
                this.pendingKey = null;
            }
        });
        return this.pending;
    }

    private async loadLyric(musicItem: IMusic.IMusicItem, key: string, seq: number): Promise<void> {
        // 偏移和歌词一起取。偏移读得慢时，不要挡住歌词本身。
        const metaPromise = mediaMeta
            .getMeta(musicItem.platform, String(musicItem.id))
            .catch((): null => null);

        try {
            let lyricSource = await pluginManager.adapters.getLyric(musicItem);
            if (this.requestSeq !== seq) return;

            // 若插件未获取到歌词且属于网易云平台，尝试从网易云接口获取官方歌词
            if (!lyricSource?.rawLrc && !lyricSource?.lrc && musicItem.platform === 'wy') {
                try {
                    const officialLyric = await neteaseAccount.getLyric(String(musicItem.id));
                    if (officialLyric?.rawLrc) {
                        lyricSource = {
                            rawLrc: officialLyric.rawLrc,
                            translation: officialLyric.translation,
                        };
                    }
                } catch {
                    // ignore
                }
            }

            if (this.requestSeq !== seq) return;

            const rawText = lyricSource?.rawLrc || lyricSource?.lrc;
            if (!rawText) {
                this.parser = null;
                store.set(currentLyricAtom, null);
                return;
            }

            this.parser = new LyricParser(rawText, {
                musicItem,
                translation: lyricSource?.translation,
            });
            this.publishLyric(store.get(progressAtom).currentTime);

            const meta = await metaPromise;
            if (this.requestSeq !== seq || !meta) return;
            this.userOffset = meta.lyricOffset ?? 0;
            store.set(associatedLyricAtom, meta.associatedLyric?.musicItem ?? null);
            this.updatePosition(store.get(progressAtom).currentTime);
        } catch {
            if (this.requestSeq === seq) {
                this.parser = null;
                store.set(currentLyricAtom, null);
            }
        }
    }

    /** 写入当前行。还没到第一句时先显示第一句有字的歌词，避免窗口一直空白。 */
    private publishLyric(currentTime: number): void {
        if (!this.parser) {
            store.set(currentLyricAtom, null);
            return;
        }
        const items = this.parser.getLyricItems();
        const positioned = this.parser.getPosition(currentTime + this.userOffset);
        const fallback = items.find((item) => item.lrc.trim());
        store.set(currentLyricAtom, {
            parser: this.parser,
            currentLrc: positioned ?? fallback,
        });
    }

    /** 根据播放进度更新当前歌词行 */
    updatePosition(currentTime: number): void {
        if (!this.parser) return;

        const lyricItem = this.parser.getPosition(currentTime + this.userOffset);
        if (!lyricItem) return;
        const prev = store.get(currentLyricAtom);

        if (prev?.currentLrc?.index !== lyricItem?.index) {
            store.set(currentLyricAtom, {
                parser: this.parser,
                currentLrc: lyricItem ?? undefined,
            });
        }
    }

    /** 重置 */
    reset(): void {
        this.requestSeq += 1;
        this.pending = null;
        this.pendingKey = null;
        this.parser = null;
        this.currentMusicKey = null;
        this.currentPlatform = null;
        this.currentMusicId = null;
        this.userOffset = 0;
        clearTimeout(this.persistTimer);
        store.set(currentLyricAtom, null);
        store.set(associatedLyricAtom, null);
    }

    /** 获取当前用户歌词偏移（秒） */
    getUserOffset(): number {
        return this.userOffset;
    }

    /** 设置用户歌词偏移（秒），并立即刷新当前歌词行 */
    setUserOffset(offset: number): void {
        this.userOffset = offset;
        const currentTime = store.get(progressAtom).currentTime;
        this.updatePosition(currentTime);

        // 防抖写入 mediaMeta
        clearTimeout(this.persistTimer);
        const platform = this.currentPlatform;
        const musicId = this.currentMusicId;
        if (platform && musicId) {
            this.persistTimer = setTimeout(() => {
                // 确保写入时仍是同一首歌
                if (this.currentPlatform !== platform || this.currentMusicId !== musicId) return;
                if (offset === 0) {
                    mediaMeta.setMeta(platform, musicId, { lyricOffset: null });
                } else {
                    mediaMeta.setMeta(platform, musicId, { lyricOffset: offset });
                }
            }, OFFSET_PERSIST_DELAY);
        }
    }

    /** 强制重新加载当前歌曲歌词（用于关联/取消关联歌词后刷新） */
    async refreshLyric(musicItem: IMusic.IMusicItem): Promise<void> {
        // 清除当前歌词状态，让 fetchLyric 重新加载
        this.parser = null;
        this.currentMusicKey = null;
        store.set(currentLyricAtom, null);
        await this.fetchLyric(musicItem);
    }
}

export default LyricManager;
