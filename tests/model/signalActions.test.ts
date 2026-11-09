import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { buildSvg } from '../../src/io/svgExport';
import { addNodeFromTemplate, setPortGroups } from '../../src/model/actions';
import { DASH_PATTERN } from '../../src/model/lineStyle';
import { createEmptyDocument, DEFAULT_SIGNAL_TYPES } from '../../src/model/defaults';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { addSignalType, isHexColor, moveSignalType, removeSignalType, signalUsage, updateSignalType } from '../../src/model/signalActions';
import { validateDocument } from '../../src/model/validate';
import { createSampleDocument } from '../fixtures/sampleDocument';

const preset = (id: string) => presetToTemplate(PRESETS.find((p) => p.id === id)!, id);

describe('標準の信号種別', () => {
  it('SPK は標準に含まれない(必要な人が追加する)', () => {
    expect(DEFAULT_SIGNAL_TYPES.map((s) => s.id)).not.toContain('SPK');
    expect(createSampleDocument().signalTypes.map((s) => s.id)).not.toContain('SPK');
  });

  it('標準機器はすべて、標準の信号種別だけを使う', () => {
    const ids = new Set(DEFAULT_SIGNAL_TYPES.map((s) => s.id));
    for (const p of PRESETS) for (const g of p.portGroups) expect(ids.has(g.signalType), `${p.id}/${g.id}`).toBe(true);
  });
});

