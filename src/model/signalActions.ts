import type { Action, ActionResult } from './actions';
import { uniqueId } from './ids';
import { isLineStyle } from './lineStyle';
import type { LineStyle } from './lineStyle';
import { getNodePorts } from './query';
import type { DiagramDocument } from './types';

const OK: ActionResult = { ok: true };
const fail = (error: NonNullable<ActionResult['error']>): ActionResult => ({ ok: false, error });

/** 色の指定は #RRGGBB のみ受け付ける(色ピッカーの値と、保存ファイルの検証を揃える) */
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** 指定した信号種別を使っているポートの数(図中の全機器)。画面の説明に使う */
export function signalUsage(doc: DiagramDocument, signalId: string): number {
  let count = 0;
  for (const page of doc.pages) {
    for (const n of page.nodes) {
      count += getNodePorts(doc, n).filter((p) => p.signalType === signalId).length;
    }
  }
  return count;
}

/**
 * 削除を止めるべきか。使っているポートがあるか、機器の種類(テンプレート)の定義が参照していれば使用中。
 * 後者を数えるのは、そのテンプレートから機器を追加したとき、種別が無くなって線の色を失わないため。
 */
function isSignalInUse(doc: DiagramDocument, signalId: string): boolean {
  return signalUsage(doc, signalId) > 0 || doc.deviceTemplates.some((t) => t.portGroups.some((g) => g.signalType === signalId));
}

/** 信号種別を追加する。IDは自動採番(名称を変えても参照が切れないよう、IDと表示名は別) */
export function addSignalType(label: string, color: string): Action {
  return (doc) => {
    if (label.trim() === '' || !isHexColor(color)) return fail('invalid-value');
    const id = uniqueId('SIG', doc.signalTypes.map((s) => s.id));
    doc.signalTypes.push({ id, label: label.trim(), color });
    return { ok: true, created: id };
  };
}

/** 信号種別の名称・色を変更する。IDは変えない */
export function updateSignalType(id: string, patch: { label?: string; color?: string; lineStyle?: LineStyle }): Action {
  return (doc) => {
    const s = doc.signalTypes.find((x) => x.id === id);
    if (!s) return fail('unknown-signal');
    if (patch.label !== undefined && patch.label.trim() === '') return fail('invalid-value');
    if (patch.color !== undefined && !isHexColor(patch.color)) return fail('invalid-value');
    if (patch.lineStyle !== undefined && !isLineStyle(patch.lineStyle)) return fail('invalid-value');
    if (patch.label !== undefined) s.label = patch.label.trim();
    if (patch.color !== undefined) s.color = patch.color;
    if (patch.lineStyle === 'solid') delete s.lineStyle; // 実線は既定なので、項目ごと持たない
    else if (patch.lineStyle !== undefined) s.lineStyle = patch.lineStyle;
    return OK;
  };
}

/** 信号種別を削除する。使われている間は削除できない('signal-in-use') */
export function removeSignalType(id: string): Action {
  return (doc) => {
    if (!doc.signalTypes.some((x) => x.id === id)) return fail('unknown-signal');
    if (isSignalInUse(doc, id)) return fail('signal-in-use');
    doc.signalTypes = doc.signalTypes.filter((x) => x.id !== id);
    return OK;
  };
}

/** 凡例の並びを入れ替える(delta: -1 で1つ上、+1 で1つ下。端では何もしない) */
export function moveSignalType(id: string, delta: -1 | 1): Action {
  return (doc) => {
    const i = doc.signalTypes.findIndex((x) => x.id === id);
    if (i < 0) return fail('unknown-signal');
    const j = i + delta;
    if (j < 0 || j >= doc.signalTypes.length) return OK;
    [doc.signalTypes[i], doc.signalTypes[j]] = [doc.signalTypes[j], doc.signalTypes[i]];
    return OK;
  };
}
