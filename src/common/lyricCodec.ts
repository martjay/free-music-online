/**
 * Lyric codecs aligned with LX Music Desktop:
 * - QQ QRC: 3DES-ECB + zlib inflate
 * - Kugou KRC: XOR + zlib inflate (+ [language:] translation)
 * - Kuwo lyricx: inflate + yeelion XOR + duplicate-timestamp translation split
 */

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/\s+/g, '');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
}

function utf8Decode(bytes: Uint8Array): string {
    return new TextDecoder('utf-8').decode(bytes);
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
    try {
        const ds = new DecompressionStream('deflate');
        const ab = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
        return new Uint8Array(ab);
    } catch {
        const raw =
            data.length > 6
                ? data.subarray(2, data.length - 4)
                : data.length > 2
                  ? data.subarray(2)
                  : data;
        const ds = new DecompressionStream('deflate-raw');
        const ab = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
        return new Uint8Array(ab);
    }
}

export function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// ===== QQ QRC =====
const DES_ENCRYPT = 1;
const DES_DECRYPT = 0;

// DES S-box。注意：QRC 使用的是非标准 DES 变体，
// 其中 S2[23]=15、S4[53]=10 两处与标准 DES 不同（标准为 14、1）。
// 这两个值与原 native 插件（qrc_decode.node）二进制完全一致，不可改为标准值，
// 否则解密结果错误。下表逐字节对应原 C++ 实现。
const sbox = [
    [
        14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12,
        11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1,
        7, 5, 11, 3, 14, 10, 0, 6, 13,
    ],
    [
        15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1,
        10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15,
        4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
    ],
    [
        10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14,
        12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8,
        7, 4, 15, 14, 3, 11, 5, 2, 12,
    ],
    [
        7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2,
        12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10,
        13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
    ],
    [
        2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15,
        10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14,
        2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
    ],
    [
        12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13,
        14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5,
        15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
    ],
    [
        4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5,
        12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4,
        10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
    ],
    [
        13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6,
        11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10,
        8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
    ],
];

const key_rnd_shift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const key_perm_c = [
    56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59,
    51, 43, 35,
];
const key_perm_d = [
    62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27,
    19, 11, 3,
];
const key_compression = [
    13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51,
    30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
];

// 全部以无符号 32 位处理，>>> 0 保证溢出行为与 C++ uint32_t 一致
const bitnum = (a, b, c) =>
    (((a[((b / 32) | 0) * 4 + 3 - (((b % 32) / 8) | 0)] >>> (7 - (b % 8))) & 1) << c) >>> 0;

const bitnum_intr = (a, b, c) => (((a >>> (31 - b)) & 1) << c) >>> 0;

const bitnum_intl = (a, b, c) => (((((a << b) >>> 0) & 0x80000000) >>> 0) >>> c) >>> 0;

const sbox_bit = (a) => (a & 32) | ((a & 31) >>> 1) | ((a & 1) << 4);

