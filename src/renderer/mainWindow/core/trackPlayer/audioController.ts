/**
 * AudioController — IAudioController 接口 + WebAudioController 实现
 *
 * 底层音频播放抽象，面向接口编程。
 * 当前实现：WebAudioController（HTMLAudioElement + HLS）
 * 未来扩展：MpvAudioController 等
 */
import EventEmitter from 'eventemitter3';
import Hls from 'hls.js';
import type { IMusicItemSlim } from '@appTypes/infra/musicSheet';
import { PlayerState, ErrorReason } from '@common/constant';
import requestForwarder from '@infra/requestForwarder/renderer';
import { syncKV } from '@renderer/common/kvStore';
import type { IResolvedMediaSource } from './types';

// ─── 事件类型 ───

export interface IAudioControllerEvents {
    /** 播放状态变化 */
    stateChange: (state: PlayerState) => void;
    /** 播放进度更新 */
    timeUpdate: (progress: { currentTime: number; duration: number }) => void;
    /** 播放结束 */
    ended: () => void;
    /** 播放错误 */
    error: (reason: ErrorReason, detail?: any) => void;
    /** 缓冲卡住，进度没有继续往前 */
    waiting: () => void;
    /** 音量变化 */
    volumeChange: (volume: number) => void;
    /** 速度变化 */
    speedChange: (speed: number) => void;
}

// ─── 接口定义 ───

/** 音频控制器接口 — 所有实现必须遵守 */
export interface IAudioController extends EventEmitter<IAudioControllerEvents> {
    /** 预准备（设置 MediaSession metadata，清空旧音源） */
    prepareTrack(musicItem: IMusicItemSlim): void;
    /** 设置音源并可选自动播放 */
    setTrackSource(source: IResolvedMediaSource, musicItem: IMusic.IMusicItem): void;
    play(): void;
    pause(): void;
    seekTo(seconds: number): void;
    reset(): void;
    destroy(): void;

    setVolume(volume: number): void;
    setSpeed(speed: number): void;
    setSinkId(deviceId: string): Promise<void>;
    /** 等待当前音源的真实时长。超时或还不知道时长时返回 null。 */
    waitForDuration(timeoutMs: number): Promise<number | null>;

    readonly playerState: PlayerState;
    readonly hasSource: boolean;
    readonly hasUsableSource: boolean;
}

// ─── WebAudioController 实现 ───

class WebAudioController extends EventEmitter<IAudioControllerEvents> implements IAudioController {
    private audio: HTMLAudioElement;
    private hls: Hls | null = null;
    private _playerState: PlayerState = PlayerState.None;
    private _sourceId = 0; // fetch 竞态守卫
    private _currentBlobUrl: string | null = null; // 追踪 blob URL 防止内存泄漏
    private pendingHlsPlay = false;
    /** 用户选择的音量和倍速。换音源时播放器可能把它们复位，不能写回设置。 */
    private intendedVolume = 1;
    private intendedSpeed = 1;

    get playerState(): PlayerState {
        return this._playerState;
    }

    get hasSource(): boolean {
        return !!this.audio.src && this.audio.src !== location.href;
    }

    /** 地址还在，但上次加载已经失败。这种地址再点播放不会出声。 */
    get hasUsableSource(): boolean {
        return this.hasSource && this.audio.error == null;
    }

    constructor() {
        super();
        const savedVolume = syncKV.get('player.volume');
        const savedSpeed = syncKV.get('player.speed');
        this.intendedVolume =
            typeof savedVolume === 'number' ? Math.max(0, Math.min(1, savedVolume)) : 1;
        this.intendedSpeed =
            typeof savedSpeed === 'number' ? Math.max(0.25, Math.min(4, savedSpeed)) : 1;
        this.audio = new Audio();
        this.audio.preload = 'auto';
        this.audio.controls = false;
        this.audio.volume = this.intendedVolume;
        this.audio.defaultPlaybackRate = this.intendedSpeed;
        this.audio.playbackRate = this.intendedSpeed;
        this.bindEvents();
    }

