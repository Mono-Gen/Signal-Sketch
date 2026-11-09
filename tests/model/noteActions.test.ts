import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { removeItems } from '../../src/model/actions';
import { createEmptyDocument } from '../../src/model/defaults';
import { addNote, moveNotes, resizeNote, updateNotes } from '../../src/model/noteActions';
import { DEFAULT_NOTE_SIZE, MAX_NOTE_FONT, MAX_NOTE_LENGTH, MAX_NOTES_PER_PAGE, MIN_NOTE_FONT, MIN_NOTE_SIZE } from '../../src/model/notes';
import { validateDocument } from '../../src/model/validate';
import { DocumentStore } from '../../src/state/store';

// 期待値は仕様(計画 .tasks/memo_note)から導く: 文字だけの部品・上限(100個/1000文字)・色は#RRGGBB・大きさは8〜48・ページ外へ出さない。
const P = 'page-1';
const fresh = () => createEmptyDocument();
const notes = (doc: ReturnType<typeof fresh>) => doc.pages[0].notes ?? [];

describe('addNote', () => {
  it('メモを置くと、IDが返り、既定の本文と大きさで入る', () => {
    const doc = fresh();
    const r = addNote(P, { x: 100, y: 100 })(doc);
    expect(r.ok).toBe(true);
    const n = notes(doc).find((x) => x.id === r.created)!;
    expect(n.text.length).toBeGreaterThan(0);
    expect([n.w, n.h]).toEqual([DEFAULT_NOTE_SIZE.w, DEFAULT_NOTE_SIZE.h]);
  });

  it('グリッドが有効なら位置を丸め、ページの外へは出さない', () => {
    const doc = fresh();
    doc.grid.enabled = true;
    doc.grid.size = 10;
    const a = addNote(P, { x: 103, y: 97 })(doc).created!;
    const na = notes(doc).find((n) => n.id === a)!;
    expect([na.x, na.y]).toEqual([100, 100]);
    const b = addNote(P, { x: 99999, y: -50 })(doc).created!;
    const nb = notes(doc).find((n) => n.id === b)!;
    expect(nb.x + nb.w).toBeLessThanOrEqual(doc.pages[0].size.w);
    expect(nb.y).toBe(0);
  });

  it('上限(100個)を超えると断る。文字数の上限も守る', () => {
    const doc = fresh();
    for (let i = 0; i < MAX_NOTES_PER_PAGE; i++) expect(addNote(P, { x: 0, y: 0 })(doc).ok).toBe(true);
    expect(addNote(P, { x: 0, y: 0 })(doc)).toMatchObject({ ok: false, error: 'too-many-notes' });
    expect(addNote(P, { x: 0, y: 0 }, 'x'.repeat(MAX_NOTE_LENGTH + 1))(fresh()).ok).toBe(false);
  });

  it('不正な座標・存在しないページは断る', () => {
    expect(addNote(P, { x: Number.NaN, y: 0 })(fresh()).ok).toBe(false);
    expect(addNote('nope', { x: 0, y: 0 })(fresh())).toMatchObject({ ok: false, error: 'unknown-page' });
  });
});

describe('updateNotes', () => {
  const setup = () => {
    const doc = fresh();
    const a = addNote(P, { x: 0, y: 0 })(doc).created!;
    const b = addNote(P, { x: 300, y: 0 })(doc).created!;
    return { doc, ids: [a, b] };
  };

  it('本文・色・文字の大きさを、指定した項目だけ変える(複数同時も可)', () => {
    const { doc, ids } = setup();
    expect(updateNotes(P, ids, { color: '#ff0000', fontSize: 20 })(doc).ok).toBe(true);
    expect(notes(doc).map((n) => [n.color, n.fontSize])).toEqual([
      ['#ff0000', 20],
      ['#ff0000', 20],
    ]);
    expect(updateNotes(P, [ids[0]], { text: '本文' })(doc).ok).toBe(true);
    expect(notes(doc)[0].text).toBe('本文');
    expect(notes(doc)[1].text).not.toBe('本文');
    expect(notes(doc)[0].color).toBe('#ff0000'); // 指定しなかった項目は変わらない
  });

  it('null で色・文字の大きさが既定へ戻る(項目ごと消える)', () => {
    const { doc, ids } = setup();
    updateNotes(P, ids, { color: '#00ff00', fontSize: 30 })(doc);
    updateNotes(P, ids, { color: null, fontSize: null })(doc);
    for (const n of notes(doc)) expect('color' in n || 'fontSize' in n).toBe(false);
  });

  it('不正な値(色の形式・大きさの範囲・文字数)は断り、ストア経由では何も変わらない', () => {
    const { doc, ids } = setup();
    const store = new DocumentStore(doc);
    const before = JSON.stringify(store.doc.pages[0].notes);
    const patches = [{ color: 'red' }, { color: '#fff' }, { fontSize: MIN_NOTE_FONT - 1 }, { fontSize: MAX_NOTE_FONT + 1 }, { fontSize: Number.NaN }, { text: 'x'.repeat(MAX_NOTE_LENGTH + 1) }];
    for (const patch of patches) {
      expect(store.apply(updateNotes(P, ids, patch)).ok, JSON.stringify(patch)).toBe(false);
    }
    expect(JSON.stringify(store.doc.pages[0].notes)).toBe(before);
  });

  it('存在しないメモが混じると、全体を取り消す', () => {
    const { doc, ids } = setup();
    const store = new DocumentStore(doc);
    expect(store.apply(updateNotes(P, [ids[0], 'nope'], { text: 'Z' }))).toMatchObject({ ok: false, error: 'unknown-note' });
    expect(notes(store.doc)[0].text).not.toBe('Z');
    expect(updateNotes(P, [], { text: 'Z' })(fresh()).ok).toBe(false);
  });
});

