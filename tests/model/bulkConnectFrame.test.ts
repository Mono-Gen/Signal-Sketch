import { describe, expect, it } from 'vitest';
import { addEdge, addNodeFromTemplate } from '../../src/model/actions';
import { planBulkConnect } from '../../src/model/bulkConnect';
import { createEmptyDocument } from '../../src/model/defaults';
import { addFrame, resizeFrame, followersInFrame, sortReadingOrder } from '../../src/model/frames';
import { PRESETS, presetToTemplate } from '../../src/model/presets';

// 一括接続を「同じ枠の中のほかの機器」へ進める規則(案C)。期待値は計画書の規則から導く。
const P = 'page-1';
const preset = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, id);
const ref = (nodeId: string, portId: string) => ({ nodeId, portId });
type Doc = ReturnType<typeof createEmptyDocument>;

function place(doc: Doc, presetId: string, label: string, x: number, y: number): string {
  return addNodeFromTemplate(P, preset(presetId), label, { x, y })(doc).created!;
}
/** 広い枠を作る(左上 x,y、大きさ w×h) */
function frame(doc: Doc, x: number, y: number, w: number, h: number): string {
  const id = addFrame(P, 'F', { x, y })(doc).created!;
  expect(resizeFrame(P, id, { x, y, w, h })(doc).ok).toBe(true);
  return id;
}
const node = (doc: Doc, id: string) => doc.pages[0].nodes.find((n) => n.id === id)!;

describe('sortReadingOrder', () => {
  it('高さが半分以内のずれは左から右、超えれば上から下', () => {
    const doc = createEmptyDocument();
    const a = place(doc, 'speaker', 'A', 400, 100);
    const h = node(doc, a).h;
    const b = place(doc, 'speaker', 'B', 100, 100 + Math.floor(h / 2) - 1); // 半分以内 → 同じ行
    const c = place(doc, 'speaker', 'C', 300, 100 + h * 2); // 次の行
    const order = sortReadingOrder([node(doc, c), node(doc, a), node(doc, b)]).map((n) => n.id);
    expect(order).toEqual([b, a, c]);
  });

  it('空配列は空', () => {
    expect(sortReadingOrder([])).toEqual([]);
  });
});

describe('followersInFrame', () => {
  it('枠外は空、枠内なら読み順が後ろの同じ枠の機器だけ(自分・前の機器・枠外は含まない)', () => {
    const doc = createEmptyDocument();
    frame(doc, 0, 0, 800, 600);
    const a = place(doc, 'speaker', 'A', 100, 100);
    const b = place(doc, 'speaker', 'B', 100, 300);
    const out = place(doc, 'speaker', 'OUT', 1500, 100);
    const page = doc.pages[0];
    expect(followersInFrame(page, node(doc, a)).map((n) => n.id)).toEqual([b]);
    expect(followersInFrame(page, node(doc, b))).toEqual([]);
    expect(followersInFrame(page, node(doc, out))).toEqual([]);
  });
});

