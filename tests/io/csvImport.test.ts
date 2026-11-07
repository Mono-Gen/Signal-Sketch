import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, MAX_CSV_ROWS, MAX_IMPORT_QUANTITY, officialHeaders, parseCsv, parseDeviceCsv, presetNameTable, unescapeCsvCell } from '../../src/io/csvImport';
import { csvCell } from '../../src/io/csvExport';

const cells = (text: string) => {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(`parse failed at line ${r.line}`);
  return r.records.map((x) => x.cells);
};

describe('parseCsv', () => {
  it('カンマ区切り・CRLF・LF・CR のどれでも読める。末尾の改行は空の行にしない', () => {
    expect(cells('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(cells('a,b\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(cells('a,b\rc,d\r')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(cells('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('引用符で囲まれたセルは、区切り・改行・二重の引用符を含められる', () => {
    expect(cells('"a,b","c""d","e\nf"\n')).toEqual([['a,b', 'c"d', 'e\nf']]);
  });

  it('空のセル・行末の余分なカンマを保つ', () => {
    expect(cells('a,,c,\n')).toEqual([['a', '', 'c', '']]);
  });

  it('先頭のBOMを取り除く', () => {
    expect(cells('﻿a,b\n')).toEqual([['a', 'b']]);
  });

  it('引用符で始まらないセルの途中の引用符は、そのまま文字として扱う', () => {
    expect(cells('a"b,c\n')).toEqual([['a"b', 'c']]);
  });

  it('レコードの行番号は、引用符の中の改行を数えて進む', () => {
    const r = parseCsv('h\n"x\ny",1\nz,2\n');
    expect(r.ok && r.records.map((x) => x.line)).toEqual([1, 2, 4]);
  });

  it('引用符が閉じていなければ、その引用符が始まった行番号で失敗する', () => {
    expect(parseCsv('a,b\nc,"d\ne')).toEqual({ ok: false, line: 2 });
  });

  it('書き出し(csvCell)の出力を、元の値のまま読み戻せる', () => {
    const values = ['plain', 'a,b', 'say "hi"', 'line1\nline2', '日本語', ''];
    const line = values.map(csvCell).join(',') + '\r\n';
    expect(cells(line)).toEqual([values]);
  });
});

describe('unescapeCsvCell', () => {
  it.each([
    ["'=1+1", '=1+1'],
    ["'+81", '+81'],
    ["'-x", '-x'],
    ["'@a", '@a'],
    ["'abc", "'abc"], // ' で始まるだけの普通の値は変えない
    ["'", "'"],
    ['=x', '=x'],
    ['普通', '普通'],
  ])('%j → %j', (input, expected) => {
    expect(unescapeCsvCell(input)).toBe(expected);
  });

  it('書き出しが付けた印を取り除くと、元の値に戻る', () => {
    for (const v of ['=SUM(A1)', '+1', '-1', '@x', 'normal']) {
      expect(unescapeCsvCell(csvCell(v).replace(/^"|"$/g, ''))).toBe(v);
    }
  });
});

describe('decodeCsvBytes: 文字コード', () => {
  const utf8 = (s: string) => new TextEncoder().encode(s);

  it('UTF-8 をそのまま読む', () => {
    const d = decodeCsvBytes(utf8('名称,型番\n'));
    expect(d).toEqual({ text: '名称,型番\n', encoding: 'utf-8', garbled: false });
  });

  it('BOM付きUTF-8のBOMを取り除く', () => {
    const d = decodeCsvBytes(utf8('﻿名称\n'));
    expect(d.text).toBe('名称\n');
    expect(d.encoding).toBe('utf-8');
  });

  it('UTF-8 として不正なら Shift_JIS として読む(「名称」「型番」のバイト列)', () => {
    // Shift_JIS: 名称 = 96 BC 8F CC, 型番 = 8C 5E 94 D4
    const bytes = new Uint8Array([0x96, 0xbc, 0x8f, 0xcc, 0x2c, 0x8c, 0x5e, 0x94, 0xd4, 0x0d, 0x0a]);
    const d = decodeCsvBytes(bytes);
    expect(d.encoding).toBe('shift_jis');
    expect(d.text).toBe('名称,型番\r\n');
    expect(d.garbled).toBe(false);
  });

  it('ASCII だけなら UTF-8 として読む', () => {
    expect(decodeCsvBytes(utf8('Name,Model\n')).encoding).toBe('utf-8');
  });
});

describe('officialHeaders / presetNameTable', () => {
  it('正式な見出しは、日本語と英語の2通りだけ(書き出しと同じ辞書)', () => {
    const h = officialHeaders();
    expect(h.name).toEqual(['名称', 'Name']);
    expect(h.model).toEqual(['型番', 'Model']);
    expect(h.quantity).toEqual(['台数', 'Quantity']);
    expect(h.kind).toEqual(['種類', 'Type']);
    expect(h.ports).toEqual(['ポート数', 'Ports']);
    expect(h.place).toEqual(['場所', 'Location']);
  });

  it('標準機器の名前(日英)から機器のIDを引ける。完全一致のみ', () => {
    const t = presetNameTable();
    expect(t.get('カメラ')).toBe('camera');
    expect(t.get('Camera')).toBe('camera');
    expect(t.get('スイッチ')).toBe('switch');
    expect(t.get('Switch')).toBe('switch');
    expect(t.get('スイッチ 8ポート')).toBeUndefined(); // 8/16/24/48ポートの別々の標準は無い(ポート数の列で指定する)
    expect(t.get('camera')).toBeUndefined(); // 大文字小文字は区別する
    expect(t.get('カメラ ')).toBeUndefined();
  });
});

describe('parseDeviceCsv: スイッチのポート数', () => {
  const rows = (text: string) => {
    const r = parseDeviceCsv(text);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.rows;
  };
  const head = '名称,台数,種類,ポート数\n';

  it('スイッチの行は、ポート数の列をLANポート数として持つ', () => {
    expect(rows(head + 'SW,1,スイッチ,24\n')[0].ports).toBe(24);
  });

  it('ポート数が空・0のスイッチ、スイッチ以外の種類では、ポート数は使わない(標準のまま)', () => {
    const r = rows(head + 'A,1,スイッチ,\nB,1,スイッチ,0\nC,1,カメラ,24\nD,1,,5\n');
    expect(r.map((x) => x.ports)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('ポート数が整数でなければ従来どおりエラー', () => {
    const r = parseDeviceCsv(head + 'SW,1,スイッチ,abc\n');
    expect(r.ok).toBe(false);
  });
});

describe('parseDeviceCsv: 見出し', () => {
  const ok = (text: string) => {
    const r = parseDeviceCsv(text);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r;
  };

  it('日本語の見出しで読める', () => {
    const r = ok('名称,型番,台数,種類,ポート数,場所\r\nカメラA,Model-1,2,カメラ,2,会議室\r\n');
    expect(r.rows).toEqual([{ line: 2, name: 'カメラA', model: 'Model-1', quantity: 2, presetId: 'camera', kindText: 'カメラ', place: '会議室' }]);
    expect(r.warnings).toEqual([]);
  });

  it('英語の見出しで読める。日英の混在も読める(列ごとに正式な名前であればよい)', () => {
    const en = ok('Name,Model,Quantity,Type,Ports,Location\nCam,M1,3,Camera,2,Room\n');
    expect(en.rows[0]).toMatchObject({ name: 'Cam', model: 'M1', quantity: 3, presetId: 'camera', place: 'Room' });
    const mixed = ok('名称,Model\nX,Y\n');
    expect(mixed.rows[0]).toMatchObject({ name: 'X', model: 'Y' });
  });

  it('列の順番は自由。名称だけでも読める(台数は1、種類は汎用機器、場所は空)', () => {
    const r = ok('場所,名称\nRoom,Dev\n');
    expect(r.rows[0]).toMatchObject({ name: 'Dev', model: '', quantity: 1, presetId: 'generic', kindText: '', place: 'Room' });
    expect(r.warnings).toEqual([]);
  });

  it('見出しの前後の空白とBOMは取り除く', () => {
    expect(ok('﻿ 名称 , 型番 \nA,B\n').rows[0]).toMatchObject({ name: 'A', model: 'B' });
  });

  it('別名・表記の揺れは受け付けない(「名称」が見つからないエラー)', () => {
    for (const header of ['機器', '機器名', 'モデル', 'name', 'NAME', '名称 ', '名 称']) {
      const r = parseDeviceCsv(`${header},型番\nA,B\n`);
      // 前後の空白だけは取り除くので、'名称 ' は正式な見出しとして通る
      if (header === '名称 ') expect(r.ok).toBe(true);
      else expect(r).toEqual({ ok: false, errors: [{ code: 'header-no-name', found: [header, '型番'] }] });
    }
  });

  it('同じ列が2回(日英どちらでも)あるときはエラー', () => {
    expect(parseDeviceCsv('名称,Name\nA,B\n')).toEqual({ ok: false, errors: [{ code: 'header-duplicate', headers: ['Name'] }] });
    expect(parseDeviceCsv('名称,型番,型番\nA,B,C\n')).toEqual({ ok: false, errors: [{ code: 'header-duplicate', headers: ['型番'] }] });
  });

  it('知らない見出しの列は、警告にして読み込まない(エラーにしない)', () => {
    const r = ok('名称,備考,型式\nA,メモ,X\n');
    expect(r.rows[0]).toMatchObject({ name: 'A', model: '' }); // 「型式」は型番として読まれない
    expect(r.warnings).toEqual([
      { code: 'unknown-column', header: '備考' },
      { code: 'unknown-column', header: '型式' },
    ]);
  });

  it('見出しが空で中身も空の列(行末の余分なカンマ)は、警告にしない。中身があれば警告する', () => {
    expect(ok('名称,\nA,\n').warnings).toEqual([]);
    expect(ok('名称,\nA,x\n').warnings).toEqual([{ code: 'unknown-column', header: '' }]);
  });

  it('見出しより右にある中身のあるセルは、警告にする(最初の行番号と行数)', () => {
    const r = ok('名称\nA,x\nB\nC,y\n');
    expect(r.warnings).toEqual([{ code: 'extra-cells', line: 2, rows: 2 }]);
  });

  it('空のCSV・空行だけ・見出しだけは、エラー', () => {
    expect(parseDeviceCsv('')).toEqual({ ok: false, errors: [{ code: 'empty-file' }] });
    expect(parseDeviceCsv('\r\n\r\n')).toEqual({ ok: false, errors: [{ code: 'empty-file' }] });
    expect(parseDeviceCsv('名称,型番\r\n')).toEqual({ ok: false, errors: [{ code: 'empty-file' }] });
  });

  it('引用符が閉じていないCSVはエラー', () => {
    expect(parseDeviceCsv('名称\n"A\n')).toEqual({ ok: false, errors: [{ code: 'unterminated-quote', line: 2 }] });
  });

  it('見出しの前の空行は読み飛ばす', () => {
    expect(ok('\r\n名称\r\nA\r\n').rows[0].name).toBe('A');
  });
});

describe('parseDeviceCsv: 値', () => {
  const run = (rows: string[]) => parseDeviceCsv(['名称,型番,台数,種類,ポート数,場所', ...rows].join('\n') + '\n');

  it('名称が空の行は、行番号つきのエラー(空白だけも同じ)', () => {
    expect(run(['A,,,,,', ',M,,,,', '  ,M,,,,'])).toEqual({
      ok: false,
      errors: [
        { code: 'row-name-empty', line: 3 },
        { code: 'row-name-empty', line: 4 },
      ],
    });
  });

  it.each(['0', '-1', '1.5', 'abc', '１', '1e2', String(MAX_IMPORT_QUANTITY + 1), '99999'])('台数「%s」はエラー', (q) => {
    expect(run([`A,,${q},,,`])).toEqual({ ok: false, errors: [{ code: 'row-quantity-invalid', line: 2, value: q }] });
  });

  it.each([
    ['', 1],
    ['1', 1],
    ['01', 1],
    ['6', 6],
    [String(MAX_IMPORT_QUANTITY), MAX_IMPORT_QUANTITY],
  ])('台数「%s」は %i 台', (q, expected) => {
    const r = run([`A,,${q},,,`]);
    expect(r.ok && r.rows[0].quantity).toBe(expected);
  });

  it.each(['-1', '2.5', 'x'])('ポート数「%s」はエラー。空と整数は通る', (p) => {
    expect(run([`A,,,,${p},`])).toEqual({ ok: false, errors: [{ code: 'row-ports-invalid', line: 2, value: p }] });
    expect(run(['A,,,,,']).ok).toBe(true);
    expect(run(['A,,,,0,']).ok).toBe(true);
  });

  it('エラーが複数あれば、すべて集める(1件でもあれば何も返さない)', () => {
    const r = run(['A,,0,,,', ',M,,,,', 'C,,,,x,']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(['row-quantity-invalid', 'row-name-empty', 'row-ports-invalid']);
  });

  it('種類は標準機器の名前(日英)と完全一致で解決する。不明な種類は汎用機器にして警告', () => {
    const r = run(['A,,,カメラ,,', 'B,,,Camera,,', 'C,,,カメラー,,', 'D,,,camera,,', 'E,,,,,']);
    if (!r.ok) throw new Error('unexpected');
    expect(r.rows.map((x) => x.presetId)).toEqual(['camera', 'camera', 'generic', 'generic', 'generic']);
    expect(r.warnings).toEqual([
      { code: 'unknown-kind', line: 4, value: 'カメラー' },
      { code: 'unknown-kind', line: 5, value: 'camera' },
    ]);
  });

  it("書き出しが付けた ' の印を、名称・型番・種類・場所から取り除く", () => {
    const r = run(["'=A,'+B,,,,'@Room"]);
    expect(r.ok && r.rows[0]).toMatchObject({ name: '=A', model: '+B', place: '@Room' });
  });

  it('空行は読み飛ばし、行番号は物理的な行を指す', () => {
    const r = run(['A,,,,,', '', 'B,,,,,']);
    expect(r.ok && r.rows.map((x) => [x.name, x.line])).toEqual([['A', 2], ['B', 4]]);
  });

  it('セルの前後の空白は取り除く。引用符つきのカンマ入りの名称も読める', () => {
    const r = parseDeviceCsv('名称,型番\n" A, B ", M \n');
    expect(r.ok && r.rows[0]).toMatchObject({ name: 'A, B', model: 'M' });
  });

  it('セルの前後の空白は無視する(種類・台数も)。全角の違い・大文字小文字は区別する', () => {
    const csv = ['名称,台数,種類', 'A, 2 ,カメラ ', 'B,,Camera', 'C,,camera', 'D,,ｶﾒﾗ'].join('\n') + '\n';
    const r = parseDeviceCsv(csv);
    if (!r.ok) throw new Error('unexpected');
    expect(r.rows.map((x) => [x.quantity, x.presetId])).toEqual([[2, 'camera'], [1, 'camera'], [1, 'generic'], [1, 'generic']]);
    expect(r.warnings.map((w) => (w.code === 'unknown-kind' ? w.value : ''))).toEqual(['camera', 'ｶﾒﾗ']);
  });

  it('同じ知らない見出しの列が複数あっても、警告は1件', () => {
    const r = parseDeviceCsv('名称,備考,備考\nA,x,y\n');
    expect(r.ok && r.warnings).toEqual([{ code: 'unknown-column', header: '備考' }]);
  });

  it('数式として始まる文字列(=で始まる名称)も、そのままの文字として読む(実行されることはない)', () => {
    const r = parseDeviceCsv('名称\n=HYPERLINK("x")\n');
    expect(r.ok && r.rows[0].name).toBe('=HYPERLINK("x")');
  });
});

describe('parseDeviceCsv: 行数の上限', () => {
  const rows = (n: number) => '名称\n' + Array.from({ length: n }, (_, i) => `D${i}`).join('\n') + '\n';

  it('上限ちょうどは読め、1行超えたらエラー(行数だけを示す)', () => {
    expect(parseDeviceCsv(rows(MAX_CSV_ROWS)).ok).toBe(true);
    expect(parseDeviceCsv(rows(MAX_CSV_ROWS + 1))).toEqual({ ok: false, errors: [{ code: 'too-many-rows', rows: MAX_CSV_ROWS + 1 }] });
  });

  it('上限の行数でも、すぐに終わる(固まらない)', () => {
    const t = Date.now();
    parseDeviceCsv(rows(MAX_CSV_ROWS));
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
