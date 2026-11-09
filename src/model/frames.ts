import { snap } from './grid';
import { uniqueId } from './ids';
import { getPage } from './query';
import type { Action, ActionResult } from './actions';
import type { DiagramGroup, DiagramNode, Page } from './types';

// 「枠」(データ上は groups)。所属は保存せず、見た目(機器の中心が枠の中か)から毎回決める。
// 参加・離脱の操作は不要で、枠の中へ動かせば入り、外へ出せば外れる。

const MIN_FRAME_WIDTH = 60;
const MIN_FRAME_HEIGHT = 40;
const DEFAULT_FRAME_SIZE = { w: 300, h: 200 } as const;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const OK: ActionResult = { ok: true };
const fail = (error: NonNullable<ActionResult['error']>): ActionResult => ({ ok: false, error });

const centerInside = (inner: Rect, frame: Rect): boolean => {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx >= frame.x && cx < frame.x + frame.w && cy >= frame.y && cy < frame.y + frame.h;
};

/** 枠の中にある機器(中心が枠内) */
export function nodesInFrame(page: Page, frame: Rect): DiagramNode[] {
  return page.nodes.filter((n) => centerInside(n, frame));
}

/** 機器が属する枠。入れ子のときは最も小さい(内側の)枠。どの枠にも入っていなければ undefined */
export function frameOfNode(page: Page, node: Rect): DiagramGroup | undefined {
  let best: DiagramGroup | undefined;
  for (const g of page.groups) {
    if (!centerInside(node, g)) continue;
    if (!best || g.w * g.h < best.w * best.h) best = g;
  }
  return best;
}

/**
 * 読み順(上から下、同じ高さなら左から右)に機器を並べる。
 * 「同じ高さ」は、行の先頭の機器の中心から、その機器の高さの半分以内。
 * 単純な比較関数では推移しない(AがBと同じ高さ、BがCと同じ高さでも、AとCは違う)ため、行ごとにまとめてから並べる。
 */
export function sortReadingOrder(nodes: readonly DiagramNode[]): DiagramNode[] {
  const cy = (n: DiagramNode) => n.y + n.h / 2;
  const byY = [...nodes].sort((a, b) => cy(a) - cy(b) || a.x - b.x || a.id.localeCompare(b.id));
  const rows: DiagramNode[][] = [];
  for (const n of byY) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(cy(n) - cy(row[0])) <= row[0].h / 2) row.push(n);
    else rows.push([n]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id)));
}

/**
 * 指定した機器と同じ枠(いちばん内側の枠)にいて、読み順で指定した機器より後ろの機器を返す。
 * 一括接続が「落とし先以降」へ進む規則と合わせるため、前の機器へは戻らない。
 * 枠に入っていない機器は、範囲が自分だけなので空。
 */
export function followersInFrame(page: Page, node: DiagramNode): DiagramNode[] {
  const frame = frameOfNode(page, node);
  if (!frame) return [];
  // まず対象の枠に入る機器だけに絞る(全機器×全枠の判定を避ける)。入れ子の内側の枠に取られる機器は除く
  const ordered = sortReadingOrder(page.nodes.filter((n) => centerInside(n, frame) && frameOfNode(page, n)?.id === frame.id));
  return ordered.slice(ordered.findIndex((n) => n.id === node.id) + 1);
}

/** 枠を追加する。位置を省略すると、左上から少しずつずらして置く。大きさは既定(グリッドへ丸める) */
export function addFrame(pageId: string, label: string, at?: { x: number; y: number }): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const g = doc.grid.size;
    const s = (v: number) => (doc.grid.enabled ? snap(v, g) : v);
    const cascade = 20 + 20 * (page.groups.length % 10);
    const pos = at ? { x: s(at.x), y: s(at.y) } : { x: s(cascade), y: s(cascade + 20) };
    const id = uniqueId('g', page.groups.map((x) => x.id));
    page.groups.push({ id, label, x: pos.x, y: pos.y, w: s(DEFAULT_FRAME_SIZE.w), h: s(DEFAULT_FRAME_SIZE.h) });
    return { ok: true, created: id };
  };
}