// 初始置换：返回 [s0, s1]
const initial_permutation = (input) => {
    const s0 =
        (bitnum(input, 57, 31) |
            bitnum(input, 49, 30) |
            bitnum(input, 41, 29) |
            bitnum(input, 33, 28) |
            bitnum(input, 25, 27) |
            bitnum(input, 17, 26) |
            bitnum(input, 9, 25) |
            bitnum(input, 1, 24) |
            bitnum(input, 59, 23) |
            bitnum(input, 51, 22) |
            bitnum(input, 43, 21) |
            bitnum(input, 35, 20) |
            bitnum(input, 27, 19) |
            bitnum(input, 19, 18) |
            bitnum(input, 11, 17) |
            bitnum(input, 3, 16) |
            bitnum(input, 61, 15) |
            bitnum(input, 53, 14) |
            bitnum(input, 45, 13) |
            bitnum(input, 37, 12) |
            bitnum(input, 29, 11) |
            bitnum(input, 21, 10) |
            bitnum(input, 13, 9) |
            bitnum(input, 5, 8) |
            bitnum(input, 63, 7) |
            bitnum(input, 55, 6) |
            bitnum(input, 47, 5) |
            bitnum(input, 39, 4) |
            bitnum(input, 31, 3) |
            bitnum(input, 23, 2) |
            bitnum(input, 15, 1) |
            bitnum(input, 7, 0)) >>>
        0;
    const s1 =
        (bitnum(input, 56, 31) |
            bitnum(input, 48, 30) |
            bitnum(input, 40, 29) |
            bitnum(input, 32, 28) |
            bitnum(input, 24, 27) |
            bitnum(input, 16, 26) |
            bitnum(input, 8, 25) |
            bitnum(input, 0, 24) |
            bitnum(input, 58, 23) |
            bitnum(input, 50, 22) |
            bitnum(input, 42, 21) |
            bitnum(input, 34, 20) |
            bitnum(input, 26, 19) |
            bitnum(input, 18, 18) |
            bitnum(input, 10, 17) |
            bitnum(input, 2, 16) |
            bitnum(input, 60, 15) |
            bitnum(input, 52, 14) |
            bitnum(input, 44, 13) |
            bitnum(input, 36, 12) |
            bitnum(input, 28, 11) |
            bitnum(input, 20, 10) |
            bitnum(input, 12, 9) |
            bitnum(input, 4, 8) |
            bitnum(input, 62, 7) |
            bitnum(input, 54, 6) |
            bitnum(input, 46, 5) |
            bitnum(input, 38, 4) |
            bitnum(input, 30, 3) |
            bitnum(input, 22, 2) |
            bitnum(input, 14, 1) |
            bitnum(input, 6, 0)) >>>
        0;
    return [s0, s1];
};

// 逆置换：将 s0/s1 写回 8 字节 out
const inverse_permutation = (s0, s1, out) => {
    out[3] =
        (bitnum_intr(s1, 7, 7) |
            bitnum_intr(s0, 7, 6) |
            bitnum_intr(s1, 15, 5) |
            bitnum_intr(s0, 15, 4) |
            bitnum_intr(s1, 23, 3) |
            bitnum_intr(s0, 23, 2) |
            bitnum_intr(s1, 31, 1) |
            bitnum_intr(s0, 31, 0)) &
        0xff;
    out[2] =
        (bitnum_intr(s1, 6, 7) |
            bitnum_intr(s0, 6, 6) |
            bitnum_intr(s1, 14, 5) |
            bitnum_intr(s0, 14, 4) |
            bitnum_intr(s1, 22, 3) |
            bitnum_intr(s0, 22, 2) |
            bitnum_intr(s1, 30, 1) |
            bitnum_intr(s0, 30, 0)) &
        0xff;
    out[1] =
        (bitnum_intr(s1, 5, 7) |
            bitnum_intr(s0, 5, 6) |
            bitnum_intr(s1, 13, 5) |
            bitnum_intr(s0, 13, 4) |
            bitnum_intr(s1, 21, 3) |
            bitnum_intr(s0, 21, 2) |
            bitnum_intr(s1, 29, 1) |
            bitnum_intr(s0, 29, 0)) &
        0xff;
    out[0] =
        (bitnum_intr(s1, 4, 7) |
            bitnum_intr(s0, 4, 6) |
            bitnum_intr(s1, 12, 5) |
            bitnum_intr(s0, 12, 4) |
            bitnum_intr(s1, 20, 3) |
            bitnum_intr(s0, 20, 2) |
            bitnum_intr(s1, 28, 1) |
            bitnum_intr(s0, 28, 0)) &
        0xff;
    out[7] =
        (bitnum_intr(s1, 3, 7) |
            bitnum_intr(s0, 3, 6) |
            bitnum_intr(s1, 11, 5) |
            bitnum_intr(s0, 11, 4) |
            bitnum_intr(s1, 19, 3) |
            bitnum_intr(s0, 19, 2) |
            bitnum_intr(s1, 27, 1) |
            bitnum_intr(s0, 27, 0)) &
        0xff;
    out[6] =
        (bitnum_intr(s1, 2, 7) |
            bitnum_intr(s0, 2, 6) |
            bitnum_intr(s1, 10, 5) |
            bitnum_intr(s0, 10, 4) |
            bitnum_intr(s1, 18, 3) |
            bitnum_intr(s0, 18, 2) |
            bitnum_intr(s1, 26, 1) |
            bitnum_intr(s0, 26, 0)) &
        0xff;
    out[5] =
        (bitnum_intr(s1, 1, 7) |
            bitnum_intr(s0, 1, 6) |
            bitnum_intr(s1, 9, 5) |
            bitnum_intr(s0, 9, 4) |
            bitnum_intr(s1, 17, 3) |
            bitnum_intr(s0, 17, 2) |
            bitnum_intr(s1, 25, 1) |
            bitnum_intr(s0, 25, 0)) &
        0xff;
    out[4] =
        (bitnum_intr(s1, 0, 7) |
            bitnum_intr(s0, 0, 6) |
            bitnum_intr(s1, 8, 5) |
            bitnum_intr(s0, 8, 4) |
            bitnum_intr(s1, 16, 3) |
            bitnum_intr(s0, 16, 2) |
            bitnum_intr(s1, 24, 1) |
            bitnum_intr(s0, 24, 0)) &
        0xff;
};

