import { dictionaries } from '../i18n';
import type { MessageKey } from '../i18n';
import { exceedsPortLimit, MAX_UNITS } from '../model/ports';
import { PRESETS } from '../model/presets';

// 機器一覧CSVの読み込み(解析・検証)。書き出し(csvExport.ts)と同じ形のCSVを、人が作って読み込む。
// 見出しは、書き出しと同じ正式な名前(日本語または英語)だけを受け付ける。別名・表記の揺れは受け付けない
// (黙って無視される列ができ、型番が空の機器が静かに作られる、といった失敗を防ぐため)。

export type DeviceCsvField = 'name' | 'model' | 'quantity' | 'kind' | 'ports' | 'place';

const FIELDS: readonly DeviceCsvField[] = ['name', 'model', 'quantity', 'kind', 'ports', 'place'];

/** 見出しの辞書キー(書き出しと同じ辞書。見出しの正本はi18nの辞書1か所) */
const HEADER_KEY: Record<DeviceCsvField, MessageKey> = {
  name: 'csv.name',
  model: 'csv.model',
  quantity: 'csv.quantity',
  kind: 'csv.kind',
  ports: 'csv.ports',
  place: 'csv.place',
};

/** CSVとして読み込むファイルの上限(バイト)。通常の機器表は数十KB。極端に大きなファイルで、メモリを使い切らないための上限 */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

/** CSVのデータ行の上限。ページに置ける機器の数(数百台)より十分に大きい値 */
export const MAX_CSV_ROWS = 10000;

/** 台数の上限(機器の台数の上限と同じ値) */
export const MAX_IMPORT_QUANTITY = MAX_UNITS;

/** 正式な見出し(日本語・英語)。列ごとに受け付ける名前 */
export function officialHeaders(): Record<DeviceCsvField, string[]> {
  const result = {} as Record<DeviceCsvField, string[]>;
  for (const f of FIELDS) result[f] = [dictionaries.ja[HEADER_KEY[f]], dictionaries.en[HEADER_KEY[f]]];
  return result;
}

/** 標準機器の名前(日本語・英語)→ 標準機器のID。種類の照合に使う(完全一致のみ) */
export function presetNameTable(): Map<string, string> {
  const table = new Map<string, string>();
  for (const p of PRESETS) {
    const key = `preset.${p.id}` as MessageKey;
    table.set(dictionaries.ja[key], p.id);
    table.set(dictionaries.en[key], p.id);
  }
  return table;
}

// ---------------------------------------------------------------------------
// 文字コード

export interface DecodedCsv {
  text: string;
  encoding: 'utf-8' | 'shift_jis';
  /** 文字化けの恐れがある(置換文字が含まれる) */
  garbled: boolean;
}

/**
 * CSVのバイト列を文字列にする。UTF-8(BOM付き含む)として読めればそれを使い、
 * 不正なバイト列なら Shift_JIS(日本語のExcelが「CSV」で保存する既定)として読む。
 */
export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'utf-8', garbled: text.includes('�') };
  } catch {
    const text = new TextDecoder('shift_jis').decode(bytes);
    return { text, encoding: 'shift_jis', garbled: text.includes('�') };
  }
}

// ---------------------------------------------------------------------------
// CSV解析

export interface CsvRecord {
  cells: string[];
  /** レコードが始まる行番号(1始まり。引用符の中の改行で、1レコードが複数行にまたがることがある) */
  line: number;
}

export type CsvParseResult = { ok: true; records: CsvRecord[] } | { ok: false; line: number };

/**
 * CSVを読む(RFC 4180 を基本に、Excelの書き出しに合わせる)。
 * 引用符で囲まれたセルは、区切り・改行・二重の引用符("")を含められる。改行は CRLF / LF / CR を受け付ける。
 * 引用符が閉じていなければ、その引用符が始まった行番号とともに失敗を返す。
 * 引用符で始まらないセルの途中にある引用符は、そのまま文字として扱う。
 */
