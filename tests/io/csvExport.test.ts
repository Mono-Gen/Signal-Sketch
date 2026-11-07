import { describe, expect, it } from 'vitest';
import { buildDeviceCsv, csvCell } from '../../src/io/csvExport';
import { addNodeFromTemplate, updateNode } from '../../src/model/actions';
import { createEmptyDocument } from '../../src/model/defaults';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { createSampleDocument } from '../fixtures/sampleDocument';

const H = { name: '名称', model: '型番', quantity: '台数', kind: '種類', ports: 'ポート数', place: '場所' };
const cam = presetToTemplate(PRESETS.find((p) => p.id === 'camera')!, 'カメラ');

describe('csvCell', () => {
  it('区切り・引用符・改行を含む値は引用符で囲み、引用符を二重にする', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });
  it('普通の値はそのまま', () => {
    expect(csvCell('Model-E1')).toBe('Model-E1');
    expect(csvCell('')).toBe('');
  });
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx'])('数式として実行されうる値 %j は先頭に引用符を付ける', (v) => {
    expect(csvCell(v).startsWith("'") || csvCell(v).startsWith('"\'')).toBe(true);
  });
});

describe('buildDeviceCsv', () => {
  it('空の図は見出し行だけ', () => {
    expect(buildDeviceCsv(createEmptyDocument(), H)).toBe('名称,型番,台数,種類,ポート数,場所\r\n');
  });

  it('同じ名称・型番・種類の機器は1行にまとめて台数を合計する', () => {
    const doc = createEmptyDocument();
    addNodeFromTemplate('page-1', cam, 'PTZ Camera')(doc);
    addNodeFromTemplate('page-1', cam, 'PTZ Camera')(doc);
    const ids = doc.pages[0].nodes.map((n) => n.id);
    updateNode('page-1', ids[0], { model: 'Model-J1', count: 2 })(doc);
    updateNode('page-1', ids[1], { model: 'Model-J1' })(doc); // 台数の記載なしは1台
    const lines = buildDeviceCsv(doc, H).trim().split('\r\n');
    expect(lines).toEqual(['名称,型番,台数,種類,ポート数,場所', 'PTZ Camera,Model-J1,3,カメラ,2,']);
  });

  it('型番が違えば別の行になる', () => {
    const doc = createEmptyDocument();
    addNodeFromTemplate('page-1', cam, 'Camera')(doc);
    addNodeFromTemplate('page-1', cam, 'Camera')(doc);
    updateNode('page-1', doc.pages[0].nodes[0].id, { model: 'A' })(doc);
    updateNode('page-1', doc.pages[0].nodes[1].id, { model: 'B' })(doc);
    expect(buildDeviceCsv(doc, H).trim().split('\r\n')).toHaveLength(3);
  });

  it('機器名に数式風の文字列があっても、数式として出力されない', () => {
    const doc = createEmptyDocument();
    addNodeFromTemplate('page-1', cam, '=HYPERLINK("x")')(doc);
    expect(buildDeviceCsv(doc, H)).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('サンプル図: 全機器の台数合計が、機器ごとの台数(無記載は1)の合計に一致する', () => {
    const doc = createSampleDocument();
    const expected = doc.pages[0].nodes.reduce((s, n) => s + (n.count ?? 1), 0);
    const lines = buildDeviceCsv(doc, H).trim().split('\r\n').slice(1);
    const total = lines.reduce((s, l) => s + Number(l.match(/,(\d+),[^,]*,\d+,[^,]*$/)![1]), 0);
    expect(total).toBe(expected);
  });
});
