import { describe, expect, it } from 'vitest';
import { ceilToGrid, isOnGrid, snap } from '../../src/model/grid';

describe('snap: 最も近いグリッドの倍数へ吸着(中間値は大きい方)', () => {
  it.each([
    [13, 10, 10],
    [16, 10, 20],
    [15, 10, 20], // 中間値は大きい方へ
    [0, 10, 0],
    [-4, 10, 0], // -0 ではなく 0 になる
    [-6, 10, -10],
    [-5, 10, 0], // 負の中間値も大きい方(0)へ
    [37, 20, 40],
  ])('snap(%d, %d) = %d', (v, g, expected) => {
    expect(Object.is(snap(v, g), expected)).toBe(true);
  });

  it('グリッド幅が0以下・非有限なら例外', () => {
    expect(() => snap(10, 0)).toThrow(RangeError);
    expect(() => snap(10, -10)).toThrow(RangeError);
    expect(() => snap(10, Number.NaN)).toThrow(RangeError);
  });
});

describe('ceilToGrid: 必要な長さをグリッドの倍数へ切り上げ', () => {
  it.each([
    [95, 10, 100],
    [100, 10, 100], // ちょうどなら据え置き
    [101, 10, 110],
    [0, 10, 0],
    [1, 20, 20],
  ])('ceilToGrid(%d, %d) = %d', (len, g, expected) => {
    expect(Object.is(ceilToGrid(len, g), expected)).toBe(true);
  });

  it('グリッド幅が不正なら例外', () => {
    expect(() => ceilToGrid(10, 0)).toThrow(RangeError);
  });
});

describe('isOnGrid', () => {
  it('倍数ならtrue、そうでなければfalse', () => {
    expect(isOnGrid(30, 10)).toBe(true);
    expect(isOnGrid(0, 10)).toBe(true);
    expect(isOnGrid(-20, 10)).toBe(true);
    expect(isOnGrid(35, 10)).toBe(false);
  });
});
