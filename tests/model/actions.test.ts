import { describe, expect, it } from 'vitest';
import { addEdge, moveNodes, removeItems, setGridEnabled } from '../../src/model/actions';
import { createSampleDocument } from '../fixtures/sampleDocument';

const P = 'page-1';
const fresh = () => createSampleDocument();
const node = (doc: ReturnType<typeof fresh>, id: string) => doc.pages[0].nodes.find((n) => n.id === id)!;

describe('moveNodes', () => {
  it('グリッド有効なら最も近い倍数へ吸着する', () => {
    const doc = fresh();
    expect(moveNodes(P, [{ id: 'tap', x: 43, y: 76 }])(doc).ok).toBe(true);
    expect([node(doc, 'tap').x, node(doc, 'tap').y]).toEqual([40, 80]);
  });

  it('グリッド無効なら指定どおりの座標', () => {
    const doc = fresh();
    doc.grid.enabled = false;
    moveNodes(P, [{ id: 'tap', x: 43, y: 76 }])(doc);
    expect([node(doc, 'tap').x, node(doc, 'tap').y]).toEqual([43, 76]);
  });

  it('1件でも存在しない機器があれば、全体を適用しない', () => {
    const doc = fresh();
    const r = moveNodes(P, [
      { id: 'tap', x: 100, y: 100 },
      { id: 'nope', x: 0, y: 0 },
    ])(doc);
    expect(r).toEqual({ ok: false, error: 'unknown-node' });
    expect([node(doc, 'tap').x, node(doc, 'tap').y]).toEqual([40, 70]);
  });

  it('存在しないページは失敗', () => {
    expect(moveNodes('zzz', [])(fresh())).toEqual({ ok: false, error: 'unknown-page' });
  });
});

