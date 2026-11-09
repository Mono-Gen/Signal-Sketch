import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { addEdge, addNodeFromTemplate, moveNodes, removeItems } from '../../src/model/actions';
import { createEmptyDocument } from '../../src/model/defaults';
import { addFrame, moveSelection } from '../../src/model/frames';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { validateDocument } from '../../src/model/validate';
import { MAX_WAYPOINTS, setEdgeWaypoints } from '../../src/model/waypoints';
import { DocumentStore } from '../../src/state/store';

// 期待値は仕様から導く: 両端が同じだけ動けば経路も同じだけ動く・片方だけなら捨てる・変わらなければそのまま・空配列で消える。
const P = 'page-1';
type Doc = ReturnType<typeof createEmptyDocument>;

/** 2台の機器と、その間の1本の線を持つ図 */
function withEdge(): { store: DocumentStore; edgeId: string; a: string; b: string } {
  const doc: Doc = createEmptyDocument();
  const amp = presetToTemplate(PRESETS.find((p) => p.id === 'amp')!, 'amp');
  const speaker = presetToTemplate(PRESETS.find((p) => p.id === 'speaker')!, 'speaker');
  const a = addNodeFromTemplate(P, amp, 'A', { x: 40, y: 40 })(doc).created!;
  const b = addNodeFromTemplate(P, speaker, 'B', { x: 400, y: 200 })(doc).created!;
  // 方向の不一致は警告付きで接続できる。各機器の最初のポート同士をつなぐ
  const firstPort = (id: string): string => {
    const node = doc.pages[0].nodes.find((n) => n.id === id)!;
    const tpl = doc.deviceTemplates.find((t) => t.id === node.templateId)!;
    return `${tpl.portGroups[0].id}-1`;
  };
  const r = addEdge(P, { nodeId: a, portId: firstPort(a) }, { nodeId: b, portId: firstPort(b) })(doc);
  expect(r.ok).toBe(true);
  const store = new DocumentStore(doc);
  return { store, edgeId: store.doc.pages[0].edges[0].id, a, b };
}

const wp = (store: DocumentStore) => store.doc.pages[0].edges[0].waypoints;
const node = (store: DocumentStore, id: string) => store.doc.pages[0].nodes.find((n) => n.id === id)!;

describe('setEdgeWaypoints', () => {
  it('経路を保存でき、空配列で消える', () => {
    const { store, edgeId } = withEdge();
    expect(store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }, { x: 100, y: 220 }])).ok).toBe(true);
    expect(wp(store)).toEqual([{ x: 100, y: 120 }, { x: 100, y: 220 }]);
    expect(store.apply(setEdgeWaypoints(P, edgeId, [])).ok).toBe(true);
    expect('waypoints' in store.doc.pages[0].edges[0]).toBe(false);
  });

  it('不正な点・多すぎる点・存在しない線は断る(何も変わらない)', () => {
    const { store, edgeId } = withEdge();
    expect(store.apply(setEdgeWaypoints(P, edgeId, [{ x: Number.NaN, y: 0 }])).ok).toBe(false);
    expect(store.apply(setEdgeWaypoints(P, edgeId, Array.from({ length: MAX_WAYPOINTS + 1 }, () => ({ x: 1, y: 1 })))).ok).toBe(false);
    expect(store.apply(setEdgeWaypoints(P, 'nope', [{ x: 1, y: 1 }]))).toMatchObject({ ok: false, error: 'unknown-edge' });
    expect(store.apply(setEdgeWaypoints('nope', edgeId, [{ x: 1, y: 1 }]))).toMatchObject({ ok: false, error: 'unknown-page' });
    expect(wp(store)).toBeUndefined();
  });

  it('読み込みでも、中継点の上限(50点)を守る。上限ちょうどは通る(監査の指摘)', () => {
    const { store } = withEdge();
    const make = (count: number) => {
      const d = JSON.parse(JSON.stringify(store.doc)) as Doc;
      d.pages[0].edges[0].waypoints = Array.from({ length: count }, (_, i) => ({ x: i, y: i }));
      return d;
    };
    expect(validateDocument(make(MAX_WAYPOINTS)).ok).toBe(true);
    expect(validateDocument(make(MAX_WAYPOINTS + 1)).ok).toBe(false);
  });

  it('元に戻すで、経路の設定が戻る', () => {
    const { store, edgeId } = withEdge();
    store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }]));
    store.undo();
    expect(wp(store)).toBeUndefined();
  });

  it('保存して読み直しても、経路が残る', () => {
    const { store, edgeId } = withEdge();
    store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }]));
    const r = parseDocument(serializeDocument(store.doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.pages[0].edges[0].waypoints).toEqual([{ x: 100, y: 120 }]);
  });
});

