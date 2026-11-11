import type { Direction, Side } from './types';

export type CompassDirection = 'north' | 'south' | 'east' | 'west';

export interface MarkerSpec {
  shape: 'triangle' | 'square';
  /** 三角形が向く方角(四角形では意味を持たない) */
  direction: CompassDirection;
}

const OUTWARD: Record<Side, CompassDirection> = { left: 'west', right: 'east', top: 'north', bottom: 'south' };
const INWARD: Record<Side, CompassDirection> = { left: 'east', right: 'west', top: 'south', bottom: 'north' };

/**
 * ポートのマークの形(設計書 5.3)。信号の流れる向きを三角形の向きで表す。
 * 入力 = 機器の内側へ向く三角 / 出力 = 外側へ向く三角 / 双方向 = 四角形。
 * 色は信号種別が決めるため、向きの区別は形で行う(色だけに頼らない)。
 */
export function markerSpec(direction: Direction, side: Side): MarkerSpec {
  if (direction === 'inout') return { shape: 'square', direction: 'east' };
  return { shape: 'triangle', direction: direction === 'in' ? INWARD[side] : OUTWARD[side] };
}

// 画面とSVGで同じ余白と文字サイズにする。
export const MULTI_OUTLINE_GAP = 2;
export const PORT_LABEL_SIZE = 8;
export function portLabelPosition(side: Side, x: number, y: number, markerSize: number): { x: number; y: number; align: 'left' | 'right' | 'center' } {
  const gap = markerSize / 2 + MULTI_OUTLINE_GAP + 2;
  if (side === 'left') return { x: x + gap, y, align: 'left' };
  if (side === 'right') return { x: x - gap, y, align: 'right' };
  if (side === 'top') return { x, y: y + gap + PORT_LABEL_SIZE / 2, align: 'center' };
  return { x, y: y - gap - PORT_LABEL_SIZE / 2, align: 'center' };
}