export function parseCsv(input: string): CsvParseResult {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let quoteLine = 1;
  let line = 1;
  let recordLine = 1;
  let atCellStart = true;
  let recordHasContent = false;

  const endCell = () => {
    cells.push(cell);
    cell = '';
    atCellStart = true;
  };
  const endRecord = () => {
    endCell();
    records.push({ cells, line: recordLine });
    cells = [];
    recordHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        else if (ch === '\r' && text[i + 1] !== '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atCellStart) {
      inQuotes = true;
      quoteLine = line;
      atCellStart = false;
      recordHasContent = true;
    } else if (ch === ',') {
      recordHasContent = true;
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      cell += ch;
      atCellStart = false;
      recordHasContent = true;
    }
  }
  if (inQuotes) return { ok: false, line: quoteLine };
  if (recordHasContent || cell !== '' || cells.length > 0) endRecord();
  return { ok: true, records };
}

// ---------------------------------------------------------------------------
// 機器一覧の検証

/** 読み込んだ1行(検証済み)。種類は標準機器のIDへ解決済み(不明なら汎用機器) */
export interface DeviceRow {
  /** CSVの行番号(見出しを1行目とする) */
  line: number;
  name: string;
  model: string;
  quantity: number;
  presetId: string;
  /** CSVに書かれていた種類(警告・確認画面の表示用。空なら空) */
  kindText: string;
  place: string;
}

export type CsvImportError =
  | { code: 'empty-file' }
  | { code: 'unterminated-quote'; line: number }
  | { code: 'too-many-rows'; rows: number }
  | { code: 'header-no-name'; found: string[] }
  | { code: 'header-duplicate'; headers: string[] }
  | { code: 'row-name-empty'; line: number }
  | { code: 'row-quantity-invalid'; line: number; value: string }
  /** 台数ぶんのポートの合計が、1機器あたりの上限を超える */
  | { code: 'row-too-many-ports'; line: number; value: string }
  | { code: 'row-ports-invalid'; line: number; value: string };

export type CsvImportWarning =
  | { code: 'unknown-column'; header: string }
  | { code: 'unknown-kind'; line: number; value: string }
  /** 見出しより右にあるセル。最初の行番号と、該当する行数 */
  | { code: 'extra-cells'; line: number; rows: number };

export type DeviceCsvResult =
  | { ok: true; rows: DeviceRow[]; warnings: CsvImportWarning[] }
  | { ok: false; errors: CsvImportError[] };

/**
 * 書き出しが、表計算ソフトで数式として実行されないよう先頭に付けた印(' の次が = + - @ やタブ・復帰)を取り除く。
 * ' で始まるだけの普通の値は変えない。
 */
export function unescapeCsvCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

const isBlankRecord = (r: CsvRecord) => r.cells.every((c) => c.trim() === '');

/**
 * 機器一覧のCSVを検証して、行へ変換する。
 * - 1行目は見出し。正式な名前(日本語・英語)だけを受け付ける。必須は「名称」。列の順番は自由。
 * - 知らない見出しの列は、警告にして読み込まない(エラーにはしない。備考などのメモ列を残して使える)。
 * - 見出し・値にエラーがあれば、すべて集めて返す(1件でもあれば何も作らない)。
 */
