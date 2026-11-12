import { planConnectionColors } from '../model/diagnostics';
import { markerSpec, MULTI_OUTLINE_GAP, portLabelPosition, portLabelText } from '../model/portMarker';
import type { CompassDirection } from '../model/portMarker';
import type { PortPlacement } from '../model/portLayout';
import type { Port } from '../model/ports';
import type { DiagramDocument, DiagramEdge, DiagramNode, SignalType } from '../model/types';
import { signalColor } from './theme';
import type { Theme } from './theme';

// ポートと線の「見た目の決定」(何色か・塗るか・どこに置くか)。画面(maxGraph)と画像の書き出し(SVG)で共有する。
// 食い違いは、ここを通さずに別々に決めたときに起きていた。出力の組み立て(maxGraph のスタイル / SVG の属性)は、各自に残す。
// 座標は機器内の相対座標(PortPlacement と同じ基準)。画面はそのまま機器の子として使い、SVG は機器の位置を足す。

const FALLBACK_PORT_COLOR = '#888888';
const FALLBACK_LINE_COLOR = '#666666';

/** 1ページ分の見た目を決めるのに要る材料。描画の最初に1回だけ作る */
export interface LookContext {
  readonly theme: Theme;
  readonly signals: ReadonlyMap<string, SignalType>;
  /** 線の信号(線ID → 信号ID) */
  readonly lineSignal: ReadonlyMap<string, string>;
  /** 接続済みポートを塗る信号(`nodeId/portId` → 信号ID)。系統が違う・競合するポートは入らない(ポート自身の色のまま) */
  readonly portSignal: ReadonlyMap<string, string>;
  /** 線がつながっているポート(`nodeId/portId`) */
  readonly connected: ReadonlySet<string>;
  /** マークの外接の大きさ */
  readonly markerSize: number;
}

export const portKey = (nodeId: string, portId: string): string => `${nodeId}/${portId}`;

export function buildLookContext(doc: DiagramDocument, edges: readonly DiagramEdge[], theme: Theme): LookContext {
  const plan = planConnectionColors(doc, edges);
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(portKey(e.from.nodeId, e.from.portId));
    connected.add(portKey(e.to.nodeId, e.to.portId));
  }
  return {
    theme,
    signals: new Map(doc.signalTypes.map((s) => [s.id, s])),
    lineSignal: plan.lineSignal,
    portSignal: plan.portSignal,
    connected,
    markerSize: doc.grid.size * theme.markerRatio,
  };
}

export interface PortLook {
  /** ポート自身の信号の色 */
  own: string;
  /** 線にそろえた色。接続済みで、塗る信号が決まっているときだけ own と変わる */
  color: string;
  connected: boolean;
  /** 空きは白抜き、接続済みは信号色で塗りつぶす */
  fill: string;
  stroke: string;
  marker: { shape: 'triangle' | 'square'; direction: CompassDirection; size: number; cx: number; cy: number };
  /** 複数接続のポートの外枠(外接の大きさと、枠線の色) */
  outline?: { size: number; stroke: string };
  /** 番号。位置は文字の基準点 */
  label?: { text: string; x: number; y: number; align: 'left' | 'right' | 'center' };
}

export function portLook(ctx: LookContext, node: DiagramNode, placement: PortPlacement, port: Port): PortLook {
  const own = signalColor(ctx.theme, ctx.signals.get(port.signalType)?.color ?? FALLBACK_PORT_COLOR);
  const key = portKey(node.id, port.id);
  const connected = ctx.connected.has(key);
  const planned = ctx.portSignal.get(key);
  const color = connected ? signalColor(ctx.theme, ctx.signals.get(planned ?? '')?.color ?? ctx.signals.get(port.signalType)?.color ?? FALLBACK_PORT_COLOR) : own;
  const spec = markerSpec(port.direction, placement.side);
  const { x: cx, y: cy, side } = placement;
  const look: PortLook = {
    own,
    color,
    connected,
    fill: connected ? color : ctx.theme.portEmptyFill,
    stroke: color,
    marker: { shape: spec.shape, direction: spec.direction, size: ctx.markerSize, cx, cy },
  };
  if (port.multi) look.outline = { size: ctx.markerSize + 2 * MULTI_OUTLINE_GAP, stroke: color };
  if (node.showPortLabels) {
    const pos = portLabelPosition(side, cx, cy, ctx.markerSize);
    look.label = { text: portLabelText(port, side), x: pos.x, y: pos.y, align: pos.align };
  }
  return look;
}

/** 線の色と、線の信号(線種はここから決める) */
export function edgeLook(ctx: LookContext, edgeId: string, fromPort: Port | undefined): { color: string; signal: SignalType | undefined } {
  const signal = ctx.signals.get(ctx.lineSignal.get(edgeId) ?? fromPort?.signalType ?? '');
  return { color: signalColor(ctx.theme, signal?.color ?? FALLBACK_LINE_COLOR), signal };
}
