import { t } from '../i18n';
import { MAX_CSV_ROWS } from '../io/csvImport';
import type { CsvImportError, CsvImportWarning } from '../io/csvImport';

// 機器一覧CSVの読み込みで出す文言(エラー・警告)。解析側(csvImport.ts)は言語を持たず、ここで画面の言語に直す。

/** エラーや警告を並べるとき、読み切れる件数で打ち切る */
const MAX_ERRORS_SHOWN = 3;
const MAX_WARNINGS_SHOWN = 8;

function errorText(e: CsvImportError): string {
  switch (e.code) {
    case 'empty-file':
      return t('import.error.emptyFile');
    case 'too-many-rows':
      return t('import.error.tooManyRows', { rows: e.rows, max: MAX_CSV_ROWS });
    case 'unterminated-quote':
      return t('import.error.unterminatedQuote', { line: e.line });
    case 'header-no-name':
      return t('import.error.headerNoName', { found: e.found.length > 0 ? e.found.join(' / ') : '-' });
    case 'header-duplicate':
      return t('import.error.headerDuplicate', { headers: e.headers.join(t('list.separator')) });
    case 'row-name-empty':
      return t('import.error.rowName', { line: e.line });
    case 'row-quantity-invalid':
      return t('import.error.rowQuantity', { line: e.line, value: e.value });
    case 'row-too-many-ports':
      return t('import.error.rowTooManyPorts', { line: e.line, value: e.value });
    case 'row-ports-invalid':
      return t('import.error.rowPorts', { line: e.line, value: e.value });
  }
}

/** 読み込めなかった理由(先頭の数件+件数)を、右上の状態表示に出す1つの文にする */
export function formatImportErrors(errors: readonly CsvImportError[]): string {
  const shown = errors.slice(0, MAX_ERRORS_SHOWN).map(errorText).join(' / ');
  const rest = errors.length - MAX_ERRORS_SHOWN;
  return t('import.error.prefix', { reasons: rest > 0 ? t('list.more', { names: shown, count: rest }) : shown });
}

function warningText(w: CsvImportWarning): string {
  switch (w.code) {
    case 'unknown-column':
      return w.header === '' ? t('import.warn.noHeaderColumn') : t('import.warn.unknownColumn', { header: w.header });
    case 'unknown-kind':
      return t('import.warn.unknownKind', { line: w.line, value: w.value });
    case 'extra-cells':
      return t('import.warn.extraCells', { line: w.line, rows: w.rows });
  }
}

export interface ImportNotes {
  shiftJis: boolean;
  garbled: boolean;
  /** ページに収まらず置けない機器の名称 */
  unplaced: readonly string[];
}

/** 確認の画面に出す警告の行(読み込みは止めない確認事項)。多いときは先頭の数件+件数 */
export function formatImportWarnings(warnings: readonly CsvImportWarning[], notes: ImportNotes): string[] {
  const lines: string[] = [];
  if (notes.garbled) lines.push(t('import.warn.garbled'));
  else if (notes.shiftJis) lines.push(t('import.warn.shiftJis'));
  for (const w of warnings) lines.push(warningText(w));
  if (notes.unplaced.length > 0) {
    const shown = notes.unplaced.slice(0, 3).join(t('list.separator'));
    const rest = notes.unplaced.length - 3;
    lines.push(t('import.warn.unplaced', { names: rest > 0 ? t('list.more', { names: shown, count: rest }) : shown }));
  }
  if (lines.length <= MAX_WARNINGS_SHOWN) return lines;
  const rest = lines.length - MAX_WARNINGS_SHOWN;
  return [...lines.slice(0, MAX_WARNINGS_SHOWN), t('list.more', { names: '…', count: rest })];
}

/** 確認の画面に差し込む、警告の部分(警告が無ければ空) */
export function warningsBlock(lines: readonly string[]): string {
  return lines.length === 0 ? '' : t('import.warnTitle') + '\n' + lines.map((l) => `・${l}`).join('\n');
}
