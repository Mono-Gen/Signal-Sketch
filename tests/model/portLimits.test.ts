import { describe, expect, it } from 'vitest';
import { addNodeFromTemplate, lostEdgeIds, lostEdgeIdsForCount, setPortGroups, updateNode } from '../../src/model/actions';
import { createEmptyDocument } from '../../src/model/defaults';
import { exceedsPortLimit, MAX_NOMINAL_PORTS_PER_UNIT, MAX_PORTS_PER_NODE, MAX_UNITS } from '../../src/model/ports';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { validateDocument } from '../../src/model/validate';
import { parseDeviceCsv } from '../../src/io/csvImport';
import { createSampleDocument } from '../fixtures/sampleDocument';

const P = 'page-1';
const preset = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, id);
const g = (count: number) => ({ id: 'g', signalType: 'LAN', direction: 'inout' as const, side: 'left' as const, count, labelPrefix: 'L ' });

/** 巨大な値でも、固まらずにすぐ答えが返ること(展開してから調べると、その展開で固まる) */
const FAST_MS = 1500;
const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const t = Date.now();
  const value = fn();
  return { value, ms: Date.now() - t };
};

describe('exceedsPortLimit', () => {
  it('欠番を実数から除き、公称数には別の安全上限を設ける', () => {
    const skipped = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(exceedsPortLimit([{ ...g(24), skipped }], 300)).toBe(false);
    expect(exceedsPortLimit([{ ...g(24), skipped: [1, 1] }], 300)).toBe(true);
    expect(exceedsPortLimit([{ ...g(MAX_NOMINAL_PORTS_PER_UNIT + 1), skipped: Array.from({ length: MAX_NOMINAL_PORTS_PER_UNIT + 1 }, (_, i) => i + 1) }], 1)).toBe(true);
    const doc = createSampleDocument();
    const node = doc.pages[0].nodes[0];
    node.portGroupsOverride = [{ ...g(24), signalType: 'USB', skipped }];
    node.count = 300;
    doc.pages[0].edges = [];
    expect(validateDocument(doc).ok).toBe(true);
    node.portGroupsOverride[0].count = MAX_NOMINAL_PORTS_PER_UNIT + 1;
    node.portGroupsOverride[0].skipped = Array.from({ length: MAX_NOMINAL_PORTS_PER_UNIT + 1 }, (_, i) => i + 1);
    expect(validateDocument(doc).ok).toBe(false);
  });
  it('台数の範囲(1〜上限の整数)', () => {
    expect(exceedsPortLimit([g(1)], 1)).toBe(false);
    expect(exceedsPortLimit([g(1)], MAX_UNITS)).toBe(false);
    expect(exceedsPortLimit([g(1)], MAX_UNITS + 1)).toBe(true);
    for (const bad of [0, -1, 1.5, NaN, Infinity]) expect(exceedsPortLimit([g(1)], bad), String(bad)).toBe(true);
  });

  it('ポートの合計(台数ぶんを含む)が上限ちょうどなら可、1つ超えたら不可', () => {
    expect(exceedsPortLimit([g(MAX_PORTS_PER_NODE)], 1)).toBe(false);
    expect(exceedsPortLimit([g(MAX_PORTS_PER_NODE + 1)], 1)).toBe(true);
    expect(exceedsPortLimit([g(50)], 100)).toBe(false); // 5000
    expect(exceedsPortLimit([g(50)], 101)).toBe(true); // 5050
    expect(exceedsPortLimit([g(30), g(20)], 100)).toBe(false); // グループの合計 50
    expect(exceedsPortLimit([g(30), g(21)], 100)).toBe(true);
  });

  it('不正な個数(負・非数)は数えない(それを弾くのは展開側の検査)', () => {
    expect(exceedsPortLimit([g(-5), g(3)], 1)).toBe(false);
    expect(exceedsPortLimit([{ count: NaN }, g(3)], 1)).toBe(false);
    expect(exceedsPortLimit([{ count: '9' as unknown as number }], 1)).toBe(false);
  });
});

