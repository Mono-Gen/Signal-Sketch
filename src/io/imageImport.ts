import {
  assetIdFromHash,
  fitLongSide,
  IMAGE_MIMES,
  isImageDataUri,
  MAX_IMAGE_DATA_URI_LENGTH,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_IMAGE_SOURCE_PIXELS,
  readImageHeader,
} from '../model/images';
import type { NodeImage } from '../model/imageActions';

// 利用者が選んだ画像ファイルを、図に入れられる形(縮小・再符号化した data URI)にする。ブラウザの API を使う。
// 責任: ファイルの確認(種類・大きさ・画素数)と、縮小・再符号化。対象外: 規則そのもの(model/images)、機器への設定(model/imageActions)。

export type ImageImportError =
  | 'unsupported-type' // PNG・JPEG・WebP 以外
  | 'file-too-large' // 元のファイルが大きすぎる
  | 'unreadable' // 壊れている・読めない
  | 'too-many-pixels' // 画素数が多すぎる(展開する前に断る)
  | 'result-too-large'; // 縮小しても、保存の上限に収まらない

export type ImageImportResult = { ok: true; image: NodeImage } | { ok: false; error: ImageImportError };

/** 再符号化の品質と縮小の段階(上限に収まるまで、順に試す) */
const ATTEMPTS: readonly { quality: number; scale: number }[] = [
  { quality: 0.85, scale: 1 },
  { quality: 0.7, scale: 1 },
  { quality: 0.6, scale: 0.75 },
  { quality: 0.5, scale: 0.5 },
];

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 透明な画素が1つでもあるか(不透明なら JPEG にして、保存の大きさを抑える) */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * 画像ファイルを取り込む。長辺を上限まで縮小し、不透明なら JPEG、透明を含むなら PNG に再符号化する(元の画像は残さない)。
 * 展開する前に、種類・ファイルの大きさ・画素数を確認し、極端に大きな画像は断る。
 */
export async function prepareImage(file: File): Promise<ImageImportResult> {
  try {
    return await prepare(file);
  } catch {
    return { ok: false, error: 'unreadable' }; // ファイルの読み込み・キャンバス・符号化の失敗は、読めない画像として扱う
  }
}

async function prepare(file: File): Promise<ImageImportResult> {
  if (file.size > MAX_IMAGE_SOURCE_BYTES) return { ok: false, error: 'file-too-large' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = readImageHeader(bytes);
  // 拡張子や file.type は偽れるので、中身(ヘッダ)で形式を決める
  if (!header || !IMAGE_MIMES.includes(header.mime)) return { ok: false, error: 'unsupported-type' };
  if (!(header.width > 0) || !(header.height > 0)) return { ok: false, error: 'unreadable' };
  if (header.width * header.height > MAX_IMAGE_SOURCE_PIXELS) return { ok: false, error: 'too-many-pixels' };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: header.mime }));
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  try {
    for (const attempt of ATTEMPTS) {
      const base = fitLongSide(bitmap.width, bitmap.height);
      const w = Math.max(1, Math.round(base.w * attempt.scale));
      const h = Math.max(1, Math.round(base.h * attempt.scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { ok: false, error: 'unreadable' };
      ctx.drawImage(bitmap, 0, 0, w, h);
      // 透明を含む画像は PNG のまま(JPEG にすると、透明が黒や白に潰れる)。不透明なら JPEG にして小さくする
      const transparent = header.mime !== 'image/jpeg' && hasTransparency(ctx, w, h);
      const dataUri = transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', attempt.quality);
      if (dataUri.length <= MAX_IMAGE_DATA_URI_LENGTH && isImageDataUri(dataUri)) {
        return { ok: true, image: { id: assetIdFromHash(await sha256Hex(dataUri)), dataUri, width: w, height: h } };
      }
    }
    return { ok: false, error: 'result-too-large' };
  } finally {
    bitmap.close();
  }
}