// Feistel 轮函数 f(state, key)
const des_f = (state, key) => {
    const t1 =
        (bitnum_intl(state, 31, 0) |
            (((state & 0xf0000000) >>> 0) >>> 1) |
            bitnum_intl(state, 4, 5) |
            bitnum_intl(state, 3, 6) |
            (((state & 0x0f000000) >>> 0) >>> 3) |
            bitnum_intl(state, 8, 11) |
            bitnum_intl(state, 7, 12) |
            (((state & 0x00f00000) >>> 0) >>> 5) |
            bitnum_intl(state, 12, 17) |
            bitnum_intl(state, 11, 18) |
            (((state & 0x000f0000) >>> 0) >>> 7) |
            bitnum_intl(state, 16, 23)) >>>
        0;
    const t2 =
        (bitnum_intl(state, 15, 0) |
            (((state & 0x0000f000) << 15) >>> 0) |
            bitnum_intl(state, 20, 5) |
            bitnum_intl(state, 19, 6) |
            (((state & 0x00000f00) << 13) >>> 0) |
            bitnum_intl(state, 24, 11) |
            bitnum_intl(state, 23, 12) |
            (((state & 0x000000f0) << 11) >>> 0) |
            bitnum_intl(state, 28, 17) |
            bitnum_intl(state, 27, 18) |
            (((state & 0x0000000f) << 9) >>> 0) |
            bitnum_intl(state, 0, 23)) >>>
        0;

    const lrgstate = [
        (t1 >>> 24) & 0xff,
        (t1 >>> 16) & 0xff,
        (t1 >>> 8) & 0xff,
        (t2 >>> 24) & 0xff,
        (t2 >>> 16) & 0xff,
        (t2 >>> 8) & 0xff,
    ];
    for (let i = 0; i < 6; i++) lrgstate[i] ^= key[i];

    let s =
        ((sbox[0][sbox_bit(lrgstate[0] >>> 2)] << 28) |
            (sbox[1][sbox_bit(((lrgstate[0] & 0x03) << 4) | (lrgstate[1] >>> 4))] << 24) |
            (sbox[2][sbox_bit(((lrgstate[1] & 0x0f) << 2) | (lrgstate[2] >>> 6))] << 20) |
            (sbox[3][sbox_bit(lrgstate[2] & 0x3f)] << 16) |
            (sbox[4][sbox_bit(lrgstate[3] >>> 2)] << 12) |
            (sbox[5][sbox_bit(((lrgstate[3] & 0x03) << 4) | (lrgstate[4] >>> 4))] << 8) |
            (sbox[6][sbox_bit(((lrgstate[4] & 0x0f) << 2) | (lrgstate[5] >>> 6))] << 4) |
            sbox[7][sbox_bit(lrgstate[5] & 0x3f)]) >>>
        0;

    return (
        (bitnum_intl(s, 15, 0) |
            bitnum_intl(s, 6, 1) |
            bitnum_intl(s, 19, 2) |
            bitnum_intl(s, 20, 3) |
            bitnum_intl(s, 28, 4) |
            bitnum_intl(s, 11, 5) |
            bitnum_intl(s, 27, 6) |
            bitnum_intl(s, 16, 7) |
            bitnum_intl(s, 0, 8) |
            bitnum_intl(s, 14, 9) |
            bitnum_intl(s, 22, 10) |
            bitnum_intl(s, 25, 11) |
            bitnum_intl(s, 4, 12) |
            bitnum_intl(s, 17, 13) |
            bitnum_intl(s, 30, 14) |
            bitnum_intl(s, 9, 15) |
            bitnum_intl(s, 1, 16) |
            bitnum_intl(s, 7, 17) |
            bitnum_intl(s, 23, 18) |
            bitnum_intl(s, 13, 19) |
            bitnum_intl(s, 31, 20) |
            bitnum_intl(s, 26, 21) |
            bitnum_intl(s, 2, 22) |
            bitnum_intl(s, 8, 23) |
            bitnum_intl(s, 18, 24) |
            bitnum_intl(s, 12, 25) |
            bitnum_intl(s, 29, 26) |
            bitnum_intl(s, 5, 27) |
            bitnum_intl(s, 21, 28) |
            bitnum_intl(s, 10, 29) |
            bitnum_intl(s, 3, 30) |
            bitnum_intl(s, 24, 31)) >>>
        0
    );
};

