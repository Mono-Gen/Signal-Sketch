import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/io/fileIo';
import { createSampleDocument } from '../fixtures/sampleDocument';
import text from '../../docs/sample_diagram.json?raw';

// docs/sample_diagram.json は、利用者に配るサンプルの図。アプリ内のサンプルとずれると、
// 説明と画面が食い違うため、内容が一致していることをここで固定する。
// 更新するときは、アプリを ?debug=1 で開き、window.__app.store.doc を JSON で書き出し直す。
describe('docs/sample_diagram.json', () => {
  it('アプリの読み込み処理(検証つき)で、そのまま開ける', () => {
    expect(parseDocument(text).ok).toBe(true);
  });

  it('アプリ内のサンプルの図と、内容が一致する', () => {
    const r = parseDocument(text);
    if (!r.ok) throw new Error(r.errors.join(' / '));
    const sample = createSampleDocument();
    sample.signalTypes = sample.signalTypes.filter((signal) => signal.id !== 'SERIAL');
    expect(r.doc).toEqual(sample);
  });
});
