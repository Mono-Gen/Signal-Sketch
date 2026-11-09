import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { buildSvg } from '../../src/io/svgExport';
import { removeItems, setPageSize } from '../../src/model/actions';
import { copySelection, pasteClipboard } from '../../src/model/clipboard';
import { addFrame, moveSelection } from '../../src/model/frames';
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
      (d) => (d.pages[0].notes![0].w = 0),
      (d) => (d.pages[0].notes![0].h = -1),
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

describe('メモと他の機能の連携', () => {
  it('SVG出力に、メモが本物の文字として入る(色・大きさ・特殊文字のエスケープ・折り返し)', () => {
    const doc = fresh();
    const id = addNote(P, { x: 40, y: 40 }, 'A<B>&"C"\n二行目')(doc).created!;
    updateNotes(P, [id], { color: '#ff0000', fontSize: 20 })(doc);
    const svg = buildSvg(doc, P, { edgePoints: new Map(), countText: (n) => `x${n}`, legendTitle: '凡例' });
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('font-size="20"');
    expect(svg).toContain('A&lt;B&gt;&amp;&quot;C&quot;');
    expect(svg).toContain('二行目');
    expect(svg).not.toContain('A<B>');
    expect((svg.match(/<tspan/g) ?? []).length).toBe(2);
  });

  it('幅が狭いと、SVGでも折り返す。高さに収まらない行は出さない', () => {
    const doc = fresh();
    const id = addNote(P, { x: 0, y: 0 }, 'あ'.repeat(30))(doc).created!;
    resizeNote(P, id, { x: 0, y: 0, w: 100, h: 60 })(doc);
    const svg = buildSvg(doc, P, { edgePoints: new Map(), countText: (n) => `x${n}`, legendTitle: '凡例' });
    const lines = (svg.match(/<tspan/g) ?? []).length;
    expect(lines).toBeGreaterThan(1); // 100px 幅に全角30文字(14px)は1行に入らない
    expect(lines).toBeLessThanOrEqual(Math.floor(58 / (14 * 1.25))); // 高さ60に収まる行数まで
  });

  it('コピー&貼り付けで、メモ(本文・色)が複製され、IDは新しく、位置はずれる', () => {
    const doc = fresh();
    const id = addNote(P, { x: 100, y: 100 }, '複製')(doc).created!;
    updateNotes(P, [id], { color: '#123456' })(doc);
    const data = copySelection(doc, P, { noteIds: [id] })!;
    expect(data.notes).toHaveLength(1);
    const r = pasteClipboard(P, data, { dx: 20, dy: 20 })(doc);
    expect(r.ok).toBe(true);
    expect(r.createdNoteIds).toHaveLength(1);
    const copy = notes(doc).find((n) => n.id === r.createdNoteIds![0])!;
    expect(copy).toMatchObject({ text: '複製', color: '#123456', x: 120, y: 120 });
    expect(copy.id).not.toBe(id);
  });

  it('メモだけを選んだときも、コピーできる(空の選択は null のまま)', () => {
    const doc = fresh();
    expect(copySelection(doc, P, { noteIds: ['nope'] })).toBeNull();
  });

  it('貼り付けで上限(100個)を超えるなら断り、何も変わらない', () => {
    const doc = fresh();
    for (let i = 0; i < MAX_NOTES_PER_PAGE; i++) addNote(P, { x: 0, y: 0 })(doc);
    const data = copySelection(doc, P, { noteIds: [notes(doc)[0].id] })!;
    const store = new DocumentStore(doc);
    expect(store.apply(pasteClipboard(P, data, { dx: 20, dy: 20 }))).toMatchObject({ ok: false, error: 'too-many-notes' });
    expect(notes(store.doc)).toHaveLength(MAX_NOTES_PER_PAGE);
  });

  it('枠を選んでコピーすると、枠の中のメモも入る。外のメモは入らない', () => {
    const doc = fresh();
    const frame = addFrame(P, '枠', { x: 100, y: 100 })(doc).created!;
    const inside = addNote(P, { x: 120, y: 120 }, '中')(doc).created!;
    const f = doc.pages[0].groups.find((g) => g.id === frame)!;
    const outside = addNote(P, { x: f.x + f.w + 300, y: 400 }, '外')(doc).created!;
    const data = copySelection(doc, P, { frameIds: [frame] })!;
    expect(data.notes!.map((n) => n.id)).toEqual([inside]);
    expect(data.notes!.some((n) => n.id === outside)).toBe(false);
  });

  it('枠を動かすと、枠の中のメモも同じだけ動く。外のメモは動かない', () => {
    const doc = fresh();
    const frame = addFrame(P, '枠', { x: 100, y: 100 })(doc).created!;
    const f = doc.pages[0].groups.find((g) => g.id === frame)!;
    const inside = addNote(P, { x: f.x + 20, y: f.y + 20 }, '中')(doc).created!;
    const outside = addNote(P, { x: f.x + f.w + 300, y: 500 }, '外')(doc).created!;
    const before = Object.fromEntries(notes(doc).map((n) => [n.id, [n.x, n.y]]));
    expect(moveSelection(P, [], [{ id: frame, x: f.x + 50, y: f.y + 30 }])(doc).ok).toBe(true);
    const byId = (id: string) => notes(doc).find((n) => n.id === id)!;
    expect([byId(inside).x, byId(inside).y]).toEqual([before[inside][0] + 50, before[inside][1] + 30]);
    expect([byId(outside).x, byId(outside).y]).toEqual(before[outside]);
  });

  it('外枠と内枠を同時に動かしても、両方に属するメモは1回分だけ動く(監査の指摘)', () => {
    const doc = fresh();
    const outer = addFrame(P, '外', { x: 100, y: 100 })(doc).created!;
    const inner = addFrame(P, '内', { x: 120, y: 120 })(doc).created!;
    Object.assign(doc.pages[0].groups.find((g) => g.id === outer)!, { x: 100, y: 100, w: 600, h: 400 });
    Object.assign(doc.pages[0].groups.find((g) => g.id === inner)!, { x: 140, y: 140, w: 200, h: 150 });
    const note = addNote(P, { x: 160, y: 160 }, '二重')(doc).created!;
    const before = notes(doc).find((n) => n.id === note)!.x;
    const o = doc.pages[0].groups.find((g) => g.id === outer)!;
    const i = doc.pages[0].groups.find((g) => g.id === inner)!;
    expect(moveSelection(P, [], [{ id: outer, x: o.x + 10, y: o.y }, { id: inner, x: i.x + 10, y: i.y }])(doc).ok).toBe(true);
    expect(notes(doc).find((n) => n.id === note)!.x).toBe(before + 10);
  });

  it('ページを小さくして、メモがはみ出すなら断る(メモの本文の1行目が理由に出る)。収まるなら通る', () => {
    const doc = fresh();
    addNote(P, { x: 1000, y: 600 }, '右下のメモ\n二行目')(doc);
    const r = setPageSize(P, { w: 640, h: 360 })(doc);
    expect(r).toMatchObject({ ok: false, error: 'page-too-small' });
    expect(r.blockers).toEqual(['右下のメモ']);
    expect(doc.pages[0].size.w).toBe(1280);
    expect(setPageSize(P, { w: 1280, h: 720 })(doc).ok).toBe(true);
  });

  it('メモを含む図は、古いコピーデータ(notes なし)も貼れる', () => {
    const doc = fresh();
    const frame = addFrame(P, '枠', { x: 100, y: 100 })(doc).created!;
    const data = copySelection(doc, P, { frameIds: [frame] })!;
    delete data.notes;
    expect(pasteClipboard(P, data, { dx: 20, dy: 20 })(doc).ok).toBe(true);
  });
});