// 单次 DES 加/解密一个 8 字节分组（轮密钥 schedule 为 16x6）
const des_crypt = (input, schedule, output) => {
    let [s0, s1] = initial_permutation(input);
    for (let i = 0; i < 15; i++) {
        const prev = s1;
        s1 = (des_f(s1, schedule[i]) ^ s0) >>> 0;
        s0 = prev;
    }
    s0 = (des_f(s1, schedule[15]) ^ s0) >>> 0;
    inverse_permutation(s0, s1, output);
};

// 生成 16 轮子密钥
const key_schedule = (key, mode) => {
    const schedule = Array.from({ length: 16 }, () => new Uint8Array(6));
    let c = 0;
    let d = 0;
    for (let i = 0; i < 28; i++) {
        c = (c | bitnum(key, key_perm_c[i], 31 - i)) >>> 0;
        d = (d | bitnum(key, key_perm_d[i], 31 - i)) >>> 0;
    }
    for (let i = 0; i < 16; i++) {
        c =
            ((((c << key_rnd_shift[i]) >>> 0) | (c >>> (28 - key_rnd_shift[i]))) & 0xfffffff0) >>>
            0;
        d =
            ((((d << key_rnd_shift[i]) >>> 0) | (d >>> (28 - key_rnd_shift[i]))) & 0xfffffff0) >>>
            0;
        const togen = mode === DES_DECRYPT ? 15 - i : i;
        for (let j = 0; j < 24; j++) {
            schedule[togen][(j / 8) | 0] |= bitnum_intr(c, key_compression[j], 7 - (j % 8));
        }
        for (let j = 24; j < 48; j++) {
            schedule[togen][(j / 8) | 0] |= bitnum_intr(d, key_compression[j] - 27, 7 - (j % 8));
        }
    }
    return schedule;
};

// 3DES（EDE3）密钥编排，返回 3 组 schedule
const tripledes_key_setup = (key, mode) => {
    if (mode === DES_ENCRYPT) {
        return [
            key_schedule(key.subarray(0, 8), DES_ENCRYPT),
            key_schedule(key.subarray(8, 16), DES_DECRYPT),
            key_schedule(key.subarray(16, 24), DES_ENCRYPT),
        ];
    }
    return [
        key_schedule(key.subarray(16, 24), DES_DECRYPT),
        key_schedule(key.subarray(8, 16), DES_ENCRYPT),
        key_schedule(key.subarray(0, 8), DES_DECRYPT),
    ];
};

