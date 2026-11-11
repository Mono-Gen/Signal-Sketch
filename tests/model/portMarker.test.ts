import { describe, expect, it } from 'vitest';
import { markerSpec, portLabelPosition, portLabelText } from '../../src/model/portMarker';

describe('markerSpec(設計書 5.3: 入力=内向き三角 / 出力=外向き三角 / 双方向=四角形)', () => {
  it.each([
    ['in', 'left', 'east'],
    ['in', 'right', 'west'],
    ['in', 'top', 'south'],
    ['in', 'bottom', 'north'],
    ['out', 'left', 'west'],
    ['out', 'right', 'east'],
    ['out', 'top', 'north'],
    ['out', 'bottom', 'south'],
  ] as const)('%s / %s の辺 → 三角形が %s を向く', (direction, side, expected) => {
    expect(markerSpec(direction, side)).toEqual({ shape: 'triangle', direction: expected });
  });

  it.each(['left', 'right', 'top', 'bottom'] as const)('双方向は辺 %s でも四角形', (side) => {
    expect(markerSpec('inout', side).shape).toBe('square');
  });
});

it('各辺のラベルをマークの内側に置く', () => {
  expect(portLabelPosition('left', 50, 50, 10)).toEqual({ x: 59, y: 50, align: 'left' });
  expect(portLabelPosition('right', 50, 50, 10)).toEqual({ x: 41, y: 50, align: 'right' });
  expect(portLabelPosition('top', 50, 50, 10)).toEqual({ x: 50, y: 63, align: 'center' });
  expect(portLabelPosition('bottom', 50, 50, 10)).toEqual({ x: 50, y: 37, align: 'center' });
});

describe('portLabelText(図の上に出すポートの文字)', () => {
  const port = { label: 'LAN3', shortLabel: '3' };

  it('どの辺でも、番号だけにする(辺ごとの見た目をそろえ、1グリッドずつ並ぶ文字が重ならないように)', () => {
    for (const side of ['top', 'bottom', 'left', 'right'] as const) expect(portLabelText(port, side)).toBe('3');
  });

  it('短い表示名がなければ、名前の全体にする', () => {
    expect(portLabelText({ label: 'IN' }, 'bottom')).toBe('IN');
  });
});
