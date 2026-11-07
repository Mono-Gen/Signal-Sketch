// 拡大率の計算(画面に依存しない純関数。単体テストの対象)。

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
/** ボタン・ショートカット・ホイール1段あたりの倍率 */
const ZOOM_STEP = 1.25;

/** 拡大率を許容範囲へ収める。数でない値は 1 とみなす */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** 1段階だけ拡大(dir=1)・縮小(dir=-1)した拡大率。浮動小数の誤差が溜まらないよう1%単位に丸める */
export function stepZoom(z: number, dir: 1 | -1): number {
  const next = dir === 1 ? z * ZOOM_STEP : z / ZOOM_STEP;
  return clampZoom(Math.round(next * 100) / 100);
}

/**
 * 表示領域に図全体が収まる拡大率。領域が負・0 のときは 1。
 * 拡大の上限は 1(全体表示で必要以上に大きくしない)、下限は MIN_ZOOM。
 */
export function fitZoom(page: { w: number; h: number }, avail: { w: number; h: number }): number {
  if (!(avail.w > 0) || !(avail.h > 0) || !(page.w > 0) || !(page.h > 0)) return 1;
  const z = Math.min(avail.w / page.w, avail.h / page.h);
  return Math.min(1, clampZoom(Math.floor(z * 100) / 100));
}

/**
 * 拡大率を変えたとき、カーソル下の図の点が動かないようにするスクロール量の差分。
 * anchor は「図の座標」(拡大前後で不変)。差分は拡大前後の見た目の位置の差。
 */
export function anchorScrollDelta(anchor: { x: number; y: number }, oldZoom: number, newZoom: number): { dx: number; dy: number } {
  return { dx: anchor.x * (newZoom - oldZoom), dy: anchor.y * (newZoom - oldZoom) };
}
