import { describe, expect, it } from 'vitest';
import { addNodeFromTemplate } from '../../src/model/actions';
import { applyNodeMoves, planAlign, planDistribute } from '../../src/model/align';
import type { NodeMove } from '../../src/model/align';
import { createEmptyDocument } from '../../src/model/defaults';
import { PRESETS, presetToTemplate } from '../../src/model/presets';

// 期待値は規則(外接長方形・辺と辺の等間隔)から手で導く。実装の出力は写さない。
const P = 'page-1';
type Doc = ReturnType<typeof createEmptyDocument>;

/** 位置と大きさを直接指定した機器を置く。グリッドは既定で有効なので、必要なら呼び出し側で無効にする */
function put(doc: Doc, label: string, x: number, y: number, w: number, h: number): string {
  const id = addNodeFromTemplate(P, presetToTemplate(PRESETS.find((p) => p.id === 'generic')!, 'generic'), label, { x, y })(doc).created!;
  const n = doc.pages[0].nodes.find((v) => v.id === id)!;
  n.x = x;
  n.y = y;
  n.w = w;
  n.h = h;
  return id;
}
const noGrid = (doc: Doc) => {
  doc.grid.enabled = false;
};
const at = (moves: NodeMove[], id: string) => moves.find((m) => m.id === id);

