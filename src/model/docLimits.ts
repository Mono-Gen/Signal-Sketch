import type { DiagramDocument } from './types';

// 図全体の大きさの上限。1機器あたりの上限(ports.ts の MAX_UNITS / MAX_PORTS_PER_NODE)だけでは、
// 「5000ポートの機器を100台」のような小さなファイルで、数十万個の図形を描こうとして画面が固まる。
// 実際の図(機器数十台、ポート数千個)より十分に大きい値にしてある。

/** 1ページあたりの機器の数の上限 */
export const MAX_NODES_PER_PAGE = 2000;

/** 1ページあたりのポートの合計(台数ぶんを含む)の上限 */
export const MAX_PORTS_PER_PAGE = 20000;

/** 1ページあたりの接続の数の上限 */
export const MAX_EDGES_PER_PAGE = 20000;

export type DocumentLimitIssue = 'nodes' | 'ports' | 'edges';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 図が1ページあたりの上限を超えているかを調べる(超えた項目を返す。収まっていれば null)。
 * ポートは展開せずに数える(展開すると、その展開で固まるため)。構造が壊れたデータでも例外にせず、
 * 数えられる範囲で数える(構造の検査は validate.ts が行う)。
 */
export function documentLimitIssue(doc: Pick<DiagramDocument, 'deviceTemplates' | 'pages'>): DocumentLimitIssue | null {
  const templates = new Map<string, unknown>();
  for (const t of Array.isArray(doc.deviceTemplates) ? doc.deviceTemplates : []) {
    if (isRecord(t) && typeof t.id === 'string') templates.set(t.id, t);
  }
  for (const page of Array.isArray(doc.pages) ? doc.pages : []) {
    if (!isRecord(page)) continue;
    const nodes = Array.isArray(page.nodes) ? page.nodes : [];
    const edges = Array.isArray(page.edges) ? page.edges : [];
    if (nodes.length > MAX_NODES_PER_PAGE) return 'nodes';
    if (edges.length > MAX_EDGES_PER_PAGE) return 'edges';
    let ports = 0;
    for (const n of nodes) {
      if (!isRecord(n)) continue;
      const tpl = typeof n.templateId === 'string' ? templates.get(n.templateId) : undefined;
      const groups = Array.isArray(n.portGroupsOverride) ? n.portGroupsOverride : isRecord(tpl) && Array.isArray(tpl.portGroups) ? tpl.portGroups : [];
      let perUnit = 0;
      for (const g of groups) {
        if (isRecord(g) && typeof g.count === 'number' && Number.isFinite(g.count) && g.count > 0) perUnit += g.count;
      }
      const units = typeof n.count === 'number' && Number.isInteger(n.count) && n.count >= 1 ? n.count : 1;
      ports += perUnit * units;
      if (ports > MAX_PORTS_PER_PAGE) return 'ports';
    }
  }
  return null;
}
