import { describe, expect, it } from 'vitest';
import { dictionaries } from '../../src/i18n';
import type { MessageKey } from '../../src/i18n';
import { buildDeviceCsv } from '../../src/io/csvExport';
import { parseDeviceCsv } from '../../src/io/csvImport';
import { addNodeFromTemplate, setPageSize } from '../../src/model/actions';
import { createEmptyDocument } from '../../src/model/defaults';
import { addFrame, frameOfNode } from '../../src/model/frames';
import { importDevices } from '../../src/model/importDevices';
import type { ImportRow } from '../../src/model/importDevices';
import { getNodePorts } from '../../src/model/query';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { validateDocument } from '../../src/model/validate';
import { DocumentStore } from '../../src/state/store';
import sampleCsv from '../../docs/sample_devices.csv?raw';

const P = 'page-1';
// アプリと同じく、機器の名前は画面の言語(ここでは日本語)の標準機器の名前を使う
const options = { templateFor: (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, dictionaries.ja[`preset.${id}` as MessageKey]) };
const row = (name: string, extra: Partial<ImportRow> = {}): ImportRow => ({ name, model: '', quantity: 1, presetId: 'generic', place: '', ...extra });
const rect = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
const overlap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('importDevices: 追加と配置', () => {
  it('機器を追加し、名称・型番・台数・種類が入る。台数が2以上は1つの機器の台数、1なら台数表記なし', () => {
    const doc = createEmptyDocument();
    const r = importDevices(P, [row('Cam', { model: 'M1', quantity: 3, presetId: 'camera' }), row('Sw', { presetId: 'switch' })], options)(doc);
    expect(r.ok).toBe(true);
    const [cam, sw] = doc.pages[0].nodes;
    expect(cam).toMatchObject({ label: 'Cam', model: 'M1', count: 3, templateId: 'preset-camera' });
    expect(sw).toMatchObject({ label: 'Sw', model: '', templateId: 'preset-switch' });
    expect(sw.count).toBeUndefined();
    expect(getNodePorts(doc, cam).filter((p) => p.unit === 3).length).toBeGreaterThan(0); // 台数ぶんのポートが付く
    expect(r.createdNodeIds).toEqual(doc.pages[0].nodes.map((n) => n.id));
  });

  it('場所が同じ機器を1つの枠にまとめ、枠の中へ置く。場所が空の機器は枠の外', () => {
    const doc = createEmptyDocument();
    const r = importDevices(P, [row('A', { place: '会議室' }), row('B', { place: '機器室' }), row('C', { place: '会議室' }), row('D')], options)(doc);
    expect(r.ok).toBe(true);
    const page = doc.pages[0];
    expect(page.groups.map((g) => g.label)).toEqual(['会議室', '機器室']); // 出現順
    const place = (label: string) => frameOfNode(page, page.nodes.find((n) => n.label === label)!)?.label;
    expect(place('A')).toBe('会議室');
    expect(place('C')).toBe('会議室');
    expect(place('B')).toBe('機器室');
    expect(place('D')).toBeUndefined();
    expect(r.createdFrameIds).toHaveLength(2);
  });

  it('枠と機器は、互いに重ならず、ページの中に収まる(枠どうし・枠なしの機器とも)', () => {
    const doc = createEmptyDocument();
    const rows = ['R1', 'R2', 'R3'].flatMap((place) => ['a', 'b', 'c', 'd', 'e'].map((n) => row(`${place}-${n}`, { place, presetId: 'camera' })));
    rows.push(row('free1'), row('free2'));
    expect(importDevices(P, rows, options)(doc).ok).toBe(true);
    const page = doc.pages[0];
    const everything = [...page.groups.map((g) => ({ ...rect(g), what: `frame ${g.label}` })), ...page.nodes.filter((n) => !frameOfNode(page, n)).map((n) => ({ ...rect(n), what: n.label }))];
    for (let i = 0; i < everything.length; i++) {
      for (let j = i + 1; j < everything.length; j++) {
        expect(overlap(everything[i], everything[j]), `${everything[i].what} と ${everything[j].what}`).toBe(false);
      }
    }
    for (const n of page.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(page.size.w);
      expect(n.y + n.h).toBeLessThanOrEqual(page.size.h);
    }
    for (const n of page.nodes.filter((x) => x.label.startsWith('R'))) {
      const f = frameOfNode(page, n)!;
      // 機器全体が、所属する枠の中に入っている(中心だけでなく)
      expect(n.x).toBeGreaterThanOrEqual(f.x);
      expect(n.y).toBeGreaterThanOrEqual(f.y);
      expect(n.x + n.w).toBeLessThanOrEqual(f.x + f.w);
      expect(n.y + n.h).toBeLessThanOrEqual(f.y + f.h);
    }
  });

  it('同じ枠の機器どうしも重ならない(折り返しを含む)', () => {
    const doc = createEmptyDocument();
    const rows = Array.from({ length: 14 }, (_, i) => row(`D${i}`, { place: 'X', presetId: 'amp', model: 'MODEL-123456' }));
    expect(importDevices(P, rows, options)(doc).ok).toBe(true);
    const nodes = doc.pages[0].nodes.map(rect);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(overlap(nodes[i], nodes[j])).toBe(false);
  });

  it('既存の機器・枠の下から並べ、重ならない', () => {
    const doc = createEmptyDocument();
    const tpl = options.templateFor('camera');
    addNodeFromTemplate(P, tpl, 'Existing', { x: 100, y: 300 })(doc);
    addFrame(P, 'OldFrame', { x: 400, y: 100 })(doc);
    const before = { node: rect(doc.pages[0].nodes[0]), frame: rect(doc.pages[0].groups[0]) };
    expect(importDevices(P, [row('New1', { place: 'N' }), row('New2')], options)(doc).ok).toBe(true);
    const page = doc.pages[0];
    for (const n of page.nodes.slice(1)) {
      expect(overlap(rect(n), before.node)).toBe(false);
      expect(overlap(rect(n), before.frame)).toBe(false);
    }
    expect(overlap(rect(page.groups[1]), before.node)).toBe(false);
    expect(overlap(rect(page.groups[1]), before.frame)).toBe(false);
    expect(page.nodes[0]).toMatchObject({ label: 'Existing', x: 100, y: 300 }); // 既存は動かさない
  });

  it('場所の名称が極端に長くても、枠はページの幅を超えない', () => {
    const doc = createEmptyDocument();
    const long = 'あ'.repeat(120);
    expect(importDevices(P, [row('A', { place: long })], options)(doc).ok).toBe(true);
    const f = doc.pages[0].groups[0];
    expect(f.x + f.w).toBeLessThanOrEqual(doc.pages[0].size.w);
  });

  it('接続は作らない', () => {
    const doc = createEmptyDocument();
    importDevices(P, [row('A', { presetId: 'camera' }), row('B', { presetId: 'switch' })], options)(doc);
    expect(doc.pages[0].edges).toEqual([]);
  });

  it('作った図は、読み込み検証(validateDocument)を通る', () => {
    const doc = createEmptyDocument();
    importDevices(P, [row('A', { presetId: 'amp', quantity: 4, model: 'M', place: 'X' }), row('B', { presetId: 'speaker', quantity: 6 })], options)(doc);
    expect(validateDocument(doc)).toEqual({ ok: true, errors: [] });
  });

  it('グリッドの倍数の位置・大きさに置く', () => {
    const doc = createEmptyDocument();
    importDevices(P, [row('A', { place: 'X' }), row('B', { place: 'X', presetId: 'amp' })], options)(doc);
    const g = doc.grid.size;
    for (const n of doc.pages[0].nodes) expect([n.x % g, n.y % g, n.w % g, n.h % g]).toEqual([0, 0, 0, 0]);
    for (const f of doc.pages[0].groups) expect([f.x % g, f.y % g, f.w % g, f.h % g]).toEqual([0, 0, 0, 0]);
  });
});

