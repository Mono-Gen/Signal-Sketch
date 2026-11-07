import type { Action, ActionResult } from './actions';
import { snap } from './grid';
import { getPage } from './query';
import type { DiagramDocument, DiagramNode } from './types';

// 機器の「揃え」と「等間隔」。位置の計画だけを返し(保存や描画はしない)、
// 適用は applyNodeMoves で行う(計画の座標をそのまま使い、もう一度は丸めない)。
// 計画が空なら、何も動かないので適用しない(元に戻す履歴を積まないため)。

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

export interface NodeMove {
  id: string;
  x: number;
  y: number;
}

/** 揃えに必要な最小の件数 */
export const MIN_ALIGN_COUNT = 2;
/** 等間隔に必要な最小の件数(両端は動かさないので、間に1台以上が要る) */
export const MIN_DISTRIBUTE_COUNT = 3;

/**
 * 指定した機器を取り出す(重複は1つにまとめる)。存在しない ID が混ざっているとき、
 * 位置や大きさが有限の数でない機器があるときは、全体を断る(null)。壊れた値から計算しない。
 */
function resolveNodes(doc: DiagramDocument, pageId: string, ids: readonly string[]): DiagramNode[] | null {
  const page = getPage(doc, pageId);
  if (!page) return null;
  const wanted = new Set(ids);
  const nodes = page.nodes.filter((n) => wanted.has(n.id));
  if (nodes.length !== wanted.size) return null;
  if (nodes.some((n) => ![n.x, n.y, n.w, n.h].every(Number.isFinite))) return null;
  return nodes;
}

/** グリッドが有効なら丸める。有効でなければそのまま */
function rounder(doc: DiagramDocument): (v: number) => number {
  return (v) => (doc.grid.enabled ? snap(v, doc.grid.size) : v);
}

/** 丸めや計算の結果がページの外へ出ないよう、内側へ寄せる(機器がページより大きいときは寄せない) */
function clamper(doc: DiagramDocument, pageId: string): (n: DiagramNode, p: { x: number; y: number }) => { x: number; y: number } {
  const size = getPage(doc, pageId)?.size;
  const fit = (v: number, extent: number, limit: number | undefined) => (limit !== undefined && extent <= limit ? Math.min(Math.max(v, 0), limit - extent) : v);
  return (n, p) => ({ x: fit(p.x, n.w, size?.w), y: fit(p.y, n.h, size?.h) });
}

/** 動いた機器だけを返す。計算の結果が有限の数でないもの(巨大な値の桁あふれ)があれば、全体を断る */
function onlyChanged(nodes: readonly DiagramNode[], next: Map<string, { x: number; y: number }>): NodeMove[] {
  const moves: NodeMove[] = [];
  for (const n of nodes) {
    const to = next.get(n.id);
    if (!to) continue;
    if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return [];
    if (to.x !== n.x || to.y !== n.y) moves.push({ id: n.id, x: to.x, y: to.y });
  }
  return moves;
}

/**
 * 選んだ機器を、全体の外接長方形に揃える計画。
 * 左右・上下の中央は、外接長方形の中央に機器の中央を合わせる。件数が足りなければ空。
 */
export function planAlign(doc: DiagramDocument, pageId: string, ids: readonly string[], mode: AlignMode): NodeMove[] {
  const nodes = resolveNodes(doc, pageId, ids);
  if (!nodes || nodes.length < MIN_ALIGN_COUNT) return [];
  const round = rounder(doc);
  const clamp = clamper(doc, pageId);
  const left = Math.min(...nodes.map((n) => n.x));
  const right = Math.max(...nodes.map((n) => n.x + n.w));
  const top = Math.min(...nodes.map((n) => n.y));
  const bottom = Math.max(...nodes.map((n) => n.y + n.h));
  const next = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    let { x, y } = n;
    if (mode === 'left') x = left;
    else if (mode === 'right') x = right - n.w;
    else if (mode === 'hcenter') x = (left + right) / 2 - n.w / 2;
    else if (mode === 'top') y = top;
    else if (mode === 'bottom') y = bottom - n.h;
    else y = (top + bottom) / 2 - n.h / 2;
    next.set(n.id, clamp(n, { x: round(x), y: round(y) }));
  }
  return onlyChanged(nodes, next);
}

/**
 * 選んだ機器を、辺と辺の間隔が等しくなるよう並べる計画。両端(最も端の2台)は動かさない。
 * 順序は現在の位置順(同じ位置なら ID 順)。件数が足りなければ空。
 */
export function planDistribute(doc: DiagramDocument, pageId: string, ids: readonly string[], axis: DistributeAxis): NodeMove[] {
  const nodes = resolveNodes(doc, pageId, ids);
  if (!nodes || nodes.length < MIN_DISTRIBUTE_COUNT) return [];
  const round = rounder(doc);
  const clamp = clamper(doc, pageId);
  const horizontal = axis === 'horizontal';
  const pos = (n: DiagramNode) => (horizontal ? n.x : n.y);
  const size = (n: DiagramNode) => (horizontal ? n.w : n.h);
  const ordered = [...nodes].sort((a, b) => pos(a) - pos(b) || a.id.localeCompare(b.id));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  // 両端の外側の辺の間から、全機器の大きさの合計を引いた余白を、機器の間の数で割る
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - ordered.reduce((sum, n) => sum + size(n), 0)) / (ordered.length - 1);
  const next = new Map<string, { x: number; y: number }>();
  let cursor = pos(first) + size(first);
  for (const n of ordered.slice(1, -1)) {
    cursor += gap;
    const p = round(cursor);
    next.set(n.id, clamp(n, horizontal ? { x: p, y: n.y } : { x: n.x, y: p }));
    cursor += size(n);
  }
  return onlyChanged(nodes, next);
}

/**
 * 計画した位置を、そのまま適用する。moveNodes と違い、丸めない(計画の時点で丸め済み。
 * もう一度丸めると、動かさない側の軸まで変わってしまう)。不正な ID が1件でもあれば全体を適用しない。
 */
export function applyNodeMoves(pageId: string, moves: readonly NodeMove[]): Action {
  return (doc): ActionResult => {
    const page = getPage(doc, pageId);
    if (!page) return { ok: false, error: 'unknown-page' };
    if (moves.some((m) => !page.nodes.some((n) => n.id === m.id))) return { ok: false, error: 'unknown-node' };
    for (const m of moves) {
      const node = page.nodes.find((n) => n.id === m.id)!;
      node.x = m.x;
      node.y = m.y;
    }
    return { ok: true };
  };
}
