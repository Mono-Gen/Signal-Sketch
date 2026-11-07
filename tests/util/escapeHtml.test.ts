import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../src/util/escapeHtml';

describe('escapeHtml', () => {
  it('HTMLとして意味を持つ文字を無害化する', () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml(`a & b`)).toBe('a &amp; b');
    expect(escapeHtml(`it's`)).toBe('it&#39;s');
  });

  it('&を最初に処理するので、二重にエスケープされない', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('通常の文字(日本語・型番・記号)はそのまま', () => {
    expect(escapeHtml('天井スピーカ Model-B1 98"')).toBe('天井スピーカ Model-B1 98&quot;');
  });
});