describe('addEdge', () => {
  it('同じ信号種別のポートを接続でき、新しい接続IDが付く', () => {
    const doc = fresh();
    const before = doc.pages[0].edges.length;
    const r = addEdge(P, { nodeId: 'sw', portId: 'lan-r-3' }, { nodeId: 'ap', portId: 'lan-1' })(doc);
    expect(r).toEqual({ ok: true });
    expect(doc.pages[0].edges).toHaveLength(before + 1);
    expect(doc.pages[0].edges.at(-1)).toMatchObject({ id: 'e-17', from: { nodeId: 'sw', portId: 'lan-r-3' } });
  });

  it('信号種別が異なっても接続でき、警告を返す(禁止しない)', () => {
    const doc = fresh();
    const r = addEdge(P, { nodeId: 'sw', portId: 'lan-r-3' }, { nodeId: 'ap', portId: 'audio-1' })(doc);
    expect(r).toEqual({ ok: true, warning: 'signal-mismatch', warnings: ['signal-mismatch'] });
  });

  it('同じポート同士は失敗', () => {
    const doc = fresh();
    const p = { nodeId: 'sw', portId: 'lan-r-3' };
    expect(addEdge(P, p, p)(doc)).toEqual({ ok: false, error: 'self-connection' });
  });

  it('既存の接続は、向きが逆でも重複として失敗', () => {
    const doc = fresh();
    // e-12: sw.lan-r-1 -> ptz.lan-1
    const fwd = addEdge(P, { nodeId: 'sw', portId: 'lan-r-1' }, { nodeId: 'ptz', portId: 'lan-1' })(doc);
    const rev = addEdge(P, { nodeId: 'ptz', portId: 'lan-1' }, { nodeId: 'sw', portId: 'lan-r-1' })(doc);
    expect(fwd).toEqual({ ok: false, error: 'duplicate-edge' });
    expect(rev).toEqual({ ok: false, error: 'duplicate-edge' });
  });

  it('1つのポートには1本まで: 接続元が使用済みなら失敗(線は増えない)', () => {
    const doc = fresh();
    const n = doc.pages[0].edges.length;
    // sw.lan-r-1 は e-12 で使用済み。ap.lan-1 は空き
    const r = addEdge(P, { nodeId: 'sw', portId: 'lan-r-1' }, { nodeId: 'ap', portId: 'lan-1' })(doc);
    expect(r).toEqual({ ok: false, error: 'port-occupied' });
    expect(doc.pages[0].edges).toHaveLength(n);
  });

  it('1つのポートには1本まで: 接続先が使用済みでも失敗', () => {
    const doc = fresh();
    // aif.lan-1 は e-13 で使用済み。sw.lan-r-3 は空き
    const r = addEdge(P, { nodeId: 'sw', portId: 'lan-r-3' }, { nodeId: 'aif', portId: 'lan-1' })(doc);
    expect(r).toEqual({ ok: false, error: 'port-occupied' });
  });

  it('使用済みでも、その線を消せば同じポートへ繋げられる', () => {
    const doc = fresh();
    removeItems(P, { edgeIds: ['e-13'] })(doc); // sw.lan-r-2 -> aif.lan-1 を削除
    const r = addEdge(P, { nodeId: 'sw', portId: 'lan-r-3' }, { nodeId: 'aif', portId: 'lan-1' })(doc);
    expect(r.ok).toBe(true);
  });

  it('同じポートへの2本目は、同じ相手なら重複として扱う(理由が分かりやすい方を返す)', () => {
    const doc = fresh();
    const r = addEdge(P, { nodeId: 'sw', portId: 'lan-r-1' }, { nodeId: 'ptz', portId: 'lan-1' })(doc);
    expect(r.error).toBe('duplicate-edge');
  });

  it('存在しない機器・ポート・ページは失敗し、接続は増えない', () => {
    const doc = fresh();
    const n = doc.pages[0].edges.length;
    expect(addEdge(P, { nodeId: 'zzz', portId: 'x' }, { nodeId: 'sw', portId: 'lan-l-5' })(doc).error).toBe('unknown-node');
    expect(addEdge(P, { nodeId: 'sw', portId: 'lan-l-99' }, { nodeId: 'aif', portId: 'lan-1' })(doc).error).toBe('unknown-port');
    expect(addEdge('zzz', { nodeId: 'sw', portId: 'lan-l-5' }, { nodeId: 'aif', portId: 'lan-1' })(doc).error).toBe('unknown-page');
    expect(doc.pages[0].edges).toHaveLength(n);
  });
});

describe('setGridEnabled', () => {
  it('グリッド吸着の設定を切り替え、その後の移動に反映される', () => {
    const doc = fresh();
    setGridEnabled(false)(doc);
    expect(doc.grid.enabled).toBe(false);
    moveNodes(P, [{ id: 'tap', x: 43, y: 76 }])(doc);
    expect(node(doc, 'tap').x).toBe(43);
    setGridEnabled(true)(doc);
    moveNodes(P, [{ id: 'tap', x: 43, y: 76 }])(doc);
    expect(node(doc, 'tap').x).toBe(40);
  });
});

describe('removeItems', () => {
  it('機器を削除すると、その機器につながる接続が消える(所属は見た目で決まるので、枠側の後始末は不要)', () => {
    const doc = fresh();
    expect(removeItems(P, { nodeIds: ['sw'] })(doc).ok).toBe(true);
    const page = doc.pages[0];
    expect(page.nodes.some((n) => n.id === 'sw')).toBe(false);
    expect(page.edges.some((e) => e.from.nodeId === 'sw' || e.to.nodeId === 'sw')).toBe(false);
    expect(page.groups.find((g) => g.id === 'g-rack')).toBeDefined(); // 枠は残る
  });

  it('接続だけを削除でき、機器は残る', () => {
    const doc = fresh();
    removeItems(P, { edgeIds: ['e-1'] })(doc);
    expect(doc.pages[0].edges.some((e) => e.id === 'e-1')).toBe(false);
    expect(doc.pages[0].nodes.some((n) => n.id === 'tap')).toBe(true);
  });

  it('存在しないページは失敗', () => {
    expect(removeItems('zzz', {})(fresh()).error).toBe('unknown-page');
  });
});
