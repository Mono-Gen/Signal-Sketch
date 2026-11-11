import { describe, expect, it } from 'vitest';
import { autoNodeSize, DEFAULT_NODE_HEIGHT, estimateTextWidth } from '../../src/model/nodeSize';
import { layoutPorts } from '../../src/model/portLayout';
import { expandPortGroups } from '../../src/model/ports';
import type { PortGroup, Side } from '../../src/model/types';

const g = (id: string, side: Side, count: number): PortGroup => ({
  id,
  signalType: 'LAN',
  direction: 'inout',
  side,
  count,
  labelPrefix: 'P',
});

const size = (groups: PortGroup[], label = 'Dev', model = '', grid = 10) => autoNodeSize({ groups, label, model, grid });

describe('estimateTextWidth', () => {
  it('全角は半角より広く数える', () => {
    expect(estimateTextWidth('日本')).toBeGreaterThan(estimateTextWidth('ab'));
    expect(estimateTextWidth('')).toBe(0);
  });
});

describe('autoNodeSize', () => {
  it('ポートが少なければ最小サイズ(120x50)', () => {
    expect(size([g('a', 'left', 1)])).toEqual({ w: 120, h: 50 });
  });

  it('左右の辺のポートが多ければ、1段に収まる高さまで広げる(30 + 10 x 枠数)', () => {
    expect(size([g('a', 'left', 8)]).h).toBe(110); // 30 + 8*10
    expect(size([g('a', 'left', 8), g('b', 'right', 3)]).h).toBe(110); // 多い方に合わせる
  });

  it('グループの切れ目の枠も数える', () => {
    // 4 + 1(切れ目) + 4 = 9枠 -> 30 + 90
    expect(size([g('a', 'left', 4), g('b', 'left', 4)]).h).toBe(120);
  });

  it('上下の辺のポートが多ければ、幅を広げる(10 x (枠数+1))', () => {
    expect(size([g('a', 'bottom', 24)]).w).toBe(250);
    expect(size([g('a', 'top', 48)]).w).toBe(490);
  });

  it('名称が長ければ幅を広げ、結果はグリッドの倍数', () => {
    const w = size([g('a', 'left', 1)], 'Very Long Control Touch Panel Name').w;
    expect(w).toBeGreaterThan(120);
    expect(w % 10).toBe(0);
  });

  it('型番が名称より長ければ型番に合わせる', () => {
    const byModel = size([g('a', 'left', 1)], 'A', 'Model-E1-LONG-MODEL-NUMBER-XXXXXX').w;
    const byLabel = size([g('a', 'left', 1)], 'A', '').w;
    expect(byModel).toBeGreaterThan(byLabel);
  });

  it('グリッド幅20でも、結果は20の倍数', () => {
    const s = size([g('a', 'left', 5), g('b', 'bottom', 7)], 'Dev', '', 20);
    expect(s.w % 20).toBe(0);
    expect(s.h % 20).toBe(0);
  });

  it('ポートなしでも最小サイズ', () => {
    expect(size([])).toEqual({ w: 120, h: 50 });
  });

  it.each([
    [[g('a', 'left', 12), g('b', 'right', 5), g('c', 'top', 3), g('d', 'bottom', 30)]],
    [[g('a', 'left', 2), g('b', 'left', 2), g('c', 'left', 2)]],
    [[g('a', 'bottom', 48)]],
    [[g('a', 'right', 1)]],
  ])('求めたサイズなら、layoutPorts が折り返さず1段に並べる(整合性)', (groups) => {
    const s = size(groups);
    const placements = layoutPorts(expandPortGroups(groups), s, 10);
    for (const p of placements) {
      if (p.side === 'left') expect(p.x).toBe(0);
      if (p.side === 'right') expect(p.x).toBe(s.w);
      if (p.side === 'top') expect(p.y).toBe(0);
      if (p.side === 'bottom') expect(p.y).toBe(s.h);
    }
  });
});

describe('autoNodeSize(ポート番号を表示するときの高さの下限)', () => {
  const withLabels = (groups: PortGroup[], model = '') => autoNodeSize({ groups, label: 'Dev', model, grid: 10, portLabels: true });

  // 期待値は仕様から: アイコン 8+24=32 / 名前の下端 6+14=20(型番があれば+14) / 上辺に番号があれば名前が10下がる / 下辺の番号の行 18 を足し、グリッドへ切り上げる
  it('下辺だけ: 32+18=50 → 50', () => {
    expect(withLabels([g('b', 'bottom', 8)]).h).toBe(50);
  });

  it('上辺と下辺: 10+32+18=60 → 60', () => {
    expect(withLabels([g('t', 'top', 1), g('b', 'bottom', 8)]).h).toBe(60);
  });

  it('上辺と下辺で、型番もある: 10+34+18=62 → 70', () => {
    expect(withLabels([g('t', 'top', 1), g('b', 'bottom', 8)], 'Model-X').h).toBe(70);
  });

  it('下辺にポートがなければ、番号の行が要らないので、標準のまま', () => {
    expect(withLabels([g('t', 'top', 2), g('l', 'left', 2)]).h).toBe(size([g('t', 'top', 2), g('l', 'left', 2)]).h);
  });

  it('番号を表示しないときは、これまでと同じ', () => {
    const groups = [g('t', 'top', 1), g('b', 'bottom', 8)];
    expect(size(groups, 'Dev', 'Model-X').h).toBe(50);
  });
});

describe('DEFAULT_NODE_HEIGHT(新しく置く機器の標準の高さ)', () => {
  it('下限(50)より大きい60で、下限そのものは変えない(保存済みの機器が勝手に大きくならないように)', () => {
    expect(DEFAULT_NODE_HEIGHT).toBe(60);
    expect(size([])).toEqual({ w: 120, h: 50 });
  });
});
