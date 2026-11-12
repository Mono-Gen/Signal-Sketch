import type { Action, ActionResult } from './actions';
import { uniqueId } from './ids';
import { isLineStyle } from './lineStyle';
import type { LineStyle } from './lineStyle';
import { getNodePorts } from './query';
import type { DiagramDocument, SignalType } from './types';

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
  return doc.pages.some((p) => p.nodes.some((n) => n.portGroupsOverride?.some((g) => g.signalType === signalId))) || signalUsage(doc, signalId) > 0 || doc.deviceTemplates.some((t) => t.portGroups.some((g) => g.signalType === signalId));
}

/** 信号種別を追加する。IDは自動採番(名称を変えても参照が切れないよう、IDと表示名は別) */
export function addSignalType(label: string, color: string, parentId?: string): Action {
  return (doc) => {
    if (label.trim() === '' || !isHexColor(color)) return fail('invalid-value');
    const parent = parentId === undefined ? undefined : doc.signalTypes.find((s) => s.id === parentId);
    if (parentId !== undefined && (!parent || parent.parent !== undefined)) return fail('invalid-value');
    const id = uniqueId('SIG', doc.signalTypes.map((s) => s.id));
    const shade = parent ? availableChildShade(doc.signalTypes, parent.id) : color;
    if (shade === undefined) return fail('invalid-value');
    doc.signalTypes.push({ id, label: label.trim(), color: shade, ...(parent ? { parent: parent.id } : {}) });
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
    if (isSignalInUse(doc, id) || doc.signalTypes.some((s) => s.parent === id)) return fail('signal-in-use');
    doc.signalTypes = doc.signalTypes.filter((x) => x.id !== id);
    return OK;
  };
}

/** 凡例の並びを入れ替える(delta: -1 で1つ上、+1 で1つ下。端では何もしない) */
export function moveSignalType(id: string, delta: -1 | 1): Action {
  return (doc) => {
    const i = doc.signalTypes.findIndex((x) => x.id === id);
    if (i < 0) return fail('unknown-signal');
    const peers = doc.signalTypes.filter((s) => s.parent === doc.signalTypes[i].parent);
    const peerIndex = peers.findIndex((s) => s.id === id);
    const neighbor = peers[peerIndex + delta];
    if (!neighbor) return OK;
    const j = doc.signalTypes.indexOf(neighbor);
    [doc.signalTypes[i], doc.signalTypes[j]] = [doc.signalTypes[j], doc.signalTypes[i]];
    return OK;
  };
}

export function signalUsageDetails(doc: DiagramDocument, signalId: string): { ports: number; devices: { name: string; count: number }[]; templates: string[] } {
  const counts = new Map<string, number>();
  for (const page of doc.pages) for (const node of page.nodes) {
    const count = getNodePorts(doc, node).filter((p) => p.signalType === signalId).length;
    if (count || node.portGroupsOverride?.some((g) => g.signalType === signalId)) counts.set(node.label, (counts.get(node.label) ?? 0) + count);
  }
  return { ports: [...counts.values()].reduce((a, b) => a + b, 0), devices: [...counts].map(([name, count]) => ({ name, count })), templates: doc.deviceTemplates.filter((t) => t.portGroups.some((g) => g.signalType === signalId)).map((t) => t.name) };
}

export function reassignAndRemoveSignalType(id: string, toId: string): Action {
  return (doc) => {
    const source = doc.signalTypes.find((s) => s.id === id);
    const target = doc.signalTypes.find((s) => s.id === toId);
    if (!source || !target || id === toId) return fail('unknown-signal');
    if (target.parent === id) return fail('invalid-value');
    if (doc.signalTypes.some((s) => s.parent === id)) return fail('signal-in-use');
    for (const t of doc.deviceTemplates) for (const g of t.portGroups) if (g.signalType === id) g.signalType = toId;
    for (const p of doc.pages) for (const n of p.nodes) for (const g of n.portGroupsOverride ?? []) if (g.signalType === id) g.signalType = toId;
    doc.signalTypes = doc.signalTypes.filter((s) => s.id !== id);
    return OK;
  };
}

export function childShade(color: string, index: number): string {
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), light = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
  const newLight = 0.3 + ((index * 37) % 101) / 250;
  const chroma = (1 - Math.abs(2 * newLight - 1)) * sat;
  const oldChroma = max - min;
  const values = oldChroma === 0 ? rgb.map(() => newLight) : rgb.map((v) => ((v - min) / oldChroma) * chroma + newLight - chroma / 2);
  return '#' + values.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

export function orderedSignalTypes(signals: readonly SignalType[]): SignalType[] {
  return signals.filter((s) => s.parent === undefined).flatMap((root) => [root, ...signals.filter((s) => s.parent === root.id)]);
}

export function availableChildShade(signals: readonly SignalType[], parentId: string, excludeId?: string): string | undefined {
  const parent = signals.find((s) => s.id === parentId);
  if (!parent || parent.parent !== undefined) return undefined;
  const used = new Set(signals.filter((s) => s.parent === parentId && s.id !== excludeId).map((s) => s.color.toLowerCase()));
  for (let i = 0; i < 101; i++) {
    const shade = childShade(parent.color, i);
    if (!used.has(shade)) return shade;
  }
  return undefined;
}
