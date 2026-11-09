import type { Action } from './actions';
import { snap } from './grid';
import { uniqueId } from './ids';
import { DEFAULT_NOTE_SIZE, DEFAULT_NOTE_TEXT, MAX_NOTE_FONT, MAX_NOTE_LENGTH, MAX_NOTES_PER_PAGE, MIN_NOTE_FONT, MIN_NOTE_SIZE } from './notes';
import { getPage } from './query';
import { isHexColor } from './signalActions';

type NoteError = 'unknown-page' | 'unknown-note' | 'invalid-value' | 'too-many-notes';
const fail = (error: NoteError) => ({ ok: false as const, error });
const OK = { ok: true as const };

/** メモを置く。座標はグリッドが有効なら丸め、ページの外へは出さない。作ったメモのIDは created に返す */
export function addNote(pageId: string, at: { x: number; y: number }, text: string = DEFAULT_NOTE_TEXT): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || text.length > MAX_NOTE_LENGTH) return fail('invalid-value');
    const notes = (page.notes ??= []);
    if (notes.length >= MAX_NOTES_PER_PAGE) return fail('too-many-notes');
    const s = (v: number) => (doc.grid.enabled ? snap(v, doc.grid.size) : v);
    const { w, h } = DEFAULT_NOTE_SIZE;
    const x = Math.max(0, Math.min(s(at.x), page.size.w - w));
    const y = Math.max(0, Math.min(s(at.y), page.size.h - h));
    const id = uniqueId('note', notes.map((n) => n.id));
    notes.push({ id, text, x, y, w, h });
    return { ok: true, created: id };
  };
}

/**
 * メモの本文・色・文字の大きさを変える(指定した項目だけ)。color / fontSize に null を渡すと既定(テーマの色・標準の大きさ)へ戻す。
 * 複数のメモを同時に指定でき、どれか1つでも不正なら全体を取り消す。
 */
export function updateNotes(
  pageId: string,
  noteIds: readonly string[],
  patch: { text?: string; color?: string | null; fontSize?: number | null },
): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    if (noteIds.length === 0) return fail('invalid-value');
    if (patch.text !== undefined && patch.text.length > MAX_NOTE_LENGTH) return fail('invalid-value');
    if (typeof patch.color === 'string' && !isHexColor(patch.color)) return fail('invalid-value');
    if (typeof patch.fontSize === 'number' && !(Number.isFinite(patch.fontSize) && patch.fontSize >= MIN_NOTE_FONT && patch.fontSize <= MAX_NOTE_FONT)) {
      return fail('invalid-value');
    }
    for (const id of noteIds) {
      const note = page.notes?.find((n) => n.id === id);
      if (!note) return fail('unknown-note');
      if (patch.text !== undefined) note.text = patch.text;
      if (patch.color === null) delete note.color;
      else if (patch.color !== undefined) note.color = patch.color;
      if (patch.fontSize === null) delete note.fontSize;
      else if (patch.fontSize !== undefined) note.fontSize = Math.round(patch.fontSize);
    }
    return OK;
  };
}

/** メモを動かす(ドラッグ・矢印キー)。グリッドが有効なら丸め、ページの外へは出さない */
export function moveNotes(pageId: string, moves: readonly { id: string; x: number; y: number }[]): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    for (const m of moves) {
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return fail('invalid-value');
      if (!page.notes?.some((n) => n.id === m.id)) return fail('unknown-note');
    }
    const s = (v: number) => (doc.grid.enabled ? snap(v, doc.grid.size) : v);
    for (const m of moves) {
      const note = page.notes!.find((n) => n.id === m.id)!;
      note.x = Math.max(0, Math.min(s(m.x), page.size.w - note.w));
      note.y = Math.max(0, Math.min(s(m.y), page.size.h - note.h));
    }
    return OK;
  };
}

/** メモの箱の大きさ・位置を変える(ハンドルのドラッグ・パネルの数値)。最小より小さくはならず、ページの外へは出ない */
export function resizeNote(pageId: string, noteId: string, rect: { x: number; y: number; w: number; h: number }): Action {
  return (doc) => {
    const page = getPage(doc, pageId);
    if (!page) return fail('unknown-page');
    const note = page.notes?.find((n) => n.id === noteId);
    if (!note) return fail('unknown-note');
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return fail('invalid-value');
    const s = (v: number) => (doc.grid.enabled ? snap(v, doc.grid.size) : v);
    const w = Math.min(Math.max(s(rect.w), MIN_NOTE_SIZE.w), page.size.w);
    const h = Math.min(Math.max(s(rect.h), MIN_NOTE_SIZE.h), page.size.h);
    note.w = w;
    note.h = h;
    note.x = Math.max(0, Math.min(s(rect.x), page.size.w - w));
    note.y = Math.max(0, Math.min(s(rect.y), page.size.h - h));
    return OK;
  };
}
