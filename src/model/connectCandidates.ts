import { locatePorts } from './bulkConnect';
import type { DiagramDocument, PortRef } from './types';

/**
 * 接続ドラッグ中に強調する、つなぎ先の候補。開始ポートと同じ信号の種類で、空いているポート
 * (複数接続可のポートは、線があっても候補)。開始ポート自身は含めない。
 * 信号違い・入力同士も接続自体はできる(警告つき)が、候補には含めない(「つなぐべき先」を示すため)。
 * 開始ポートが接続済み(複数可でない)なら、そもそもつなげないので候補は空。
 */
export function connectCandidates(doc: DiagramDocument, pageId: string, from: PortRef): PortRef[] {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return [];
  const all = locatePorts(doc, pageId);
  const start = all.find((p) => p.ref.nodeId === from.nodeId && p.ref.portId === from.portId);
  if (!start) return [];

  const used = new Set<string>();
  for (const e of page.edges) {
    used.add(`${e.from.nodeId}/${e.from.portId}`);
    used.add(`${e.to.nodeId}/${e.to.portId}`);
  }
  const isFree = (p: { ref: PortRef; port: { multi: boolean } }) => p.port.multi || !used.has(`${p.ref.nodeId}/${p.ref.portId}`);
  if (!isFree(start)) return [];

  return all
    .filter((p) => p !== start && p.port.signalType === start.port.signalType && isFree(p))
    .map((p) => p.ref);
}
