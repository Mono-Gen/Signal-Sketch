import { describe, expect, it } from 'vitest';
import { addNodeFromTemplate, updateNode } from '../../src/model/actions';
import { copySelection, pasteClipboard, suggestPasteOffset } from '../../src/model/clipboard';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { createEmptyDocument } from '../../src/model/defaults';
import { addFrame, moveSelection, nodesInFrame, resizeFrame } from '../../src/model/frames';
import { movePort } from '../../src/model/actions';
import { validateDocument } from '../../src/model/validate';
import { DocumentStore } from '../../src/state/store';
import { createSampleDocument } from '../fixtures/sampleDocument';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { MAX_TEMPLATES } from '../../src/model/templateActions';
import type { DeviceTemplate } from '../../src/model/types';
import { TINY_PNG } from '../fixtures/tinyImage';

const P = 'page-1';
const fresh = () => createSampleDocument();
const node = (doc: ReturnType<typeof fresh>, id: string) => doc.pages[0].nodes.find((n) => n.id === id)!;
const paste = (doc: ReturnType<typeof fresh>, data: NonNullable<ReturnType<typeof copySelection>>, d = 20) =>
  pasteClipboard(P, data, { dx: d, dy: d })(doc);

const customTemplate = (overrides: Partial<DeviceTemplate> = {}): DeviceTemplate => ({
  ...presetToTemplate(PRESETS.find((p) => p.id === 'speaker')!, '登録スピーカー'),
  id: 'custom-1',
  size: { w: 240, h: 160 },
  imageId: 'img-source',
  ...overrides,
});

const addCustomNode = (doc: ReturnType<typeof createEmptyDocument>, template = customTemplate()) => {
  doc.assets['img-source'] = TINY_PNG;
  return addNodeFromTemplate(P, template, '登録機器', { x: 40, y: 40 })(doc).created!;
};

const tinyPngVariant = (marker: number): string => {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, marker];
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
};

describe('貼り付けの境界(iconRef・ずらし量)', () => {
  it('同じIDで iconRef だけ違う登録は、別の定義として両方残る', () => {
    const src = fresh();
    const n = addCustomNode(src, customTemplate({ iconRef: 'speaker' }));
    const data = copySelection(src, P, { nodeIds: [n] })!;
    const dst = fresh();
    dst.assets['img-source'] = TINY_PNG;
    dst.deviceTemplates.push(customTemplate({ iconRef: 'amp' }));
    const r = paste(dst, data);
    expect(r.ok).toBe(true);
    const custom = dst.deviceTemplates.filter((t) => t.name === '登録スピーカー');
    expect(custom).toHaveLength(2);
    const pasted = dst.pages[0].nodes.find((x) => x.id === r.createdNodeIds![0])!;
    expect(pasted.templateId).not.toBe('custom-1');
    expect(dst.deviceTemplates.find((t) => t.id === pasted.templateId)!.iconRef).toBe('speaker');
  });

  it('同じIDで内容も同一なら、定義は増えない', () => {
    const src = fresh();
    const n = addCustomNode(src, customTemplate({ iconRef: 'speaker' }));
    const data = copySelection(src, P, { nodeIds: [n] })!;
    const dst = fresh();
    dst.assets['img-source'] = TINY_PNG;
    dst.deviceTemplates.push(customTemplate({ iconRef: 'speaker' }));
    const before = dst.deviceTemplates.length;
    expect(paste(dst, data).ok).toBe(true);
    expect(dst.deviceTemplates).toHaveLength(before);
  });

  it('ずらし量が NaN・Infinity なら失敗し、図は変わらない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { nodeIds: [doc.pages[0].nodes[0].id] })!;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const copy = structuredClone(doc);
      expect(pasteClipboard(P, data, { dx: bad, dy: 0 })(copy).ok).toBe(false);
      expect(pasteClipboard(P, data, { dx: 0, dy: bad })(copy).ok).toBe(false);
      expect(copy).toEqual(doc);
    }
  });
});

