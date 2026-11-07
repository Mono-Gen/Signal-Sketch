import { describe, expect, it } from 'vitest';
import { addEdge, addEdges, addNodeFromTemplate, updateNode } from '../../src/model/actions';
import { planBulkConnect, portsInRect } from '../../src/model/bulkConnect';
import { createEmptyDocument } from '../../src/model/defaults';
import { layoutNodePorts } from '../../src/model/query';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { DocumentStore } from '../../src/state/store';

const P = 'page-1';
const preset = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, id);
const ref = (nodeId: string, portId: string) => ({ nodeId, portId });

/** 指定した位置に機器を置く */
function place(doc: ReturnType<typeof createEmptyDocument>, presetId: string, label: string, x: number, y: number): string {
  return addNodeFromTemplate(P, preset(presetId), label, { x, y })(doc).created!;
}

describe('planBulkConnect: 割り当て', () => {
  it('カメラ4台のLANを、スイッチの落とし先から順に1対1でつなぐ(選択側は上から下の順)', () => {
    const doc = createEmptyDocument();
    const cams = [place(doc, 'camera', 'C1', 40, 300), place(doc, 'camera', 'C2', 40, 100), place(doc, 'camera', 'C3', 40, 200), place(doc, 'camera', 'C4', 40, 400)];
    const sw = place(doc, 'switch8', 'SW', 400, 100);
    const plan = planBulkConnect(doc, P, cams.map((c) => ref(c, 'lan-1')), ref(sw, 'lan-3'));
    expect(plan.refused).toBeUndefined();
    expect(plan.skipped).toEqual([]);
    // y が小さい順: C2(100) → C3(200) → C1(300) → C4(400)。スイッチは lan-3 から
    expect(plan.pairs).toEqual([
      { from: ref(cams[1], 'lan-1'), to: ref(sw, 'lan-3') },
      { from: ref(cams[2], 'lan-1'), to: ref(sw, 'lan-4') },
      { from: ref(cams[0], 'lan-1'), to: ref(sw, 'lan-5') },
      { from: ref(cams[3], 'lan-1'), to: ref(sw, 'lan-6') },
    ]);
  });

  it('相手のポートが足りない分は、理由つきで除外する', () => {
    const doc = createEmptyDocument();
    const sw = place(doc, 'switch8', 'SW', 40, 100);
    const cams = [place(doc, 'camera', 'C1', 400, 100), place(doc, 'camera', 'C2', 400, 200), place(doc, 'camera', 'C3', 400, 300)];
    // スイッチの lan-7 から落とすと、空きは lan-7, lan-8 の2つだけ
    const plan = planBulkConnect(doc, P, cams.map((c) => ref(c, 'lan-1')), ref(sw, 'lan-7'));
    expect(plan.pairs.map((p) => p.to.portId)).toEqual(['lan-7', 'lan-8']);
    expect(plan.skipped).toEqual([{ ref: ref(cams[2], 'lan-1'), reason: 'no-target' }]);
  });

  it('接続済みの相手ポートは飛ばして、次の空きへ割り当てる', () => {
    const doc = createEmptyDocument();
    const sw = place(doc, 'switch8', 'SW', 400, 100);
    const other = place(doc, 'camera', 'X', 40, 500);
    addEdge(P, ref(other, 'lan-1'), ref(sw, 'lan-2'))(doc);
    const cams = [place(doc, 'camera', 'C1', 40, 100), place(doc, 'camera', 'C2', 40, 200)];
    const plan = planBulkConnect(doc, P, cams.map((c) => ref(c, 'lan-1')), ref(sw, 'lan-1'));
    expect(plan.pairs.map((p) => p.to.portId)).toEqual(['lan-1', 'lan-3']);
  });

  it('接続済みの選択ポートは除外し、相手ポートは消費しない', () => {
    const doc = createEmptyDocument();
    const sw = place(doc, 'switch8', 'SW', 400, 100);
    const cams = [place(doc, 'camera', 'C1', 40, 100), place(doc, 'camera', 'C2', 40, 200)];
    addEdge(P, ref(cams[0], 'lan-1'), ref(sw, 'lan-8'))(doc);
    const plan = planBulkConnect(doc, P, cams.map((c) => ref(c, 'lan-1')), ref(sw, 'lan-1'));
    expect(plan.skipped).toEqual([{ ref: ref(cams[0], 'lan-1'), reason: 'source-occupied' }]);
    expect(plan.pairs).toEqual([{ from: ref(cams[1], 'lan-1'), to: ref(sw, 'lan-1') }]);
  });

  it('信号の種類が違う組は、つながずに除外する(1本ずつなら警告つきで可能)', () => {
    const doc = createEmptyDocument();
    const cam = place(doc, 'camera', 'C', 40, 100);
    const sw = place(doc, 'switch8', 'SW', 400, 100);
    const plan = planBulkConnect(doc, P, [ref(cam, 'hdmi-1')], ref(sw, 'lan-1'));
    expect(plan.pairs).toEqual([]);
    expect(plan.skipped).toEqual([{ ref: ref(cam, 'hdmi-1'), reason: 'signal-mismatch' }]);
  });

  it('入力同士は除外する', () => {
    const doc = createEmptyDocument();
    const amp = place(doc, 'amp', 'A', 40, 100);
    const spk = place(doc, 'speaker', 'S', 400, 100);
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-1')], ref(spk, 'audio-1'));
    expect(plan.skipped).toEqual([{ ref: ref(amp, 'audio-1'), reason: 'direction-mismatch' }]);
  });

  it('台数が複数の機器の入力を、出力側へまとめてつなげる(相手が2つなら2本、残りは除外)', () => {
    const doc = createEmptyDocument();
    const amp = place(doc, 'amp', 'A', 40, 100);
    const spk = place(doc, 'speaker', 'S', 400, 100);
    updateNode(P, spk, { count: 3 })(doc);
    const selected = [ref(spk, 'audio-1'), ref(spk, 'audio-1@2'), ref(spk, 'audio-1@3')];
    const plan = planBulkConnect(doc, P, selected, ref(amp, 'audio-out-1'));
    expect(plan.pairs).toHaveLength(2);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe('no-target');
  });

  it('選択の中に入力と出力が混ざっているときは、全体を断る', () => {
    const doc = createEmptyDocument();
    const amp = place(doc, 'amp', 'A', 40, 100);
    const spk = place(doc, 'speaker', 'S', 400, 100);
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-out-1'), ref(spk, 'audio-1')], ref(amp, 'audio-1'));
    expect(plan.refused).toBe('mixed-direction');
    expect(plan.pairs).toEqual([]);
  });

  it('選択が空、落とし先が存在しない、選択が存在しないポートだけ、ページが無い、のときは断る', () => {
    const doc = createEmptyDocument();
    const cam = place(doc, 'camera', 'C', 40, 100);
    const sw = place(doc, 'switch8', 'SW', 400, 100);
    expect(planBulkConnect(doc, P, [], ref(sw, 'lan-1')).refused).toBe('no-selection');
    expect(planBulkConnect(doc, P, [ref(cam, 'lan-1')], ref(sw, 'nothing')).refused).toBe('unknown-target');
    expect(planBulkConnect(doc, P, [ref('ghost', 'lan-1')], ref(sw, 'lan-1')).refused).toBe('no-selection');
    expect(planBulkConnect(doc, 'no-page', [ref(cam, 'lan-1')], ref(sw, 'lan-1')).refused).toBe('unknown-target');
  });

  it('選択に含まれるポートは相手側の候補にしない(同じ機器の中で、自分自身へつながない)', () => {
    const doc = createEmptyDocument();
    const sw = place(doc, 'switch8', 'SW', 400, 100);
    const plan = planBulkConnect(doc, P, [ref(sw, 'lan-1'), ref(sw, 'lan-2')], ref(sw, 'lan-1'));
    expect(plan.pairs.map((p) => [p.from.portId, p.to.portId])).toEqual([
      ['lan-1', 'lan-3'],
      ['lan-2', 'lan-4'],
    ]);
  });

  it('選択の重複は1つとして数える', () => {
    const doc = createEmptyDocument();
    const cam = place(doc, 'camera', 'C', 40, 100);
    const sw = place(doc, 'switch8', 'SW', 400, 100);
    const plan = planBulkConnect(doc, P, [ref(cam, 'lan-1'), ref(cam, 'lan-1')], ref(sw, 'lan-1'));
    expect(plan.pairs).toHaveLength(1);
  });
});