describe('planAlign', () => {
  function setup() {
    const doc = createEmptyDocument();
    noGrid(doc);
    // 外接長方形: 左 100 / 右 400(c の x+w) / 上 50 / 下 300(b の y+h)
    const a = put(doc, 'A', 100, 50, 80, 40); // 右端 180
    const b = put(doc, 'B', 200, 250, 60, 50); // 下端 300
    const c = put(doc, 'C', 300, 120, 100, 30); // 右端 400
    return { doc, ids: [a, b, c], a, b, c };
  }

  it('左揃え: 全員の x が最小の x になる(最小の機器は動かない)', () => {
    const { doc, ids, a, b, c } = setup();
    const m = planAlign(doc, P, ids, 'left');
    expect(at(m, a)).toBeUndefined();
    expect(at(m, b)).toEqual({ id: b, x: 100, y: 250 });
    expect(at(m, c)).toEqual({ id: c, x: 100, y: 120 });
  });

  it('右揃え: 右端が最大の右端(400)に揃う', () => {
    const { doc, ids, a, b, c } = setup();
    const m = planAlign(doc, P, ids, 'right');
    expect(at(m, a)).toEqual({ id: a, x: 320, y: 50 }); // 400 - 80
    expect(at(m, b)).toEqual({ id: b, x: 340, y: 250 }); // 400 - 60
    expect(at(m, c)).toBeUndefined();
  });

  it('左右中央: 機器の中央が外接長方形の中央(250)に揃う', () => {
    const { doc, ids, a, b, c } = setup();
    const m = planAlign(doc, P, ids, 'hcenter');
    expect(at(m, a)?.x).toBe(210); // 250 - 40
    expect(at(m, b)?.x).toBe(220); // 250 - 30
    expect(at(m, c)?.x).toBe(200); // 250 - 50
  });

  it('上揃え・下揃え・上下中央', () => {
    const { doc, ids, a, b, c } = setup();
    const top = planAlign(doc, P, ids, 'top');
    expect(at(top, a)).toBeUndefined();
    expect(at(top, b)?.y).toBe(50);
    expect(at(top, c)?.y).toBe(50);
    const bottom = planAlign(doc, P, ids, 'bottom');
    expect(at(bottom, a)?.y).toBe(260); // 300 - 40
    expect(at(bottom, b)).toBeUndefined();
    expect(at(bottom, c)?.y).toBe(270); // 300 - 30
    const mid = planAlign(doc, P, ids, 'vcenter');
    expect(at(mid, a)?.y).toBe(155); // 175 - 20
    expect(at(mid, b)?.y).toBe(150); // 175 - 25
    expect(at(mid, c)?.y).toBe(160); // 175 - 15
  });

  it('揃え済みなら空(何も動かない)', () => {
    const doc = createEmptyDocument();
    noGrid(doc);
    const a = put(doc, 'A', 100, 50, 80, 40);
    const b = put(doc, 'B', 100, 200, 80, 40);
    expect(planAlign(doc, P, [a, b], 'left')).toEqual([]);
  });

  it('1件以下は空。重複した ID は1つにまとめる', () => {
    const { doc, a, b } = setup();
    expect(planAlign(doc, P, [a], 'left')).toEqual([]);
    expect(planAlign(doc, P, [a, a], 'left')).toEqual([]);
    expect(planAlign(doc, P, [a, a, b], 'left').map((m) => m.id)).toEqual([b]);
  });

  it('存在しない ID が1件でも混ざれば、全体を断る(空の計画)', () => {
    const { doc, a, b } = setup();
    expect(planAlign(doc, P, [a, b, 'nope'], 'left')).toEqual([]);
    expect(planAlign(doc, P, ['nope'], 'left')).toEqual([]);
  });

  it('位置や大きさが有限の数でない機器(壊れたファイル)や、巨大な値の桁あふれは、全体を断る', () => {
    const { doc, ids, b } = setup();
    doc.pages[0].nodes.find((n) => n.id === b)!.x = Number.NaN;
    expect(planAlign(doc, P, ids, 'left')).toEqual([]);
    const d2 = createEmptyDocument();
    noGrid(d2);
    const p = put(d2, 'P', 1e308, 0, 1e308, 10);
    const q = put(d2, 'Q', 0, 0, 10, 10);
    expect(planAlign(d2, P, [p, q], 'right')).toEqual([]);
  });

  it('丸めた結果がページの外へ出るときは、内側へ寄せる', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = true;
    doc.grid.size = 5;
    doc.pages[0].size = { w: 800, h: 600 };
    const a = put(doc, 'A', 700, 50, 100, 40); // 右端 800(ぴったり)
    const b = put(doc, 'B', 799, 100, 1, 40); // 右端 800
    // 右揃えは右端 800。b は x=799 で、5 の倍数へ丸めると 800 になり、右端 801 でページ外 → 799 へ寄せる
    const m = planAlign(doc, P, [a, b], 'right');
    expect(m).toEqual([]); // 寄せた結果は元の位置と同じなので、動かす機器はない
  });

  it('グリッドが奇数(7)でも、丸めた結果はグリッドの倍数になる(寄せられる場合を除く)', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = true;
    doc.grid.size = 7;
    const a = put(doc, 'A', 70, 50, 40, 40);
    const b = put(doc, 'B', 210, 120, 40, 40);
    const m = planAlign(doc, P, [a, b], 'hcenter'); // 中央 (70+250)/2 = 160 → a.x=140, b.x=140
    expect(at(m, a)?.x).toBe(140);
    expect(at(m, b)?.x).toBe(140);
    expect(140 % 7).toBe(0);
  });

  it('グリッドが有効なら結果をグリッドの倍数へ丸める', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = true;
    doc.grid.size = 10;
    const a = put(doc, 'A', 100, 50, 80, 40);
    const b = put(doc, 'B', 300, 50, 65, 40); // 左右中央: 中央 (100+365)/2 = 232.5 → b.x = 232.5 - 32.5 = 200
    const m = planAlign(doc, P, [a, b], 'hcenter');
    // a: 232.5 - 40 = 192.5 → 190(丸めは最も近い倍数。中間値は大きい方 → 200ではなく 192.5/10=19.25 → 19 → 190)
    expect(at(m, a)?.x).toBe(190);
    expect(at(m, b)?.x).toBe(200);
  });

  it('適用すると位置が変わる(計画は適用先と整合する)', () => {
    const { doc, ids, b } = setup();
    expect(applyNodeMoves(P, planAlign(doc, P, ids, 'left'))(doc).ok).toBe(true);
    expect(doc.pages[0].nodes.find((n) => n.id === b)!.x).toBe(100);
  });
});