describe('addSignalType / updateSignalType', () => {
  it('追加すると、新しいIDで末尾に入り、IDは作成結果で返る', () => {
    const doc = createEmptyDocument();
    const n = doc.signalTypes.length;
    const r = addSignalType(' Custom ', '#112233')(doc);
    expect(r.ok).toBe(true);
    const s = doc.signalTypes.at(-1)!;
    expect(doc.signalTypes).toHaveLength(n + 1);
    expect(s).toMatchObject({ id: r.created, label: 'Custom', color: '#112233' });
  });

  it('空の名称・不正な色は拒否する', () => {
    const doc = createEmptyDocument();
    expect(addSignalType('  ', '#112233')(doc).error).toBe('invalid-value');
    expect(addSignalType('x', 'red')(doc).error).toBe('invalid-value');
    expect(addSignalType('x', '#12345')(doc).error).toBe('invalid-value');
  });

  it('名称と色を変えても、IDは変わらない', () => {
    const doc = createEmptyDocument();
    expect(updateSignalType('LAN', { label: 'Wired LAN', color: '#000000' })(doc).ok).toBe(true);
    expect(doc.signalTypes.find((s) => s.id === 'LAN')).toEqual({ id: 'LAN', label: 'Wired LAN', color: '#000000' });
  });

  it('存在しない種別・空の名称・不正な色の変更は拒否し、状態を変えない', () => {
    const doc = createEmptyDocument();
    const before = JSON.stringify(doc);
    expect(updateSignalType('nope', { label: 'x' })(doc).error).toBe('unknown-signal');
    expect(updateSignalType('LAN', { label: '' })(doc).error).toBe('invalid-value');
    expect(updateSignalType('LAN', { color: 'blue' })(doc).error).toBe('invalid-value');
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('removeSignalType', () => {
  it('使われていない種別は削除できる', () => {
    const doc = createEmptyDocument();
    expect(removeSignalType('USB')(doc).ok).toBe(true);
    expect(doc.signalTypes.map((s) => s.id)).not.toContain('USB');
  });

  it('機器のポートが使っている種別は削除できず、状態も変わらない', () => {
    const doc = createSampleDocument();
    const before = JSON.stringify(doc);
    expect(signalUsage(doc, 'LAN')).toBeGreaterThan(0);
    expect(removeSignalType('LAN')(doc)).toMatchObject({ ok: false, error: 'signal-in-use' });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('機器が無くても、機器の種類(テンプレート)が参照していれば削除できない', () => {
    const doc = createEmptyDocument();
    addNodeFromTemplate('page-1', preset('camera'), 'C')(doc);
    doc.pages[0].nodes = [];
    expect(signalUsage(doc, 'HDMI')).toBe(0);
    expect(removeSignalType('HDMI')(doc).error).toBe('signal-in-use');
  });

  it('存在しない種別はエラー', () => {
    expect(removeSignalType('nope')(createEmptyDocument()).error).toBe('unknown-signal');
  });
});

describe('moveSignalType', () => {
  it('1つ上・下へ入れ替え、端では何もしない', () => {
    const doc = createEmptyDocument();
    const order = () => doc.signalTypes.map((s) => s.id);
    moveSignalType('HDMI', -1)(doc);
    expect(order().slice(0, 3)).toEqual(['LAN', 'HDMI', 'CONTROL']);
    const first = order();
    moveSignalType('LAN', -1)(doc);
    expect(order()).toEqual(first);
    moveSignalType(order().at(-1)!, 1)(doc);
    expect(order()).toEqual(first);
  });
});

describe('標準機器の追加と信号種別', () => {
  it('凡例から削除済みの標準の種別を使う機器を追加すると、標準の定義で補われる', () => {
    const doc = createEmptyDocument();
    removeSignalType('HDMI')(doc);
    addNodeFromTemplate('page-1', preset('camera'), 'C')(doc);
    expect(doc.signalTypes.find((s) => s.id === 'HDMI')).toEqual(DEFAULT_SIGNAL_TYPES.find((s) => s.id === 'HDMI'));
  });

  it('追加した種別をポート構成で使える(ポート構成の変更が通る)', () => {
    const doc = createEmptyDocument();
    const id = addSignalType('Custom', '#223344')(doc).created!;
    addNodeFromTemplate('page-1', preset('generic'), 'G')(doc);
    const node = doc.pages[0].nodes[0];
    const groups = [{ id: 'custom', signalType: id, direction: 'inout' as const, side: 'left' as const, count: 2, labelPrefix: 'D ' }];
    expect(setPortGroups('page-1', node.id, groups, { removeOrphanEdges: true })(doc).ok).toBe(true);
    expect(signalUsage(doc, id)).toBe(2);
  });
});

describe('検証', () => {
  it('色が #RRGGBB でない・IDが重複している信号種別は検出される', () => {
    const doc = createEmptyDocument();
    doc.signalTypes[0].color = 'url(javascript:1)';
    doc.signalTypes.push({ ...doc.signalTypes[1] });
    const r = validateDocument(JSON.parse(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('色');
    expect(r.errors.join('\n')).toContain('重複');
  });

  it('isHexColor', () => {
    expect(isHexColor('#a0B1c2')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor(123)).toBe(false);
  });
});

describe('信号の線の種類(lineStyle)', () => {
  const fresh = () => createEmptyDocument();

  it('破線・点線を指定でき、実線へ戻すと項目ごと消える', () => {
    const doc = fresh();
    const id = doc.signalTypes[0].id;
    expect(updateSignalType(id, { lineStyle: 'dashed' })(doc).ok).toBe(true);
    expect(doc.signalTypes[0].lineStyle).toBe('dashed');
    expect(updateSignalType(id, { lineStyle: 'dotted' })(doc).ok).toBe(true);
    expect(doc.signalTypes[0].lineStyle).toBe('dotted');
    expect(updateSignalType(id, { lineStyle: 'solid' })(doc).ok).toBe(true);
    expect('lineStyle' in doc.signalTypes[0]).toBe(false);
  });

  it('不正な種類は断り、何も変えない', () => {
    const doc = fresh();
    const id = doc.signalTypes[0].id;
    const r = updateSignalType(id, { lineStyle: 'wavy' as never })(doc);
    expect(r).toMatchObject({ ok: false, error: 'invalid-value' });
    expect('lineStyle' in doc.signalTypes[0]).toBe(false);
  });

  it('保存して読み直しても残り、不正な値を含む図は読み込みで断る', () => {
    const doc = fresh();
    updateSignalType(doc.signalTypes[0].id, { lineStyle: 'dashed' })(doc);
    const parsed = parseDocument(serializeDocument(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc.signalTypes[0].lineStyle).toBe('dashed');
    const bad = JSON.parse(JSON.stringify(doc));
    bad.signalTypes[0].lineStyle = 'wavy';
    expect(validateDocument(bad).ok).toBe(false);
  });

  it('SVG出力で、線と凡例に同じ破線パターンが付く。実線には付かない', () => {
    const doc = fresh();
    const [a, b] = doc.signalTypes;
    updateSignalType(a.id, { lineStyle: 'dashed' })(doc);
    updateSignalType(b.id, { lineStyle: 'dotted' })(doc);
    const svg = buildSvg(doc, 'page-1', { edgePoints: new Map(), countText: (n) => `x${n}`, legendTitle: '凡例' });
    expect(svg).toContain(`stroke-dasharray="${DASH_PATTERN.dashed}"`);
    expect(svg).toContain(`stroke-dasharray="${DASH_PATTERN.dotted}"`);
    const solidLegendLines = (svg.match(/<line [^>]*stroke-width="3"[^>]*>/g) ?? []).filter((l) => !l.includes('stroke-dasharray'));
    expect(solidLegendLines.length).toBe(doc.signalTypes.length - 2);
  });
});
