import { describe, expect, it } from 'vitest';
import { findFreePosition } from '../../src/model/placement';

const PAGE = { w: 1280, h: 720 };
const SIZE = { w: 120, h: 50 };

describe('findFreePosition', () => {
  it('何もなければ左上(グリッド2つ分の余白)へ置く', () => {
    expect(findFreePosition([], SIZE, PAGE, 10)).toEqual({ x: 20, y: 20 });
  });

  it('既存の機器と重なる場所は避け、右隣の空きへ置く', () => {
    const existing = [{ x: 20, y: 20, w: 120, h: 50 }];
    const pos = findFreePosition(existing, SIZE, PAGE, 10);
    expect(pos.y).toBe(20);
    expect(pos.x).toBeGreaterThanOrEqual(20 + 120 + 10); // 余白(1グリッド)を空ける
  });

  it('結果は既存の機器と重ならず、グリッド(10)の倍数', () => {
    const existing = [
      { x: 20, y: 20, w: 120, h: 50 },
      { x: 160, y: 20, w: 120, h: 50 },
      { x: 20, y: 90, w: 300, h: 130 },
    ];
    const p = findFreePosition(existing, SIZE, PAGE, 10);
    expect(p.x % 10).toBe(0);
    expect(p.y % 10).toBe(0);
    const hit = existing.some((n) => p.x < n.x + n.w && n.x < p.x + SIZE.w && p.y < n.y + n.h && n.y < p.y + SIZE.h);
    expect(hit).toBe(false);
  });

  it('1行が埋まっていたら次の行へ', () => {
    // 1行目(y=20)を横いっぱいに埋める
    const row = [{ x: 0, y: 0, w: 1280, h: 80 }];
    expect(findFreePosition(row, SIZE, PAGE, 10).y).toBeGreaterThanOrEqual(90);
  });

  it('ページに空きがなければ左上を返す(例外にしない)', () => {
    const full = [{ x: 0, y: 0, w: 1280, h: 720 }];
    expect(findFreePosition(full, SIZE, PAGE, 10)).toEqual({ x: 20, y: 20 });
  });

  it('ページより大きい機器でも左上を返す', () => {
    expect(findFreePosition([], { w: 2000, h: 50 }, PAGE, 10)).toEqual({ x: 20, y: 20 });
  });
});
