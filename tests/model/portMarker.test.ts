import { describe, expect, it } from 'vitest';
import { markerSpec } from '../../src/model/portMarker';

describe('markerSpec(設計書 5.3: 入力=内向き三角 / 出力=外向き三角 / 双方向=菱形)', () => {
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

  it.each(['left', 'right', 'top', 'bottom'] as const)('双方向は辺 %s でも菱形', (side) => {
    expect(markerSpec('inout', side).shape).toBe('rhombus');
  });
});