describe('portsInRect: 枠選択', () => {
  it('枠に触れたポートだけを、上から下、左から右の順で返す。逆向きに引いても同じ', () => {
    const doc = createEmptyDocument();
    const sw = place(doc, 'switch8', 'SW', 100, 100);
    const node = doc.pages[0].nodes.find((n) => n.id === sw)!;
    const pts = layoutNodePorts(doc, node)
      .map((p) => ({ id: p.portId, x: node.x + p.x, y: node.y + p.y }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    // 先頭から3つのポートの中心を囲む
    const rect = { x1: pts[0].x - 1, y1: pts[0].y - 1, x2: pts[2].x + 1, y2: pts[2].y + 1 };
    const hit = portsInRect(doc, P, rect, 0);
    expect(hit.map((r) => r.portId)).toEqual(pts.slice(0, 3).map((p) => p.id));
    const reversed = portsInRect(doc, P, { x1: rect.x2, y1: rect.y2, x2: rect.x1, y2: rect.y1 }, 0);
    expect(reversed).toEqual(hit);
  });

  it('機器をまたいで選べる。何も触れなければ空', () => {
    const doc = createEmptyDocument();
    const a = place(doc, 'camera', 'A', 100, 100);
    const b = place(doc, 'camera', 'B', 100, 300);
    const all = portsInRect(doc, P, { x1: 0, y1: 0, x2: 1000, y2: 1000 }, 0);
    expect(new Set(all.map((r) => r.nodeId))).toEqual(new Set([a, b]));
    expect(portsInRect(doc, P, { x1: 900, y1: 600, x2: 950, y2: 650 }, 0)).toEqual([]);
  });

  it('マークの大きさぶん、当たりを広げる', () => {
    const doc = createEmptyDocument();
    const cam = place(doc, 'camera', 'C', 100, 100);
    const node = doc.pages[0].nodes.find((n) => n.id === cam)!;
    const pl = layoutNodePorts(doc, node).find((p) => p.portId === 'lan-1')!;
    const x = node.x + pl.x;
    const y = node.y + pl.y;
    const justOutside = { x1: x - 20, y1: y - 5, x2: x - 5, y2: y + 5 };
    expect(portsInRect(doc, P, justOutside, 0).some((r) => r.portId === 'lan-1')).toBe(false);
    expect(portsInRect(doc, P, justOutside, 12).some((r) => r.portId === 'lan-1')).toBe(true);
  });
});

describe('addEdges: まとめて追加', () => {
  it('複数の接続を1回の操作で追加し、1回の Undo で戻る', () => {
    const doc = createEmptyDocument();
    const cams = [place(doc, 'camera', 'C1', 40, 100), place(doc, 'camera', 'C2', 40, 200)];
    const sw = place(doc, 'switch8', 'SW', 400, 100);
    const store = new DocumentStore(doc);
    const plan = planBulkConnect(store.doc, P, cams.map((c) => ref(c, 'lan-1')), ref(sw, 'lan-1'));
    expect(store.apply(addEdges(P, plan.pairs)).ok).toBe(true);
    expect(store.doc.pages[0].edges).toHaveLength(2);
    store.undo();
    expect(store.doc.pages[0].edges).toHaveLength(0);
  });

  it('1件でも失敗したら、何も追加しない', () => {
    const doc = createEmptyDocument();
    const cam = place(doc, 'camera', 'C', 40, 100);
    const sw = place(doc, 'switch8', 'SW', 400, 100);
    const store = new DocumentStore(doc);
    const r = store.apply(addEdges(P, [{ from: ref(cam, 'lan-1'), to: ref(sw, 'lan-1') }, { from: ref(cam, 'nothing'), to: ref(sw, 'lan-2') }]));
    expect(r.ok).toBe(false);
    expect(store.doc.pages[0].edges).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('空の組は失敗する', () => {
    expect(addEdges(P, [])(createEmptyDocument()).ok).toBe(false);
  });
});
