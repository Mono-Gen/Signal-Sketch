// ページ(キャンバス)の大きさ。画面に依存しない純粋なモジュール。

/** 標準の大きさ。16:9(PowerPoint のスライドと同じ比率)の3段階 */
export const PAGE_SIZE_PRESETS: readonly { w: number; h: number }[] = [
  { w: 1280, h: 720 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
];

/** 自由に指定するときの範囲(1辺)。小さすぎると標準の機器が収まらず、大きすぎると PNG 出力(2倍)が重くなる */
export const MIN_PAGE = { w: 640, h: 360 } as const;
export const MAX_PAGE = 4000;

/** 範囲内の整数か(保存データの検証と、変更操作で共通に使う) */
export function isValidPageSize(size: { w: unknown; h: unknown }): boolean {
  const ok = (v: unknown, min: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= MAX_PAGE;
  return ok(size.w, MIN_PAGE.w) && ok(size.h, MIN_PAGE.h);
}

/** 標準の大きさのうち一致するものの番号。一致しなければ -1(= 自由な大きさ) */
export function presetIndexOf(size: { w: number; h: number }): number {
  return PAGE_SIZE_PRESETS.findIndex((p) => p.w === size.w && p.h === size.h);
}

interface Boxed {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 指定の大きさのページからはみ出す機器・枠の名称(機器の id は名称が空のときの代わり)。
 * ページを小さくしてよいかの判定と、断る理由の提示に使う。
 */
export function itemsOutside(
  page: {
    nodes: readonly { id: string; label: string; x: number; y: number; w: number; h: number }[];
    groups: readonly Boxed[];
    notes?: readonly { id: string; text: string; x: number; y: number; w: number; h: number }[];
  },
  size: { w: number; h: number },
): string[] {
  const out = (b: { x: number; y: number; w: number; h: number }) => b.x < 0 || b.y < 0 || b.x + b.w > size.w || b.y + b.h > size.h;
  // メモは本文の1行目を名前の代わりに示す(長いときは切る)
  const noteName = (m: { id: string; text: string }) => (m.text.split('\n')[0].slice(0, 12) || m.id);
  return [
    ...page.nodes.filter(out).map((n) => n.label || n.id),
    ...page.groups.filter(out).map((g) => g.label || '(枠)'),
    ...(page.notes ?? []).filter(out).map(noteName),
  ];
}