// 3DES 加/解密一个 8 字节分组
const tripledes_crypt = (input, schedule, output) => {
    const buf = new Uint8Array(8);
    des_crypt(input, schedule[0], buf);
    des_crypt(buf, schedule[1], output);
    des_crypt(output, schedule[2], buf);
    output.set(buf);
};

// QRC 固定密钥：!@#)(*$%123ZXC!@!@#)(NHL
const QRC_KEY: Uint8Array = Uint8Array.from([
    0x21, 0x40, 0x23, 0x29, 0x28, 0x2a, 0x24, 0x25, 0x31, 0x32, 0x33, 0x5a, 0x58, 0x43, 0x21, 0x40,
    0x21, 0x40, 0x23, 0x29, 0x28, 0x4e, 0x48, 0x4c,
]);

export async function decodeQrc(hexData: string): Promise<string> {
    if (!hexData || hexData.length % 2 !== 0) return '';
    const encrypted = hexToBytes(hexData);
    if (encrypted.length === 0) return '';

    const schedule = tripledes_key_setup(QRC_KEY, DES_DECRYPT);
    const block = new Uint8Array(8);
    for (let i = 0; i + 8 <= encrypted.length; i += 8) {
        tripledes_crypt(encrypted.subarray(i, i + 8), schedule, block);
        encrypted.set(block, i);
    }

    try {
        const inflated = await inflateZlib(encrypted);
        return utf8Decode(inflated);
    } catch {
        return '';
    }
}

/** Convert QQ QRC timed lyric ([ms,dur]word(offset,len)...) to standard LRC + strip word timings. */
export function parseQrcToLrc(lrc: string): { lyric: string; lxlyric: string } {
    lrc = (lrc || '').trim().replace(/\r/g, '');
    if (!lrc) return { lyric: '', lxlyric: '' };
    // Strip XML wrapper if present
    lrc = lrc.replace(/^[\S\s]*?LyricContent="/, '').replace(/"\/>[\S\s]*?$/, '');
    const lines = lrc.split('\n');
    const lrcLines: string[] = [];
    const lxlrcLines: string[] = [];
    const lineTime = /^\[(\d+),\d+\]/;
    const lineTime2 = /^\[([\d:.]+)\]/;
    const wordTime = /\(\d+,\d+\)/;
    const wordTimeAll = /(\(\d+,\d+\))/g;

    const msFormat = (timeMs: number) => {
        if (Number.isNaN(timeMs)) return '';
        let ms = (timeMs % 1000).toString().padStart(3, '0');
        timeMs = Math.floor(timeMs / 1000);
        const m = Math.floor(timeMs / 60)
            .toString()
            .padStart(2, '0');
        const s = Math.floor(timeMs % 60)
            .toString()
            .padStart(2, '0');
        return `[${m}:${s}.${ms}]`;
    };

    for (let line of lines) {
        line = line.trim();
        const result = lineTime.exec(line);
        if (!result) {
            if (line.startsWith('[offset')) {
                lxlrcLines.push(line);
                lrcLines.push(line);
            }
            if (lineTime2.test(line)) lrcLines.push(line);
            continue;
        }
        const startMsTime = parseInt(result[1]!, 10);
        const startTimeStr = msFormat(startMsTime);
        if (!startTimeStr) continue;
        let words = line.replace(lineTime, '');
        lrcLines.push(`${startTimeStr}${words.replace(wordTimeAll, '')}`);
        const times = words.match(wordTimeAll);
        if (!times) continue;
        const mapped = times.map((time) => {
            const r = /\((\d+),(\d+)\)/.exec(time)!;
            return `<${Math.trunc(Math.max(parseInt(r[1]!, 10) - startMsTime, 0))},${r[2]}>`;
        });
        const wordArr = words.split(wordTime);
        const newWords = mapped.map((time, index) => `${time}${wordArr[index]}`).join('');
        lxlrcLines.push(`${startTimeStr}${newWords}`);
    }
    return { lyric: lrcLines.join('\n'), lxlyric: lxlrcLines.join('\n') };
}

