import { describe, expect, it } from 'vitest';
import { addNodeFromTemplate } from '../../src/model/actions';
import { resizeNodes, setPortGroupsMany, updateNodes } from '../../src/model/bulkActions';
import { getNodePorts } from '../../src/model/query';
import type { PortGroup } from '../../src/model/types';
import { createEmptyDocument } from '../../src/model/defaults';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { DocumentStore } from '../../src/state/store';

// 期待値は仕様(指定した項目だけ全員へ・失敗は全体を取り消す・大きさは機器ごとの規則で補正)から導く。
const P = 'page-1';
type Doc = ReturnType<typeof createEmptyDocument>;
const tpl = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, id);
const node = (doc: Doc, id: string) => doc.pages[0].nodes.find((n) => n.id === id)!;

function setup(): { doc: Doc; ids: string[] } {
  const doc = createEmptyDocument();
  const a = addNodeFromTemplate(P, tpl('speaker'), 'A', { x: 40, y: 40 })(doc).created!;
  const b = addNodeFromTemplate(P, tpl('amp'), 'B', { x: 300, y: 40 })(doc).created!;
  node(doc, a).model = 'M-A';
  node(doc, b).model = 'M-B';
  return { doc, ids: [a, b] };
}

describe('updateNodes', () => {
  it('指定した項目(型番)だけ全員に反映し、ほかの項目は変えない', () => {
    const { doc, ids } = setup();
    expect(updateNodes(P, ids, { model: 'X1' })(doc).ok).toBe(true);
    expect(ids.map((id) => node(doc, id).model)).toEqual(['X1', 'X1']);
    expect(ids.map((id) => node(doc, id).label)).toEqual(['A', 'B']);
  });

  it('台数をまとめて設定できる', () => {
    const { doc, ids } = setup();
    expect(updateNodes(P, ids, { count: 3 })(doc).ok).toBe(true);
    expect(ids.map((id) => node(doc, id).count)).toEqual([3, 3]);
  });

  it('台数が不正なら失敗する。ストア経由では、1台も変わらない', () => {
    const { doc, ids } = setup();
    const store = new DocumentStore(doc);
    expect(store.apply(updateNodes(P, ids, { count: 0 })).ok).toBe(false);
    expect(ids.map((id) => node(store.doc, id).count)).toEqual([undefined, undefined]);
  });

  it('存在しない機器が混じると失敗し、ストア経由では先頭の機器も変わらない', () => {
    const { doc, ids } = setup();
    const store = new DocumentStore(doc);
    expect(store.apply(updateNodes(P, [ids[0], 'nope'], { model: 'Z' })).ok).toBe(false);
    expect(node(store.doc, ids[0]).model).toBe('M-A');
  });

  it('対象が空・ページが無いときは失敗する', () => {
    const { doc, ids } = setup();
    expect(updateNodes(P, [], { model: 'Z' })(doc).ok).toBe(false);
    expect(updateNodes('nope', ids, { model: 'Z' })(doc).ok).toBe(false);
  });

  it('1回の適用なので、元に戻すで全員が戻る', () => {
    const { doc, ids } = setup();
    const store = new DocumentStore(doc);
    store.apply(updateNodes(P, ids, { model: 'X1' }));
    store.undo();
    expect(ids.map((id) => node(store.doc, id).model)).toEqual(['M-A', 'M-B']);
  });
});

describe('resizeNodes', () => {
  it('幅だけ指定すると、高さは各機器の今の値のまま', () => {
    const { doc, ids } = setup();
    const heights = ids.map((id) => node(doc, id).h);
    expect(resizeNodes(P, ids, { w: 240 })(doc).ok).toBe(true);
    expect(ids.map((id) => node(doc, id).w)).toEqual([240, 240]);
    expect(ids.map((id) => node(doc, id).h)).toEqual(heights);
  });

  it('不正な値(NaN)なら失敗し、ストア経由では何も変わらない', () => {
    const { doc, ids } = setup();
    const store = new DocumentStore(doc);
    const before = ids.map((id) => [node(store.doc, id).w, node(store.doc, id).h]);
    expect(store.apply(resizeNodes(P, ids, { w: Number.NaN })).ok).toBe(false);
    expect(ids.map((id) => [node(store.doc, id).w, node(store.doc, id).h])).toEqual(before);
  });

  it('対象が空・存在しない機器は失敗する', () => {
    const { doc, ids } = setup();
    expect(resizeNodes(P, [], { w: 200 })(doc).ok).toBe(false);
    expect(resizeNodes(P, [ids[0], 'nope'], { w: 200 })(doc).ok).toBe(false);
  });
});

describe('setPortGroupsMany', () => {
  const group = (count: number): PortGroup => ({ id: 'x1', signalType: 'LAN', direction: 'inout', side: 'left', count, labelPrefix: 'X ' });

  it('全員のポート構成を同じにする', () => {
    const { doc, ids } = setup();
    expect(setPortGroupsMany(P, ids, [group(3)])(doc).ok).toBe(true);
    for (const id of ids) {
      const ports = getNodePorts(doc, node(doc, id));
      expect(ports).toHaveLength(3);
      expect(ports.every((p) => p.signalType === 'LAN')).toBe(true);
    }
  });

  it('不正な構成なら失敗し、ストア経由では1台も変わらない', () => {
    const { doc, ids } = setup();
    const store = new DocumentStore(doc);
    const before = ids.map((id) => getNodePorts(store.doc, node(store.doc, id)).length);
    expect(store.apply(setPortGroupsMany(P, ids, [group(-1)])).ok).toBe(false);
    expect(ids.map((id) => getNodePorts(store.doc, node(store.doc, id)).length)).toEqual(before);
  });

  it('線が消える台があると、確認済みの指定が無ければ失敗する', () => {
    const { doc, ids } = setup();
    setPortGroupsMany(P, ids, [group(2)])(doc);
    const [a, b] = ids.map((id) => getNodePorts(doc, node(doc, id)));
    doc.pages[0].edges.push({ id: 'e1', from: { nodeId: ids[0], portId: a[1].id }, to: { nodeId: ids[1], portId: b[1].id } } as never);
    const store = new DocumentStore(doc);
    expect(store.apply(setPortGroupsMany(P, ids, [group(1)])).ok).toBe(false);
    expect(store.doc.pages[0].edges).toHaveLength(1);
    expect(store.apply(setPortGroupsMany(P, ids, [group(1)], { removeOrphanEdges: true })).ok).toBe(true);
    expect(store.doc.pages[0].edges).toHaveLength(0);
  });

  it('対象が空・存在しない機器は失敗する', () => {
    const { doc, ids } = setup();
    expect(setPortGroupsMany(P, [], [group(1)])(doc).ok).toBe(false);
    expect(setPortGroupsMany(P, [ids[0], 'nope'], [group(1)])(doc).ok).toBe(false);
  });
});
