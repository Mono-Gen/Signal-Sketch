import { describe, expect, it } from 'vitest';
import { anchorScrollDelta, clampZoom, fitZoom, MAX_ZOOM, MIN_ZOOM, stepZoom } from '../../src/view/zoom';

describe('clampZoom', () => {
  it('範囲内はそのまま、範囲外は端へ収める', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
  });
  it('数でない値は 1', () => {
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
  });
});

describe('stepZoom', () => {
  it('拡大は 1.25 倍、縮小は 1/1.25 倍(1%単位に丸め)', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.8);
  });
  it('上限・下限を超えない', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe('fitZoom', () => {
  const page = { w: 1280, h: 720 };
  it('領域が小さければ、縦横の小さい方の比率に合わせる', () => {
    expect(fitZoom(page, { w: 640, h: 1000 })).toBe(0.5);
    expect(fitZoom(page, { w: 2000, h: 360 })).toBe(0.5);
  });
  it('領域が大きくても 1 を超えない', () => {
    expect(fitZoom(page, { w: 5000, h: 5000 })).toBe(1);
  });
  it('端数は切り捨てて、はみ出さない', () => {
    expect(fitZoom(page, { w: 1000, h: 5000 })).toBe(0.78); // 0.78125 → 0.78
  });
  it('極端に小さい領域は下限、不正な領域は 1', () => {
    expect(fitZoom(page, { w: 10, h: 10 })).toBe(MIN_ZOOM);
    expect(fitZoom(page, { w: 0, h: 500 })).toBe(1);
    expect(fitZoom(page, { w: -5, h: 500 })).toBe(1);
  });
});

describe('anchorScrollDelta', () => {
  it('図の点 (100,200) を 1→2 倍にすると、見た目の位置は (100,200) だけ右下へ動く。その分スクロールして打ち消す', () => {
    expect(anchorScrollDelta({ x: 100, y: 200 }, 1, 2)).toEqual({ dx: 100, dy: 200 });
  });
  it('縮小では負の差分', () => {
    expect(anchorScrollDelta({ x: 100, y: 200 }, 2, 1)).toEqual({ dx: -100, dy: -200 });
  });
  it('変わらなければ 0', () => {
    expect(anchorScrollDelta({ x: 100, y: 200 }, 1.5, 1.5)).toEqual({ dx: 0, dy: 0 });
  });
});
