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
/** 上辺のポートの番号を出すとき、機器の名前とアイコンを下へずらす量(px)。番号が名前に重ならないようにする */
export const TOP_LABEL_SHIFT = 10;
/** 番号を出すとき、左右の辺のポートの開始位置を、ヘッダからさらに下げる量(1グリッド分。アイコンと番号が重ならないように) */
export const SIDE_LABEL_EXTRA = 10;
/** 下辺のポートの番号が、マークの上に占める高さ(px。文字の高さ+余白) */
export const BOTTOM_LABEL_ROW = 18;
export function portLabelPosition(side: Side, x: number, y: number, markerSize: number): { x: number; y: number; align: 'left' | 'right' | 'center' } {
  const gap = markerSize / 2 + MULTI_OUTLINE_GAP + 2;
  if (side === 'left') return { x: x + gap, y, align: 'left' };
  if (side === 'right') return { x: x - gap, y, align: 'right' };
  if (side === 'top') return { x, y: y + gap + PORT_LABEL_SIZE / 2, align: 'center' };
  return { x, y: y - gap - PORT_LABEL_SIZE / 2, align: 'center' };
}

/**
 * 図の上に出すポートの文字。複数のポートがあるグループは、接頭辞を除いた番号だけにする
 * (1グリッドずつ並ぶ上辺・下辺で「LAN1」「LAN2」が重ならないようにし、辺ごとの見た目もそろえる)。
 * ポートが1つだけのグループは、名前そのもの(「HDMI」「IN」)を出す。名前は、ホバーで出る説明で確かめられる。
 * side は将来、辺ごとに変える余地のために受け取るが、いまは使わない。
 */
export function portLabelText(port: { label: string; shortLabel?: string }, _side: Side): string {
  return port.shortLabel ?? port.label;
}
