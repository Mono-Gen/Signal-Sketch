import { connectionIssues, rootSignalId } from './diagnostics';
import { followersInFrame } from './frames';
import type { Port } from './ports';
import { getNodePorts, getPage, layoutNodePorts } from './query';
import type { DiagramDocument, PortRef } from './types';

/** 一括接続でつなげなかった理由 */
export type BulkSkipReason =
  | 'source-occupied' // 選択したポートが接続済み
  | 'no-target' // 相手側に、割り当てられる空きのポートが残っていない
  | 'signal-mismatch' // 信号の種類が違う(一括では接続しない。1本ずつなら警告つきで接続できる)
  | 'direction-mismatch' // 入力同士・出力同士(同上)
  | 'duplicate'; // すでに同じ2つのポートの間に線がある

/** 一括接続を行わない理由(計画全体を断る) */
export type BulkRefusal = 'no-selection' | 'mixed-direction' | 'unknown-target';

export interface BulkPlan {
  /** つなぐ組。from は選択側、to は落とし先側 */
  pairs: { from: PortRef; to: PortRef }[];
  /** つなげなかった選択側のポートと理由 */
  skipped: { ref: PortRef; reason: BulkSkipReason }[];
  /** 全体を断る場合の理由。このとき pairs は空 */
  refused?: BulkRefusal;
}

export interface Located {
  ref: PortRef;
  port: Port;
  /** ポート中心の図の座標 */
  x: number;
  y: number;
}

/** ポートの識別キー。IDに区切り文字が含まれても衝突しないよう、連結ではなく JSON にする */
const key = (r: PortRef) => JSON.stringify([r.nodeId, r.portId]);

/** ページ上の全ポートを、図の座標つきで並べる(ポートIDは機器をまたいで重複するため、機器IDと組で扱う) */
export function locatePorts(doc: DiagramDocument, pageId: string): Located[] {
  const page = getPage(doc, pageId);
  if (!page) return [];
  const result: Located[] = [];
  for (const node of page.nodes) {
    const ports = getNodePorts(doc, node);
    for (const pl of layoutNodePorts(doc, node)) {
      const port = ports.find((p) => p.id === pl.portId);
      if (port) result.push({ ref: { nodeId: node.id, portId: port.id }, port, x: node.x + pl.x, y: node.y + pl.y });
    }
  }
  return result;
}

/**
 * 図の座標の長方形に触れるポートを返す(枠選択)。ポートのマークの大きさ(markerSize)だけ
 * 当たりを広げて判定する。並びは「上から下、左から右」。
 */
export function portsInRect(
  doc: DiagramDocument,
  pageId: string,
  rect: { x1: number; y1: number; x2: number; y2: number },
  markerSize: number,
): PortRef[] {
  const x1 = Math.min(rect.x1, rect.x2);
  const x2 = Math.max(rect.x1, rect.x2);
  const y1 = Math.min(rect.y1, rect.y2);
  const y2 = Math.max(rect.y1, rect.y2);
  const half = markerSize / 2;
  return locatePorts(doc, pageId)
    .filter((p) => p.x + half >= x1 && p.x - half <= x2 && p.y + half >= y1 && p.y - half <= y2)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((p) => p.ref);
}

/**
 * 選択したポートを、落とし先のポートから順に1対1で割り当てる(一括接続の計画。保存や描画は行わない)。
 * - 選択側は「上から下、左から右」の順。
 * - 相手側は、落とし先と同じ機器・同じポートグループの、落とし先以降のポートを並び順に使い、
 *   足りなければ同じ枠の中で読み順が後ろの機器の、同じグループ・信号・向きのポートへ進む。
 *   接続済みのポートと、選択に含まれるポートは飛ばす。
 * - 向き(入力/出力)が選択の中で混在しているときは、全体を断る(入出力は、どちらとも組める)。
 * - 信号・方向が合わない組、接続済みの選択ポート、相手が足りない分は、理由つきで除外する。
 *   警告つきで接続できる1本ずつの接続と違い、まとめての接続では不一致を作らない。
 */
