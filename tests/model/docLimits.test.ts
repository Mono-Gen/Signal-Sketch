import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { documentLimitIssue, MAX_EDGES_PER_PAGE, MAX_NODES_PER_PAGE, MAX_PORTS_PER_PAGE } from '../../src/model/docLimits';
import { expandPortGroups } from '../../src/model/ports';
import { validateDocument } from '../../src/model/validate';
import { createSampleDocument } from '../fixtures/sampleDocument';

const FAST_MS = 2000;

/** 同じテンプレートを参照する機器を、指定の数だけ足す */
function withNodes(count: number, templateId: string) {
  const doc = createSampleDocument();
  const page = doc.pages[0];
  const base = page.nodes.find((n) => n.templateId === templateId)!;
  page.nodes = Array.from({ length: count }, (_, i) => ({ ...base, id: `x${i}`, count: undefined, portPlacements: undefined }));
  page.edges = [];
  return doc;
}

describe('documentLimitIssue: ページ全体の上限', () => {
  it('旧形式の欠番情報を無視して全ポートと接続を読み込む', () => {
    const doc = createSampleDocument();
    const group = doc.deviceTemplates.find((t) => t.id === 'switch')!.portGroups[0];
    Object.assign(group, { skipped: [1] });
    const result = parseDocument(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(', '));
    expect(validateDocument(result.doc).ok).toBe(true);
    const loaded = result.doc.deviceTemplates.find((t) => t.id === 'switch')!.portGroups[0];
    expect(expandPortGroups([loaded]).map((p) => p.id)).toEqual(Array.from({ length: group.count }, (_, i) => group.id + '-' + (i + 1)));
    expect(result.doc.pages[0].edges).toEqual(doc.pages[0].edges);
  });
  it('ふつうの図は収まる', () => {
    expect(documentLimitIssue(createSampleDocument())).toBeNull();
  });

  it('機器の数: 上限ちょうどは可、1つ超えたら nodes', () => {
    expect(documentLimitIssue(withNodes(MAX_NODES_PER_PAGE, 'lan-left'))).toBeNull();
    expect(documentLimitIssue(withNodes(MAX_NODES_PER_PAGE + 1, 'lan-left'))).toBe('nodes');
  });

  it('ポートの合計: 1ポートの機器を上限ちょうどまで可(機器数の上限が先に効かない範囲で)', () => {
    const doc = createSampleDocument();
    const node = doc.pages[0].nodes.find((n) => n.templateId === 'lan-left')!;
    // 1機器のポートを台数で増やして合計を調整する(台数は上限999以内)
    doc.pages[0].nodes = [];
    const perNode = 800; // 800 台ぶんの 1 ポート
    const count = MAX_PORTS_PER_PAGE / perNode;
    for (let i = 0; i < count; i++) doc.pages[0].nodes.push({ ...node, id: `y${i}`, count: perNode });
    doc.pages[0].edges = [];
    expect(documentLimitIssue(doc)).toBeNull();
    doc.pages[0].nodes.push({ ...node, id: 'y-extra', count: 1 });
    expect(documentLimitIssue(doc)).toBe('ports');
  });

  it('接続の数: 上限を超えたら edges', () => {
    const doc = createSampleDocument();
    const e = doc.pages[0].edges[0];
    doc.pages[0].edges = Array.from({ length: MAX_EDGES_PER_PAGE + 1 }, (_, i) => ({ ...e, id: `e${i}` }));
    expect(documentLimitIssue(doc)).toBe('edges');
  });

  it('壊れた構造でも例外にせず、数えられる範囲で数える', () => {
    expect(() => documentLimitIssue({ deviceTemplates: null, pages: [null, { nodes: 'x', edges: 5 }, { nodes: [null, 1, {}] }] } as never)).not.toThrow();
    expect(documentLimitIssue({ deviceTemplates: [], pages: [] } as never)).toBeNull();
  });
});