/** 枠の名称を変更する */
export function updateFrame(pageId: string, frameId: string, patch: { label?: string }): Action {
  return (doc) => {
    const frame = getPage(doc, pageId)?.groups.find((x) => x.id === frameId);
    if (!frame) return fail('unknown-frame');
    if (patch.label !== undefined) frame.label = patch.label;
    return OK;
  };
}

/** 枠の位置と大きさを変える(ハンドルでの変形)。中の機器は動かさない。最小サイズ未満は拒否する */
export function resizeFrame(pageId: string, frameId: string, rect: Rect): Action {
  return (doc) => {
    const frame = getPage(doc, pageId)?.groups.find((x) => x.id === frameId);
    if (!frame) return fail('unknown-frame');
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return fail('invalid-value');
    const g = doc.grid.size;
    const s = (v: number) => (doc.grid.enabled ? snap(v, g) : v);
    const next = { x: s(rect.x), y: s(rect.y), w: s(rect.w), h: s(rect.h) };
    if (next.w < MIN_FRAME_WIDTH || next.h < MIN_FRAME_HEIGHT) return fail('invalid-value');
    Object.assign(frame, next);
    return OK;
  };
}

/**
 * 機器と枠をまとめて動かす(ドラッグの結果の反映)。枠を動かすと、動かす前に枠の中にあった機器と、
 * 中にあった別の枠(入れ子)も同じだけ動く。いっしょにドラッグされた機器・枠は、指定の座標を優先する。
 * 所属は、すべて動かす前の位置で判定する(途中の変更に影響されない)。
 */
export function moveSelection(
  pageId: string,
  nodeMoves: readonly { id: string; x: number; y: number }[],
  frameMoves: readonly { id: string; x: number; y: number }[],
): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    for (const m of nodeMoves) if (!page.nodes.some((n) => n.id === m.id)) return fail('unknown-node');
    for (const m of frameMoves) if (!page.groups.some((x) => x.id === m.id)) return fail('unknown-frame');

    const g = doc.grid.size;
    const s = (v: number) => (doc.grid.enabled ? snap(v, g) : v);
    const explicitNodes = new Set(nodeMoves.map((m) => m.id));
    const explicitFrames = new Set(frameMoves.map((m) => m.id));

    // 動かす前の位置で、連れて動くものと移動量を決める(同じものは最初の1回だけ)
    const nodeShift = new Map<string, { dx: number; dy: number }>();
    const frameShift = new Map<string, { dx: number; dy: number }>();
    for (const m of frameMoves) {
      const frame = page.groups.find((x) => x.id === m.id)!;
      const d = { dx: s(m.x) - frame.x, dy: s(m.y) - frame.y };
      for (const n of nodesInFrame(page, frame)) {
        if (!explicitNodes.has(n.id) && !nodeShift.has(n.id)) nodeShift.set(n.id, d);
      }
      for (const other of page.groups) {
        if (other.id === frame.id || explicitFrames.has(other.id) || frameShift.has(other.id)) continue;
        if (centerInside(other, frame)) frameShift.set(other.id, d);
      }
    }

    // 枠の中にあるメモも、枠といっしょに動く(中の機器と同じ考え方。メモ自身を動かす指定は、あとで moveNotes が絶対位置で上書きする)
    for (const m of frameMoves) {
      const frame = page.groups.find((x) => x.id === m.id)!;
      const d = { dx: s(m.x) - frame.x, dy: s(m.y) - frame.y };
      for (const note of page.notes ?? []) {
        if (!centerInside(note, frame)) continue;
        note.x = Math.max(0, Math.min(note.x + d.dx, page.size.w - note.w));
        note.y = Math.max(0, Math.min(note.y + d.dy, page.size.h - note.h));
      }
    }

    for (const [id, d] of nodeShift) {
      const n = page.nodes.find((x) => x.id === id)!;
      n.x += d.dx;
      n.y += d.dy;
    }
    for (const [id, d] of frameShift) {
      const f = page.groups.find((x) => x.id === id)!;
      f.x += d.dx;
      f.y += d.dy;
    }
    for (const m of nodeMoves) {
      const n = page.nodes.find((x) => x.id === m.id)!;
      n.x = s(m.x);
      n.y = s(m.y);
    }
    for (const m of frameMoves) {
      const f = page.groups.find((x) => x.id === m.id)!;
      f.x = s(m.x);
      f.y = s(m.y);
    }
    return OK;
  };
}
