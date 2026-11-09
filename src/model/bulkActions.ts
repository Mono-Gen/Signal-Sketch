import type { Action } from './actions';
import { updateNode } from './actions';
import { resizeNode } from './imageActions';
import { getPage } from './query';

const fail = (error: 'unknown-page' | 'unknown-node' | 'invalid-value') => ({ ok: false as const, error });

/**
 * 複数の機器の名称・型番・台数を、まとめて同じ値にする(指定した項目だけ)。
 * どれか1台でも失敗したら全体を取り消す(Action は失敗すると破棄されるので、一部だけ変わった状態は残らない)。
 */
export function updateNodes(
  pageId: string,
  nodeIds: readonly string[],
  patch: { label?: string; model?: string; count?: number | undefined },
  options: { removeOrphanEdges?: boolean } = {},
): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    if (nodeIds.length === 0) return fail('invalid-value');
    for (const id of nodeIds) {
      const r = updateNode(pageId, id, patch, options)(doc);
      if (!r.ok) return r;
    }
    return { ok: true };
  };
}

/**
 * 複数の機器の幅・高さを、まとめて変える(指定した側だけ。もう一方は各機器の今の値のまま)。
 * 丸めや最小値への補正は、機器ごとに resizeNode の規則で行う。
 */
export function resizeNodes(pageId: string, nodeIds: readonly string[], size: { w?: number; h?: number }): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    if (nodeIds.length === 0) return fail('invalid-value');
    for (const id of nodeIds) {
      const node = page.nodes.find((n) => n.id === id);
      if (!node) return fail('unknown-node');
      const r = resizeNode(pageId, id, { w: size.w ?? node.w, h: size.h ?? node.h })(doc);
      if (!r.ok) return r;
    }
    return { ok: true };
  };
}