describe('planDistribute', () => {
  it('左右に等間隔: 両端は動かず、辺と辺の間隔が等しくなる', () => {
    const doc = createEmptyDocument();
    noGrid(doc);
    // 幅 100,50,50,100(合計 300)。左端 0、右端 700 → 余白 400 → 間隔 133.333…
    const a = put(doc, 'A', 0, 0, 100, 40);
    const b = put(doc, 'B', 150, 0, 50, 40);
    const c = put(doc, 'C', 220, 0, 50, 40);
    const d = put(doc, 'D', 600, 0, 100, 40);
    const m = planDistribute(doc, P, [d, b, a, c], 'horizontal');
    expect(at(m, a)).toBeUndefined();
    expect(at(m, d)).toBeUndefined();
    const gap = 400 / 3;
    expect(at(m, b)?.x).toBeCloseTo(100 + gap, 9);
    expect(at(m, c)?.x).toBeCloseTo(100 + gap + 50 + gap, 9);
  });

  it('上下に等間隔(高さの違う3台)', () => {
    const doc = createEmptyDocument();
    noGrid(doc);
    const a = put(doc, 'A', 0, 0, 80, 40); // 0〜40
    const b = put(doc, 'B', 0, 60, 80, 20); // 中: 動く
    const c = put(doc, 'C', 0, 300, 80, 60); // 300〜360
    // 余白 = 360 - 120(合計) = 240 → 間隔 120 → b.y = 40 + 120 = 160
    const m = planDistribute(doc, P, [a, b, c], 'vertical');
    expect(m).toEqual([{ id: b, x: 0, y: 160 }]);
  });

  it('順序は選択の順ではなく現在の位置順(順序は入れ替わらない)', () => {
    const doc = createEmptyDocument();
    noGrid(doc);
    const a = put(doc, 'A', 0, 0, 50, 40);
    const b = put(doc, 'B', 100, 0, 50, 40);
    const c = put(doc, 'C', 500, 0, 50, 40);
    const m = planDistribute(doc, P, [c, a, b], 'horizontal');
    expect(m).toEqual([{ id: b, x: 250, y: 0 }]); // 余白 550-150=400 → 間隔 200 → 50+200
  });

  it('2台以下は空', () => {
    const doc = createEmptyDocument();
    noGrid(doc);
    const a = put(doc, 'A', 0, 0, 50, 40);
    const b = put(doc, 'B', 300, 0, 50, 40);
    expect(planDistribute(doc, P, [a, b], 'horizontal')).toEqual([]);
    expect(planDistribute(doc, P, [], 'vertical')).toEqual([]);
  });

  it('すでに等間隔なら空', () => {
    const doc = createEmptyDocument();
    noGrid(doc);
    const ids = [0, 1, 2].map((i) => put(doc, `N${i}`, i * 200, 0, 100, 40));
    expect(planDistribute(doc, P, ids, 'horizontal')).toEqual([]);
  });

  it('間隔が負(機器の合計が幅より大きい)でも計画する(重なりを禁止する規則はない)', () => {
    const doc = createEmptyDocument();
    noGrid(doc);
    const a = put(doc, 'A', 0, 0, 100, 40);
    const b = put(doc, 'B', 10, 0, 100, 40);
    const c = put(doc, 'C', 120, 0, 100, 40); // 外接 0〜220、合計 300 → 余白 -80 → 間隔 -40
    expect(planDistribute(doc, P, [a, b, c], 'horizontal')).toEqual([{ id: b, x: 60, y: 0 }]); // 100 + (-40)
  });

  it('グリッドが有効なら結果を丸める', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = true;
    doc.grid.size = 10;
    const a = put(doc, 'A', 0, 0, 50, 40);
    const b = put(doc, 'B', 20, 0, 50, 40);
    const c = put(doc, 'C', 260, 0, 50, 40); // 余白 310-150=160 → 間隔 80 → b.x = 50+80 = 130
    expect(planDistribute(doc, P, [a, b, c], 'horizontal')).toEqual([{ id: b, x: 130, y: 0 }]);
    const d = put(doc, 'D', 0, 100, 50, 40);
    const e = put(doc, 'E', 20, 100, 50, 40);
    const f = put(doc, 'F', 255, 100, 50, 40); // 余白 305-150=155 → 間隔 77.5 → e.x = 127.5 → 130
    expect(at(planDistribute(doc, P, [d, e, f], 'horizontal'), e)?.x).toBe(130);
  });
});

describe('applyNodeMoves', () => {
  it('計画の座標をそのまま適用する。動かさない軸は、グリッドに乗っていなくても変わらない', () => {
    const doc = createEmptyDocument();
    doc.grid.enabled = true;
    doc.grid.size = 10;
    const a = put(doc, 'A', 0, 0, 50, 40);
    const b = put(doc, 'B', 20, 7, 50, 40); // y=7 はグリッド外
    const c = put(doc, 'C', 260, 0, 50, 40);
    const moves = planDistribute(doc, P, [a, b, c], 'horizontal');
    expect(applyNodeMoves(P, moves)(doc).ok).toBe(true);
    const nb = doc.pages[0].nodes.find((n) => n.id === b)!;
    expect(nb.x).toBe(130);
    expect(nb.y).toBe(7); // 水平の等間隔は、縦の位置を変えない
  });

  it('存在しない ID が1件でもあれば、何も変えない', () => {
    const doc = createEmptyDocument();
    noGrid(doc);
    const a = put(doc, 'A', 0, 0, 50, 40);
    const r = applyNodeMoves(P, [{ id: a, x: 99, y: 99 }, { id: 'nope', x: 1, y: 1 }])(doc);
    expect(r.ok).toBe(false);
    expect(doc.pages[0].nodes.find((n) => n.id === a)!.x).toBe(0);
  });
});
