import { useEffect, useState } from 'react';

export type RadioProxyMode = 'system' | 'direct' | 'custom';

interface RadioProxyState {
    mode: RadioProxyMode;
    customUrl: string;
}

const STORAGE_KEY = 'radio-proxy:v1';
const listeners = new Set<(state: RadioProxyState) => void>();

function readState(): RadioProxyState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { mode: 'system', customUrl: '' };
        const parsed = JSON.parse(raw) as Partial<RadioProxyState>;
        const mode =
            parsed.mode === 'direct' || parsed.mode === 'custom' || parsed.mode === 'system'
                ? parsed.mode
                : 'system';
        const customUrl = typeof parsed.customUrl === 'string' ? parsed.customUrl : '';
        if (mode === 'custom' && !customUrl) return { mode: 'system', customUrl: '' };
        return { mode, customUrl };
    } catch {
        return { mode: 'system', customUrl: '' };
    }
}

let state = readState();

function commit(next: RadioProxyState): void {
    state = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // 无痕模式只保留本次会话
    }
    for (const listener of listeners) listener(state);
}

/** 传给 Rust 的代理说明：direct、system，或完整代理 URL。 */
export function getRadioProxySpec(): string {
    if (state.mode === 'direct') return 'direct';
    if (state.mode === 'custom' && state.customUrl) return state.customUrl;
    return 'system';
}

export function getRadioProxyState(): RadioProxyState {
    return state;
}

export function setRadioProxyMode(mode: RadioProxyMode): void {
    if (mode === 'custom' && !state.customUrl) {
        commit({ ...state, mode: 'system' });
        return;
    }
    commit({ ...state, mode });
}

/** 保存自定义代理并立即启用。空字符串或无法识别的地址返回 false。 */
export function applyCustomRadioProxy(input: string): boolean {
    const customUrl = normalizeProxyInput(input);
    if (!customUrl) return false;
    commit({ mode: 'custom', customUrl });
    return true;
}

export function normalizeProxyInput(input: string): string | null {
    const text = input.trim();
    if (!text || /\s/.test(text)) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
    try {
        const url = new URL(withScheme);
        if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)) return null;
        if (!url.hostname || !url.port) return null;
        return url.href;
    } catch {
        return null;
    }
}

export function useRadioProxy(): RadioProxyState {
    const [snapshot, setSnapshot] = useState(state);
    useEffect(() => {
        const listener = (next: RadioProxyState) => setSnapshot(next);
        listeners.add(listener);
        setSnapshot(state);
        return () => {
            listeners.delete(listener);
        };
    }, []);
    return snapshot;
}