describe('読み込み検証: 小さなファイルでも、図全体が大きすぎれば断る(固まらない)', () => {
  it('5000ポートの共有テンプレートを100機器が参照するファイルは、すぐに断る', () => {
    const doc = createSampleDocument();
    const page = doc.pages[0];
    doc.deviceTemplates.push({ id: 'big', name: 'Big', kind: 'generic', shape: 'roundRect', portGroups: [{ id: 'g', signalType: 'LAN', direction: 'inout', side: 'left', count: 5000, labelPrefix: 'L ' }] });
    const base = page.nodes[0];
    page.nodes = Array.from({ length: 100 }, (_, i) => ({ ...base, id: `b${i}`, templateId: 'big', count: undefined, portPlacements: undefined }));
    page.edges = [];
    const t = Date.now();
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('ポートの合計');
    expect(Date.now() - t).toBeLessThan(FAST_MS);
  });

  it('文字列にした図(JSON)でも、同じように断る', () => {
    const doc = withNodes(MAX_NODES_PER_PAGE + 1, 'lan-left');
    const r = parseDocument(serializeDocument(doc));
    expect(r.ok).toBe(false);
  });
});

describe('読み込み検証: 構造が壊れたファイルは、例外ではなく理由を返す', () => {
  const base = () => structuredClone(createSampleDocument()) as unknown as Record<string, unknown>;
  const pageOf = (d: Record<string, unknown>) => (d.pages as Record<string, unknown>[])[0];

  it.each([
    ['ページの nodes が無い', (d: Record<string, unknown>) => delete pageOf(d).nodes, 'nodes'],
    ['ページの edges が配列でない', (d: Record<string, unknown>) => (pageOf(d).edges = 5), 'edges'],
    ['pages が空', (d: Record<string, unknown>) => (d.pages = []), 'pages'],
    ['pages の要素が null', (d: Record<string, unknown>) => (d.pages = [null]), 'pages[0]'],
    ['機器が null', (d: Record<string, unknown>) => ((pageOf(d).nodes as unknown[])[0] = null), 'nodes[0]'],
    ['接続の from が無い', (d: Record<string, unknown>) => delete (pageOf(d).edges as Record<string, unknown>[])[0].from, 'from'],
    ['テンプレートの portGroups が配列でない', (d: Record<string, unknown>) => ((d.deviceTemplates as Record<string, unknown>[])[0].portGroups = 'x'), 'portGroups'],
    ['信号種別が文字列', (d: Record<string, unknown>) => (d.signalTypes = ['x']), 'signalTypes[0]'],
    ['portPlacements が配列', (d: Record<string, unknown>) => ((pageOf(d).nodes as Record<string, unknown>[])[0].portPlacements = []), 'portPlacements'],
  ])('%s', (_name, mutate, where) => {
    const d = base();
    mutate(d);
    let r: ReturnType<typeof parseDocument> | undefined;
    expect(() => (r = parseDocument(JSON.stringify(d)))).not.toThrow();
    expect(r!.ok).toBe(false);
    if (!r!.ok) expect(r!.errors.join(' ')).toContain(where);
  });

  it('壊れた構造の報告は、件数が増えすぎない', () => {
    const d = base();
    pageOf(d).nodes = Array.from({ length: 500 }, () => null);
    const r = validateDocument(d);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeLessThanOrEqual(20);
  });

  it('groups(枠)は旧ファイルに無くてもよい', () => {
    const d = base();
    delete pageOf(d).groups;
    expect(validateDocument(d).ok).toBe(true);
  });

  it('いつもの図は通る', () => {
    expect(parseDocument(serializeDocument(createSampleDocument())).ok).toBe(true);
  });
});

describe('ストア: どの操作でも、図全体の上限を超える結果は適用しない', () => {
  it('機器を上限を超えて足す操作は document-too-large で断られ、図も履歴も変わらない', async () => {
    const { DocumentStore } = await import('../../src/state/store');
    const store = new DocumentStore(createSampleDocument());
    const before = structuredClone(store.doc);
    const r = store.apply((doc) => {
      const page = doc.pages[0];
      const base = page.nodes[0];
      for (let i = 0; i < MAX_NODES_PER_PAGE + 1; i++) page.nodes.push({ ...base, id: `z${i}` });
      return { ok: true };
    });
    expect(r).toMatchObject({ ok: false, error: 'document-too-large' });
    expect(store.doc).toEqual(before);
    expect(store.canUndo).toBe(false);
  });

  it('上限の内側の操作は、これまでどおり適用される', async () => {
    const { DocumentStore } = await import('../../src/state/store');
    const store = new DocumentStore(createSampleDocument());
    expect(store.apply((doc) => ((doc.pages[0].nodes[0].x += 10), { ok: true })).ok).toBe(true);
    expect(store.canUndo).toBe(true);
  });
});
