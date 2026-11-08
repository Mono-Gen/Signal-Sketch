import { describe, expect, it } from 'vitest';
import { addNodesInRow, MAX_ROW_COUNT, MAX_ROW_GAP } from '../../src/model/actions';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { DocumentStore } from '../../src/state/store';
import { createEmptyDocument } from '../../src/model/defaults';
import { MAX_NODES_PER_PAGE } from '../../src/model/docLimits';
import { parseRowLayout } from '../../src/ui/rowPlaceDialog';

const P = 'page-1';
const tpl = () => presetToTemplate(PRESETS.find((p) => p.id === 'speaker')!, 'スピーカー');
const fresh = () => createEmptyDocument();
const nodes = (doc: ReturnType<typeof fresh>) => doc.pages[0].nodes;

describe('addNodesInRow', () => {
  it('横に3台、同じ名称・同じ大きさで、先頭の位置から並べる', () => {
    const doc = fresh();
    const r = addNodesInRow(P, tpl(), '名称', { count: 3, direction: 'horizontal', gap: 20 }, { x: 100, y: 200 })(doc);
    expect(r.ok).toBe(true);
    expect(r.createdNodeIds).toHaveLength(3);
    const ns = nodes(doc);
    expect(ns.map((n) => n.label)).toEqual(['名称', '名称', '名称']);
    expect(new Set(ns.map((n) => n.w)).size).toBe(1);
    expect(ns.map((n) => n.y)).toEqual([200, 200, 200]);
    expect(ns[0].x).toBe(100);
    // 隣との間隔は指定以上で、刻みはグリッド(10)の倍数
    const step = ns[1].x - ns[0].x;
    expect(step).toBeGreaterThanOrEqual(ns[0].w + 20);
    expect(step % doc.grid.size).toBe(0);
    expect(ns[2].x - ns[1].x).toBe(step);
  });

  it('縦に並べると、x は同じで y が増える', () => {
    const doc = fresh();
    addNodesInRow(P, tpl(), 'S', { count: 4, direction: 'vertical', gap: 10 }, { x: 60, y: 40 })(doc);
    const ns = nodes(doc);
    expect(new Set(ns.map((n) => n.x))).toEqual(new Set([60]));
    expect(ns[1].y - ns[0].y).toBeGreaterThanOrEqual(ns[0].h + 10);
  });

  it('1台でも動く(個数1)', () => {
    const doc = fresh();
    expect(addNodesInRow(P, tpl(), 'S', { count: 1, direction: 'horizontal', gap: 0 }, { x: 0, y: 0 })(doc).ok).toBe(true);
    expect(nodes(doc)).toHaveLength(1);
  });

  it('登録サイズがページより大きい場合は縮め、1台ならページ内へ配置する', () => {
    const doc = fresh();
    const page = doc.pages[0];
    const oversized = { ...tpl(), id: 'custom-oversized-row', size: { w: 4000, h: 4000 } };
    const result = addNodesInRow(P, oversized, '大型機器', { count: 1, direction: 'horizontal', gap: 0 }, { x: 9999, y: 9999 })(doc);
    expect(result.ok).toBe(true);
    expect(nodes(doc)[0]).toMatchObject({ x: 0, y: 0, w: page.size.w, h: page.size.h });
  });

  it('グリッド無効なら、刻みは機器の大きさ+間隔そのまま', () => {
    const doc = fresh();
    doc.grid.enabled = false;
    addNodesInRow(P, tpl(), 'S', { count: 2, direction: 'horizontal', gap: 7 }, { x: 13, y: 17 })(doc);
    const ns = nodes(doc);
    expect([ns[0].x, ns[0].y]).toEqual([13, 17]);
    expect(ns[1].x - ns[0].x).toBe(ns[0].w + 7);
  });

  it('ページの右端からはみ出す位置は、列がちょうど収まるよう左へ寄せる', () => {
    const doc = fresh();
    const page = doc.pages[0];
    addNodesInRow(P, tpl(), 'S', { count: 3, direction: 'horizontal', gap: 10 }, { x: page.size.w - 10, y: 10 })(doc);
    const ns = nodes(doc);
    const last = ns[2];
    expect(last.x + last.w).toBeLessThanOrEqual(page.size.w);
    expect(ns[0].x).toBeGreaterThanOrEqual(0);
  });

  it('負の位置は 0 へ寄せる', () => {
    const doc = fresh();
    addNodesInRow(P, tpl(), 'S', { count: 2, direction: 'horizontal', gap: 10 }, { x: -50, y: -50 })(doc);
    expect([nodes(doc)[0].x, nodes(doc)[0].y]).toEqual([0, 0]);
  });

  it('列がページに収まらないときは断り、何も追加しない', () => {
    const doc = fresh();
    const r = addNodesInRow(P, tpl(), 'S', { count: MAX_ROW_COUNT, direction: 'horizontal', gap: MAX_ROW_GAP }, { x: 0, y: 0 })(doc);
    expect(r).toMatchObject({ ok: false, error: 'import-no-space', blockers: ['S'] });
    expect(nodes(doc)).toHaveLength(0);
  });

  it.each([
    [0, 10],
    [MAX_ROW_COUNT + 1, 10],
    [2.5, 10],
    [Number.NaN, 10],
    [2, -1],
    [2, MAX_ROW_GAP + 1],
    [2, Number.NaN],
  ])('不正な値(個数 %s・間隔 %s)は invalid-value', (count, gap) => {
    const doc = fresh();
    expect(addNodesInRow(P, tpl(), 'S', { count, direction: 'horizontal', gap }, { x: 0, y: 0 })(doc)).toEqual({ ok: false, error: 'invalid-value' });
    expect(nodes(doc)).toHaveLength(0);
  });

  it('不正な向き・位置も断る', () => {
    const doc = fresh();
    expect(addNodesInRow(P, tpl(), 'S', { count: 2, direction: 'diagonal' as never, gap: 0 }, { x: 0, y: 0 })(doc).error).toBe('invalid-value');
    expect(addNodesInRow(P, tpl(), 'S', { count: 2, direction: 'horizontal', gap: 0 }, { x: Number.NaN, y: 0 })(doc).error).toBe('invalid-value');
  });

  it('機器のIDは重複せず、既存の機器の続きから振る', () => {
    const doc = fresh();
    addNodesInRow(P, tpl(), 'A', { count: 2, direction: 'horizontal', gap: 0 }, { x: 0, y: 0 })(doc);
    addNodesInRow(P, tpl(), 'B', { count: 2, direction: 'vertical', gap: 0 }, { x: 0, y: 200 })(doc);
    const ids = nodes(doc).map((n) => n.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('テンプレートは図に1つだけ取り込む', () => {
    const doc = fresh();
    addNodesInRow(P, tpl(), 'S', { count: 3, direction: 'horizontal', gap: 0 }, { x: 0, y: 0 })(doc);
    expect(doc.deviceTemplates.filter((t) => t.id === tpl().id)).toHaveLength(1);
  });

  it('ストア経由では1回の操作で、Undo 1回で全部戻る', () => {
    const store = new DocumentStore(fresh());
    const r = store.apply(addNodesInRow(P, tpl(), 'S', { count: 5, direction: 'horizontal', gap: 10 }, { x: 0, y: 0 }));
    expect(r.ok).toBe(true);
    expect(store.doc.pages[0].nodes).toHaveLength(5);
    store.undo();
    expect(store.doc.pages[0].nodes).toHaveLength(0);
  });

  it('失敗したときは、ストアの状態もUndo履歴も変わらない', () => {
    const store = new DocumentStore(fresh());
    store.apply(addNodesInRow(P, tpl(), 'S', { count: 0, direction: 'horizontal', gap: 0 }, { x: 0, y: 0 }));
    expect(store.canUndo).toBe(false);
  });

  it('グリッド無効でも、右端・下端を超える位置は内側に寄せる', () => {
    const doc = fresh();
    doc.grid.enabled = false;
    const { w, h } = doc.pages[0].size;
    addNodesInRow(P, tpl(), 'S', { count: 2, direction: 'vertical', gap: 5 }, { x: w + 500, y: h + 500 })(doc);
    for (const n of nodes(doc)) {
      expect(n.x + n.w).toBeLessThanOrEqual(w);
      expect(n.y + n.h).toBeLessThanOrEqual(h);
    }
  });

  it('図全体の上限(機器の数)を超える追加は、ストアが断って何も変えない', () => {
    const store = new DocumentStore(fresh());
    // 上限の手前まで、1台ずつ置く(位置は重なってよい)
    const doc = store.doc;
    const base = nodes(doc);
    for (let i = 0; i < MAX_NODES_PER_PAGE - 2; i++) {
      base.push({ id: `n-${i + 1}`, templateId: 'x', label: 'L', model: '', x: 0, y: 0, w: 10, h: 10 });
    }
    const r = store.apply(addNodesInRow(P, tpl(), 'S', { count: 5, direction: 'horizontal', gap: 0 }, { x: 0, y: 0 }));
    expect(r).toEqual({ ok: false, error: 'document-too-large' });
    expect(store.doc.pages[0].nodes).toHaveLength(MAX_NODES_PER_PAGE - 2);
    expect(store.canUndo).toBe(false);
  });

  it('数として正確に扱えない大きな番号のIDがあっても、IDは重複しない', () => {
    const doc = fresh();
    nodes(doc).push({ id: 'n-9007199254740992', templateId: 'x', label: 'L', model: '', x: 0, y: 0, w: 10, h: 10 });
    addNodesInRow(P, tpl(), 'S', { count: 3, direction: 'horizontal', gap: 0 }, { x: 0, y: 100 })(doc);
    const ids = nodes(doc).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parseRowLayout', () => {
  it('正しい入力を読む', () => {
    expect(parseRowLayout('3', 'horizontal', '20')).toEqual({ count: 3, direction: 'horizontal', gap: 20 });
    expect(parseRowLayout(' 99 ', 'vertical', '0')).toEqual({ count: 99, direction: 'vertical', gap: 0 });
  });

  it.each([
    ['', 'horizontal', '10'],
    ['3', 'horizontal', ''],
    ['0', 'horizontal', '10'],
    ['100', 'horizontal', '10'],
    ['2.5', 'horizontal', '10'],
    ['abc', 'horizontal', '10'],
    ['3', 'horizontal', '-1'],
    ['3', 'horizontal', '501'],
    ['3', 'horizontal', 'NaN'],
    ['3', 'diagonal', '10'],
    ['1e3', 'horizontal', '10'],
  ])('不正な入力(%s, %s, %s)は null', (c, d, g) => {
    expect(parseRowLayout(c, d, g)).toBeNull();
  });
});
