import { expect, it } from 'vitest';
import { countRemovedPortEdges, removePorts, restorePorts } from '../../src/model/portActions';
import { getNodePorts } from '../../src/model/query';
import { DocumentStore } from '../../src/state/store';
import { createSampleDocument } from '../fixtures/sampleDocument';
import { setPortGroups } from '../../src/model/actions';
import { copySelection, pasteClipboard } from '../../src/model/clipboard';

it('欠番と接続削除を一度に取り消し、復元では接続を戻さない', () => {
  const store = new DocumentStore(createSampleDocument());
  expect(countRemovedPortEdges(store.doc, 'page-1', 'sw', ['lan-l-1', 'lan-l-2'])).toBe(2);
  expect(store.apply(removePorts('page-1', 'sw', ['lan-l-1', 'lan-l-2'])).ok).toBe(true);
  const node = () => store.doc.pages[0].nodes.find((n) => n.id === 'sw')!;
  expect(node().portGroupsOverride![0].skipped).toEqual([1, 2]);
  expect(store.doc.pages[0].edges).toHaveLength(14);
  expect(store.undo()).toBe(true);
  expect(store.doc.pages[0].edges).toHaveLength(16);
  expect(store.redo()).toBe(true);
  expect(store.apply(restorePorts('page-1', 'sw', 'lan-l', [1, 2])).ok).toBe(true);
  expect(node().portGroupsOverride![0].skipped).toBeUndefined();
  expect(store.doc.pages[0].edges).toHaveLength(14);
  expect(getNodePorts(store.doc, node()).some((p) => p.id === 'lan-l-1')).toBe(true);
  expect(store.apply(removePorts('page-1', 'sw', ['missing'])).error).toBe('unknown-port');
});

it('複数台の同じ番号に付く線を合計する', () => {
  const doc = createSampleDocument();
  doc.pages[0].edges.push({ id: 'extra', from: { nodeId: 'mute', portId: 'lan-1@2' }, to: { nodeId: 'sw', portId: 'lan-l-5' } });
  expect(countRemovedPortEdges(doc, 'page-1', 'mute', ['lan-1@2'])).toBe(2);
  expect(removePorts('page-1', 'mute', ['lan-1@2'])(doc).ok).toBe(true);
  expect(doc.pages[0].edges.some((e) => e.id === 'extra' || e.id === 'e-5')).toBe(false);
});

it('個数を減らすと範囲外の欠番を整理し、接続中のポートは保護する', () => {
  const doc = createSampleDocument();
  removePorts('page-1', 'sw', ['lan-l-8'])(doc);
  const node = doc.pages[0].nodes.find((n) => n.id === 'sw')!;
  const groups = node.portGroupsOverride!.map((g) => g.id === 'lan-l' ? { ...g, count: 2 } : g);
  expect(setPortGroups('page-1', 'sw', groups)(doc).error).toBe('ports-in-use');
  expect(setPortGroups('page-1', 'sw', groups, { removeOrphanEdges: true })(doc).ok).toBe(true);
  expect(node.portGroupsOverride![0].skipped).toBeUndefined();
});

it('コピーと貼り付けで欠番を保つ', () => {
  const doc = createSampleDocument();
  removePorts('page-1', 'sw', ['lan-l-8'])(doc);
  const data = copySelection(doc, 'page-1', { nodeIds: ['sw'] })!;
  const result = pasteClipboard('page-1', data, { dx: 20, dy: 20 })(doc);
  expect(result.ok).toBe(true);
  expect(doc.pages[0].nodes.find((n) => n.id === result.createdNodeIds![0])!.portGroupsOverride![0].skipped).toEqual([8]);
});
