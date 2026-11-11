import { ceilToGrid } from './grid';
import { HEADER_HEIGHT } from './portLayout';
import { BOTTOM_LABEL_ROW, TOP_LABEL_SHIFT } from './portMarker';
import type { PortGroup, Side } from './types';

/** 文字幅の概算(全角は広め)。実測せず、レイアウトの下限を決めるためだけに使う */
export function estimateTextWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += /[　-鿿＀-￯]/.test(ch) ? 13 : 7.5;
  }
  return width;
}

export interface SizeInput {
  groups: readonly PortGroup[];
  label: string;
  model: string;
  grid: number;
  /** 名称の左に置くアイコンと余白の合計幅 */
  textInset?: number;
  /** 台数(ポートは台数ぶん並ぶ)。省略は1台 */
  units?: number;
  /** ポートの番号を図に出すか。出すなら、名前・アイコンと上下の番号が重ならない高さを下限にする */
  portLabels?: boolean;
}

const MIN_NODE_WIDTH = 120;
const MIN_NODE_HEIGHT = 50;
/**
 * 新しく置く機器の標準の高さ(最小より少し大きい)。ポート番号を出したときも、名前や上下の番号が重なりにくくする。
 * 下限(MIN_NODE_HEIGHT)は変えない: 変えると、保存済みの機器が、名前の変更などで勝手に大きくなる。
 */
export const DEFAULT_NODE_HEIGHT = 60;
const DEFAULT_TEXT_INSET = 24 + 14 + 12;
/** アイコンの高さと、その上の余白(画面・書き出しの描き方と同じ) */
const ICON_BLOCK = 8 + 24;
/** 名前(1行)の下端。上の余白6+行の高さ14 */
const TITLE_BOTTOM = 6 + 14;
/** 型番の行の高さ */
const MODEL_LINE = 14;

/** 1辺に並べるポートの枠数。グループの切れ目は1つ分あく(layoutPorts と同じ規則) */
function slotsOnSide(groups: readonly PortGroup[], side: Side, units: number): number {
  const used = groups.filter((g) => g.side === side && g.count > 0);
  if (used.length === 0) return 0;
  // 台ごとにグループが繰り返され、切れ目(台・グループの切替)ごとに1枠あく
  return units * used.reduce((sum, g) => sum + g.count, 0) + (units * used.length - 1);
}

/**
 * 機器の標準サイズ。ポートが1段に収まり、名称・型番が枠からはみ出さない大きさを、
 * グリッドの倍数で返す(設計書 5.1 の課題①)。layoutPorts の余白規則と対応している。
 */
export function autoNodeSize(input: SizeInput): { w: number; h: number } {
  const { groups, label, model, grid } = input;
  const inset = input.textInset ?? DEFAULT_TEXT_INSET;
  const units = input.units && input.units > 1 ? input.units : 1;

  const vertical = Math.max(slotsOnSide(groups, 'left', units), slotsOnSide(groups, 'right', units));
  const horizontal = Math.max(slotsOnSide(groups, 'top', units), slotsOnSide(groups, 'bottom', units));

  // 左右の辺: 開始位置(ヘッダ分) + 間隔 x (枠数-1) + 終端の余白(1グリッド)
  const neededH = vertical > 0 ? ceilToGrid(ceilToGrid(HEADER_HEIGHT, grid) + (vertical - 1) * grid + grid, grid) : 0;
  // 上下の辺: 両端1グリッドずつの余白 + 間隔 x (枠数-1)
  const neededPortW = horizontal > 0 ? (horizontal + 1) * grid : 0;
  const neededTextW = ceilToGrid(inset + Math.max(estimateTextWidth(label), estimateTextWidth(model)), grid);

  // 番号を図に出すとき: 名前(と型番)・アイコンの下端が、下辺の番号の行に重ならない高さ。上辺に番号があれば、名前は下へずれる
  let neededLabelsH = 0;
  if (input.portLabels) {
    const hasTop = groups.some((g) => g.side === 'top' && g.count > 0);
    const hasBottom = groups.some((g) => g.side === 'bottom' && g.count > 0);
    if (hasBottom) neededLabelsH = ceilToGrid((hasTop ? TOP_LABEL_SHIFT : 0) + Math.max(ICON_BLOCK, TITLE_BOTTOM + (model.trim() !== '' ? MODEL_LINE : 0)) + BOTTOM_LABEL_ROW, grid);
  }

  return {
    w: Math.max(ceilToGrid(MIN_NODE_WIDTH, grid), neededTextW, neededPortW),
    h: Math.max(ceilToGrid(MIN_NODE_HEIGHT, grid), neededH, neededLabelsH),
  };
}
