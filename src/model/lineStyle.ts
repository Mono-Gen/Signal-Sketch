// 線の種類(信号の種類ごとに決める)。画面・SVG出力・凡例で同じ見た目にするため、ここに一本化する。

export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type LineStyle = (typeof LINE_STYLES)[number];

/** 線の破線パターン(SVG の stroke-dasharray と同じ書式)。実線は undefined */
export const DASH_PATTERN: Record<LineStyle, string | undefined> = {
  solid: undefined,
  dashed: '12 6',
  dotted: '2 5',
};

export const isLineStyle = (v: unknown): v is LineStyle => typeof v === 'string' && (LINE_STYLES as readonly string[]).includes(v);

/** 信号の線の種類(未指定は実線) */
export const lineStyleOf = (s: { lineStyle?: LineStyle } | undefined): LineStyle => s?.lineStyle ?? 'solid';
