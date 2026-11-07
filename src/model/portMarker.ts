import type { Direction, Side } from './types';

export type CompassDirection = 'north' | 'south' | 'east' | 'west';

export interface MarkerSpec {
  shape: 'triangle' | 'rhombus';
  /** 三角形が向く方角(菱形では意味を持たない) */
  direction: CompassDirection;
}

const OUTWARD: Record<Side, CompassDirection> = { left: 'west', right: 'east', top: 'north', bottom: 'south' };
const INWARD: Record<Side, CompassDirection> = { left: 'east', right: 'west', top: 'south', bottom: 'north' };

/**
 * ポートのマークの形(設計書 5.3)。信号の流れる向きを三角形の向きで表す。
 * 入力 = 機器の内側へ向く三角 / 出力 = 外側へ向く三角 / 双方向 = 菱形。
 * 色は信号種別が決めるため、向きの区別は形で行う(色だけに頼らない)。
 */
export function markerSpec(direction: Direction, side: Side): MarkerSpec {
  if (direction === 'inout') return { shape: 'rhombus', direction: 'east' };
  return { shape: 'triangle', direction: direction === 'in' ? INWARD[side] : OUTWARD[side] };
}
