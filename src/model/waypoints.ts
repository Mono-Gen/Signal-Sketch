import type { Action, ActionResult } from './actions';
import { MAX_WAYPOINTS } from './docLimits';
import { getPage, layoutNodePorts } from './query';
import type { DiagramDocument, DiagramEdge, PortRef } from './types';

// 手動で引き直した線の経路(Edge.waypoints)の保存と、機器が動いたときの追従。

export { MAX_WAYPOINTS };

const EPS = 1e-6;

/**
 * 線の手動の経路を設定する(図の座標の点列)。空の配列なら、手動の経路を消す(自動配線へ戻る)。
 * 点は有限の数値で、MAX_WAYPOINTS 個まで。
 */
export function setEdgeWaypoints(pageId: string, edgeId: string, points: readonly { x: number; y: number }[]): Action {
  return (doc): ActionResult => {
    const page = getPage(doc, pageId);
    if (!page) return { ok: false, error: 'unknown-page' };
    const edge = page.edges.find((e) => e.id === edgeId);
    if (!edge) return { ok: false, error: 'unknown-edge' };
    if (points.length > MAX_WAYPOINTS || !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
      return { ok: false, error: 'invalid-value' };
    }
    if (points.length === 0) delete edge.waypoints;
    else edge.waypoints = points.map((p) => ({ x: p.x, y: p.y }));
    return { ok: true };
  };
}

/** ポートの付け根の、図の座標での位置(機器やポートが無ければ undefined) */
function anchor(doc: DiagramDocument, pageId: string, ref: PortRef): { x: number; y: number } | undefined {
  const node = getPage(doc, pageId)?.nodes.find((n) => n.id === ref.nodeId);
  const placement = node ? layoutNodePorts(doc, node).find((p) => p.portId === ref.portId) : undefined;
  return node && placement ? { x: node.x + placement.x, y: node.y + placement.y } : undefined;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

/**
 * 操作の前後を比べて、手動の経路を持つ線の経路を直す(操作の結果を適用するとき、ストアが1回だけ呼ぶ)。
 *  ・両端のポートの位置が変わらない: そのまま
 *  ・両端が同じだけ動いた(枠ごと・複数選択の移動): 経路も同じだけ動かす(形が保たれる)
 *  ・片方だけ動いた、ポートが消えたなど: 経路を捨てて自動配線へ戻す(古い点が新しい位置と合わず、奇妙な線になるため)
 * 前に無かった線(貼り付けなど)と、経路そのものを今回の操作で変えた線は対象外。
 */
export function reconcileWaypoints(before: DiagramDocument, after: DiagramDocument): void {
  for (const page of after.pages) {
    for (const edge of page.edges) {
      if (!edge.waypoints || edge.waypoints.length === 0) continue;
      const prev = getPage(before, page.id)?.edges.find((e) => e.id === edge.id);
      if (!prev || !sameWaypoints(prev, edge)) continue;
      const fromB = anchor(before, page.id, prev.from);
      const toB = anchor(before, page.id, prev.to);
      const fromA = anchor(after, page.id, edge.from);
      const toA = anchor(after, page.id, edge.to);
      if (!fromB || !toB || !fromA || !toA) {
        delete edge.waypoints;
        continue;
      }
      const d1 = { x: fromA.x - fromB.x, y: fromA.y - fromB.y };
      const d2 = { x: toA.x - toB.x, y: toA.y - toB.y };
      if (same(d1.x, 0) && same(d1.y, 0) && same(d2.x, 0) && same(d2.y, 0)) continue;
      if (same(d1.x, d2.x) && same(d1.y, d2.y)) {
        edge.waypoints = edge.waypoints.map((p) => ({ x: p.x + d1.x, y: p.y + d1.y }));
      } else {
        delete edge.waypoints;
      }
    }
  }
}

function sameWaypoints(a: DiagramEdge, b: DiagramEdge): boolean {
  const p = a.waypoints ?? [];
  const q = b.waypoints ?? [];
  return p.length === q.length && p.every((pt, i) => same(pt.x, q[i].x) && same(pt.y, q[i].y));
}
