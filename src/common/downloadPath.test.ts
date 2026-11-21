import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveDownloadDirectory } from './downloadPath.ts';
import { parseQrcToLrc } from './lyricCodec.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('empty download path uses the fallback directory', () => {
    assert.equal(resolveDownloadDirectory({ configured: '', fallback: 'C:/Music' }), 'C:/Music');
    assert.equal(
        resolveDownloadDirectory({ configured: '.', fallback: '/data/downloads' }),
        '/data/downloads',
    );
});

test('android rejects a download path outside app data', () => {
    assert.equal(
        resolveDownloadDirectory({
            configured: '/storage/emulated/0/Download',
            fallback: '/data/user/0/com.anhe.player/files/downloads',
            restrictToDir: '/data/user/0/com.anhe.player/files',
        }),
        '/data/user/0/com.anhe.player/files/downloads',
    );
    assert.equal(
        resolveDownloadDirectory({
            configured: '/data/user/0/com.anhe.player/files/downloads',
            fallback: '/data/user/0/com.anhe.player/files/downloads',
            restrictToDir: '/data/user/0/com.anhe.player/files',
        }),
        '/data/user/0/com.anhe.player/files/downloads',
    );
});

test('qrc word timings become a normal lyric line', () => {
    const parsed = parseQrcToLrc('[1000,500]你好(0,100)');
    assert.equal(parsed.lyric, '[00:01.000]你好');
    assert.match(parsed.lxlyric, /\[00:01\.000\]<0,100>你好/);
});

test('windows player tools stay in a row and mobile overrides stay gated', () => {
    const player = readFileSync(
        join(root, 'src/renderer/mainWindow/components/layout/PlayerBar/index.scss'),
        'utf8',
    );
    assert.match(player, /&__desktop-tools\s*\{[^}]*display:\s*flex/);

    const app = readFileSync(join(root, 'src/renderer/mainWindow/App.scss'), 'utf8');
    const mobileAt = app.indexOf('html.is-mobile-app');
    assert.ok(mobileAt > 0);
    assert.ok(app.indexOf('.l-player-bar__desktop-tools') > mobileAt);
});