export function planBulkConnect(doc: DiagramDocument, pageId: string, selected: readonly PortRef[], drop: PortRef): BulkPlan {
  const empty = (refused: BulkRefusal): BulkPlan => ({ pairs: [], skipped: [], refused });
  const page = getPage(doc, pageId);
  if (!page) return empty('unknown-target');
  if (selected.length === 0) return empty('no-selection');

  const all = locatePorts(doc, pageId);
  const byKey = new Map(all.map((p) => [key(p.ref), p]));
  const dropPort = byKey.get(key(drop));
  if (!dropPort) return empty('unknown-target');

  // 選択の重複・存在しないポートは捨てる(描き直しで機器が消えた後の古い選択など)
  const seen = new Set<string>();
  const sources: Located[] = [];
  for (const ref of selected) {
    const p = byKey.get(key(ref));
    if (!p || seen.has(key(ref))) continue;
    seen.add(key(ref));
    sources.push(p);
  }
  if (sources.length === 0) return empty('no-selection');
  sources.sort((a, b) => a.y - b.y || a.x - b.x);

  const directions = new Set(sources.map((s) => s.port.direction).filter((d) => d !== 'inout'));
  if (directions.has('in') && directions.has('out')) return empty('mixed-direction');

  const used = new Map<string, number>(); // ポートごとの接続数
  const bump = (r: PortRef) => used.set(key(r), (used.get(key(r)) ?? 0) + 1);
  for (const e of page.edges) {
    bump(e.from);
    bump(e.to);
  }
  const isFree = (p: Located) => p.port.multi || !used.has(key(p.ref));
  const pairKeys = new Set(page.edges.map((e) => `${key(e.from)}|${key(e.to)}`));
  const connectedPair = (a: PortRef, b: PortRef) => pairKeys.has(`${key(a)}|${key(b)}`) || pairKeys.has(`${key(b)}|${key(a)}`);

  // 相手側の候補。まず落とし先の機器(落とし先以降の同じグループ)、
  // 次に同じ枠の中で読み順が後ろの機器を、落とし先と同じグループ・信号・向きのポートを先頭から。
  const node = page.nodes.find((n) => n.id === drop.nodeId)!;
  const usable = (p: Located | undefined): p is Located => p !== undefined && !seen.has(key(p.ref)) && isFree(p);
  const group = getNodePorts(doc, node).filter((p) => p.groupId === dropPort.port.groupId);
  const start = group.findIndex((p) => p.id === drop.portId);
  const candidates: Located[] = group
    .slice(Math.max(0, start))
    .map((p) => byKey.get(key({ nodeId: drop.nodeId, portId: p.id })))
    .filter(usable);
  const sourceNodeIds = new Set(sources.map((s) => s.ref.nodeId));
  for (const other of followersInFrame(page, node)) {
    if (sourceNodeIds.has(other.id)) continue; // 送り側の機器へは進めない(自分自身につながないため)
    for (const p of getNodePorts(doc, other)) {
      if (p.groupId !== dropPort.port.groupId || rootSignalId(doc.signalTypes, p.signalType) !== rootSignalId(doc.signalTypes, dropPort.port.signalType) || p.direction !== dropPort.port.direction) continue;
      const located = byKey.get(key({ nodeId: other.id, portId: p.id }));
      if (usable(located)) candidates.push(located);
    }
  }

  const plan: BulkPlan = { pairs: [], skipped: [] };
  let next = 0;
  for (const src of sources) {
    if (!src.port.multi && used.has(key(src.ref))) {
      plan.skipped.push({ ref: src.ref, reason: 'source-occupied' });
      continue;
    }
    const target = candidates[next];
    if (!target) {
      plan.skipped.push({ ref: src.ref, reason: 'no-target' });
      continue;
    }
    const issues = connectionIssues(src.port, target.port, doc.signalTypes);
    if (issues.includes('signal-mismatch')) {
      plan.skipped.push({ ref: src.ref, reason: 'signal-mismatch' });
      continue;
    }
    if (issues.includes('direction-mismatch')) {
      plan.skipped.push({ ref: src.ref, reason: 'direction-mismatch' });
      continue;
    }
    if (connectedPair(src.ref, target.ref)) {
      plan.skipped.push({ ref: src.ref, reason: 'duplicate' });
      continue;
    }
    plan.pairs.push({ from: { ...src.ref }, to: { ...target.ref } });
    next += 1;
  }
  return plan;
}