describe('importDevices: ページに収まらない場合', () => {
  it('収まらない分は置かず、置けなかった機器の名称を unplaced で返す。ページは大きくしない', () => {
    const doc = createEmptyDocument();
    const size0 = { ...doc.pages[0].size };
    const rows = Array.from({ length: 200 }, (_, i) => row(`D${i}`, { presetId: 'amp' }));
    const r = importDevices(P, rows, options)(doc);
    expect(r.ok).toBe(true);
    const placed = r.createdNodeIds!.length;
    expect(placed).toBeGreaterThan(0);
    expect(placed).toBeLessThan(200);
    expect(r.unplaced).toHaveLength(200 - placed);
    expect(r.unplaced![0]).toBe(`D${placed}`); // 置けた最後の次から
    expect(doc.pages[0].size).toEqual(size0);
    for (const n of doc.pages[0].nodes) expect(n.y + n.h).toBeLessThanOrEqual(size0.h);
  });

  it('1台も置けないときは断り(import-no-space)、何も変えない。名称は blockers に入る', () => {
    const doc = createEmptyDocument();
    const tpl = options.templateFor('camera');
    addNodeFromTemplate(P, tpl, 'Wide', { x: 40, y: 600 })(doc);
    doc.pages[0].nodes[0].h = 90; // 下端 690。残りは 30 しかなく、機器を置けない
    const before = structuredClone(doc);
    const r = importDevices(P, [row('A'), row('B', { place: 'X' })], options)(doc);
    expect(r).toMatchObject({ ok: false, error: 'import-no-space', blockers: ['B', 'A'] }); // 枠つきの機器を先に並べるため、枠なしの A は後
    expect(doc).toEqual(before); // 失敗時は何も変えない(1件も追加されていない)
  });

  it('1台の幅がページより広い機器は、飛ばして残りを置く', () => {
    const doc = createEmptyDocument();
    setPageSize(P, { w: 640, h: 720 })(doc);
    const r = importDevices(P, [row('Big', { presetId: 'switch', ports: 48, quantity: 3 }), row('Small')], options)(doc);
    expect(r.ok).toBe(true);
    expect(doc.pages[0].nodes.map((n) => n.label)).toEqual(['Small']);
    expect(r.unplaced).toEqual(['Big']);
  });

  it('枠の途中で収まらなくなったら、以降の枠の機器も置かない。置けた分の枠だけを作る', () => {
    const doc = createEmptyDocument();
    const rows = [...Array.from({ length: 100 }, (_, i) => row(`A${i}`, { presetId: 'amp', place: 'A' })), row('B1', { place: 'B' })];
    const r = importDevices(P, rows, options)(doc);
    expect(r.ok).toBe(true);
    expect(doc.pages[0].groups.map((g) => g.label)).toEqual(['A']); // B は1台も置けないので枠も作らない
    expect(r.unplaced).toContain('B1');
  });
});

