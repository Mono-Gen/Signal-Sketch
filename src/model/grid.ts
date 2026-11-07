function assertGrid(grid: number): void {
  if (!Number.isFinite(grid) || grid <= 0) {
    throw new RangeError(`グリッド幅が不正です(正の数): ${grid}`);
  }
}

/** 最も近いグリッドの倍数へ吸着する。中間値は大きい方へ丸める */
export function snap(value: number, grid: number): number {
  assertGrid(grid);
  // -0 を 0 に正規化する(保存値や比較で -0 が出ないように)
  return Math.round(value / grid) * grid + 0;
}

/** 必要な長さを、グリッドの倍数へ切り上げる(機器の自動サイズ調整用) */
export function ceilToGrid(length: number, grid: number): number {
  assertGrid(grid);
  return Math.ceil(length / grid) * grid + 0;
}

export function isOnGrid(value: number, grid: number): boolean {
  assertGrid(grid);
  return Number.isInteger(value / grid);
}
