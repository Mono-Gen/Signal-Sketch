import { usedAssets } from '../model/imageActions';
import { validateDocument } from '../model/validate';
import type { DiagramDocument } from '../model/types';

/** 図のファイルとして読み込む上限(バイト)。通常の図は数百KB。極端に大きなファイルで、メモリを使い切らないための上限 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export function serializeDocument(doc: DiagramDocument): string {
  // どの機器・登録テンプレートからも使われていない画像は保存しない(外した画像で、ファイルが膨らまないように)
  return JSON.stringify({ ...doc, assets: usedAssets(doc) }, null, 2);
}

export type ParseResult = { ok: true; doc: DiagramDocument } | { ok: false; errors: string[] };

/** 保存されたJSONを読み込む。構文エラーも検証エラーも、原因が分かる形で返す */
export function parseDocument(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`JSONとして読み込めません: ${(err as Error).message}`] };
  }
  let result: ReturnType<typeof validateDocument>;
  try {
    result = validateDocument(data);
  } catch (err) {
    // 想定外の構造で検証が例外になっても、読み込み失敗の理由として返す(何も表示されないままにしない)
    return { ok: false, errors: [`ファイルの内容を検証できませんでした: ${(err as Error).message}`] };
  }
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, doc: data as DiagramDocument };
}
