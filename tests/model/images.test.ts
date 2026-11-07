import { describe, expect, it } from 'vitest';
import {
  assetIdFromHash,
  assetsIssue,
  fitLongSide,
  imageBox,
  imageTop,
  isAssetId,
  isImageDataUri,
  MAX_IMAGE_DATA_URI_LENGTH,
  MAX_IMAGES_PER_DOCUMENT,
  MAX_IMAGES_TOTAL_LENGTH,
  nodeHeightForImage,
  readImageHeader,
} from '../../src/model/images';
import { TINY_PNG } from '../fixtures/tinyImage';

// 画像ファイルは置かず、ヘッダのバイト列と data URI をコードで作って確かめる。期待値は規格(ヘッダの並び)から手で導く。

const bytes = (...parts: (number | string | number[])[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p);
    else if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return Uint8Array.from(out);
};
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

describe('isImageDataUri / isAssetId', () => {
  it('PNG・JPEG・WebP の base64 の data URI だけを受け付ける', () => {
    expect(isImageDataUri(TINY_PNG)).toBe(true);
    expect(isImageDataUri('data:image/jpeg;base64,/9j/AAAA')).toBe(true);
    expect(isImageDataUri('data:image/webp;base64,UklGRg==')).toBe(true);
  });

  it('SVG・GIF・外部の URL・スクリプト・base64 以外の文字・大きすぎるものは断る', () => {
    expect(isImageDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isImageDataUri('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toBe(false);
    expect(isImageDataUri('https://example.com/a.png')).toBe(false);
    expect(isImageDataUri('javascript:alert(1)')).toBe(false);
    expect(isImageDataUri('data:image/png;base64,AAA"onload="x')).toBe(false);
    expect(isImageDataUri('data:image/png;base64,AA AA')).toBe(false);
    expect(isImageDataUri('data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_DATA_URI_LENGTH))).toBe(false);
    expect(isImageDataUri(123)).toBe(false);
    expect(isImageDataUri(undefined)).toBe(false);
  });

  it('画像のIDは、英数字・_・- の1〜64文字', () => {
    expect(isAssetId('img-0123456789abcdef')).toBe(true);
    expect(isAssetId('')).toBe(false);
    expect(isAssetId('a/b')).toBe(false);
    expect(isAssetId('a'.repeat(65))).toBe(false);
    expect(assetIdFromHash('0123456789abcdef0123')).toBe('img-0123456789abcdef');
  });
});

describe('assetsIssue', () => {
  it('未指定・空・正しい画像は問題なし', () => {
    expect(assetsIssue(undefined)).toBeNull();
    expect(assetsIssue({})).toBeNull();
    expect(assetsIssue({ 'img-a': TINY_PNG })).toBeNull();
  });

  it('オブジェクトでない・不正なID・不正な値は問題として返す', () => {
    expect(assetsIssue([])).not.toBeNull();
    expect(assetsIssue(null)).not.toBeNull();
    expect(assetsIssue('x')).not.toBeNull();
    expect(assetsIssue({ 'a/b': TINY_PNG })).not.toBeNull();
    expect(assetsIssue({ 'img-a': 'data:image/svg+xml;base64,AAAA' })).not.toBeNull();
    expect(assetsIssue({ 'img-a': 5 })).not.toBeNull();
  });

  it('枚数と合計の上限を超えると問題として返す', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_IMAGES_PER_DOCUMENT + 1 }, (_, i) => [`img-${i}`, TINY_PNG]));
    expect(assetsIssue(many)).not.toBeNull();
    expect(assetsIssue(Object.fromEntries(Array.from({ length: MAX_IMAGES_PER_DOCUMENT }, (_, i) => [`img-${i}`, TINY_PNG])))).toBeNull();
    // 1枚ずつは上限内でも、合計が上限を超える
    const big = 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_DATA_URI_LENGTH - 30);
    const count = Math.ceil(MAX_IMAGES_TOTAL_LENGTH / big.length) + 1;
    expect(count).toBeLessThanOrEqual(MAX_IMAGES_PER_DOCUMENT);
    expect(assetsIssue(Object.fromEntries(Array.from({ length: count }, (_, i) => [`img-${i}`, big])))).not.toBeNull();
  });
});

