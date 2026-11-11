import { isDirectionMismatch } from './ports';
import type { Port } from './ports';
import { findPortByRef, getNodePorts } from './query';
import type { DiagramDocument, DiagramEdge, SignalType } from './types';

export function rootSignalId(signals: readonly SignalType[], id: string): string {
  return signals.find((s) => s.id === id)?.parent ?? id;
}

/** 接続1本に対する指摘の種類 */
export type ConnectionIssue = 'signal-mismatch' | 'direction-mismatch';

/**
 * 2つのポートの接続に対する指摘。接続時の警告・線の表示・確認事項の一覧が、
 * すべてこの判定を使う(食い違わないよう、判定をここ1か所にする)。
 */
export function connectionIssues(a: Pick<Port, 'signalType' | 'direction' | 'multi'>, b: Pick<Port, 'signalType' | 'direction' | 'multi'>, signals: readonly SignalType[] = []): ConnectionIssue[] {
  const issues: ConnectionIssue[] = [];
  if (rootSignalId(signals, a.signalType) !== rootSignalId(signals, b.signalType)) issues.push('signal-mismatch');
  if (isDirectionMismatch(a, b)) issues.push('direction-mismatch');
  return issues;
}

export type Severity = 'error' | 'warning';

/** 確認事項の1件。図の内容から毎回計算し、保存しない(直せば消える) */
export interface Diagnostic {
  /** 一覧での識別用(接続ID+種類)。画面の更新をまたいで同じ指摘を同じ項目として扱える */
  key: string;
  severity: Severity;
  code: ConnectionIssue | 'broken-edge';
  pageId: string;
  edgeId: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
}

/**
 * 図全体の確認事項を計算する。エラー(図として成立しない)を先に、警告をその後に、図中の接続順で並べる。
 * 信号種別・方向の不一致は、禁止せず警告として示す(設計書 4章)。
 */
export function diagnose(doc: DiagramDocument): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  for (const page of doc.pages) {
    const byNode = new Map(page.nodes.map((n) => [n.id, n]));
    for (const e of page.edges) {
      const base = { pageId: page.id, edgeId: e.id, from: e.from, to: e.to };
      const na = byNode.get(e.from.nodeId);
      const nb = byNode.get(e.to.nodeId);
      const pa = na ? getNodePorts(doc, na).find((p) => p.id === e.from.portId) : undefined;
      const pb = nb ? getNodePorts(doc, nb).find((p) => p.id === e.to.portId) : undefined;
      if (!pa || !pb) {
        // 検証済みの図では起きないが、黙って読み飛ばさず、エラーとして見せる
        errors.push({ ...base, key: `${e.id}:broken-edge`, severity: 'error', code: 'broken-edge' });
        continue;
      }
      for (const code of connectionIssues(pa, pb, doc.signalTypes)) {
        warnings.push({ ...base, key: `${e.id}:${code}`, severity: 'warning', code });
      }
    }
  }
  return [...errors, ...warnings];
}

/** 接続の見た目(線の色・線種と、両端のポートの色)を決める信号 */
export interface ConnectionLook {
  /** 線の信号 */
  line: string;
  /** 両端のポートを塗る信号。系統が違う接続は、ポートを自分の信号のままにする(警告が見えなくならないよう)ので null */
  ports: string | null;
}

/**
 * 同じ系統(ルートが同じ)の接続は、サブ信号のある側の色に線と両端のポートをそろえる
 * (どちらもサブなら、線を引き始めた側)。系統が違う接続は、引き始めた側の色の線のまま、ポートは自分の色。
 * 引く向きで色が変わらないよう、同じ信号どうしでは今までと同じ結果になる。
 */
export function connectionLook(signals: readonly SignalType[], fromId: string, toId: string): ConnectionLook {
  if (rootSignalId(signals, fromId) !== rootSignalId(signals, toId)) return { line: fromId, ports: null };
  const hasParent = (id: string): boolean => signals.find((s) => s.id === id)?.parent !== undefined;
  const line = hasParent(fromId) || !hasParent(toId) ? fromId : toId;
  return { line, ports: line };
}

/**
 * ページの全接続について、線の信号と、接続済みポートを塗る信号を求める(画面と画像の書き出しで共通)。
 * 1つのポートに複数の線があって塗る信号が食い違うときは、ポートは自分の信号のままにする。
 */
export function planConnectionColors(
  doc: DiagramDocument,
  edges: readonly DiagramEdge[],
): { lineSignal: Map<string, string>; portSignal: Map<string, string> } {
  const lineSignal = new Map<string, string>();
  const wanted = new Map<string, Set<string | null>>();
  const note = (key: string, id: string | null): void => {
    const set = wanted.get(key) ?? new Set<string | null>();
    set.add(id);
    wanted.set(key, set);
  };
  for (const e of edges) {
    const from = findPortByRef(doc, e.from);
    const to = findPortByRef(doc, e.to);
    if (!from || !to) continue;
    const look = connectionLook(doc.signalTypes, from.signalType, to.signalType);
    lineSignal.set(e.id, look.line);
    note(`${e.from.nodeId}/${e.from.portId}`, look.ports);
    note(`${e.to.nodeId}/${e.to.portId}`, look.ports);
  }
  const portSignal = new Map<string, string>();
  for (const [key, set] of wanted) {
    const [only] = set;
    if (set.size === 1 && only !== null) portSignal.set(key, only);
  }
  return { lineSignal, portSignal };
}
