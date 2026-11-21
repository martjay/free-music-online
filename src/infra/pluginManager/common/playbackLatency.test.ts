import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playbackSourceRank } from './playbackLatency.ts';

const proven = new Set(['kuwo', 'qq']);

function rank(hash: string, latency: number | null): number {
    return playbackSourceRank(hash, 'netease', proven, latency);
}

test('sources that already played stay ahead of a faster unchecked source', () => {
    const playedSlow = rank('kuwo', 1200);
    const uncheckedFast = rank('kugou', 400);
    assert.ok(playedSlow < uncheckedFast);
});

test('played sources keep the check-latency order among themselves', () => {
    const qq = rank('qq', 800);
    const kuwo = rank('kuwo', 1200);
    assert.ok(qq < kuwo);
});

test('without a played source, measured platforms stay ahead of the song platform', () => {
    const none = new Set<string>();
    const measured = playbackSourceRank('qq', 'netease', none, 900);
    const original = playbackSourceRank('netease', 'netease', none, null);
    assert.ok(measured < original);
});
