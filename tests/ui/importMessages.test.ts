import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLanguage, setLanguage } from '../../src/i18n';
import type { CsvImportError, CsvImportWarning } from '../../src/io/csvImport';
import { formatImportErrors, formatImportWarnings, warningsBlock } from '../../src/ui/importMessages';

let saved: ReturnType<typeof getLanguage>;
beforeEach(() => {
  saved = getLanguage();
  setLanguage('ja');
});
afterEach(() => setLanguage(saved));

const none = { shiftJis: false, garbled: false, unplaced: [] as string[] };

describe('formatImportErrors', () => {
  it('見出しのエラーは、見つかった見出しと、どうすればよいかを含む', () => {
    const text = formatImportErrors([{ code: 'header-no-name', found: ['機器', '型番'] }]);
    expect(text).toContain('機器 / 型番');
    expect(text).toContain('名称');
    expect(text).toContain('先頭行');
  });

  it('見出しのエラーには、使える見出しの一覧(日本語・英語)も含む。重複のエラーにも、直し方がある', () => {
    for (const e of [{ code: 'header-no-name', found: ['機器'] }, { code: 'header-duplicate', headers: ['型番'] }] as CsvImportError[]) {
      const text = formatImportErrors([e]);
      for (const h of ['名称', '型番', '台数', '種類', 'ポート数', '場所', 'Name', 'Model', 'Quantity', 'Type', 'Ports', 'Location']) expect(text, h).toContain(h);
      expect(text).toContain('先頭行');
    }
  });

  it('値のエラーは、行番号と値を含む', () => {
    const text = formatImportErrors([{ code: 'row-quantity-invalid', line: 7, value: '1.5' }]);
    expect(text).toContain('行 7');
    expect(text).toContain('1.5');
  });

  it('多いときは先頭の3件と、残りの件数にする', () => {
    const errors: CsvImportError[] = Array.from({ length: 10 }, (_, i) => ({ code: 'row-name-empty', line: i + 2 }));
    const text = formatImportErrors(errors);
    expect(text).toContain('行 2');
    expect(text).toContain('行 4');
    expect(text).not.toContain('行 5:');
    expect(text).toContain('ほか7件');
  });

  it('英語でも出る', () => {
    setLanguage('en');
    expect(formatImportErrors([{ code: 'empty-file' }])).toContain('empty');
  });
});

describe('formatImportWarnings', () => {
  it('警告が無ければ空。確認の画面の警告部分も空になる', () => {
    expect(formatImportWarnings([], none)).toEqual([]);
    expect(warningsBlock([])).toBe('');
  });

  it('知らない列・不明な種類・見出しなしの列・文字コードを、それぞれの文言にする', () => {
    const w: CsvImportWarning[] = [
      { code: 'unknown-column', header: '備考' },
      { code: 'unknown-column', header: '' },
      { code: 'unknown-kind', line: 5, value: 'カメラー' },
      { code: 'extra-cells', line: 3, rows: 2 },
    ];
    const lines = formatImportWarnings(w, { shiftJis: true, garbled: false, unplaced: ['A', 'B'] });
    expect(lines[0]).toContain('Shift_JIS');
    expect(lines.some((l) => l.includes('備考'))).toBe(true);
    expect(lines.some((l) => l.includes('見出しなし'))).toBe(true);
    expect(lines.some((l) => l.includes('カメラー') && l.includes('行 5'))).toBe(true);
    expect(lines.some((l) => l.includes('行 3') && l.includes('2 行'))).toBe(true);
    expect(lines.at(-1)).toContain('A、B');
  });

  it('文字化けの恐れがあるときは、Shift_JIS の通知の代わりに化けの警告だけを出す', () => {
    const lines = formatImportWarnings([], { shiftJis: true, garbled: true, unplaced: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('文字化け');
  });

  it('警告が多いときは、先頭の8件と残りの件数にする。置けない機器も3件+件数', () => {
    const w: CsvImportWarning[] = Array.from({ length: 12 }, (_, i) => ({ code: 'unknown-kind', line: i + 2, value: `k${i}` }));
    const lines = formatImportWarnings(w, none);
    expect(lines).toHaveLength(9);
    expect(lines[8]).toContain('ほか4件');
    const unplaced = formatImportWarnings([], { ...none, unplaced: ['a', 'b', 'c', 'd', 'e'] });
    expect(unplaced[0]).toContain('a、b、c ほか2件');
  });

  it('確認の画面の警告部分は、見出しと「・」つきの行になる', () => {
    expect(warningsBlock(['x', 'y'])).toBe('\n\n確認事項:\n・x\n・y');
  });
});
