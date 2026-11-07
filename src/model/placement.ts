interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect, gap: number): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * 新しい機器を置く空き位置を探す。左上から、グリッド2つ分の刻みで走査し、
 * 既存の機器と(1グリッドの余白を含めて)重ならない最初の場所を返す。
 * ページに空きが無ければ左上(余白位置)を返す。重なってもユーザーが動かせる。
 */
export function findFreePosition(
  nodes: readonly Rect[],
  size: { w: number; h: number },
  page: { w: number; h: number },
  grid: number,
): { x: number; y: number } {
  const margin = 2 * grid;
  const step = 2 * grid;
  for (let y = margin; y + size.h <= page.h - margin; y += step) {
    for (let x = margin; x + size.w <= page.w - margin; x += step) {
      const candidate = { x, y, w: size.w, h: size.h };
      if (!nodes.some((n) => overlaps(candidate, n, grid))) return { x, y };
    }
  }
  return { x: margin, y: margin };
}
