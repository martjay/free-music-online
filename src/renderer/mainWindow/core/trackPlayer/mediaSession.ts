function getMediaSession(): MediaSession | null {
    if (typeof navigator === 'undefined') return null;
    const session = navigator.mediaSession;
    if (!session || typeof session.setActionHandler !== 'function') {
        return null;
    }
    return session;
}

export function bindMediaSessionHandlers(
    handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>>,
): void {
    const session = getMediaSession();
    if (!session) return;
    for (const [action, handler] of Object.entries(handlers)) {
        try {
            session.setActionHandler(action as MediaSessionAction, handler ?? null);
        } catch {
            // Some WebViews expose mediaSession but reject individual actions.
        }
    }
}

export function setMediaSessionMetadata(init: MediaMetadataInit | null): void {
    const session = getMediaSession();
    if (!session) return;
    try {
        if (init === null || typeof MediaMetadata === 'undefined') {
            session.metadata = null;
            return;
        }
        session.metadata = new MediaMetadata(init);
    } catch {
        // Android WebView may not implement MediaMetadata.
    }
}

export function setMediaSessionPlaybackState(state: MediaSessionPlaybackState): void {
    const session = getMediaSession();
    if (!session) return;
    try {
        session.playbackState = state;
    } catch {
        // playbackState is optional on incomplete mediaSession stubs.
    }
}
