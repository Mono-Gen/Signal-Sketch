import { isDirectionMismatch } from './ports';
import type { Port } from './ports';
import { getNodePorts } from './query';
import type { DiagramDocument, SignalType } from './types';

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
