import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { createSampleDocument } from '../fixtures/sampleDocument';

describe('fileIo', () => {
  it('保存して読み込むと、同じドキュメントに戻る(ラウンドトリップ)', () => {
    const doc = createSampleDocument();
    const r = parseDocument(serializeDocument(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toEqual(doc);
  });

  it('JSONとして不正なテキストは、構文エラーとして返す(例外にしない)', () => {
    const r = parseDocument('{ not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('JSON');
  });

  it('JSONでも形式が違えば、検証エラーとして返す', () => {
    const r = parseDocument(JSON.stringify({ hello: 'world' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('format');
  });

  it('参照が壊れたドキュメントは拒否する', () => {
    const doc = createSampleDocument();
    doc.pages[0].edges[0].to.nodeId = 'ghost';
    const r = parseDocument(serializeDocument(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('ghost');
  });
});