describe('読み込み検証(validateDocument): 巨大な値で固まらない', () => {
  it('台数が極端に大きいファイルは、すぐに断る', () => {
    for (const count of [MAX_UNITS + 1, 1_000_000, 2 ** 40]) {
      const doc = createSampleDocument();
      doc.pages[0].nodes[0].count = count;
      const { value, ms } = timed(() => validateDocument(doc));
      expect(value.ok, `count=${count}`).toBe(false);
      expect(value.errors.join(' ')).toMatch(/上限|までです/); // 1機器の上限、またはページ全体の上限
      expect(ms, `count=${count}`).toBeLessThan(FAST_MS);
    }
  });

  it('機器ごとのポート構成(上書き)の個数が極端に大きいファイルも、すぐに断る', () => {
    const doc = createSampleDocument();
    const node = doc.pages[0].nodes[0];
    node.portGroupsOverride = [{ ...g(2 ** 31), id: 'usb', signalType: 'USB' }];
    const { value, ms } = timed(() => validateDocument(doc));
    expect(value.ok).toBe(false);
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('テンプレートのポート構成の個数が極端に大きいファイルも、すぐに断る(使われていないテンプレートでも)', () => {
    const doc = createSampleDocument();
    doc.deviceTemplates.push({ id: 'unused', name: 'Unused', kind: 'generic', shape: 'roundRect', portGroups: [{ ...g(2 ** 31), id: 'x' }] });
    const { value, ms } = timed(() => validateDocument(doc));
    expect(value.ok).toBe(false);
    expect(value.errors.join(' ')).toContain('上限');
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('上限の内側の機器は読み込める(台数999 × 5ポート = 4995)', () => {
    const doc = createSampleDocument();
    const node = doc.pages[0].nodes[0];
    node.portGroupsOverride = [{ ...g(5), id: 'usb', signalType: 'USB', direction: 'out', side: 'right' }];
    node.count = MAX_UNITS;
    node.portPlacements = undefined;
    doc.pages[0].edges = doc.pages[0].edges.filter((e) => e.from.nodeId !== node.id && e.to.nodeId !== node.id);
    expect(validateDocument(doc)).toEqual({ ok: true, errors: [] });
  });

  it('いつもの図(サンプル)は読み込める', () => {
    expect(validateDocument(createSampleDocument()).ok).toBe(true);
  });
});

describe('操作(パネルの入力)でも、上限を超える値は断り、固まらない', () => {
  const setup = (presetId: string) => {
    const doc = createEmptyDocument();
    const id = addNodeFromTemplate(P, preset(presetId), 'N')(doc).created!;
    return { doc, id };
  };

  it('台数: 範囲外・上限超えは invalid-value。上限の内側は通る', () => {
    const { doc, id } = setup('camera'); // 2ポート
    expect(updateNode(P, id, { count: MAX_UNITS + 1 })(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(updateNode(P, id, { count: 1_000_000_000 })(doc)).toMatchObject({ ok: false, error: 'invalid-value' });
    expect(updateNode(P, id, { count: MAX_UNITS })(doc).ok).toBe(true); // 2 × 999 = 1998
  });

  it('ポートの合計が上限を超える台数は断る(LAN 48ポートの機器は 104台まで)', () => {
    const { doc, id } = setup('switch');
    expect(setPortGroups(P, id, [{ ...g(48), id: 'lan' }])(doc).ok).toBe(true);
    expect(updateNode(P, id, { count: 104 })(doc).ok).toBe(true); // 4992
    expect(updateNode(P, id, { count: 105 })(doc)).toMatchObject({ ok: false, error: 'invalid-value' }); // 5040
  });

  it('ポート構成: 個数が巨大なら、展開せずにすぐ断る', () => {
    const { doc, id } = setup('camera');
    const { value, ms } = timed(() => setPortGroups(P, id, [g(1_000_000_000)])(doc));
    expect(value).toMatchObject({ ok: false, error: 'invalid-port-groups' });
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('ポート構成: 台数ぶんを含めて上限を超える個数も断る', () => {
    const { doc, id } = setup('camera');
    updateNode(P, id, { count: 100 })(doc);
    expect(setPortGroups(P, id, [g(51)])(doc)).toMatchObject({ ok: false, error: 'invalid-port-groups' }); // 5100
    expect(setPortGroups(P, id, [g(50)])(doc).ok).toBe(true); // 5000
  });

  it('入力の途中で呼ばれる「消える接続の調べ」も、巨大な値では展開せずに空を返す', () => {
    const { doc, id } = setup('camera');
    const a = timed(() => lostEdgeIdsForCount(doc, P, id, 1_000_000_000));
    expect(a.value).toEqual([]);
    expect(a.ms).toBeLessThan(FAST_MS);
    const b = timed(() => lostEdgeIds(doc, P, id, [g(2 ** 31)]));
    expect(b.value).toEqual([]);
    expect(b.ms).toBeLessThan(FAST_MS);
  });

  it('失敗した操作は、図を変えない', () => {
    const { doc, id } = setup('camera');
    const before = structuredClone(doc);
    updateNode(P, id, { count: 1_000_000_000 })(doc);
    setPortGroups(P, id, [g(1_000_000_000)])(doc);
    expect(doc).toEqual(before);
  });
});

describe('機器一覧CSVの読み込み: ポートの合計の上限', () => {
  const run = (row: string) => parseDeviceCsv(`名称,台数,種類\n${row}\n`);

  it('スイッチのポート数を指定した行で、台数ぶんのポートが上限を超えると、行番号つきのエラー(48ポート × 105台)', () => {
    const withPorts = (row: string) => parseDeviceCsv(`名称,台数,種類,ポート数\n${row}\n`);
    expect(withPorts('SW,105,スイッチ,48')).toEqual({ ok: false, errors: [{ code: 'row-ports-too-many', line: 2, value: '48' }] });
    expect(withPorts('SW,104,スイッチ,48').ok).toBe(true);
  });

  it('ポート数を指定しない標準のスイッチ(8ポート)は、台数ぶんの合計が5000までなら通る(625台まで)', () => {
    expect(run('SW,625,スイッチ').ok).toBe(true); // 8 × 625 = 5000
    expect(run('SW,626,スイッチ')).toEqual({ ok: false, errors: [{ code: 'row-too-many-ports', line: 2, value: '626' }] });
  });

  it('台数の上限(999)は、ポートが少ない機器なら通り、1000はエラー', () => {
    expect(run('Spk,999,スピーカ').ok).toBe(true); // 1ポート × 999
    expect(run('Spk,1000,スピーカ')).toEqual({ ok: false, errors: [{ code: 'row-quantity-invalid', line: 2, value: '1000' }] });
  });

  it('種類が不明(汎用機器)でも、台数ぶんのポートの上限を確認する', () => {
    expect(run('X,999,不明な種類').ok).toBe(true); // 汎用機器は1ポート
  });
});