describe('importDevices: 元に戻す・失敗時', () => {
  it('ストアで適用すると1回の操作で、元に戻すのも1回', () => {
    const store = new DocumentStore(createEmptyDocument());
    const r = store.apply(importDevices(P, [row('A', { place: 'X' }), row('B'), row('C')], options));
    expect(r.ok).toBe(true);
    expect(store.doc.pages[0].nodes).toHaveLength(3);
    expect(store.doc.pages[0].groups).toHaveLength(1);
    store.undo();
    expect(store.doc.pages[0].nodes).toHaveLength(0);
    expect(store.doc.pages[0].groups).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('ページが無ければ失敗する', () => {
    expect(importDevices('nope', [row('A')], options)(createEmptyDocument())).toMatchObject({ ok: false, error: 'unknown-page' });
  });
});

describe('importDevices: スイッチのポート数', () => {
  it('ポート数を指定したスイッチは、その機器だけLANポートがその数になる(標準のテンプレートは8のまま)', () => {
    const doc = createEmptyDocument();
    const r = importDevices(P, [row('S24', { presetId: 'switch', ports: 24 }), row('S8', { presetId: 'switch' })], options)(doc);
    expect(r.ok).toBe(true);
    const nodes = doc.pages[0].nodes;
    const s24 = nodes.find((n) => n.label === 'S24')!;
    const s8 = nodes.find((n) => n.label === 'S8')!;
    expect(s24.portGroupsOverride?.[0].count).toBe(24);
    expect(s8.portGroupsOverride).toBeUndefined();
    expect(s24.w).toBeGreaterThan(s8.w); // 24ポートぶん広い
    expect(doc.deviceTemplates.find((t) => t.id === 'preset-switch')!.portGroups[0].count).toBe(8);
  });

  it('標準と同じ8ポートの指定なら、上書きは作らない', () => {
    const doc = createEmptyDocument();
    importDevices(P, [row('S', { presetId: 'switch', ports: 8 })], options)(doc);
    expect(doc.pages[0].nodes[0].portGroupsOverride).toBeUndefined();
  });

  it('スイッチ以外の種類では、ポート数の指定は無視される', () => {
    const doc = createEmptyDocument();
    importDevices(P, [row('Cam', { presetId: 'camera', ports: 24 })], options)(doc);
    expect(doc.pages[0].nodes[0].portGroupsOverride).toBeUndefined();
  });

  it('台数が複数でも、ポート数の指定を反映する(1台あたり)', () => {
    const doc = createEmptyDocument();
    importDevices(P, [row('S', { presetId: 'switch', ports: 24, quantity: 2 })], options)(doc);
    const n = doc.pages[0].nodes[0];
    expect(n.count).toBe(2);
    expect(n.portGroupsOverride?.[0].count).toBe(24);
  });
});

describe('機器一覧CSV: 書き出し → 読み込みの往復と、見本', () => {
  const headers = { name: '名称', model: '型番', quantity: '台数', kind: '種類', ports: 'ポート数', place: '場所' };

  it('見本のCSV(docs/sample_devices.csv)は、警告なく読み込めて、機器と枠になる', () => {
    const parsed = parseDeviceCsv(sampleCsv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toHaveLength(8);
    const doc = createEmptyDocument();
    const r = importDevices(P, parsed.rows, options)(doc);
    expect(r.ok).toBe(true);
    expect(r.unplaced).toBeUndefined();
    expect(doc.pages[0].nodes).toHaveLength(8);
    expect(doc.pages[0].groups.map((g) => g.label)).toEqual(['会議室A', '機器室']);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('見本のCSVに書かれたポート数は、標準機器のポート数と一致している(見本と実装のずれを防ぐ)', () => {
    const parsed = parseDeviceCsv(sampleCsv);
    if (!parsed.ok) throw new Error('unexpected');
    const doc = createEmptyDocument();
    importDevices(P, parsed.rows, options)(doc);
    // 書き出しの「ポート数」(1台あたり)が、見本の値と同じになる
    const exported = parseDeviceCsv(buildDeviceCsv(doc, headers));
    const csvPorts = (text: string) => text.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(',')[4]);
    expect(csvPorts(buildDeviceCsv(doc, headers))).toEqual(csvPorts(sampleCsv.replace('﻿', '')));
    expect(exported.ok).toBe(true);
  });

  it('書き出したCSVを読み込むと、名称・型番・台数・種類・場所が保たれる(スイッチはポート数も保たれ、ほかの機器のポート構成は標準に戻る)', () => {
    const src = createEmptyDocument();
    importDevices(P, [row('Cam', { model: 'M1', quantity: 2, presetId: 'camera', place: 'Room' }), row('SW', { presetId: 'switch', ports: 24, place: 'Rack' }), row('Misc')], options)(src);
    const csv = buildDeviceCsv(src, headers);

    const parsed = parseDeviceCsv(csv);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.warnings).toEqual([]);
    const dst = createEmptyDocument();
    expect(importDevices(P, parsed.rows, options)(dst).ok).toBe(true);
    expect(buildDeviceCsv(dst, headers)).toBe(csv); // 往復で、書き出しが同じになる
  });
});