describe('planBulkConnect: 同じ枠の機器へ進む', () => {
  /** 枠内に、アンプ1台とスピーカー3台(読み順 S1, S2, S3)を置く */
  function setup() {
    const doc = createEmptyDocument();
    frame(doc, 0, 0, 1200, 900);
    const amp = place(doc, 'amp', 'AMP', 40, 40);
    const s1 = place(doc, 'speaker', 'S1', 700, 100);
    const s2 = place(doc, 'speaker', 'S2', 700, 300);
    const s3 = place(doc, 'speaker', 'S3', 700, 500);
    return { doc, amp, s: [s1, s2, s3] };
  }

  it('アンプの出力2本 → 落とし先のスピーカーから読み順に別々のスピーカーへ', () => {
    const { doc, amp, s } = setup();
    // 落とし先は S2。S2 → S1 には戻らず S3 へ
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-out-1'), ref(amp, 'audio-out-2')], ref(s[1], 'audio-1'));
    expect(plan.skipped).toEqual([]);
    expect(plan.pairs).toEqual([
      { from: ref(amp, 'audio-out-1'), to: ref(s[1], 'audio-1') },
      { from: ref(amp, 'audio-out-2'), to: ref(s[2], 'audio-1') },
    ]);
  });

  it('落とし先の機器のあと、同じ枠の残りを読み順に使う(落とし先が先頭)', () => {
    const { doc, amp, s } = setup();
    // 出力は2本しかないので、スピーカー1台ぶんのポートを使い切ったあとに進むことを、先に1本つないで確認する
    addEdge(P, ref(s[1], 'audio-1'), ref(amp, 'audio-1'))(doc); // S2 の入力は接続済み(multi でない)
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-out-1'), ref(amp, 'audio-out-2')], ref(s[0], 'audio-1'));
    // S1 → (S2 は埋まっているので飛ばす) → S3
    expect(plan.pairs.map((p) => p.to.nodeId)).toEqual([s[0], s[2]]);
  });

  it('足りない分は no-target', () => {
    const { doc, amp, s } = setup();
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-out-1'), ref(amp, 'audio-out-2')], ref(s[2], 'audio-1'));
    expect(plan.pairs).toEqual([{ from: ref(amp, 'audio-out-1'), to: ref(s[2], 'audio-1') }]);
    expect(plan.skipped).toEqual([{ ref: ref(amp, 'audio-out-2'), reason: 'no-target' }]);
  });

  it('枠の外のスピーカーへは進まない', () => {
    const { doc, amp, s } = setup();
    place(doc, 'speaker', 'OUT', 1500, 600);
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-out-1'), ref(amp, 'audio-out-2')], ref(s[2], 'audio-1'));
    expect(plan.pairs).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe('no-target');
  });

  it('対応するポートを持たない機器(カメラ)が間にあっても飛ばして進む', () => {
    const doc = createEmptyDocument();
    frame(doc, 0, 0, 1200, 900);
    const amp = place(doc, 'amp', 'AMP', 40, 40);
    const s1 = place(doc, 'speaker', 'S1', 700, 100);
    place(doc, 'camera', 'CAM', 700, 300);
    const s2 = place(doc, 'speaker', 'S2', 700, 500);
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-out-1'), ref(amp, 'audio-out-2')], ref(s1, 'audio-1'));
    expect(plan.pairs.map((p) => p.to.nodeId)).toEqual([s1, s2]);
  });

  it('枠がなければ従来どおり、落とし先の1台の中だけ', () => {
    const doc = createEmptyDocument();
    const amp = place(doc, 'amp', 'AMP', 40, 40);
    const s1 = place(doc, 'speaker', 'S1', 700, 100);
    place(doc, 'speaker', 'S2', 700, 300);
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-out-1'), ref(amp, 'audio-out-2')], ref(s1, 'audio-1'));
    expect(plan.pairs).toHaveLength(1);
    expect(plan.skipped).toEqual([{ ref: ref(amp, 'audio-out-2'), reason: 'no-target' }]);
  });

  it('入れ子の枠は、内側の枠の機器だけが対象', () => {
    const doc = createEmptyDocument();
    frame(doc, 0, 0, 1200, 900); // 外
    frame(doc, 600, 0, 500, 400); // 内
    const amp = place(doc, 'amp', 'AMP', 40, 40);
    const inner1 = place(doc, 'speaker', 'I1', 700, 100);
    const inner2 = place(doc, 'speaker', 'I2', 700, 250);
    place(doc, 'speaker', 'O1', 700, 600); // 外の枠にだけ属する
    const plan = planBulkConnect(
      doc,
      P,
      [ref(amp, 'audio-out-1'), ref(amp, 'audio-out-2')],
      ref(inner1, 'audio-1'),
    );
    expect(plan.pairs.map((p) => p.to.nodeId)).toEqual([inner1, inner2]);
  });

  it('複数接続可(multi)のポートは、接続済みでも候補に残る(1本ずつの接続と同じ扱い)', () => {
    const { doc, amp, s } = setup();
    const multi = { id: 'audio', signalType: 'AUDIO', direction: 'in' as const, side: 'left' as const, count: 1, labelPrefix: 'IN ', multi: true };
    node(doc, s[1]).portGroupsOverride = [multi];
    addEdge(P, ref(s[1], 'audio-1'), ref(amp, 'audio-1'))(doc);
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-out-1'), ref(amp, 'audio-out-2')], ref(s[0], 'audio-1'));
    expect(plan.pairs.map((p) => p.to.nodeId)).toEqual([s[0], s[1]]);
  });

  it('枠の境界: 中心が枠の外の機器は対象外、中心が内なら対象', () => {
    const doc = createEmptyDocument();
    frame(doc, 0, 0, 1000, 600);
    const amp = place(doc, 'amp', 'AMP', 40, 40);
    const s1 = place(doc, 'speaker', 'S1', 700, 100);
    const h = node(doc, s1).h;
    const w = node(doc, s1).w;
    const inside = place(doc, 'speaker', 'IN', 1000 - w / 2 - 10, 300); // 中心 x が枠の内側
    place(doc, 'speaker', 'OUTSIDE', 1000 - w / 2 + 10, 400); // 中心 x が枠の外側
    expect(h).toBeGreaterThan(0);
    const plan = planBulkConnect(doc, P, [ref(amp, 'audio-out-1'), ref(amp, 'audio-out-2'), ref(amp, 'audio-out-3')], ref(s1, 'audio-1'));
    expect(plan.pairs.map((p) => p.to.nodeId)).toEqual([s1, inside]);
  });
});

describe('sortReadingOrder: 非推移の連鎖', () => {
  it('隣同士は同じ高さでも、行の先頭から離れた機器は次の行になる(順序が一意に決まる)', () => {
    const doc = createEmptyDocument();
    const a = place(doc, 'speaker', 'A', 100, 100);
    const h = node(doc, a).h;
    const b = place(doc, 'speaker', 'B', 200, 100 + h * 0.4); // A と同じ行
    const c = place(doc, 'speaker', 'C', 50, 100 + h * 0.8); // A から半分を超えるので次の行(B とは近いが行先頭は A)
    const order = sortReadingOrder([node(doc, c), node(doc, b), node(doc, a)]).map((n) => n.id);
    expect(order).toEqual([a, b, c]);
  });
});
