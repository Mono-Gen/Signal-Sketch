// 見た目の値(設計書 5.1: フラット = モック案A)。
// ライト/ダークの切り替えができるよう、描画コードから値を分離しておく。
export interface Theme {
  nodeFill: string;
  nodeStroke: string;
  nodeStrokeWidth: number;
  nodeText: string;
  modelText: string;
  groupStroke: string;
  edgeWidth: number;
  /** ポートのマークの大きさ(グリッド幅に対する比率) */
  markerRatio: number;
  iconSize: number;
  /** 未接続のポートの塗り(用紙の色に合わせて「白抜き」に見せる) */
  portEmptyFill: string;
  /** 選択・つなぐ組の強調 */
  selection: string;
  /** つなげないものの強調 */
  bad: string;
  /** つなぎ先の候補の強調 */
  candidate: string;
  /** 重ね描きの文字(ヒントの吹き出しなど) */
  ink: string;
  /** 重ね描きの文字・マークの縁取り(用紙の色に近い色) */
  halo: string;
  /** 移動中のポートの影の線 */
  ghostStroke: string;
  /** 枠選択の矩形の塗り */
  marqueeFill: string;
  /** 信号色の画面表示を、この背景(用紙)の上で見えるよう補正する。null なら補正しない(ライト) */
  signalPaper: string | null;
}

export type ThemeName = 'light' | 'dark';

export const FLAT_THEME: Theme = {
  nodeFill: '#ffffff',
  nodeStroke: '#34405a',
  nodeStrokeWidth: 1.2,
  nodeText: '#1f2a44',
  modelText: '#5a6580',
  groupStroke: '#3b5b9a',
  edgeWidth: 1.8,
  markerRatio: 0.8,
  iconSize: 24,
  portEmptyFill: '#ffffff',
  selection: '#e8590c',
  bad: '#c92a2a',
  candidate: '#1c7ed6',
  ink: '#1f2a44',
  halo: '#ffffff',
  ghostStroke: '#2b3f6b',
  marqueeFill: 'rgba(232,89,12,.08)',
  signalPaper: null,
};

export const DARK_THEME: Theme = {
  ...FLAT_THEME,
  nodeFill: '#232c40',
  nodeStroke: '#a9b8d6',
  nodeText: '#e6ebf7',
  modelText: '#a3afc9',
  groupStroke: '#8fb0f0',
  portEmptyFill: '#141a26',
  selection: '#ff8a4c',
  bad: '#ff6b6b',
  candidate: '#4dabf7',
  ink: '#e6ebf7',
  halo: '#141a26',
  ghostStroke: '#a9b8d6',
  marqueeFill: 'rgba(255,138,76,.14)',
  signalPaper: '#141a26',
};

export function themeFor(name: ThemeName): Theme {
  return name === 'dark' ? DARK_THEME : FLAT_THEME;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const parse = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: readonly number[]): string => '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

/** 白との混ぜ具合 t(0〜1)で明るくする。色相をなるべく保つため、白へ近づける方向だけに動かす */
const mixWhite = (rgb: readonly number[], t: number): number[] => rgb.map((c) => c + (255 - c) * t);

/** 信号色を、テーマの用紙の上で 3:1(図形の基準)以上に見えるよう補正した画面用の色。保存データ・出力の色は変えない */
export const SIGNAL_MIN_CONTRAST = 3;
export function signalColor(theme: Theme, color: string): string {
  if (theme.signalPaper === null || !HEX.test(color)) return color;
  const paper = parse(theme.signalPaper);
  let rgb = parse(color);
  if (ratio(rgb, paper) >= SIGNAL_MIN_CONTRAST) return color;
  const base = rgb;
  for (let t = 0.04; t <= 1; t += 0.04) {
    rgb = mixWhite(base, t);
    if (ratio(rgb, paper) >= SIGNAL_MIN_CONTRAST) break;
  }
  return toHex(rgb);
}
