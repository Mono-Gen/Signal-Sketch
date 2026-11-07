import { describe, expect, it } from 'vitest';
import { buildDeviceCsv } from '../../src/io/csvExport';
import { addEdge, lostEdgeIdsForCount, updateNode } from '../../src/model/actions';
import { autoNodeSize } from '../../src/model/nodeSize';
import { layoutNodePorts, getNodePorts } from '../../src/model/query';
import { validateDocument } from '../../src/model/validate';
import { createSampleDocument } from '../fixtures/sampleDocument';

const P = 'page-1';
const fresh = () => createSampleDocument();
const node = (doc: ReturnType<typeof fresh>, id: string) => doc.pages[0].nodes.find((n) => n.id === id)!;

describe('台数ぶんのポート', () => {
  it('台数が複数の機器は、台数ぶんのポートを持ち、1台目のIDは従来のまま', () => {
    const doc = fresh();
    const ids = getNodePorts(doc, node(doc, 'mute')).map((p) => p.id);
    expect(ids).toEqual(['lan-1', 'lan-1@2', 'lan-1@3', 'lan-1@4']);
  });

  it('台数の無い機器・1台の機器は、従来どおり', () => {
    const doc = fresh();
    expect(getNodePorts(doc, node(doc, 'tsc')).map((p) => p.id)).toEqual(['lan-1']);
    expect(getNodePorts(doc, node(doc, 'tsc')).every((p) => p.unit === 1)).toBe(true);
  });

  it('台ごとに1枠あけて並び、サンプルの機器は1段に収まる(折り返さない)', () => {
    const doc = fresh();
    const n = node(doc, 'mute');
    const ys = layoutNodePorts(doc, n).map((p) => p.y);
    expect(ys).toEqual([30, 50, 70, 90]); // 30始まり、台の間に1枠(10)あく
    expect(new Set(layoutNodePorts(doc, n).map((p) => p.side)).size).toBe(1); // すべて同じ辺
    expect(Math.max(...ys)).toBeLessThanOrEqual(n.h - doc.grid.size);
  });

  it('autoNodeSize: 台数ぶんのポートが1段に収まる高さになる', () => {
    // LAN x1 が左辺、4台 → 枠数 4 + 3 = 7 → 高さ = 30 + 6*10 + 10 = 100
    const g = [{ id: 'lan', signalType: 'LAN', direction: 'inout' as const, side: 'left' as const, count: 1, labelPrefix: 'L' }];
    expect(autoNodeSize({ groups: g, label: 'A', model: '', grid: 10, units: 4 }).h).toBe(100);
    expect(autoNodeSize({ groups: g, label: 'A', model: '', grid: 10 }).h).toBe(50);
  });

  it('台ごとに別のスイッチポートへ接続できる(行き先が違ってよい)', () => {
    const doc = fresh();
    const r = addEdge(P, { nodeId: 'mute', portId: 'lan-1@3' }, { nodeId: 'sw', portId: 'lan-l-6' })(doc);
    expect(r.ok).toBe(true);
  });

  it('存在しない台のポートへは接続できない', () => {
    const doc = fresh();
    expect(addEdge(P, { nodeId: 'mute', portId: 'lan-1@5' }, { nodeId: 'sw', portId: 'lan-l-6' })(doc).error).toBe('unknown-port');
  });
});

describe('台数の変更', () => {
  it('台数を増やすと、機器が大きくなる(ポートが収まる)。既存の接続は保たれる', () => {
    const doc = fresh();
    const edges = doc.pages[0].edges.length;
    expect(updateNode(P, 'tsc', { count: 5 })(doc).ok).toBe(true);
    const n = node(doc, 'tsc');
    expect(n.h).toBeGreaterThanOrEqual(110); // 30 + 8*10 + 10 = 120
    expect(doc.pages[0].edges).toHaveLength(edges);
  });

  it('台数を減らして接続のある台がなくなる場合は、確認なしでは失敗し、状態を変えない', () => {
    const doc = fresh();
    addEdge(P, { nodeId: 'mute', portId: 'lan-1@3' }, { nodeId: 'sw', portId: 'lan-l-6' })(doc);
    const snapshot = JSON.stringify(doc);
    expect(lostEdgeIdsForCount(doc, P, 'mute', 2)).toHaveLength(1);
    expect(updateNode(P, 'mute', { count: 2 })(doc).error).toBe('ports-in-use');
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('確認済みなら、なくなる台の接続だけが消える', () => {
    const doc = fresh();
    addEdge(P, { nodeId: 'mute', portId: 'lan-1@3' }, { nodeId: 'sw', portId: 'lan-l-6' })(doc);
    const before = doc.pages[0].edges.length;
    expect(updateNode(P, 'mute', { count: 2 }, { removeOrphanEdges: true })(doc).ok).toBe(true);
    expect(doc.pages[0].edges).toHaveLength(before - 1);
    expect(doc.pages[0].edges.some((e) => e.from.portId === 'lan-1' && e.from.nodeId === 'mute')).toBe(true); // 1台目の接続は残る
  });

  it('台数の表記を消す(1台に戻す)と、2台目以降の接続は消える', () => {
    const doc = fresh();
    addEdge(P, { nodeId: 'mute', portId: 'lan-1@2' }, { nodeId: 'sw', portId: 'lan-l-6' })(doc);
    expect(updateNode(P, 'mute', { count: undefined })(doc).error).toBe('ports-in-use');
  });
});

describe('検証・CSV', () => {
  it('台数以内の台のポートを指す接続は有効、台数を超える台は無効', () => {
    const doc = fresh();
    addEdge(P, { nodeId: 'mute', portId: 'lan-1@4' }, { nodeId: 'sw', portId: 'lan-l-6' })(doc);
    expect(validateDocument(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
    node(doc, 'mute').count = 2;
    const r = validateDocument(JSON.parse(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('lan-1@4');
  });

  it('CSVのポート数は、1台あたりの数のまま(台数ぶんに増えない)', () => {
    const doc = fresh();
    const csv = buildDeviceCsv(doc, { name: 'n', model: 'm', quantity: 'q', kind: 'k', ports: 'p', place: 'l' });
    expect(csv).toMatch(/Mute Button,Model-A2,4,Panel \(LAN\),1,Table\r\n/);
  });

  it('サンプルの機器は、すべてほかの機器と重ならない(台数ぶんのポートで大きくなっても)', () => {
    const nodes = createSampleDocument().pages[0].nodes;
    for (const a of nodes) for (const b of nodes) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} と ${b.id}`).toBe(false);
    }
  });
});
