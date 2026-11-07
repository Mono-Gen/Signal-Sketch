import { describe, expect, it } from 'vitest';
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

const place = (groups: PortGroup[], w: number, h: number, grid = 10) =>
  layoutPorts(expandPortGroups(groups), { w, h }, grid).map((p) => [p.portId, p.x, p.y]);

describe('layoutPorts(設計書 5.3: 辺に沿って、グリッド間隔で並べる)', () => {
  it('左の辺: ヘッダ分(30)を空けて、グリッド間隔で下へ並ぶ。x は辺上(0)', () => {
    expect(place([g('a', 'left', 3)], 100, 100)).toEqual([
      ['a-1', 0, 30],
      ['a-2', 0, 40],
      ['a-3', 0, 50],
    ]);
  });

  it('右の辺: x は機器の幅', () => {
    expect(place([g('a', 'right', 2)], 120, 100)).toEqual([
      ['a-1', 120, 30],
      ['a-2', 120, 40],
    ]);
  });

  it('上下の辺: 端から1グリッド(10)空けて横へ並ぶ。y は 0 / 機器の高さ', () => {
    expect(place([g('t', 'top', 2)], 100, 60)).toEqual([
      ['t-1', 10, 0],
      ['t-2', 20, 0],
    ]);
    expect(place([g('b', 'bottom', 2)], 100, 60)).toEqual([
      ['b-1', 10, 60],
      ['b-2', 20, 60],
    ]);
  });

  it('グループが切り替わる所は1つ分あける', () => {
    expect(place([g('a', 'left', 2), g('b', 'left', 1)], 100, 100)).toEqual([
      ['a-1', 0, 30],
      ['a-2', 0, 40],
      ['b-1', 0, 60],
    ]);
  });

  it('1辺に収まらない分は、内側へ2グリッドずらした段へ折り返す', () => {
    // h=50: 使える長さ=50-30-10=10 → 1段に2個
    expect(place([g('a', 'left', 3)], 100, 50)).toEqual([
      ['a-1', 0, 30],
      ['a-2', 0, 40],
      ['a-3', 20, 30],
    ]);
    // 右の辺は内側=左向きにずれる
    expect(place([g('a', 'right', 3)], 100, 50)[2]).toEqual(['a-3', 80, 30]);
  });

  it('極端に小さい機器でも、1段に最低1個として段を重ねる(例外にしない)', () => {
    expect(place([g('a', 'left', 3)], 100, 10)).toEqual([
      ['a-1', 0, 30],
      ['a-2', 20, 30],
      ['a-3', 40, 30],
    ]);
  });

  it('グリッド幅が20なら、開始位置も間隔も20の倍数になる', () => {
    expect(place([g('a', 'left', 2)], 200, 200, 20)).toEqual([
      ['a-1', 0, 40],
      ['a-2', 0, 60],
    ]);
  });

  it('機器の位置とサイズがグリッドの倍数なら、全ポート座標もグリッドの倍数', () => {
    const groups = [g('l', 'left', 8), g('r', 'right', 8), g('t', 'top', 2), g('b', 'bottom', 4)];
    for (const [, x, y] of place(groups, 260, 130)) {
      expect((x as number) % 10).toBe(0);
      expect((y as number) % 10).toBe(0);
    }
  });

  it('24ポートのスイッチ(幅260)が1段に収まる', () => {
    const placed = place([g('a', 'top', 24)], 260, 60);
    // 10 から 10 刻みで 24 個 = 10..240。折り返しなし(全て y=0)
    expect(placed[0]).toEqual(['a-1', 10, 0]);
    expect(placed[23]).toEqual(['a-24', 240, 0]);
    expect(placed.every(([, , y]) => y === 0)).toBe(true);
  });

  it('1段の上限(幅260で25個)を超えた分は、内側の段へ折り返す', () => {
    const placed = place([g('a', 'top', 26)], 260, 60);
    expect(placed[24]).toEqual(['a-25', 260 - 10, 0]);
    expect(placed[25]).toEqual(['a-26', 10, 20]);
  });

  it('ポートが無ければ空', () => {
    expect(layoutPorts([], { w: 100, h: 100 }, 10)).toEqual([]);
  });
});