describe('readImageHeader', () => {
  it('PNG: IHDR の幅・高さ', () => {
    const png = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(640), be32(480), [8, 6, 0, 0, 0]);
    expect(readImageHeader(png)).toEqual({ mime: 'image/png', width: 640, height: 480 });
  });

  it('JPEG: SOF0 の高さ・幅(手前に別のセグメントがあっても読める)', () => {
    const app0 = [0xff, 0xe0, ...be16(16), ...Array(14).fill(0)];
    const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(133), ...be16(1024), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    expect(readImageHeader(bytes([0xff, 0xd8], app0, sof))).toEqual({ mime: 'image/jpeg', width: 1024, height: 133 });
  });

  it('JPEG: プログレッシブ(SOF2)も読める。DHT(0xC4)は寸法ではない', () => {
    const dht = [0xff, 0xc4, ...be16(5), 0, 0, 0];
    const sof2 = [0xff, 0xc2, ...be16(11), 8, ...be16(300), ...be16(200), 1, 1, 0x11, 0];
    expect(readImageHeader(bytes([0xff, 0xd8], dht, sof2))).toEqual({ mime: 'image/jpeg', width: 200, height: 300 });
  });

  it('WebP: VP8X(拡張)・VP8L(可逆)・VP8(非可逆)', () => {
    const vp8x = bytes('RIFF', be32(0), 'WEBP', 'VP8X', [10, 0, 0, 0], [0, 0, 0, 0], le24(1000 - 1), le24(200 - 1));
    expect(readImageHeader(vp8x)).toEqual({ mime: 'image/webp', width: 1000, height: 200 });

    // VP8L: 署名 0x2f のあと、14ビットの幅-1・高さ-1
    const w = 300 - 1;
    const h = 150 - 1;
    const b1 = w & 255;
    const b2 = ((w >> 8) & 0x3f) | ((h & 3) << 6);
    const b3 = (h >> 2) & 255;
    const b4 = (h >> 10) & 0x0f;
    const vp8l = bytes('RIFF', be32(0), 'WEBP', 'VP8L', [0, 0, 0, 0], [0x2f, b1, b2, b3, b4], Array(5).fill(0)); // 実際のファイルは、この後に画像データが続く
    expect(readImageHeader(vp8l)).toEqual({ mime: 'image/webp', width: 300, height: 150 });

    const vp8 = bytes('RIFF', be32(0), 'WEBP', 'VP8 ', [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], [320 & 255, 320 >> 8, 240 & 255, 240 >> 8]);
    expect(readImageHeader(vp8)).toEqual({ mime: 'image/webp', width: 320, height: 240 });
  });

  it('画像でないバイト列・短すぎるもの・空は null', () => {
    expect(readImageHeader(bytes('hello world, not an image at all.....'))).toBeNull();
    expect(readImageHeader(bytes([0x89], 'PNG'))).toBeNull();
    expect(readImageHeader(new Uint8Array())).toBeNull();
    expect(readImageHeader(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBeNull(); // SOF がない JPEG
    expect(readImageHeader(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'))).toBeNull();
  });
});

describe('fitLongSide', () => {
  it('長辺が上限(640)を超えるときだけ、縦横比を保って縮小する', () => {
    expect(fitLongSide(750, 750)).toEqual({ w: 640, h: 640 });
    expect(fitLongSide(1024, 133)).toEqual({ w: 640, h: 83 }); // 133 × 0.625 = 83.1
    expect(fitLongSide(133, 1024)).toEqual({ w: 83, h: 640 });
    expect(fitLongSide(300, 200)).toEqual({ w: 300, h: 200 });
    expect(fitLongSide(640, 10)).toEqual({ w: 640, h: 10 });
  });

  it('極端な縦横比でも、1px 未満にはしない', () => {
    expect(fitLongSide(1, 4000)).toEqual({ w: 1, h: 640 });
    expect(fitLongSide(100000, 1)).toEqual({ w: 640, h: 1 });
  });
});

describe('機器の中の画像の領域', () => {
  const host = (over: Partial<{ w: number; h: number; label: string; model: string; count: number }> = {}) => ({ w: 160, h: 190, label: 'N', model: '', ...over });

  it('名称が1行で型番がなければ、上端は下限(32)。左右と下に8の余白を残す', () => {
    expect(imageTop(host())).toBe(32);
    expect(imageBox(host())).toEqual({ x: 8, y: 32, w: 144, h: 150 });
  });

  it('型番があれば、その行の分だけ下がる(18 + 1 + 13 + 6 = 38)', () => {
    expect(imageTop(host({ model: 'M1' }))).toBe(38);
  });

  it('台数の表記(×N台)も、型番の行に含めて数える', () => {
    expect(imageTop(host({ count: 3 }))).toBe(38);
  });

  it('名称が折り返して2行になると、その分(14)だけ下がる。幅が広ければ1行のまま', () => {
    const long = '天井スピーカー(会議室A前方・左側)'; // 全角 16 字 ≒ 208px
    expect(imageTop(host({ w: 160, label: long }))).toBeGreaterThan(imageTop(host({ w: 400, label: long })));
    expect(imageTop(host({ w: 400, label: long }))).toBe(32);
    expect(imageTop(host({ w: 160, label: long }))).toBe(38); // 18 + 14×(2-1) + 6
  });

  it('機器が小さすぎても、負の大きさにならない', () => {
    expect(imageBox({ w: 10, h: 20, label: 'N', model: '' })).toEqual({ x: 8, y: 32, w: 0, h: 0 });
  });

  it('機器の幅に合わせた高さ = 名称の行 + 幅に合わせた画像の高さ + 余白', () => {
    expect(nodeHeightForImage(host({ h: 60 }), 750, 750)).toBe(32 + 144 + 8); // 正方形: 184
    expect(nodeHeightForImage(host({ w: 240, h: 90 }), 1024, 133)).toBe(Math.ceil(32 + (224 * 133) / 1024 + 8)); // 横長: 70
  });

  it('寸法が不正なら、領域の高さを持たない最小', () => {
    expect(nodeHeightForImage(host(), 0, 100)).toBe(40);
    expect(nodeHeightForImage(host(), 100, Number.NaN)).toBe(40);
  });
});

describe('assetsIssue: 保存された画像の中身(画像爆弾・偽装の拒否)', () => {
  const png = (w: number, h: number) => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const bytes = [...sig, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0];
    return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
  };

  it('ヘッダの寸法が取り込みの上限(長辺640px)に収まる画像は通る', () => {
    expect(assetsIssue({ 'img-a': png(640, 640) })).toBeNull();
    expect(assetsIssue({ 'img-a': png(1, 640) })).toBeNull();
  });

  it('小さなデータで巨大な画素数に展開される画像(ヘッダが 20000×20000)は、読み込みを断る', () => {
    expect(assetsIssue({ 'img-a': png(20000, 20000) })).not.toBeNull();
    expect(assetsIssue({ 'img-a': png(641, 1) })).not.toBeNull();
    expect(assetsIssue({ 'img-a': png(0, 10) })).not.toBeNull();
  });

  it('中身が画像でない・宣言と形式が違う data URI は断る', () => {
    expect(assetsIssue({ 'img-a': 'data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })).not.toBeNull();
    // PNG の中身を JPEG と宣言している
    expect(assetsIssue({ 'img-a': png(10, 10).replace('image/png', 'image/jpeg') })).not.toBeNull();
    expect(assetsIssue({ 'img-a': 'data:image/webp;base64,UklGRg==' })).not.toBeNull();
  });
});
