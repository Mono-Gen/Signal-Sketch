import { describe, expect, it, vi } from 'vitest';
import { addEdge, moveNodes } from '../../src/model/actions';
import { createSampleDocument } from '../fixtures/sampleDocument';
import { DocumentStore } from '../../src/state/store';

const P = 'page-1';
const x = (s: DocumentStore) => s.doc.pages[0].nodes.find((n) => n.id === 'tap')!.x;

describe('DocumentStore', () => {
  it('apply で状態が変わり、undo/redo で行き来できる', () => {
    const s = new DocumentStore(createSampleDocument());
    expect(x(s)).toBe(40);
    s.apply(moveNodes(P, [{ id: 'tap', x: 100, y: 70 }]));
    expect(x(s)).toBe(100);
    expect(s.undo()).toBe(true);
    expect(x(s)).toBe(40);
    expect(s.redo()).toBe(true);
    expect(x(s)).toBe(100);
  });

  it('失敗した操作は状態も履歴も変えない', () => {
    const s = new DocumentStore(createSampleDocument());
    const r = s.apply(moveNodes(P, [{ id: 'nope', x: 1, y: 1 }]));
    expect(r.ok).toBe(false);
    expect(s.canUndo).toBe(false);
    expect(s.isDirty).toBe(false);
  });

  it('途中で失敗する操作が、状態を中途半端に変えない', () => {
    const s = new DocumentStore(createSampleDocument());
    s.apply((doc) => {
      doc.pages[0].nodes[0].x = 999; // 先に書き換えてから失敗する操作
      return { ok: false, error: 'unknown-node' };
    });
    expect(x(s)).toBe(40);
  });

  it('履歴が空なら undo/redo は false', () => {
    const s = new DocumentStore(createSampleDocument());
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(false);
  });

  it('新しい操作をすると redo 履歴は破棄される', () => {
    const s = new DocumentStore(createSampleDocument());
    s.apply(moveNodes(P, [{ id: 'tap', x: 100, y: 70 }]));
    s.undo();
    s.apply(moveNodes(P, [{ id: 'tap', x: 200, y: 70 }]));
    expect(s.canRedo).toBe(false);
  });

  it('履歴は上限を超えたら古いものから捨てる', () => {
    const s = new DocumentStore(createSampleDocument(), 3);
    for (let i = 1; i <= 5; i++) s.apply(moveNodes(P, [{ id: 'tap', x: 40 + i * 10, y: 70 }]));
    let undone = 0;
    while (s.undo()) undone++;
    expect(undone).toBe(3);
  });

  it('isDirty: 変更で true、保存で false、replace 直後は false', () => {
    const s = new DocumentStore(createSampleDocument());
    expect(s.isDirty).toBe(false);
    s.apply(moveNodes(P, [{ id: 'tap', x: 100, y: 70 }]));
    expect(s.isDirty).toBe(true);
    s.markSaved();
    expect(s.isDirty).toBe(false);
    s.apply(moveNodes(P, [{ id: 'tap', x: 110, y: 70 }]));
    s.replace(createSampleDocument());
    expect(s.isDirty).toBe(false);
    expect(s.canUndo).toBe(false);
  });

  it('保存後に undo すると、保存時点と異なるので dirty になる', () => {
    const s = new DocumentStore(createSampleDocument());
    s.apply(moveNodes(P, [{ id: 'tap', x: 100, y: 70 }]));
    s.markSaved();
    s.undo();
    expect(s.isDirty).toBe(true);
  });

  it('渡した元のドキュメントを後から変更しても、ストアには影響しない', () => {
    const src = createSampleDocument();
    const s = new DocumentStore(src);
    src.pages[0].nodes[0].x = 777;
    expect(x(s)).toBe(40);
  });

  it('購読者へ変更を通知し、解除後は通知しない', () => {
    const s = new DocumentStore(createSampleDocument());
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.apply(moveNodes(P, [{ id: 'tap', x: 100, y: 70 }]));
    s.undo();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    s.redo();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('接続の追加も1回の undo で元に戻る', () => {
    const s = new DocumentStore(createSampleDocument());
    const n = s.doc.pages[0].edges.length;
    s.apply(addEdge(P, { nodeId: 'sw', portId: 'lan-r-3' }, { nodeId: 'ap', portId: 'lan-1' }));
    expect(s.doc.pages[0].edges).toHaveLength(n + 1);
    s.undo();
    expect(s.doc.pages[0].edges).toHaveLength(n);
  });
});