describe('copySelection', () => {
  it('ポート番号表示設定をコピーと貼り付けで保持する', () => {
    const doc = fresh();
    node(doc, 'sw').showPortLabels = true;
    const data = copySelection(doc, P, { nodeIds: ['sw'] })!;
    const result = paste(doc, data);
    expect(result.ok).toBe(true);
    expect(node(doc, result.createdNodeIds![0]).showPortLabels).toBe(true);
  });
  it('開始番号を持つテンプレートを通常の同一IDと区別して貼り付ける', () => {
    const source = fresh();
    const group = source.deviceTemplates.find((t) => t.id === 'switch')!.portGroups[0];
    group.startNumber = 0;
    source.pages[0].edges = source.pages[0].edges.filter((e) => e.id !== 'e-5');
    const dest = fresh();
    const result = paste(dest, copySelection(source, P, { nodeIds: ['sw', 'tsc'] })!);
    expect(result.ok).toBe(true);
    const pasted = dest.pages[0].nodes.find((n) => result.createdNodeIds!.includes(n.id) && n.label === 'Network Switch')!;
    expect(pasted.templateId).not.toBe('switch');
    expect(dest.deviceTemplates.find((t) => t.id === pasted.templateId)!.portGroups[0]).toMatchObject({ startNumber: 0 });
    expect(parseDocument(serializeDocument(dest)).ok).toBe(true);
  });

  it('開始番号の省略と1は同じ定義として再利用する', () => {
    const source = fresh();
    Object.assign(source.deviceTemplates.find((t) => t.id === 'switch')!.portGroups[0], { startNumber: 1 });
    const dest = fresh();
    const result = paste(dest, copySelection(source, P, { nodeIds: ['sw'] })!);
    const pasted = dest.pages[0].nodes.find((n) => n.id === result.createdNodeIds![0])!;
    expect(pasted.templateId).toBe('switch');
  });
  it('何も選ばれていない・存在しないページは null', () => {
    const doc = fresh();
    expect(copySelection(doc, P, {})).toBeNull();
    expect(copySelection(doc, P, { nodeIds: ['nope'] })).toBeNull();
    expect(copySelection(doc, 'nope', { nodeIds: ['sw'] })).toBeNull();
  });

  it('選んだ機器どうしの接続だけを含み、外の機器への接続は含めない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { nodeIds: ['lap', 'enc'] })!;
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['enc', 'lap']);
    expect(data.edges.map((e) => e.id)).toEqual(['e-9']); // lap→enc だけ。enc→sw は外へ出るので含めない
  });

  it('枠を選ぶと、中の機器も含める', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { frameIds: ['g-rack'] })!;
    expect(data.frames.map((f) => f.id)).toEqual(['g-rack']);
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['amp', 'ctl', 'sw']);
  });

  it('入れ子の枠は、外側を選ぶと内側の枠も含める', () => {
    const doc = fresh();
    const inner = addFrame(P, '内側', { x: 540, y: 340 })(doc).created!;
    resizeFrame(P, inner, { x: 540, y: 340, w: 300, h: 200 })(doc);
    const data = copySelection(doc, P, { frameIds: ['g-rack'] })!;
    expect(data.frames.map((f) => f.id).sort()).toEqual([inner, 'g-rack'].sort());
  });

  it('コピーした後で元の機器を変えても、コピーの内容は変わらない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { nodeIds: ['sw'] })!;
    updateNode(P, 'sw', { label: '変更後' })(doc);
    expect(data.nodes[0].label).toBe('Network Switch');
  });

  it('機器画像と登録テンプレート画像が別なら、両方の画像データを含める', () => {
    const doc = createEmptyDocument();
    const id = addCustomNode(doc);
    doc.assets['img-node'] = tinyPngVariant(2);
    doc.pages[0].nodes.find((candidate) => candidate.id === id)!.imageId = 'img-node';

    const data = copySelection(doc, P, { nodeIds: [id] })!;
    expect(data.assets).toEqual({ 'img-node': tinyPngVariant(2), 'img-source': TINY_PNG });
  });
});

