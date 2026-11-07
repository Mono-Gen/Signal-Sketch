import { estimateTextWidth } from './nodeSize';

// 機器に設定する画像の規則(上限・形式の判定・画像ヘッダの寸法・表示の領域)。DOM を持たない純関数。
// 画像は図の assets に data URI で入れ、機器の imageId で参照する(取り込み時の縮小・再符号化は io/imageImport.ts)。

/** 取り込める画像の形式。SVG は、中にスクリプトや外部参照を含められるので許さない */
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export const IMAGE_MIMES: readonly ImageMime[] = ['image/png', 'image/jpeg', 'image/webp'];

/** 取り込む元のファイルの大きさの上限(バイト) */
export const MAX_IMAGE_SOURCE_BYTES = 5 * 1024 * 1024;
/** 元の画像の画素数の上限。展開する前にヘッダで確認する(小さなファイルが巨大な画素数に展開される「画像爆弾」を断つ) */
export const MAX_IMAGE_SOURCE_PIXELS = 40_000_000;
/** 保存する画像の長辺の上限(px)。これを超える画像は、縦横比を保って縮小する */
export const MAX_IMAGE_LONG_SIDE = 640;
/** 保存する画像1枚の上限(data URI の文字数) */
export const MAX_IMAGE_DATA_URI_LENGTH = 400 * 1024;
/** 1つの図に入れる画像の枚数と、data URI の文字数の合計の上限 */
export const MAX_IMAGES_PER_DOCUMENT = 50;
export const MAX_IMAGES_TOTAL_LENGTH = 5 * 1024 * 1024;

const DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/;
const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** 保存してよい画像の data URI か(形式・文字・大きさ) */
export function isImageDataUri(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_IMAGE_DATA_URI_LENGTH && DATA_URI.test(value);
}

/** 画像の ID として使える文字列か */
export function isAssetId(value: unknown): boolean {
  return typeof value === 'string' && ASSET_ID.test(value);
}