export function fixTlrcTimeTag(tlrc: string, lrc: string): string {
    const lineTime2 = /^\[([\d:.]+)\]/;
    const getIntv = (interval: string) => {
        if (!interval) return 0;
        if (!interval.includes('.')) interval += '.0';
        const arr = interval.split(/:|\./);
        while (arr.length < 3) arr.unshift('0');
        const [m, s, ms] = arr;
        return parseInt(m!, 10) * 3600000 + parseInt(s!, 10) * 1000 + parseInt(ms!, 10);
    };
    const tlrcLines = tlrc.split('\n');
    let lrcLines = lrc.split('\n');
    const newLrc: string[] = [];
    for (const line of tlrcLines) {
        const result = lineTime2.exec(line);
        if (!result) continue;
        const words = line.replace(lineTime2, '');
        if (!words.trim()) continue;
        let time = result[1]!;
        if (time.includes('.')) {
            time += ''.padStart(3 - time.split('.')[1]!.length, '0');
        }
        const t1 = getIntv(time);
        while (lrcLines.length) {
            const lrcLine = lrcLines.shift()!;
            const lrcLineResult = lineTime2.exec(lrcLine);
            if (!lrcLineResult) continue;
            const t2 = getIntv(lrcLineResult[1]!);
            if (Math.abs(t1 - t2) < 100) {
                newLrc.push(line.replace(lineTime2, lrcLineResult[0]!));
                break;
            }
        }
    }
    return newLrc.join('\n');
}

// ===== Kugou KRC =====
const KRC_KEY = new Uint8Array([
    0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
]);

async function decodeKrcRaw(base64Content: string): Promise<string> {
    if (!base64Content) return '';
    const all = base64ToBytes(base64Content);
    if (all.length <= 4) return '';
    const buf = all.subarray(4);
    for (let i = 0; i < buf.length; i++) {
        buf[i] = buf[i]! ^ KRC_KEY[i % 16]!;
    }
    const inflated = await inflateZlib(buf);
    return utf8Decode(inflated);
}

export async function decodeKrc(base64Content: string): Promise<{ lyric: string; tlyric: string }> {
    let str = await decodeKrcRaw(base64Content);
    str = str.replace(/\r/g, '');
    const headExp = /^.*\[id:\$\w+\]\n/;
    if (headExp.test(str)) str = str.replace(headExp, '');

    let tlyricArr: string[][] | null = null;
    const trans = str.match(/\[language:([\w=\\/+]+)\]/);
    if (trans) {
        str = str.replace(/\[language:[\w=\\/+]+\]\n?/, '');
        try {
            const json = JSON.parse(utf8Decode(base64ToBytes(trans[1]!)));
            for (const item of json.content || []) {
                if (item?.type === 1) tlyricArr = item.lyricContent;
            }
        } catch {
            /* ignore */
        }
    }

    let i = 0;
    let lxlyric = str.replace(/\[((\d+),\d+)\].*/g, (full) => {
        const result = full.match(/\[((\d+),\d+)\].*/);
        if (!result) return full;
        let time = parseInt(result[2]!, 10);
        const ms = (time % 1000).toString().padStart(3, '0');
        time = Math.floor(time / 1000);
        const m = Math.floor(time / 60)
            .toString()
            .padStart(2, '0');
        const s = Math.floor(time % 60)
            .toString()
            .padStart(2, '0');
        const timeLabel = `${m}:${s}.${ms}`;
        if (tlyricArr) {
            (tlyricArr as any)[i] = `[${timeLabel}]${(tlyricArr[i] || []).join('')}`;
        }
        i++;
        return full.replace(result[1]!, timeLabel);
    });

    lxlyric = lxlyric.replace(/<(\d+,\d+),\d+>/g, '<$1>');
    const lyric = lxlyric.replace(/<\d+,\d+>/g, '');
    const tlyric = tlyricArr ? (tlyricArr as any as string[]).join('\n') : '';
    return { lyric, tlyric };
}

