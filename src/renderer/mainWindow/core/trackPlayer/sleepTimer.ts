/** 定时停止只活在这一次打开里，不写进配置。 */
let pausePlayback: (() => void) | null = null;
let timerId: number | null = null;

export function bindSleepTimer(pause: () => void): void {
    pausePlayback = pause;
}

export function sleepTimerActive(): boolean {
    return timerId != null;
}

export function cancelSleepTimer(): void {
    if (timerId == null) return;
    window.clearTimeout(timerId);
    timerId = null;
}

export function startSleepTimer(minutes: number): void {
    cancelSleepTimer();
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    timerId = window.setTimeout(
        () => {
            timerId = null;
            pausePlayback?.();
        },
        Math.round(minutes * 60_000),
    );
}