describe('pasteClipboard', () => {
  it('新しいIDで機器が増え、内容(名称・型番・台数・ポート位置)を引き継ぎ、位置はずれる', () => {
    const doc = fresh();
    movePort(P, 'mute', 'lan-1@2', 'top', 60)(doc);
    const src = { ...node(doc, 'mute') };
    const data = copySelection(doc, P, { nodeIds: ['mute'] })!;
    const before = doc.pages[0].nodes.length;
    const r = paste(doc, data);
    expect(r.ok).toBe(true);
    expect(doc.pages[0].nodes).toHaveLength(before + 1);
    const copy = node(doc, r.createdNodeIds![0]);
    expect(copy.id).not.toBe('mute');
    expect(copy).toMatchObject({ label: src.label, model: src.model, count: 4, templateId: src.templateId, w: src.w, h: src.h });
    expect(copy.portPlacements).toEqual(src.portPlacements);
    expect([copy.x, copy.y]).toEqual([src.x + 20, src.y + 20]);
  });

  it('貼り付けた機器どうしの接続は、新しい機器に付け替えて作られる。元の接続は変わらない', () => {
    const doc = fresh();
    const edgesBefore = JSON.stringify(doc.pages[0].edges);
    const data = copySelection(doc, P, { nodeIds: ['lap', 'enc'] })!;
    const r = paste(doc, data);
    const [a, b] = r.createdNodeIds!;
    const added = doc.pages[0].edges.slice(16);
    expect(added).toHaveLength(1);
    expect(added[0].from.nodeId === a || added[0].from.nodeId === b).toBe(true);
    expect([added[0].from.nodeId, added[0].to.nodeId].sort()).toEqual([a, b].sort());
    expect(JSON.stringify(doc.pages[0].edges.slice(0, 16))).toBe(edgesBefore);
  });

  it('外の機器へつながる接続は作らない(貼り付けた機器のポートは、空きのまま)', () => {
    const doc = fresh();
    const r = paste(doc, copySelection(doc, P, { nodeIds: ['sw'] })!);
    const newId = r.createdNodeIds![0];
    expect(doc.pages[0].edges.some((e) => e.from.nodeId === newId || e.to.nodeId === newId)).toBe(false);
  });

  it('手動の経路(waypoints)は、機器と同じだけずらして引き継ぐ(元の線の経路は変わらない)', () => {
    const doc = fresh();
    doc.pages[0].edges.find((e) => e.id === 'e-9')!.waypoints = [{ x: 100, y: 200 }];
    const r = paste(doc, copySelection(doc, P, { nodeIds: ['lap', 'enc'] })!, 20);
    expect(r.ok).toBe(true);
    expect(doc.pages[0].edges.at(-1)!.waypoints).toEqual([{ x: 120, y: 220 }]);
    expect(doc.pages[0].edges.find((e) => e.id === 'e-9')!.waypoints).toEqual([{ x: 100, y: 200 }]);
  });

  it('手動の経路が無い線は、貼り付けても waypoints を持たない', () => {
    const doc = fresh();
    const r = paste(doc, copySelection(doc, P, { nodeIds: ['lap', 'enc'] })!);
    expect(r.ok).toBe(true);
    expect('waypoints' in doc.pages[0].edges.at(-1)!).toBe(false);
  });

  it('枠を貼り付けると、新しい枠の中に、貼り付けた機器だけが所属する(元の機器は含まれない)', () => {
    // 他の機器と重ならない、専用の図で確かめる
    const doc = createEmptyDocument();
    const tpl = presetToTemplate(PRESETS.find((p) => p.id === 'camera')!, 'カメラ');
    addNodeFromTemplate(P, tpl, 'A', { x: 60, y: 80 })(doc);
    addNodeFromTemplate(P, tpl, 'B', { x: 60, y: 200 })(doc);
    const fid = addFrame(P, 'Room', { x: 40, y: 50 })(doc).created!;
    const data = copySelection(doc, P, { frameIds: [fid] })!;
    expect(data.nodes).toHaveLength(2);
    const r = pasteClipboard(P, data, suggestPasteOffset(doc, P, data, 1))(doc);
    const frame = doc.pages[0].groups.find((g) => g.id === r.createdFrameIds![0])!;
    expect(frame.label).toBe('Room');
    expect(nodesInFrame(doc.pages[0], frame).map((n) => n.id).sort()).toEqual([...r.createdNodeIds!].sort());
    // 元の枠は、元の機器だけのまま
    const orig = doc.pages[0].groups.find((g) => g.id === fid)!;
    expect(nodesInFrame(doc.pages[0], orig).map((n) => n.label).sort()).toEqual(['A', 'B']);
  });

  it('suggestPasteOffset: 機器だけなら右下へ少しずつずらす', () => {
    const doc = fresh();
    const nodesOnly = copySelection(doc, P, { nodeIds: ['sw'] })!;
    expect(suggestPasteOffset(doc, P, nodesOnly, 1)).toEqual({ dx: 20, dy: 20 });
    expect(suggestPasteOffset(doc, P, nodesOnly, 3)).toEqual({ dx: 60, dy: 60 });
  });

  it('suggestPasteOffset: 枠は、元の位置に最も近い空き(元の枠から1グリッド以上あける)へ置く', () => {
    const doc = createEmptyDocument();
    const tpl = presetToTemplate(PRESETS.find((p) => p.id === 'camera')!, 'カメラ');
    addNodeFromTemplate(P, tpl, 'A', { x: 60, y: 80 })(doc);
    const fid = addFrame(P, 'Room', { x: 40, y: 50 })(doc).created!; // 40..340 x 50..250
    const data = copySelection(doc, P, { frameIds: [fid] })!;
    // 右へ 300+10=310、下へ 200+10=210。近いのは下(同じ幅なら縦ずれ最小の右を優先するが、距離は下が小さい)
    expect(suggestPasteOffset(doc, P, data, 1)).toEqual({ dx: 0, dy: 210 });
  });

  it('suggestPasteOffset: ほぼ満杯の図(サンプル)でも、小さくずらす案より、取り込む既存の機器が増えない', () => {
    const doc = fresh();
    for (const fid of ['g-table', 'g-behind', 'g-rack']) {
      const data = copySelection(doc, P, { frameIds: [fid] })!;
      const captured = (offset: { dx: number; dy: number }): number => {
        const copy = structuredClone(doc);
        const r = pasteClipboard(P, data, offset)(copy);
        const frame = copy.pages[0].groups.find((g) => g.id === r.createdFrameIds![0])!;
        const mine = new Set(r.createdNodeIds);
        return nodesInFrame(copy.pages[0], frame).filter((n) => !mine.has(n.id)).length; // 取り込んだ既存の機器
      };
      const suggested = suggestPasteOffset(doc, P, data, 1);
      expect(captured(suggested), fid).toBeLessThanOrEqual(captured({ dx: 20, dy: 20 }));
    }
  });

  it('suggestPasteOffset: ページ全体に広がる枠など、動かせる余地が無ければ、小さくずらす', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { frameIds: ['g-rack'] })!;
    const huge = { ...data, frames: [{ ...data.frames[0], x: 0, y: 0, w: 1280, h: 720 }] };
    expect(suggestPasteOffset(doc, P, huge, 1)).toEqual({ dx: 20, dy: 20 });
  });
  it('貼り付けた結果の図は、検証を通り、IDが重複しない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { frameIds: ['g-table'] })!;
    paste(doc, data, 20);
    paste(doc, data, 40);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual({ ok: true, errors: [] });
  });

  it('位置はグリッドの倍数に吸着し、ページの外へは出ない', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { nodeIds: ['aif'] })!;
    const r = paste(doc, data, 9999);
    const n = node(doc, r.createdNodeIds![0]);
    expect(n.x % doc.grid.size).toBe(0);
    expect(n.x + n.w).toBeLessThanOrEqual(doc.pages[0].size.w);
    expect(n.y + n.h).toBeLessThanOrEqual(doc.pages[0].size.h);
    const neg = paste(doc, data, -9999);
    const m = node(doc, neg.createdNodeIds![0]);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.y).toBeGreaterThanOrEqual(0);
  });

  it('別の図(新規)へ貼ると、機器の種類と信号の種類も補われ、検証を通る', () => {
    const src = fresh();
    const data = copySelection(src, P, { nodeIds: ['amp'] })!;
    const dst = createEmptyDocument();
    dst.signalTypes = []; // 信号の種類が1つも無い図
    const r = pasteClipboard(P, data, { dx: 20, dy: 20 })(dst);
    expect(r.ok).toBe(true);
    expect(dst.deviceTemplates.map((t) => t.id)).toContain(node(src, 'amp').templateId);
    expect(dst.signalTypes.length).toBeGreaterThan(0);
    expect(validateDocument(JSON.parse(JSON.stringify(dst))).ok).toBe(true);
  });

  it('同じIDで内容が異なる機器の種類は上書きせず、貼り付け側を別IDへ移す', () => {
    const doc = fresh();
    const data = copySelection(doc, P, { nodeIds: ['sw'] })!;
    doc.signalTypes[0].color = '#123456';
    const originalId = node(doc, 'sw').templateId;
    doc.deviceTemplates.find((t) => t.id === originalId)!.name = '編集済み';
    const result = paste(doc, data);
    expect(doc.signalTypes[0].color).toBe('#123456');
    expect(doc.deviceTemplates.find((t) => t.id === originalId)!.name).toBe('編集済み');
    expect(node(doc, result.createdNodeIds![0]).templateId).not.toBe(originalId);
  });

  it('新規の図へ画像付き機器を貼ると画像も移り、保存して開き直せる', () => {
    const source = createEmptyDocument();
    const sourceNodeId = addCustomNode(source);
    const store = new DocumentStore(source);
    const data = copySelection(store.doc, P, { nodeIds: [sourceNodeId] })!;
    expect(data.assets).toEqual({ 'img-source': TINY_PNG });

    store.replace(createEmptyDocument());
    const previousAssets = store.doc.assets;
    const result = store.apply(pasteClipboard(P, data, { dx: 20, dy: 20 }));
    expect(result.ok).toBe(true);
    const pasted = store.doc.pages[0].nodes.find((candidate) => candidate.id === result.createdNodeIds![0])!;
    expect(pasted.imageId).toBe('img-source');
    expect(store.doc.assets[pasted.imageId!]).toBe(TINY_PNG);
    expect(store.doc.assets).not.toBe(previousAssets);
    expect(previousAssets).toEqual({});
    expect(validateDocument(store.doc).ok).toBe(true);
    const parsed = parseDocument(serializeDocument(store.doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc.assets['img-source']).toBe(TINY_PNG);
  });

  it('異なる custom-1 がある図では登録機器を新IDへ移し、元定義と画像・寸法・ポートを保つ', () => {
    const source = createEmptyDocument();
    const sourceTemplate = customTemplate({
      portGroups: [
        { id: 'source-out', signalType: 'audio', direction: 'out', side: 'right', count: 2, labelPrefix: 'OUT' },
      ],
    });
    const sourceNodeId = addCustomNode(source, sourceTemplate);
    const data = copySelection(source, P, { nodeIds: [sourceNodeId] })!;

    const destination = createEmptyDocument();
    const destinationTemplate = customTemplate({
      name: '宛先の custom-1',
      imageId: undefined,
      size: { w: 100, h: 80 },
      portGroups: [{ id: 'dest-in', signalType: 'audio', direction: 'in', side: 'left', count: 1, labelPrefix: 'IN' }],
    });
    destination.deviceTemplates.push(structuredClone(destinationTemplate));
    const result = pasteClipboard(P, data, { dx: 0, dy: 0 })(destination);

    expect(result.ok).toBe(true);
    expect(destination.deviceTemplates.find((template) => template.id === 'custom-1')).toEqual(destinationTemplate);
    const pastedNode = destination.pages[0].nodes.find((candidate) => candidate.id === result.createdNodeIds![0])!;
    expect(pastedNode.templateId).toBe('custom-2');
    expect(destination.deviceTemplates.find((template) => template.id === 'custom-2')).toMatchObject({
      name: sourceTemplate.name,
      size: sourceTemplate.size,
      imageId: sourceTemplate.imageId,
      portGroups: sourceTemplate.portGroups,
    });
    expect(destination.assets['img-source']).toBe(TINY_PNG);
  });

  it('同一内容の custom-1 は再利用し、登録を重複させない', () => {
    const source = createEmptyDocument();
    const template = customTemplate();
    const sourceNodeId = addCustomNode(source, template);
    const data = copySelection(source, P, { nodeIds: [sourceNodeId] })!;
    const destination = createEmptyDocument();
    destination.deviceTemplates.push(structuredClone(template));

    const result = pasteClipboard(P, data, { dx: 0, dy: 0 })(destination);
    expect(result.ok).toBe(true);
    expect(destination.deviceTemplates.filter((candidate) => candidate.id === 'custom-1')).toHaveLength(1);
    expect(destination.deviceTemplates).toHaveLength(1);
    expect(destination.pages[0].nodes[0].templateId).toBe('custom-1');
  });

  it('内容が異なる preset-* の衝突は、組み込み定義でない新IDへ移す', () => {
    const source = createEmptyDocument();
    const sourceTemplate = customTemplate({ id: 'preset-speaker', imageId: undefined, size: undefined });
    const sourceNodeId = addNodeFromTemplate(P, sourceTemplate, 'コピー元', { x: 0, y: 0 })(source).created!;
    const data = copySelection(source, P, { nodeIds: [sourceNodeId] })!;
    const destination = createEmptyDocument();
    destination.deviceTemplates.push({ ...structuredClone(sourceTemplate), name: '宛先の別定義' });

    const result = pasteClipboard(P, data, { dx: 0, dy: 0 })(destination);
    expect(result.ok).toBe(true);
    const pasted = destination.pages[0].nodes.find((candidate) => candidate.id === result.createdNodeIds![0])!;
    expect(pasted.templateId).toBe('imported-1');
    expect(pasted.templateId.startsWith('preset-')).toBe(false);
    expect(destination.deviceTemplates.find((candidate) => candidate.id === 'preset-speaker')!.name).toBe('宛先の別定義');
  });

  it('貼り付けでテンプレート上限を超える場合は断る', () => {
    const source = createEmptyDocument();
    const sourceNodeId = addCustomNode(source, customTemplate({ id: 'custom-source' }));
    const data = copySelection(source, P, { nodeIds: [sourceNodeId] })!;
    const destination = createEmptyDocument();
    const base = customTemplate({ imageId: undefined, size: undefined });
    destination.deviceTemplates = Array.from({ length: MAX_TEMPLATES }, (_, index) => ({ ...structuredClone(base), id: `existing-${index + 1}` }));

    expect(pasteClipboard(P, data, { dx: 0, dy: 0 })(destination)).toEqual({ ok: false, error: 'too-many-templates' });
    expect(destination.pages[0].nodes).toHaveLength(0);
    expect(destination.deviceTemplates).toHaveLength(MAX_TEMPLATES);
  });

  it('同じ画像IDの内容が異なる場合は貼り付けを断り、既存画像を変えない', () => {
    const source = createEmptyDocument();
    const sourceNodeId = addCustomNode(source);
    const data = copySelection(source, P, { nodeIds: [sourceNodeId] })!;
    const destination = createEmptyDocument();
    const existing = tinyPngVariant(1);
    destination.assets['img-source'] = existing;

    expect(pasteClipboard(P, data, { dx: 0, dy: 0 })(destination)).toEqual({ ok: false, error: 'invalid-value' });
    expect(destination.assets).toEqual({ 'img-source': existing });
    expect(destination.pages[0].nodes).toHaveLength(0);
  });

  it('画像上限を超える貼り付けは document-too-large で断る', () => {
    const source = createEmptyDocument();
    const sourceNodeId = addCustomNode(source);
    const data = copySelection(source, P, { nodeIds: [sourceNodeId] })!;
    const destination = createEmptyDocument();
    destination.assets = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`img-${index}`, TINY_PNG]));

    expect(pasteClipboard(P, data, { dx: 0, dy: 0 })(destination)).toEqual({ ok: false, error: 'document-too-large' });
    expect(destination.assets).toHaveProperty('img-0', TINY_PNG);
    expect(destination.assets).not.toHaveProperty('img-source');
  });

  it('空の内容・存在しないページは失敗する', () => {
    const doc = fresh();
    const empty = { nodes: [], frames: [], edges: [], templates: [], signalTypes: [], assets: {} };
    expect(pasteClipboard(P, empty, { dx: 0, dy: 0 })(doc).ok).toBe(false);
    const data = copySelection(doc, P, { nodeIds: ['sw'] })!;
    expect(pasteClipboard('nope', data, { dx: 0, dy: 0 })(doc).error).toBe('unknown-page');
  });

  it('貼り付けは、元に戻す1回で全部戻る', () => {
    const store = new DocumentStore(fresh());
    const data = copySelection(store.doc, P, { frameIds: ['g-table'] })!;
    const before = JSON.stringify(store.doc);
    expect(store.apply(pasteClipboard(P, data, { dx: 20, dy: 20 })).ok).toBe(true);
    expect(JSON.stringify(store.doc)).not.toBe(before);
    store.undo();
    expect(JSON.stringify(store.doc)).toBe(before);
  });

  it('枠を動かした後でも、貼り付けた機器は元の機器とは独立して動く', () => {
    const doc = fresh();
    const r = paste(doc, copySelection(doc, P, { nodeIds: ['sw'] })!);
    const copyId = r.createdNodeIds![0];
    const orig = { x: node(doc, 'sw').x, y: node(doc, 'sw').y };
    moveSelection(P, [{ id: copyId, x: 900, y: 100 }], [])(doc);
    expect([node(doc, 'sw').x, node(doc, 'sw').y]).toEqual([orig.x, orig.y]);
  });
});