// ===== Kuwo lyricx =====
const YEELION_KEY = new TextEncoder().encode('yeelion');

export async function decodeKuwoLyricx(
    rawBase64OrBytes: string | Uint8Array,
    isGetLyricx = true,
): Promise<string> {
    const buf =
        typeof rawBase64OrBytes === 'string' ? base64ToBytes(rawBase64OrBytes) : rawBase64OrBytes;
    const head = utf8Decode(buf.subarray(0, Math.min(buf.length, 10))).toLowerCase();
    if (head !== 'tp=content') return '';
    let sep = -1;
    for (let i = 0; i + 3 < buf.length; i++) {
        if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
            sep = i;
            break;
        }
    }
    if (sep < 0) return '';
    const inflated = await inflateZlib(buf.subarray(sep + 4));
    if (!isGetLyricx) return utf8Decode(inflated);

    // lyricx body is base64 then XOR with 'yeelion' repeating
    const b64Text = utf8Decode(inflated).trim();
    const enc = base64ToBytes(b64Text);
    const out = new Uint8Array(enc.length);
    for (let i = 0; i < enc.length; ) {
        for (let j = 0; j < YEELION_KEY.length && i < enc.length; j++, i++) {
            out[i] = enc[i]! ^ YEELION_KEY[j]!;
        }
    }
    return utf8Decode(out);
}

const lyricxTag = /^<-?\d+,-?\d+>/;

export function parseKuwoLrc(lrc: string): { lyric: string; tlyric: string } {
    const timeExp = /^\[([\d:.]*)\]/;
    const tagLine = /\[(ver|ti|ar|al|offset|by|kuwo):\s*(\S+(?:\s+\S+)*)\s*\]/;
    const lines = lrc.split(/\r\n|\r|\n/);
    const tags: string[] = [];
    const lrcArr: Array<{ time: string; text: string }> = [];
    for (const raw of lines) {
        const line = raw.trim();
        timeExp.lastIndex = 0;
        const result = timeExp.exec(line);
        if (result) {
            let text = line.replace(timeExp, '').trim();
            let time = result[1]!;
            if (/\.\d\d$/.test(time)) time += '0';
            lrcArr.push({ time, text });
        } else if (tagLine.test(line)) {
            tags.push(line);
        }
    }

    const lrcSet = new Set<string>();
    const lrcOut: Array<{ time: string; text: string }> = [];
    const lrcT: Array<{ time: string; text: string }> = [];
    let isLyricx = false;
    for (const item of lrcArr) {
        if (lrcSet.has(item.time)) {
            if (lrcOut.length < 2) continue;
            const tItem = lrcOut.pop()!;
            tItem.time = lrcOut[lrcOut.length - 1]!.time;
            lrcT.push(tItem);
            lrcOut.push(item);
        } else {
            lrcOut.push(item);
            lrcSet.add(item.time);
        }
        if (!isLyricx && lyricxTag.test(item.text)) isLyricx = true;
    }
    if (!isLyricx && lrcT.length > lrcOut.length * 0.3 && lrcOut.length - lrcT.length > 6) {
        // LX treats this as failed translation split — keep all as lyric
        return {
            lyric: `${tags.join('\n')}\n${lrcArr.map((l) => `[${l.time}]${l.text}`).join('\n')}`,
            tlyric: '',
        };
    }

    const wordTimeAll = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;
    const lyric =
        `${tags.join('\n')}\n${lrcOut.map((l) => `[${l.time}]${l.text}`).join('\n')}`.replace(
            wordTimeAll,
            '',
        );
    const tlyric = lrcT.length
        ? `${tags.join('\n')}\n${lrcT.map((l) => `[${l.time}]${l.text}`).join('\n')}`.replace(
              wordTimeAll,
              '',
          )
        : '';
    return { lyric, tlyric };
}
