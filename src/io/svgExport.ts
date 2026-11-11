import { imageBox, isImageDataUri } from '../model/images';
import { getNodePorts, layoutNodePorts } from '../model/query';
import { estimateTextWidth } from '../model/nodeSize';
import { markerSpec } from '../model/portMarker';
import type { CompassDirection } from '../model/portMarker';
import { DASH_PATTERN, lineStyleOf } from '../model/lineStyle';
import { DEFAULT_NOTE_FONT } from '../model/notes';
import { planConnectionColors } from '../model/diagnostics';
import { orderedSignalTypes } from '../model/signalActions';
import type { DiagramDocument, DiagramNode, DiagramNote, SignalType } from '../model/types';
import { escapeHtml } from '../util/escapeHtml';
import { iconSvgGroup } from '../view/icons';
import { FLAT_THEME, signalColor } from '../view/theme';
import type { Theme } from '../view/theme';

// 図をSVGにする。画面の描画(maxGraph)をコピーせず、モデルから描き直す:
// 画面のラベルは foreignObject(HTML)で、PowerPoint などでは文字が表示されないため、
// ここでは文字を <text> として出力する。線の経路だけは、画面の自動配線の結果を受け取って使う。

const FONT = '"Yu Gothic UI", "Meiryo", sans-serif';
const LEGEND_HEIGHT = 40;
const CORNER_RADIUS = 8;

export interface Point {
  x: number;
  y: number;
}

export interface SvgExportOptions {
  /** 接続ID → 画面の自動配線が決めた経路(端点を含む) */
  edgePoints: ReadonlyMap<string, readonly Point[]>;
  /** 台数表記(例: ×4台)。表示言語に依存するため、呼び出し側が渡す */
  countText: (count: number) => string;
  legendTitle: string;
  /** 文字幅の測定(折り返し用)。省略時は見積もり。ブラウザでは canvas で実測した関数を渡す */
  measureText?: (text: string, bold: boolean) => number;
  theme?: Theme;
}

/**
 * SVGの属性・文字として安全にする。ユーザー入力の名称・型番が、タグとして解釈されないようにエスケープし、
 * XML 1.0 で使えない制御文字は取り除く(残すと、ブラウザやPowerPointがSVGを読み込めなくなる)。
 */
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const esc = (text: string): string => escapeHtml(text.replace(XML_INVALID, ''));
const num = (v: number): string => String(Math.round(v * 100) / 100);

