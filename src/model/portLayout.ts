import { ceilToGrid } from './grid';
import type { Port } from './ports';
import type { ManualPortPlacement, Side } from './types';

/** ポート中心の位置(機器の左上を原点とする相対座標) */
export interface PortPlacement {
  portId: string;
  side: Side;
  x: number;
  y: number;
}

/** 左右の辺で、機器名(ヘッダ)に被らないよう確保する高さ */
export const HEADER_HEIGHT = 30;

const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom'];

/** 辺に沿って置ける範囲(端の余白とヘッダを除く)。左右はY、上下はXの範囲 */
export function alongRange(side: Side, size: { w: number; h: number }, grid: number): { min: number; max: number } {
  const vertical = side === 'left' || side === 'right';
  const length = vertical ? size.h : size.w;
  // 上下の辺は端から1グリッドの余白だけ空ける。24ポートのスイッチ(幅260)が1段に収まるため
  const min = vertical ? ceilToGrid(HEADER_HEIGHT, grid) : grid;
  return { min, max: Math.max(min, length - grid) };
}

/**
 * 機器内の相対座標に最も近い辺と、その辺に沿った位置を返す(ポートのドラッグ移動用)。
 * 位置は辺の範囲へ丸める。グリッドへの吸着は呼び出し先(movePort)が行う。
 */
export function nearestSide(local: { x: number; y: number }, size: { w: number; h: number }): Side {
  const d: [Side, number][] = [
    ['left', Math.abs(local.x)],
    ['right', Math.abs(local.x - size.w)],
    ['top', Math.abs(local.y)],
    ['bottom', Math.abs(local.y - size.h)],
  ];
  return d.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0];
}

/**
 * ポートを機器の辺に沿って並べる(設計書 5.3)。
 * - 間隔はグリッド幅。機器の位置・サイズがグリッドの倍数なら、全ポートもグリッド上に載る。
 * - グループ・台が切り替わる所は1つ分あける。
 * - 1辺に収まらない場合は、内側へ2グリッド分ずらした段に折り返す。
 * - manual に指定のあるポートは、自動配置の対象から外し、指定された辺・位置の辺上へ置く
 *   (範囲外の位置は辺の範囲へ丸める)。
 */
export function layoutPorts(
  ports: readonly Port[],
  size: { w: number; h: number },
  grid: number,
  manual: Readonly<Record<string, ManualPortPlacement>> = {},
): PortPlacement[] {
  const result: PortPlacement[] = [];
  const isManual = (p: Port) => Object.prototype.hasOwnProperty.call(manual, p.id);
  for (const side of SIDES) {
    const list = ports.filter((p) => p.side === side && !isManual(p));
    if (list.length === 0) continue;
    const vertical = side === 'left' || side === 'right';
    const { min: start } = alongRange(side, size, grid);
    const endMargin = grid;
    const length = vertical ? size.h : size.w;
    const capacity = Math.max(1, Math.floor((length - start - endMargin) / grid) + 1);

    let slot = 0;
    let prevGroup: string | undefined;
    let prevUnit: number | undefined;
    for (const p of list) {
      // グループ・台が切り替わる所は1枠あける
      if (prevGroup !== undefined && (p.groupId !== prevGroup || p.unit !== prevUnit)) slot += 1;
      prevGroup = p.groupId;
      prevUnit = p.unit;
      const row = Math.floor(slot / capacity);
      const along = start + (slot % capacity) * grid;
      const inward = row * 2 * grid;
      const placement =
        side === 'left'
          ? { x: inward, y: along }
          : side === 'right'
            ? { x: size.w - inward, y: along }
            : side === 'top'
              ? { x: along, y: inward }
              : { x: along, y: size.h - inward };
      result.push({ portId: p.id, side, ...placement });
      slot += 1;
    }
  }
  for (const p of ports) {
    if (!isManual(p)) continue;
    const m = manual[p.id];
    const { min, max } = alongRange(m.side, size, grid);
    const pos = Math.min(max, Math.max(min, m.pos));
    result.push({
      portId: p.id,
      side: m.side,
      x: m.side === 'left' ? 0 : m.side === 'right' ? size.w : pos,
      y: m.side === 'top' ? 0 : m.side === 'bottom' ? size.h : pos,
    });
  }
  return result;
}
