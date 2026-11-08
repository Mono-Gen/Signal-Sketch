import { describe, expect, it } from 'vitest';
import { addNodeFromTemplate, lostEdgeIds, setPortGroups, updateNode } from '../../src/model/actions';
import { validateDocument } from '../../src/model/validate';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { createSampleDocument } from '../fixtures/sampleDocument';
import type { PortGroup } from '../../src/model/types';

const P = 'page-1';
const fresh = () => createSampleDocument();
const node = (doc: ReturnType<typeof fresh>, id: string) => doc.pages[0].nodes.find((n) => n.id === id)!;
const preset = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, `名前-${id}`);

describe('addNodeFromTemplate', () => {
  it('標準機器を追加すると、テンプレートが図へ取り込まれ、機器が1台増える', () => {
    const doc = fresh();
    const n = doc.pages[0].nodes.length;
    const tpls = doc.deviceTemplates.length;
    const r = addNodeFromTemplate(P, preset('switch'), 'SW')(doc);
    expect(r.ok).toBe(true);
    expect(r.created).toBeDefined();
    expect(doc.pages[0].nodes).toHaveLength(n + 1);
    expect(doc.deviceTemplates).toHaveLength(tpls + 1);
    expect(doc.deviceTemplates.at(-1)!.id).toBe('preset-switch');
  });

  it('同じ標準機器をもう一度追加しても、テンプレートは増えない', () => {
    const doc = fresh();
    addNodeFromTemplate(P, preset('camera'), 'A')(doc);
    const tpls = doc.deviceTemplates.length;
    addNodeFromTemplate(P, preset('camera'), 'B')(doc);
    expect(doc.deviceTemplates).toHaveLength(tpls);
  });

  it('取り込み済みのテンプレートは上書きしない(ユーザーが編集した定義を守る)', () => {
    const doc = fresh();
    addNodeFromTemplate(P, preset('camera'), 'A')(doc);
    doc.deviceTemplates.find((t) => t.id === 'preset-camera')!.name = '編集済み';
    addNodeFromTemplate(P, preset('camera'), 'B')(doc);
    expect(doc.deviceTemplates.find((t) => t.id === 'preset-camera')!.name).toBe('編集済み');
  });

  it('位置を省略すると、既存の機器と重ならない空き位置へ置く', () => {
    const doc = fresh();
    const r = addNodeFromTemplate(P, preset('generic'), 'X')(doc);
    const added = node(doc, r.created!);
    const overlap = doc.pages[0].nodes
      .filter((o) => o.id !== added.id)
      .some((o) => added.x < o.x + o.w && o.x < added.x + added.w && added.y < o.y + o.h && o.y < added.y + added.h);
    expect(overlap).toBe(false);
  });

  it('位置を指定すると、グリッドへ吸着する(吸着オフなら指定どおり)', () => {
    const doc = fresh();
    const a = addNodeFromTemplate(P, preset('generic'), 'A', { x: 43, y: 77 })(doc);
    expect([node(doc, a.created!).x, node(doc, a.created!).y]).toEqual([40, 80]);
    doc.grid.enabled = false;
    const b = addNodeFromTemplate(P, preset('generic'), 'B', { x: 43, y: 77 })(doc);
    expect([node(doc, b.created!).x, node(doc, b.created!).y]).toEqual([43, 77]);
  });

  it('サイズはポートに合わせた自動サイズ(LAN 48ポートの機器は幅490)', () => {
    const doc = fresh();
    const base = PRESETS.find((p) => p.id === 'switch')!;
    const wide = { ...base, portGroups: base.portGroups.map((g) => ({ ...g, count: 48 })) };
    const r = addNodeFromTemplate(P, presetToTemplate(wide, 'SW48'), 'SW48')(doc);
    expect(node(doc, r.created!).w).toBe(490);
  });

  it('登録サイズがページより大きくても、最小サイズを守ってページ内へ収める', () => {
    const doc = fresh();
    const page = doc.pages[0];
    const oversized = { ...preset('speaker'), id: 'custom-oversized', size: { w: 4000, h: 4000 } };
    const result = addNodeFromTemplate(P, oversized, '大型機器', { x: page.size.w, y: page.size.h })(doc);
    expect(result.ok).toBe(true);
    expect(node(doc, result.created!)).toMatchObject({ x: 0, y: 0, w: page.size.w, h: page.size.h });
  });

  it('追加後のドキュメントは検証に通る', () => {
    const doc = fresh();
    addNodeFromTemplate(P, preset('amp'), 'AMP')(doc);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('IDは既存と衝突しない', () => {
    const doc = fresh();
    const a = addNodeFromTemplate(P, preset('generic'), 'A')(doc);
    const b = addNodeFromTemplate(P, preset('generic'), 'B')(doc);
    expect(a.created).not.toBe(b.created);
    const ids = doc.pages[0].nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('存在しないページは失敗', () => {
    expect(addNodeFromTemplate('zzz', preset('generic'), 'X')(fresh()).error).toBe('unknown-page');
  });
});

describe('updateNode', () => {
  it('名称・型番・台数を変更できる', () => {
    const doc = fresh();
    expect(updateNode(P, 'tap', { label: '新名称', model: 'M-1', count: 3 })(doc).ok).toBe(true);
    expect(node(doc, 'tap')).toMatchObject({ label: '新名称', model: 'M-1', count: 3 });
  });

  it('台数に undefined を渡すと台数表記を消す', () => {
    const doc = fresh();
    updateNode(P, 'mute', { count: undefined })(doc); // mute は ×4台
    expect('count' in node(doc, 'mute')).toBe(false);
  });

  it('台数が0・負・小数なら失敗し、何も変えない', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      const doc = fresh();
      const r = updateNode(P, 'mute', { label: '変更されてはいけない', count })(doc);
      expect(r).toEqual({ ok: false, error: 'invalid-value' });
      expect(node(doc, 'mute').label).toBe('Mute Button');
    }
  });

  it('一部の項目だけ渡せば、他は変わらない', () => {
    const doc = fresh();
    updateNode(P, 'tsc', { model: 'X' })(doc);
    expect(node(doc, 'tsc').label).toBe('Control Touch Panel');
  });

  it('存在しない機器・ページは失敗', () => {
    expect(updateNode(P, 'zzz', { label: 'a' })(fresh()).error).toBe('unknown-node');
    expect(updateNode('zzz', 'tap', { label: 'a' })(fresh()).error).toBe('unknown-page');
  });
});

const lanGroup = (side: PortGroup['side'], count: number, id = 'lan'): PortGroup => ({
  id,
  signalType: 'LAN',
  direction: 'inout',
  side,
  count,
  labelPrefix: 'LAN ',
});

describe('setPortGroups / lostEdgeIds', () => {
  it('グループの辺を変えても、ポートIDが変わらないので接続は保たれる', () => {
    const doc = fresh();
    // sw の左辺 lan-l(8) を右辺へ移す
    const sw = node(doc, 'sw');
    const groups = (doc.deviceTemplates.find((t) => t.id === sw.templateId)!.portGroups).map((g) => (g.id === 'lan-l' ? { ...g, side: 'right' as const } : g));
    const edges = doc.pages[0].edges.length;
    expect(setPortGroups(P, 'sw', groups)(doc).ok).toBe(true);
    expect(doc.pages[0].edges).toHaveLength(edges);
    expect(node(doc, 'sw').portGroupsOverride!.find((g) => g.id === 'lan-l')!.side).toBe('right');
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('上書きはその機器だけで、同じテンプレートの他の機器やテンプレート自体は変わらない', () => {
    const doc = fresh();
    // d1, d2 は同じ display テンプレート
    setPortGroups(P, 'd1', [{ id: 'hdmi', signalType: 'HDMI', direction: 'in', side: 'left', count: 1, labelPrefix: 'HDMI ' }, lanGroup('left', 1, 'lan')])(doc);
    expect(node(doc, 'd1').portGroupsOverride).toBeDefined();
    expect(node(doc, 'd2').portGroupsOverride).toBeUndefined();
    expect(doc.deviceTemplates.find((t) => t.id === 'display')!.portGroups).toHaveLength(1);
  });

  it('ポートを増やすと、収まらなければ機器が大きくなる', () => {
    const doc = fresh();
    const before = node(doc, 'ap').h; // 60(接続のない機器)
    expect(setPortGroups(P, 'ap', [lanGroup('left', 8)])(doc).ok).toBe(true);
    expect(node(doc, 'ap').h).toBeGreaterThan(before);
    expect(node(doc, 'ap').h).toBe(110); // 30 + 8*10
  });

  it('機器は小さくならない(利用者が決めた大きさを尊重)', () => {
    const doc = fresh();
    const { w, h } = node(doc, 'sw');
    setPortGroups(P, 'sw', [lanGroup('left', 1)])(doc);
    expect([node(doc, 'sw').w, node(doc, 'sw').h]).toEqual([w, h]);
  });

  it('接続のあるポートを減らすと、確認なしでは失敗し何も変えない', () => {
    const doc = fresh();
    // sw の lan-l-1〜4 は接続あり。lan-l を 2 個へ減らすと lan-l-3, lan-l-4 の接続が消える
    const groups = doc.deviceTemplates.find((t) => t.id === 'switch')!.portGroups.map((g) => (g.id === 'lan-l' ? { ...g, count: 2 } : g));
    expect(lostEdgeIds(doc, P, 'sw', groups).sort()).toEqual(['e-7', 'e-8']);
    const edges = doc.pages[0].edges.length;
    const r = setPortGroups(P, 'sw', groups)(doc);
    expect(r).toEqual({ ok: false, error: 'ports-in-use' });
    expect(doc.pages[0].edges).toHaveLength(edges);
    expect(node(doc, 'sw').portGroupsOverride).toBeUndefined();
  });

  it('確認済み(removeOrphanEdges)なら、使えなくなる接続だけを消して適用する', () => {
    const doc = fresh();
    const groups = doc.deviceTemplates.find((t) => t.id === 'switch')!.portGroups.map((g) => (g.id === 'lan-l' ? { ...g, count: 2 } : g));
    const edges = doc.pages[0].edges.length;
    expect(setPortGroups(P, 'sw', groups, { removeOrphanEdges: true })(doc).ok).toBe(true);
    expect(doc.pages[0].edges).toHaveLength(edges - 2);
    expect(doc.pages[0].edges.some((e) => e.id === 'e-7' || e.id === 'e-8')).toBe(false);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('グループを丸ごと消すと、そのグループの接続が対象になる', () => {
    const doc = fresh();
    const groups = doc.deviceTemplates.find((t) => t.id === 'switch')!.portGroups.filter((g) => g.id !== 'lan-r');
    // lan-r-1(e-12), lan-r-2(e-13) が使用中
    expect(lostEdgeIds(doc, P, 'sw', groups).sort()).toEqual(['e-12', 'e-13']);
  });

  it('ポートが増える変更や、接続のないポートの削除は、接続に影響しない', () => {
    const doc = fresh();
    const groups = doc.deviceTemplates.find((t) => t.id === 'switch')!.portGroups.map((g) => (g.id === 'lan-l' ? { ...g, count: 12 } : g));
    expect(lostEdgeIds(doc, P, 'sw', groups)).toEqual([]);
  });

  it('不正な構成は失敗する(個数・重複ID・未定義の信号・辺・方向)', () => {
    const bad: PortGroup[][] = [
      [lanGroup('left', -1)],
      [lanGroup('left', 1.5)],
      [lanGroup('left', 1, 'a'), lanGroup('right', 1, 'a')],
      [{ ...lanGroup('left', 1), signalType: 'NOPE' }],
      [{ ...lanGroup('left', 1), side: 'middle' as never }],
      [{ ...lanGroup('left', 1), direction: 'both' as never }],
    ];
    for (const groups of bad) {
      const doc = fresh();
      expect(setPortGroups(P, 'tap', groups)(doc), JSON.stringify(groups)).toEqual({ ok: false, error: 'invalid-port-groups' });
      expect(node(doc, 'tap').portGroupsOverride).toBeUndefined();
    }
  });

  it('存在しない機器・ページは失敗', () => {
    expect(setPortGroups(P, 'zzz', [])(fresh()).error).toBe('unknown-node');
    expect(setPortGroups('zzz', 'tap', [])(fresh()).error).toBe('unknown-page');
  });

  it('渡した配列を後から書き換えても、保存された構成には影響しない', () => {
    const doc = fresh();
    const groups = [lanGroup('left', 2)];
    expect(setPortGroups(P, 'ap', groups)(doc).ok).toBe(true);
    groups[0].count = 99;
    expect(node(doc, 'ap').portGroupsOverride![0].count).toBe(2);
  });
});