    prepareTrack(musicItem: IMusicItemSlim): void {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album ?? undefined,
            artwork: musicItem.artwork ? [{ src: musicItem.artwork }] : undefined,
        });
        this.setPlayerState(PlayerState.None);
        this.pendingHlsPlay = false;
        this.destroyHls();
        this.revokeBlobUrl();
        this._sourceId++;
        this.audio.src = '';
        this.audio.removeAttribute('src');
        this.audio.volume = this.intendedVolume;
        this.audio.playbackRate = this.intendedSpeed;
        navigator.mediaSession.playbackState = 'none';
    }

    setTrackSource(source: IResolvedMediaSource, _musicItem: IMusic.IMusicItem): void {
        this.destroyHls();
        this.revokeBlobUrl();
        this.pendingHlsPlay = false;
        const sourceId = ++this._sourceId;

        // 从 URL 的 userinfo 部分提取 Basic Auth（如 http://user:pass@host/...）
        const { cleanUrl: url, authHeader } = this.extractBasicAuth(source.url!);
        let headers = this.buildHeaders(source);
        if (authHeader) {
            if (!headers) headers = {};
            headers['Authorization'] = authHeader;
        }

        // HLS 支持
        if (this.isHls(source)) {
            if (Hls.isSupported()) {
                this.initHls(() => {
                    if (this._sourceId !== sourceId || !this.pendingHlsPlay) return;
                    this.audio.play().catch(() => {});
                });
                if (headers) {
                    // HLS 请求由 hls.js 直连；相对分片必须保持原始清单 URL 作为解析基址。
                    this.hls!.config.xhrSetup = (xhr: XMLHttpRequest) => {
                        for (const [key, value] of Object.entries(headers)) {
                            xhr.setRequestHeader(key, value);
                        }
                    };
                }
                this.hls!.loadSource(url);
                this.applyPlaybackPrefs();
            } else {
                this.emit('error', ErrorReason.UnsupportedResource);
            }
            return;
        }

        // 远程非 HLS：通过代理服务器播放，代理负责附加 headers 和跟随重定向。
        if (requestForwarder.isProxyRequired(url)) {
            const proxyUrl = requestForwarder.buildProxyUrl(
                url,
                headers ?? undefined,
                source.publicOnly === true,
            );
            if (proxyUrl !== url) {
                this.audio.src = proxyUrl;
                this.applyPlaybackPrefs();
                return;
            }

            if (!headers) {
                this.audio.src = url;
                this.applyPlaybackPrefs();
                return;
            }

            // 代理不可用且需要 headers 时，降级到 fetch。
            fetch(url, { method: 'GET', headers })
                .then((res) => res.blob())
                .then((blob) => {
                    // 竞态守卫：fetch 期间可能已切歌
                    if (this._sourceId !== sourceId) return;
                    this._currentBlobUrl = URL.createObjectURL(blob);
                    this.audio.src = this._currentBlobUrl;
                    this.applyPlaybackPrefs();
                })
                .catch((err) => {
                    if (this._sourceId !== sourceId) return;
                    this.emit('error', ErrorReason.EmptyResource, err);
                });
            return;
        }

        this.audio.src = url;
        this.applyPlaybackPrefs();
    }

    private applyPlaybackPrefs(): void {
        this.audio.volume = this.intendedVolume;
        this.audio.playbackRate = this.intendedSpeed;
    }

    play(): void {
        if (this.hls) {
            this.pendingHlsPlay = true;
        }
        if (this.hasSource) {
            this.audio.play().catch(() => {});
        }
    }

    pause(): void {
        this.pendingHlsPlay = false;
        if (this.hasSource) {
            this.audio.pause();
        }
    }

    seekTo(seconds: number): void {
        if (this.hasSource && isFinite(seconds)) {
            this.audio.currentTime = Math.min(seconds, this.audio.duration || Infinity);
        }
    }

    setVolume(volume: number): void {
        this.intendedVolume = Math.max(0, Math.min(1, volume));
        this.audio.volume = this.intendedVolume;
    }

    setSpeed(speed: number): void {
        this.intendedSpeed = speed;
        this.audio.defaultPlaybackRate = speed;
        this.audio.playbackRate = speed;
    }

    setSinkId(deviceId: string): Promise<void> {
        return (this.audio as any).setSinkId(deviceId);
    }

    waitForDuration(timeoutMs: number): Promise<number | null> {
        const sourceId = this._sourceId;
        const read = (): number | null => {
            if (this._sourceId !== sourceId) return null;
            const duration = this.audio.duration;
            if (!Number.isFinite(duration) || duration <= 0) return null;
            return duration;
        };
        const ready = read();
        if (ready !== null) return Promise.resolve(ready);

        return new Promise((resolve) => {
            let settled = false;
            const finish = (value: number | null) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                this.audio.removeEventListener('loadedmetadata', onReady);
                this.audio.removeEventListener('durationchange', onReady);
                this.audio.removeEventListener('error', onError);
                resolve(this._sourceId === sourceId ? value : null);
            };
            const onReady = () => {
                const duration = read();
                if (duration !== null) finish(duration);
            };
            const onError = () => finish(null);
            const timer = window.setTimeout(() => finish(read()), timeoutMs);
            this.audio.addEventListener('loadedmetadata', onReady);
            this.audio.addEventListener('durationchange', onReady);
            this.audio.addEventListener('error', onError);
        });
    }

    reset(): void {
        this.setPlayerState(PlayerState.None);
        this.pendingHlsPlay = false;
        this.destroyHls();
        this.revokeBlobUrl();
        this.audio.src = '';
        this.audio.removeAttribute('src');
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
    }

    destroy(): void {
        this.destroyHls();
        this.reset();
        this.removeAllListeners();
    }

    // ─── Private Methods ───

    private bindEvents(): void {
        this.audio.onloadedmetadata = () => {
            this.applyPlaybackPrefs();
        };

        this.audio.onwaiting = () => {
            this.emit('waiting');
        };

        this.audio.onstalled = () => {
            this.emit('waiting');
        };

        this.audio.onplaying = () => {
            this.pendingHlsPlay = false;
            this.setPlayerState(PlayerState.Playing);
            navigator.mediaSession.playbackState = 'playing';
        };

        this.audio.onpause = () => {
            this.setPlayerState(PlayerState.Paused);
            navigator.mediaSession.playbackState = 'paused';
        };

        this.audio.onerror = (event) => {
            this.setPlayerState(PlayerState.Paused);
            this.emit('error', ErrorReason.EmptyResource, event);
        };

        this.audio.ontimeupdate = () => {
            this.emit('timeUpdate', {
                currentTime: this.audio.currentTime,
                duration: this.audio.duration,
            });
        };

        this.audio.onended = () => {
            this.setPlayerState(PlayerState.Paused);
            this.emit('ended');
        };

        this.audio.onvolumechange = () => {
            if (Math.abs(this.audio.volume - this.intendedVolume) > 0.001) {
                this.audio.volume = this.intendedVolume;
                return;
            }
            this.emit('volumeChange', this.audio.volume);
        };

        this.audio.onratechange = () => {
            if (Math.abs(this.audio.playbackRate - this.intendedSpeed) > 0.001) {
                this.audio.playbackRate = this.intendedSpeed;
                return;
            }
            this.emit('speedChange', this.audio.playbackRate);
        };
    }

    private setPlayerState(state: PlayerState): void {
        if (this._playerState !== state) {
            this._playerState = state;
            this.emit('stateChange', state);
        }
    }

    // ─── HLS ───

    private initHls(onReady?: () => void): void {
        this.destroyHls();
        this.hls = new Hls();
        this.hls.attachMedia(this.audio);

        if (onReady) {
            this.hls.once(Hls.Events.MANIFEST_PARSED, onReady);
        }

        this.hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
            if (data.fatal) {
                this.emit('error', ErrorReason.EmptyResource, data);
            }
        });
    }

    private destroyHls(): void {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }

    private isHls(source: IResolvedMediaSource): boolean {
        if (source.isHls === true) return true;
        const url = source.url ?? '';
        try {
            const pathname = new URL(url).pathname;
            return pathname.endsWith('.m3u8');
        } catch {
            return url.includes('.m3u8');
        }
    }

    private revokeBlobUrl(): void {
        if (this._currentBlobUrl) {
            URL.revokeObjectURL(this._currentBlobUrl);
            this._currentBlobUrl = null;
        }
    }

    /** 从 URL 的 userinfo 部分提取 Basic Auth 凭证 */
    private extractBasicAuth(url: string): { cleanUrl: string; authHeader?: string } {
        try {
            const parsed = new URL(url);
            if (parsed.username) {
                const auth =
                    'Basic ' +
                    btoa(
                        decodeURIComponent(parsed.username) +
                            ':' +
                            decodeURIComponent(parsed.password),
                    );
                parsed.username = '';
                parsed.password = '';
                return { cleanUrl: parsed.href, authHeader: auth };
            }
        } catch {
            /* not a valid URL, skip */
        }
        return { cleanUrl: url };
    }

    private buildHeaders(source: IResolvedMediaSource): Record<string, string> | null {
        const headers: Record<string, string> = {};
        if (source.headers) {
            Object.assign(headers, source.headers);
        }
        if (source.userAgent) {
            headers['User-Agent'] = source.userAgent;
        }
        return Object.keys(headers).length > 0 ? headers : null;
    }
}

// ─── 工厂模式 ───

export type AudioControllerFactory = () => IAudioController;

const controllerFactories: Record<string, AudioControllerFactory> = {
    'web-audio': () => new WebAudioController(),
    // 未来：
    // 'mpv': () => new MpvAudioController(),
};

export function createAudioController(type = 'web-audio'): IAudioController {
    const factory = controllerFactories[type];
    if (!factory) throw new Error(`Unknown audio controller: ${type}`);
    return factory();
}