describe('moveNotes / resizeNote', () => {
  it('動かすとグリッドへ丸め、ページの外へは出さない', () => {
    const doc = fresh();
    doc.grid.enabled = true;
    doc.grid.size = 10;
    const id = addNote(P, { x: 50, y: 50 })(doc).created!;
    expect(moveNotes(P, [{ id, x: 123, y: 87 }])(doc).ok).toBe(true);
    expect([notes(doc)[0].x, notes(doc)[0].y]).toEqual([120, 90]);
    moveNotes(P, [{ id, x: -999, y: 99999 }])(doc);
    expect(notes(doc)[0].x).toBe(0);
    expect(notes(doc)[0].y + notes(doc)[0].h).toBeLessThanOrEqual(doc.pages[0].size.h);
  });

  it('動かす対象が不正なら断る(不明なメモ・NaN)', () => {
    const doc = fresh();
    const id = addNote(P, { x: 50, y: 50 })(doc).created!;
    expect(moveNotes(P, [{ id: 'nope', x: 0, y: 0 }])(doc)).toMatchObject({ ok: false, error: 'unknown-note' });
    expect(moveNotes(P, [{ id, x: Number.NaN, y: 0 }])(doc).ok).toBe(false);
  });

  it('大きさは最小より小さくならず、ページより大きくならない', () => {
    const doc = fresh();
    const id = addNote(P, { x: 50, y: 50 })(doc).created!;
    expect(resizeNote(P, id, { x: 50, y: 50, w: 1, h: 1 })(doc).ok).toBe(true);
    expect([notes(doc)[0].w, notes(doc)[0].h]).toEqual([MIN_NOTE_SIZE.w, MIN_NOTE_SIZE.h]);
    resizeNote(P, id, { x: 0, y: 0, w: 999999, h: 999999 })(doc);
    expect(notes(doc)[0].w).toBe(doc.pages[0].size.w);
    expect(resizeNote(P, id, { x: 0, y: 0, w: Number.NaN, h: 10 })(doc).ok).toBe(false);
    expect(resizeNote(P, 'nope', { x: 0, y: 0, w: 50, h: 50 })(doc)).toMatchObject({ ok: false, error: 'unknown-note' });
  });
});

describe('削除・保存・検査', () => {
  it('removeItems でメモを消せる(元に戻すで戻る)', () => {
    const doc = fresh();
    const id = addNote(P, { x: 50, y: 50 })(doc).created!;
    const store = new DocumentStore(doc);
    expect(store.apply(removeItems(P, { noteIds: [id] })).ok).toBe(true);
    expect(notes(store.doc)).toHaveLength(0);
    store.undo();
    expect(notes(store.doc)).toHaveLength(1);
  });

  it('保存して読み直しても、メモ(本文・色・大きさ)が残る', () => {
    const doc = fresh();
    const id = addNote(P, { x: 50, y: 50 }, '行1\n行2')(doc).created!;
    updateNotes(P, [id], { color: '#112233', fontSize: 18 })(doc);
    const r = parseDocument(serializeDocument(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(notes(r.doc)[0]).toMatchObject({ text: '行1\n行2', color: '#112233', fontSize: 18 });
  });

  it('メモの無い古い図も、そのまま検査を通る', () => {
    expect(validateDocument(fresh()).ok).toBe(true);
  });

  it('不正なメモを含む図は読み込みで断る(型・色・大きさ・文字数・重複ID・個数)', () => {
    type Doc = ReturnType<typeof fresh>;
    const base = (): Doc => {
      const doc = fresh();
      addNote(P, { x: 0, y: 0 })(doc);
      return JSON.parse(JSON.stringify(doc)) as Doc;
    };
    const bads: Array<(d: Doc) => void> = [
      (d) => ((d.pages[0].notes![0] as unknown as { text: number }).text = 1),
      (d) => (d.pages[0].notes![0].color = 'red'),
      (d) => (d.pages[0].notes![0].fontSize = 999),
      (d) => (d.pages[0].notes![0].text = 'x'.repeat(MAX_NOTE_LENGTH + 1)),
      (d) => d.pages[0].notes!.push({ ...d.pages[0].notes![0] }),
      (d) => ((d.pages[0].notes![0] as unknown as { x: string }).x = 'a'),
      (d) => {
        d.pages[0].notes = Array.from({ length: MAX_NOTES_PER_PAGE + 1 }, (_, i) => ({ id: `n${i}`, text: 't', x: 0, y: 0, w: 50, h: 30 }));
      },
    ];
    for (const [i, mutate] of bads.entries()) {
      const d = base();
      mutate(d);
      expect(validateDocument(d).ok, `ケース${i}`).toBe(false);
    }
  });
});