/** 折れ線を、角を丸めたパスにする */
export function roundedPath(points: readonly Point[], radius: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${num(points[0].x)} ${num(points[0].y)}`;
  let d = `M${num(points[0].x)} ${num(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0) {
      d += ` L${num(cur.x)} ${num(cur.y)}`;
      continue;
    }
    const a = { x: cur.x - ((cur.x - prev.x) / inLen) * r, y: cur.y - ((cur.y - prev.y) / inLen) * r };
    const b = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
    d += ` L${num(a.x)} ${num(a.y)} Q${num(cur.x)} ${num(cur.y)} ${num(b.x)} ${num(b.y)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${num(last.x)} ${num(last.y)}`;
}

/**
 * 文字列を、指定の幅に収まるよう行に分ける(画面の自動折り返しに合わせる)。
 * 折り返せる位置は、空白の後と、全角文字(U+0100以上)の前後。「×4」のようなラテン文字の記号は単語と一続きにする。
 * 幅は measure で測る(ブラウザでは実測、テストなど測れない環境では見積もり)。
 * 1語が幅を超える場合は、その語を分割せず1行に置く(文字を欠けさせない)。
 */
export function wrapText(text: string, maxWidth: number, measure: (t: string) => number = estimateTextWidth): string[] {
  const tokens = text.match(/[^\s\u0100-\uFFFF]+|\s+|[\u0100-\uFFFF]/g) ?? [];
  const lines: string[] = [];
  let line = '';
  for (const tok of tokens) {
    const next = line + tok;
    if (line !== '' && measure(next.trimEnd()) > maxWidth) {
      lines.push(line.trimEnd());
      line = tok.trim() === '' ? '' : tok;
    } else {
      line = next;
    }
  }
  if (line.trim() !== '') lines.push(line.trimEnd());
  return lines.length > 0 ? lines : [''];
}

/** ポートのマーク(三角形または菱形)の頂点。中心(cx, cy)、外接の大きさ size */
function markerPoints(shape: 'triangle' | 'rhombus', dir: CompassDirection, cx: number, cy: number, size: number): string {
  const h = size / 2;
  const pts: [number, number][] =
    shape === 'rhombus'
      ? [[cx, cy - h], [cx + h, cy], [cx, cy + h], [cx - h, cy]]
      : dir === 'east'
        ? [[cx - h, cy - h], [cx + h, cy], [cx - h, cy + h]]
        : dir === 'west'
          ? [[cx + h, cy - h], [cx - h, cy], [cx + h, cy + h]]
          : dir === 'north'
            ? [[cx - h, cy + h], [cx, cy - h], [cx + h, cy + h]]
            : [[cx - h, cy - h], [cx + h, cy - h], [cx, cy + h]];
  return pts.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
}

function nodeSvg(doc: DiagramDocument, n: DiagramNode, index: number, connected: Set<string>, portSignal: Map<string, string>, opts: SvgExportOptions, th: Theme): string {
  const tpl = doc.deviceTemplates.find((t) => t.id === n.templateId);
  const kind = tpl?.kind ?? 'generic';
  const shape = tpl?.shape ?? 'roundRect';
  const clipId = `clip-${index}`;
  const signals = new Map(doc.signalTypes.map((s) => [s.id, s]));
  const imageUri = n.imageId ? doc.assets?.[n.imageId] : undefined;
  const image = isImageDataUri(imageUri) ? imageUri : undefined;
  const textInset = image ? 14 : th.iconSize + 14; // 画像があるときは、小さなアイコンを出さない
  const textX = n.x + textInset;
  const countText = n.count ? ` ${opts.countText(n.count)}` : '';
  const modelLine = `${n.model}${countText}`.trim();
  // 画面と同じく、名称・型番は枠の幅で折り返す(画面と同じく、右端の余白はわずか)
  const avail = n.w - textInset - 2;
  const measure = opts.measureText ?? ((text: string) => estimateTextWidth(text));
  const labelLines = wrapText(n.label, avail, (text) => measure(text, true));
  const modelLines = modelLine ? wrapText(modelLine, avail, (text) => measure(text, false)) : [];

  const body =
    shape === 'ellipse'
      ? `<ellipse cx="${num(n.x + n.w / 2)}" cy="${num(n.y + n.h / 2)}" rx="${num(n.w / 2)}" ry="${num(n.h / 2)}"`
      : `<rect x="${num(n.x)}" y="${num(n.y)}" width="${num(n.w)}" height="${num(n.h)}" rx="${shape === 'roundRect' ? 6 : 0}"`;
  const parts = [
    `<clipPath id="${clipId}"><rect x="${num(n.x)}" y="${num(n.y)}" width="${num(n.w)}" height="${num(n.h)}"/></clipPath>`,
    `${body} fill="${th.nodeFill}" stroke="${th.nodeStroke}" stroke-width="${th.nodeStrokeWidth}"/>`,
    image
      ? (() => {
          const box = imageBox(n);
          return `<image x="${num(n.x + box.x)}" y="${num(n.y + box.y)}" width="${num(box.w)}" height="${num(box.h)}" preserveAspectRatio="xMidYMid meet" href="${image}"/>`;
        })()
      : iconSvgGroup(kind, th.nodeStroke, n.x + 8, n.y + 8, th.iconSize),
    `<g clip-path="url(#${clipId})">`,
    ...labelLines.map(
      (line, i) => `<text x="${num(textX)}" y="${num(n.y + 18 + i * 14)}" font-size="12" font-weight="bold" fill="${th.nodeText}">${esc(line)}</text>`,
    ),
    ...modelLines.map(
      (line, i) => `<text x="${num(textX)}" y="${num(n.y + 18 + labelLines.length * 14 + 1 + i * 13)}" font-size="11" fill="${th.modelText}">${esc(line)}</text>`,
    ),
    '</g>',
  ];

  const ports = getNodePorts(doc, n);
  const markerSize = doc.grid.size * th.markerRatio;
  for (const pl of layoutNodePorts(doc, n)) {
    const port = ports.find((p) => p.id === pl.portId);
    if (!port) continue;
    const own = signalColor(th, signals.get(port.signalType)?.color ?? '#888888');
    const isConnected = connected.has(`${n.id}/${port.id}`);
    // 接続済みのポートは、画面と同じく、つながる線の色にそろえる
    const color = isConnected ? signalColor(th, signals.get(portSignal.get(`${n.id}/${port.id}`) ?? '')?.color ?? signals.get(port.signalType)?.color ?? '#888888') : own;
    const spec = markerSpec(port.direction, pl.side);
    const fill = isConnected ? color : th.portEmptyFill;
    parts.push(
      `<polygon points="${markerPoints(spec.shape, spec.direction, n.x + pl.x, n.y + pl.y, markerSize)}" fill="${fill}" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>`,
    );
  }
  return `<g>${parts.join('')}</g>`;
}

/** 文字1つの幅の目安(全角は文字の大きさと同じ、半角は約0.55倍)。SVG は自動で折り返さないため、メモの折り返しに使う */
const charWidth = (ch: string, size: number): number => (/[\u0000-\u00ff\uff61-\uff9f]/.test(ch) ? size * 0.55 : size);

/** メモ。文字だけ(枠も背景もない)。箱の幅で折り返し、高さに収まらない行は出さない(画面と同じ) */
function noteSvg(n: DiagramNote, th: Theme): string {
  const size = n.fontSize ?? DEFAULT_NOTE_FONT;
  const lineHeight = size * 1.25;
  const maxWidth = Math.max(n.w - 4, size);
  const lines: string[] = [];
  for (const raw of n.text.split('\n')) {
    let line = '';
    let width = 0;
    for (const ch of raw) {
      const cw = charWidth(ch, size);
      if (width + cw > maxWidth && line !== '') {
        lines.push(line);
        line = '';
        width = 0;
      }
      line += ch;
      width += cw;
    }
    lines.push(line);
  }
  const fit = Math.max(1, Math.floor((n.h - 2) / lineHeight));
  const x = n.x + 2;
  const spans = lines
    .slice(0, fit)
    .map((l, i) => `<tspan x="${num(x)}" y="${num(n.y + 2 + size + i * lineHeight)}">${esc(l)}</tspan>`)
    .join('');
  return `<text font-size="${size}" fill="${esc(n.color ?? th.nodeText)}">${spans}</text>`;
}

/** 信号の線の種類を、SVG の属性にする(実線は空)。画面と同じパターンを使う */
function dashAttr(s: SignalType | undefined): string {
  const pattern = DASH_PATTERN[lineStyleOf(s)];
  return pattern ? ` stroke-dasharray="${pattern}"` : '';
}

/** 凡例(信号の種類と線の色)。図だけを貼っても、色の意味が伝わるように含める */
function legendSvg(doc: DiagramDocument, y: number, opts: SvgExportOptions, th: Theme): string {
  const items: string[] = [`<text x="12" y="${num(y + 24)}" font-size="12" font-weight="bold" fill="${th.nodeText}">${esc(opts.legendTitle)}</text>`];
  let x = 12 + 8 * (opts.legendTitle.length + 2);
  const ordered = orderedSignalTypes(doc.signalTypes);
  for (const root of ordered.filter((s) => !s.parent)) {
    const children = ordered.filter((s) => s.parent === root.id);
    const draw = (s: SignalType, atX: number, atY: number) => {
      items.push(`<line x1="${num(atX)}" y1="${num(atY)}" x2="${num(atX + 28)}" y2="${num(atY)}" stroke="${esc(signalColor(th, s.color))}" stroke-width="3" stroke-linecap="round"${dashAttr(s)}/>`);
      items.push(`<text x="${num(atX + 36)}" y="${num(atY + 4)}" font-size="12" fill="${th.modelText}">${esc(s.label)}</text>`);
    };
    draw(root, x, children.length ? y + 10 : y + 20);
    let childX = x + 12;
    for (const child of children) {
      draw(child, childX, y + 30);
      childX += 36 + 8 * child.label.length + 24;
    }
    x = Math.max(x + 36 + 8 * root.label.length + 24, childX);
  }
  return `<g>${items.join('')}</g>`;
}

/**
 * 1ページ分の図を、単体で開けるSVG文書として組み立てる。
 * 重なり順は画面と同じ(枠 < 線 < 機器とポート)。指摘のある接続(破線・点線)も実線で出力する
 * (確認事項は作業用の目印で、提案資料には載せない)。
 */
export function buildSvg(doc: DiagramDocument, pageId: string, opts: SvgExportOptions): string {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) throw new RangeError(`ページが見つかりません: ${pageId}`);
  const th = opts.theme ?? FLAT_THEME;
  const w = page.size.w;
  const h = page.size.h + LEGEND_HEIGHT;
  const signals = new Map(doc.signalTypes.map((s) => [s.id, s]));

  const colorPlan = planConnectionColors(doc, page.edges);
  const connected = new Set<string>();
  for (const e of page.edges) {
    connected.add(`${e.from.nodeId}/${e.from.portId}`);
    connected.add(`${e.to.nodeId}/${e.to.portId}`);
  }

  const frames = page.groups.map(
    (g) =>
      `<g><rect x="${num(g.x)}" y="${num(g.y)}" width="${num(g.w)}" height="${num(g.h)}" rx="7" fill="none" stroke="${th.groupStroke}" stroke-width="1.2" stroke-dasharray="6 4"/>` +
      `<text x="${num(g.x + 14)}" y="${num(g.y + 17)}" font-size="12" font-weight="bold" fill="${th.groupStroke}">${esc(g.label)}</text></g>`,
  );

  const edges: string[] = [];
  for (const e of page.edges) {
    const pts = opts.edgePoints.get(e.id);
    if (!pts || pts.length < 2) continue;
    const fromNode = page.nodes.find((n) => n.id === e.from.nodeId);
    const fromPort = fromNode ? getNodePorts(doc, fromNode).find((p) => p.id === e.from.portId) : undefined;
    const lineSig = signals.get(colorPlan.lineSignal.get(e.id) ?? fromPort?.signalType ?? '');
    const color = signalColor(th, lineSig?.color ?? '#666666');
    edges.push(`<path d="${roundedPath(pts, CORNER_RADIUS)}" fill="none" stroke="${esc(color)}" stroke-width="${th.edgeWidth}" stroke-linecap="round" stroke-linejoin="round"${dashAttr(lineSig)}/>`);
  }

  const nodes = page.nodes.map((n, i) => nodeSvg(doc, n, i, connected, colorPlan.portSignal, opts, th));
  const notes = (page.notes ?? []).map((n) => noteSvg(n, th));

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family='${FONT}'>`,
    `<rect width="${w}" height="${h}" fill="${th.signalPaper ?? '#ffffff'}"/>`,
    ...frames,
    ...notes,
    ...edges,
    ...nodes,
    legendSvg(doc, page.size.h, opts, th),
    `</svg>`,
    '',
  ].join('\n');
}

/** SVG文書をPNGにする(ブラウザの描画を使う)。scale は解像度の倍率 */
export async function svgToPng(svg: string, width: number, height: number, scale = 2, background = '#ffffff'): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.width = width;
    img.height = height;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVGを画像として読み込めませんでした'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas を使えません');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNGへ変換できませんでした'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