/** data URI の本文(base64)をバイト列にする。復号できなければ null */
function decodeDataUri(uri: string): Uint8Array | null {
  try {
    const bin = atob(uri.slice(uri.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** data URI の画像の寸法(幅・高さ)。読めなければ null。保存形式に寸法を持たせず、中身のヘッダから読む */
export function imageDataUriSize(uri: unknown): { width: number; height: number } | null {
  if (!isImageDataUri(uri)) return null;
  const bytes = decodeDataUri(uri);
  const header = bytes ? readImageHeader(bytes) : null;
  return header && header.width > 0 && header.height > 0 ? { width: header.width, height: header.height } : null;
}

/**
 * 保存された画像の data URI が、宣言どおりの形式で、取り込みの規則(長辺640px以下)に収まる寸法かを調べる。
 * 取り込み時の縮小は、図のファイルを開く経路には働かない。細工されたファイルが、小さなデータで巨大な画素数に展開される
 * 画像(画像爆弾)を持ち込み、描画でタブを止めないよう、展開する前にヘッダの寸法を確認する。問題があれば説明を返す(なければ null)。
 */
function storedImageIssue(id: string, uri: string): string | null {
  const bytes = decodeDataUri(uri);
  const header = bytes ? readImageHeader(bytes) : null;
  const declared = /^data:(image\/(?:png|jpeg|webp));/.exec(uri)?.[1];
  if (!header || header.mime !== declared) return `画像「${id}」の中身が、宣言された形式(PNG・JPEG・WebP)ではありません`;
  if (!(header.width > 0) || !(header.height > 0) || Math.max(header.width, header.height) > MAX_IMAGE_LONG_SIDE) {
    return `画像「${id}」の大きさが不正です(長辺${MAX_IMAGE_LONG_SIDE}pxまで)`;
  }
  return null;
}

/** 内容のハッシュ(16進)から、画像の ID を作る */
export function assetIdFromHash(hex: string): string {
  return `img-${hex.slice(0, 16)}`;
}

/**
 * 図の assets(画像の一覧)に問題があれば、その説明を返す(なければ null)。
 * 開く図は信頼できない入力なので、画像として使う前に、形式・枚数・大きさを確認する。
 */
export function assetsIssue(assets: unknown): string | null {
  if (assets === undefined) return null;
  if (typeof assets !== 'object' || assets === null || Array.isArray(assets)) return 'assets はオブジェクトである必要があります';
  const entries = Object.entries(assets);
  if (entries.length > MAX_IMAGES_PER_DOCUMENT) return `画像が多すぎます(${MAX_IMAGES_PER_DOCUMENT}枚まで)`;
  let total = 0;
  for (const [id, value] of entries) {
    if (!isAssetId(id)) return `画像のID「${id.slice(0, 40)}」は使えません`;
    if (!isImageDataUri(value)) return `画像「${id}」は、PNG・JPEG・WebP の data URI(${Math.round(MAX_IMAGE_DATA_URI_LENGTH / 1024)}KB以下)である必要があります`;
    const deep = storedImageIssue(id, value);
    if (deep) return deep;
    total += value.length;
  }
  if (total > MAX_IMAGES_TOTAL_LENGTH) return `画像の合計が大きすぎます(${Math.round(MAX_IMAGES_TOTAL_LENGTH / 1024 / 1024)}MBまで)`;
  return null;
}

export interface ImageHeader {
  mime: ImageMime;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const ascii = (b: Uint8Array, i: number, s: string) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));

/**
 * 画像ファイルの先頭のバイト列から、形式と寸法を読む(画像として展開はしない)。
 * PNG・JPEG・WebP(lossy / lossless / extended)に対応。読めなければ null(壊れている・未対応の形式)。
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  // PNG: 署名のあと、IHDR に幅・高さ
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG') && ascii(bytes, 12, 'IHDR')) {
    return { mime: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  // JPEG: マーカーをたどり、SOF(寸法を持つ)を探す
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i += 1; // 詰め物
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2; // 長さを持たないマーカー
        continue;
      }
      i += 2 + u16be(bytes, i + 2);
    }
    return null;
  }
  // WebP: RIFF....WEBP のあと、最初のチャンクで形式が分かれる
  if (bytes.length >= 30 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    if (ascii(bytes, 12, 'VP8 ')) {
      return { mime: 'image/webp', width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    }
    if (ascii(bytes, 12, 'VP8L') && bytes[20] === 0x2f) {
      const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
      const height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
      return { mime: 'image/webp', width, height };
    }
    if (ascii(bytes, 12, 'VP8X')) {
      return {
        mime: 'image/webp',
        width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
      };
    }
  }
  return null;
}

/** 長辺が上限に収まる大きさ(縦横比を保つ。収まっていれば元のまま。1px未満にはしない) */
export function fitLongSide(width: number, height: number, limit = MAX_IMAGE_LONG_SIDE): { w: number; h: number } {
  const long = Math.max(width, height);
  if (long <= limit) return { w: width, h: height };
  const scale = limit / long;
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

// --- 機器の中の画像の領域 ---

/** 名称の行が1行のときの、画像の領域の上端(機器の上端からの距離)の下限 */
export const IMAGE_TOP_MIN = 32;
/** 画像の領域の、左右と下の余白 */
export const IMAGE_PAD = 8;

/** 画像の領域の計算に必要な、機器の項目 */
export interface ImageHost {
  w: number;
  h: number;
  label: string;
  model: string;
  count?: number;
}

/** 文字を、幅に収まるよう折り返したときの行数の見積もり(空なら0行) */
function countLines(text: string, avail: number): number {
  if (text === '') return 0;
  let lines = 1;
  let width = 0;
  for (const ch of text) {
    const w = estimateTextWidth(ch);
    if (width > 0 && width + w > avail) {
      lines += 1;
      width = w;
    } else {
      width += w;
    }
  }
  return lines;
}

/**
 * 画像の領域の上端(機器の上端からの距離)。名称・型番が折り返して行数が増えると、その分だけ下げる(文字と画像が重ならないように)。
 * 行数は文字幅の見積もり(実際の折り返しは、フォントによって少し違う)。SVG出力の行の並びに合わせてある。
 */
export function imageTop(node: ImageHost): number {
  const avail = Math.max(1, node.w - 14 - 2);
  const labelLines = Math.max(1, countLines(node.label, avail));
  const modelText = `${node.model}${node.count && node.count > 1 ? ` ×${node.count}台` : ''}`.trim();
  const modelLines = countLines(modelText, avail);
  return Math.max(IMAGE_TOP_MIN, 18 + 14 * (labelLines - 1) + (modelLines > 0 ? 1 + 13 * modelLines : 0) + 6);
}

/** 機器(位置は含まない)の中の、画像の領域。機器からの相対座標 */
export function imageBox(node: ImageHost): { x: number; y: number; w: number; h: number } {
  const top = imageTop(node);
  return { x: IMAGE_PAD, y: top, w: Math.max(0, node.w - IMAGE_PAD * 2), h: Math.max(0, node.h - top - IMAGE_PAD) };
}

/** 機器の幅に合わせて、画像がちょうど収まる高さ(名称の行 + 画像 + 余白) */
export function nodeHeightForImage(node: ImageHost, imageWidth: number, imageHeight: number): number {
  const top = imageTop(node);
  if (!(imageWidth > 0) || !(imageHeight > 0)) return top + IMAGE_PAD;
  const innerW = Math.max(1, node.w - IMAGE_PAD * 2);
  return Math.ceil(top + (innerW * imageHeight) / imageWidth + IMAGE_PAD);
}