describe('機器が動いたときの追従(reconcileWaypoints)', () => {
  it('両端が同じだけ動けば、経路も同じだけ動く', () => {
    const { store, edgeId, a, b } = withEdge();
    store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }, { x: 100, y: 220 }]));
    const na = node(store, a);
    const nb = node(store, b);
    expect(store.apply(moveNodes(P, [{ id: a, x: na.x + 30, y: na.y + 20 }, { id: b, x: nb.x + 30, y: nb.y + 20 }])).ok).toBe(true);
    expect(wp(store)).toEqual([{ x: 130, y: 140 }, { x: 130, y: 240 }]);
  });

  it('片方の端だけ動けば、経路は捨てて自動配線へ戻る', () => {
    const { store, edgeId, a } = withEdge();
    store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }]));
    const na = node(store, a);
    store.apply(moveNodes(P, [{ id: a, x: na.x + 30, y: na.y }]));
    expect('waypoints' in store.doc.pages[0].edges[0]).toBe(false);
  });

  it('端の機器が動かない操作(名称変更など)では、経路はそのまま', () => {
    const { store, edgeId } = withEdge();
    store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }]));
    store.apply((d) => {
      d.pages[0].nodes[0].label = '改名';
      return { ok: true };
    });
    expect(wp(store)).toEqual([{ x: 100, y: 120 }]);
  });

  it('枠ごと動かして両端が一緒に動けば、経路も追従する。片方だけ枠の中なら捨てる', () => {
    const { store, edgeId } = withEdge();
    store.apply(addFrame(P, '枠', { x: 20, y: 20 }));
    const fid = store.doc.pages[0].groups[0].id;
    const resizeFrame = (x: number, y: number, w: number, h: number) =>
      store.apply((d) => {
        Object.assign(d.pages[0].groups[0], { x, y, w, h });
        return { ok: true };
      });
    resizeFrame(20, 20, 700, 400); // 両方の機器が入る
    store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }]));
    store.apply(moveSelection(P, [], [{ id: fid, x: 60, y: 60 }]));
    expect(wp(store)).toEqual([{ x: 140, y: 160 }]);
    resizeFrame(20, 20, 200, 100); // A だけが入る(中心が枠の中)
    store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }]));
    store.apply(moveSelection(P, [], [{ id: fid, x: 60, y: 60 }]));
    expect('waypoints' in store.doc.pages[0].edges[0]).toBe(false);
  });

  it('機器を消すと線ごと消える(経路だけが残ることはない)', () => {
    const { store, edgeId, a } = withEdge();
    store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }]));
    store.apply(removeItems(P, { nodeIds: [a] }));
    expect(store.doc.pages[0].edges).toHaveLength(0);
  });

  it('失敗した操作では、経路は変わらない', () => {
    const { store, edgeId, a } = withEdge();
    store.apply(setEdgeWaypoints(P, edgeId, [{ x: 100, y: 120 }]));
    expect(store.apply(moveNodes(P, [{ id: a, x: Number.NaN, y: 0 }])).ok).toBe(false);
    expect(wp(store)).toEqual([{ x: 100, y: 120 }]);
  });

  it('機器・枠の移動に NaN・Infinity が混じると、断る(座標が壊れた図を作らない)', () => {
    const { store, a } = withEdge();
    store.apply(addFrame(P, '枠', { x: 300, y: 300 }));
    const fid = store.doc.pages[0].groups[0].id;
    const before = JSON.stringify(store.doc);
    expect(store.apply(moveSelection(P, [{ id: a, x: Number.POSITIVE_INFINITY, y: 0 }], [])).ok).toBe(false);
    expect(store.apply(moveSelection(P, [], [{ id: fid, x: 0, y: Number.NaN }])).ok).toBe(false);
    expect(JSON.stringify(store.doc)).toBe(before);
  });
});