export function parseDeviceCsv(text: string): DeviceCsvResult {
  const parsed = parseCsv(text);
  if (!parsed.ok) return { ok: false, errors: [{ code: 'unterminated-quote', line: parsed.line }] };
  const records = parsed.records.filter((r) => !isBlankRecord(r));
  if (records.length === 0) return { ok: false, errors: [{ code: 'empty-file' }] };

  // 見出し
  const [headerRecord, ...body] = records;
  const official = officialHeaders();
  const columnOf = new Map<DeviceCsvField, number>();
  const duplicated: string[] = [];
  const unknownColumns: number[] = [];
  const headers = headerRecord.cells.map((c) => c.trim());
  headers.forEach((h, index) => {
    const field = FIELDS.find((f) => official[f].includes(h));
    if (!field) {
      unknownColumns.push(index);
      return;
    }
    if (columnOf.has(field)) duplicated.push(h);
    else columnOf.set(field, index);
  });
  if (duplicated.length > 0) return { ok: false, errors: [{ code: 'header-duplicate', headers: [...new Set(duplicated)] }] };
  if (!columnOf.has('name')) return { ok: false, errors: [{ code: 'header-no-name', found: headers.filter((h) => h !== '') }] };

  const warnings: CsvImportWarning[] = [];
  const warnedHeaders = new Set<string>();
  for (const index of unknownColumns) {
    const header = headers[index];
    if (warnedHeaders.has(header)) continue; // 同じ見出しの列が複数あっても、警告は1件にまとめる
    warnedHeaders.add(header);
    // 見出しが空で、中身も空の列(行末の余分なカンマなど)は、無いものとして扱う
    if (header === '' && body.every((r) => (r.cells[index] ?? '').trim() === '')) continue;
    warnings.push({ code: 'unknown-column', header }); // header が空なら「見出しなし」の列(表示は画面側)
  }

  // 値
  if (body.length > MAX_CSV_ROWS) return { ok: false, errors: [{ code: 'too-many-rows', rows: body.length }] };
  const kinds = presetNameTable();
  const errors: CsvImportError[] = [];
  const rows: DeviceRow[] = [];
  let extraFirstLine = 0;
  let extraRows = 0;
  const cellOf = (r: CsvRecord, f: DeviceCsvField): string => {
    const index = columnOf.get(f);
    return index === undefined ? '' : unescapeCsvCell(r.cells[index] ?? '').trim();
  };
  for (const r of body) {
    if (r.cells.length > headers.length && r.cells.slice(headers.length).some((c) => c.trim() !== '')) {
      if (extraRows === 0) extraFirstLine = r.line;
      extraRows++;
    }
    const name = cellOf(r, 'name');
    if (name === '') {
      errors.push({ code: 'row-name-empty', line: r.line });
      continue;
    }
    const quantityText = cellOf(r, 'quantity');
    let quantity = 1;
    if (quantityText !== '') {
      quantity = /^[0-9]+$/.test(quantityText) ? Number(quantityText) : NaN;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_IMPORT_QUANTITY) {
        errors.push({ code: 'row-quantity-invalid', line: r.line, value: quantityText });
        continue;
      }
    }
    const kindForLimit = kinds.get(cellOf(r, 'kind')) ?? 'generic';
    const presetGroups = PRESETS.find((p) => p.id === kindForLimit)?.portGroups ?? [];
    if (exceedsPortLimit(presetGroups, quantity)) {
      errors.push({ code: 'row-too-many-ports', line: r.line, value: String(quantity) });
      continue;
    }
    const portsText = cellOf(r, 'ports');
    if (portsText !== '' && !/^[0-9]+$/.test(portsText)) {
      errors.push({ code: 'row-ports-invalid', line: r.line, value: portsText });
      continue;
    }
    const kindText = cellOf(r, 'kind');
    let presetId = 'generic';
    if (kindText !== '') {
      const found = kinds.get(kindText);
      if (found) presetId = found;
      else warnings.push({ code: 'unknown-kind', line: r.line, value: kindText });
    }
    rows.push({ line: r.line, name, model: cellOf(r, 'model'), quantity, presetId, kindText, place: cellOf(r, 'place') });
  }
  if (errors.length > 0) return { ok: false, errors };
  if (extraRows > 0) warnings.push({ code: 'extra-cells', line: extraFirstLine, rows: extraRows });
  if (rows.length === 0) return { ok: false, errors: [{ code: 'empty-file' }] };
  return { ok: true, rows, warnings };
}
