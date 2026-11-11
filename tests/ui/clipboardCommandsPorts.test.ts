import { afterEach, expect, it, vi } from 'vitest';
import { DocumentStore } from '../../src/state/store';
import { createClipboardCommands } from '../../src/ui/clipboardCommands';
import { createSampleDocument } from '../fixtures/sampleDocument';
import type { DiagramView } from '../../src/view/diagramView';

afterEach(() => vi.unstubAllGlobals());

const setup = (ports: { nodeId: string; portId: string }[]) => {
  const store = new DocumentStore(createSampleDocument());
  const view = {
    getPortSelection: () => ports,
    getSelection: () => ({ nodeIds: [], edgeIds: [], frameIds: [], noteIds: [] }),
  } as unknown as DiagramView;
  const commands = createClipboardCommands({ store, view, pageId: 'page-1', apply: (a) => store.apply(a), setStatus: () => undefined });
  return { store, commands };
};

it('Delete: 枠で選んだポートを、つながる線ごと1回の操作で削除し、元に戻せる', () => {
  vi.stubGlobal('window', { confirm: vi.fn(() => true) });
  const { store, commands } = setup([{ nodeId: 'sw', portId: 'lan-l-1' }, { nodeId: 'sw', portId: 'lan-l-2' }]);
  commands.deleteSelection();
  expect(store.doc.pages[0].nodes.find((n) => n.id === 'sw')!.portGroupsOverride![0].skipped).toEqual([1, 2]);
  expect(store.doc.pages[0].edges).toHaveLength(14); // サンプルの16本のうち、2本がつながっていた
  expect(store.undo()).toBe(true);
  expect(store.doc.pages[0].edges).toHaveLength(16);
});

it('Delete: 線が消える確認で取り消したら、何も変えない', () => {
  vi.stubGlobal('window', { confirm: vi.fn(() => false) });
  const { store, commands } = setup([{ nodeId: 'sw', portId: 'lan-l-1' }]);
  commands.deleteSelection();
  expect(store.doc.pages[0].edges).toHaveLength(16);
  expect(store.doc.pages[0].nodes.find((n) => n.id === 'sw')!.portGroupsOverride).toBeUndefined();
});
