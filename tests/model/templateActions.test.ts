import { describe, expect, it } from 'vitest';
import { addNodeFromTemplate, addNodesInRow, removeItems, setPortGroups } from '../../src/model/actions';
import { createEmptyDocument } from '../../src/model/defaults';
import { usedAssets } from '../../src/model/imageActions';
import { autoNodeSize } from '../../src/model/nodeSize';
import { PRESETS, presetToTemplate } from '../../src/model/presets';
import { MAX_TEMPLATES, MAX_TEMPLATE_NAME_LENGTH, registerTemplate, removeTemplate } from '../../src/model/templateActions';
import type { DeviceTemplate, DiagramDocument, PortGroup } from '../../src/model/types';
import { validateDocument } from '../../src/model/validate';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { DocumentStore } from '../../src/state/store';
import { TINY_PNG } from '../fixtures/tinyImage';

const PAGE_ID = 'page-1';

function speakerTemplate(): DeviceTemplate {
  return presetToTemplate(PRESETS.find((preset) => preset.id === 'speaker')!, 'スピーカー');
}

function documentWithNode(): { doc: DiagramDocument; nodeId: string } {
  const doc = createEmptyDocument();
  const result = addNodeFromTemplate(PAGE_ID, speakerTemplate(), '天井スピーカー', { x: 40, y: 60 })(doc);
  return { doc, nodeId: result.created! };
}

function customTemplate(doc: DiagramDocument): DeviceTemplate {
  return doc.deviceTemplates.find((template) => template.id.startsWith('custom-'))!;
}

describe('registerTemplate', () => {
  it('名称・元テンプレートの種類/形・有効なポート構成・画像・大きさだけを登録し、元の機器は変えない', () => {
    const { doc, nodeId } = documentWithNode();
    const node = doc.pages[0].nodes.find((candidate) => candidate.id === nodeId)!;
    const override: PortGroup[] = [
      { id: 'audio-custom', signalType: 'AUDIO', direction: 'in', side: 'top', count: 3, labelPrefix: 'IN ' },
    ];
    expect(setPortGroups(PAGE_ID, nodeId, override)(doc).ok).toBe(true);
    doc.assets['img-a'] = TINY_PNG;
    node.imageId = 'img-a';
    node.w = 230;
    node.h = 170;
    node.model = '登録しない型番';
    node.count = 7;
    const before = structuredClone(node);

    expect(registerTemplate(PAGE_ID, nodeId, '  天井スピーカー登録  ')(doc).ok).toBe(true);

    expect(customTemplate(doc)).toEqual({
      id: 'custom-1',
      name: '天井スピーカー登録',
      kind: 'speaker',
      shape: 'roundRect',
      portGroups: override,
      imageId: 'img-a',
      size: { w: 230, h: 170 },
    });
    expect(node).toEqual(before);
    expect(customTemplate(doc).portGroups).not.toBe(node.portGroupsOverride);
  });

  it('重複名には (2) から最初に空いている番号を付ける', () => {
    const { doc, nodeId } = documentWithNode();
    registerTemplate(PAGE_ID, nodeId, '機器')(doc);
    registerTemplate(PAGE_ID, nodeId, '機器')(doc);
    doc.deviceTemplates.push({ ...structuredClone(customTemplate(doc)), id: 'custom-99', name: '機器 (4)' });
    registerTemplate(PAGE_ID, nodeId, '機器')(doc);
    registerTemplate(PAGE_ID, nodeId, '機器')(doc);
    expect(doc.deviceTemplates.filter((template) => template.id.startsWith('custom-')).map((template) => template.name)).toEqual([
      '機器',
      '機器 (2)',
      '機器 (4)',
      '機器 (3)',
      '機器 (5)',
    ]);
  });

  it('空・100文字超の名前を拒否し、100文字は受け付ける', () => {
    const { doc, nodeId } = documentWithNode();
    const before = structuredClone(doc);
    expect(registerTemplate(PAGE_ID, nodeId, '   ')(doc)).toEqual({ ok: false, error: 'invalid-value' });
    expect(registerTemplate(PAGE_ID, nodeId, 'x'.repeat(MAX_TEMPLATE_NAME_LENGTH + 1))(doc)).toEqual({ ok: false, error: 'invalid-value' });
    expect(doc).toEqual(before);
    expect(registerTemplate(PAGE_ID, nodeId, 'x'.repeat(MAX_TEMPLATE_NAME_LENGTH))(doc).ok).toBe(true);
  });

  it('100文字の名前が重複しても、自動の番号を含めて100文字以内に収める', () => {
    const { doc, nodeId } = documentWithNode();
    const name = 'x'.repeat(MAX_TEMPLATE_NAME_LENGTH);
    registerTemplate(PAGE_ID, nodeId, name)(doc);
    registerTemplate(PAGE_ID, nodeId, name)(doc);
    const names = doc.deviceTemplates.filter((template) => template.id.startsWith('custom-')).map((template) => template.name);
    expect(names[1]).toBe(`${'x'.repeat(MAX_TEMPLATE_NAME_LENGTH - 4)} (2)`);
    expect(names[1]).toHaveLength(MAX_TEMPLATE_NAME_LENGTH);
  });

  it('全テンプレート数が上限なら拒否する', () => {
    const { doc, nodeId } = documentWithNode();
    while (doc.deviceTemplates.length < MAX_TEMPLATES) {
      const n = doc.deviceTemplates.length;
      doc.deviceTemplates.push({ id: `custom-fill-${n}`, name: `F${n}`, kind: 'generic', shape: 'rect', portGroups: [] });
    }
    expect(registerTemplate(PAGE_ID, nodeId, '上限超過')(doc)).toEqual({ ok: false, error: 'too-many-templates' });
    expect(doc.deviceTemplates).toHaveLength(MAX_TEMPLATES);
  });

  it('ページ・機器・元テンプレート・画像参照が不正なら拒否する', () => {
    const { doc, nodeId } = documentWithNode();
    expect(registerTemplate('missing', nodeId, 'X')(doc).error).toBe('unknown-page');
    expect(registerTemplate(PAGE_ID, 'missing', 'X')(doc).error).toBe('unknown-node');
    doc.pages[0].nodes[0].templateId = 'missing';
    expect(registerTemplate(PAGE_ID, nodeId, 'X')(doc).error).toBe('unknown-template');
    doc.pages[0].nodes[0].templateId = speakerTemplate().id;
    doc.pages[0].nodes[0].imageId = 'missing';
    expect(registerTemplate(PAGE_ID, nodeId, 'X')(doc).error).toBe('invalid-value');
  });

  it('ストアでは登録が1回の履歴になり、Undo 1回で戻る', () => {
    const { doc, nodeId } = documentWithNode();
    const store = new DocumentStore(doc);
    expect(store.apply(registerTemplate(PAGE_ID, nodeId, '登録')).ok).toBe(true);
    expect(store.doc.deviceTemplates.some((template) => template.id.startsWith('custom-'))).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.doc.deviceTemplates.some((template) => template.id.startsWith('custom-'))).toBe(false);
  });
});

describe('登録テンプレートから置く', () => {
  function registered(): { doc: DiagramDocument; template: DeviceTemplate } {
    const { doc, nodeId } = documentWithNode();
    const node = doc.pages[0].nodes[0];
    doc.assets['img-a'] = TINY_PNG;
    node.imageId = 'img-a';
    node.w = 240;
    node.h = 160;
    node.portGroupsOverride = [{ id: 'custom-port', signalType: 'AUDIO', direction: 'out', side: 'right', count: 2, labelPrefix: 'OUT ' }];
    registerTemplate(PAGE_ID, nodeId, '登録スピーカー')(doc);
    return { doc, template: customTemplate(doc) };
  }

  it('クリック/ドラッグ相当の1台追加で、登録名・画像・大きさ・ポート構成を使う', () => {
    const { doc, template } = registered();
    const result = addNodeFromTemplate(PAGE_ID, template, template.name, { x: 400, y: 300 })(doc);
    const placed = doc.pages[0].nodes.find((node) => node.id === result.created)!;
    expect(placed).toMatchObject({ label: '登録スピーカー', model: '', w: 240, h: 160, imageId: 'img-a' });
    expect(doc.deviceTemplates.find((candidate) => candidate.id === placed.templateId)!.portGroups).toEqual(template.portGroups);
  });

  it('Shift+ドロップ相当の一列配置でも、全台が登録画像と大きさを使う', () => {
    const { doc, template } = registered();
    const before = new Set(doc.pages[0].nodes.map((node) => node.id));
    const result = addNodesInRow(PAGE_ID, template, template.name, { count: 3, direction: 'horizontal', gap: 10 }, { x: 300, y: 200 })(doc);
    expect(result.ok).toBe(true);
    const placed = doc.pages[0].nodes.filter((node) => !before.has(node.id));
    expect(placed).toHaveLength(3);
    expect(placed.every((node) => node.w === 240 && node.h === 160 && node.imageId === 'img-a')).toBe(true);
  });

  it('size/imageId のない標準テンプレートは、自動サイズ(高さは標準の60以上)で画像なし', () => {
    const doc = createEmptyDocument();
    const template = speakerTemplate();
    const auto = autoNodeSize({ groups: template.portGroups, label: template.name, model: '', grid: doc.grid.size });
    const result = addNodeFromTemplate(PAGE_ID, template, template.name)(doc);
    const placed = doc.pages[0].nodes.find((node) => node.id === result.created)!;
    // 新しく置く機器の高さは、最小(50)より少し大きい標準の60(ポートが多くて最小がそれ以上なら、その高さ)
    expect({ w: placed.w, h: placed.h }).toEqual({ w: auto.w, h: Math.max(auto.h, 60) });
    expect(placed.h).toBeGreaterThanOrEqual(60);
    expect(placed.imageId).toBeUndefined();
  });
});

describe('removeTemplate', () => {
  it('使用中は拒否し、機器を削除した後は削除できる。Undo で登録が戻る', () => {
    const { doc, nodeId } = documentWithNode();
    registerTemplate(PAGE_ID, nodeId, '登録')(doc);
    const template = customTemplate(doc);
    const placed = addNodeFromTemplate(PAGE_ID, template, template.name)(doc).created!;
    const store = new DocumentStore(doc);

    expect(store.apply(removeTemplate(template.id))).toEqual({ ok: false, error: 'template-in-use' });
    expect(store.doc.deviceTemplates.some((candidate) => candidate.id === template.id)).toBe(true);
    expect(store.apply(removeItems(PAGE_ID, { nodeIds: [placed] })).ok).toBe(true);
    expect(store.apply(removeTemplate(template.id)).ok).toBe(true);
    expect(store.doc.deviceTemplates.some((candidate) => candidate.id === template.id)).toBe(false);
    expect(store.undo()).toBe(true);
    expect(store.doc.deviceTemplates.some((candidate) => candidate.id === template.id)).toBe(true);
  });

  it('使用中の参照は全ページを調べる', () => {
    const { doc, nodeId } = documentWithNode();
    registerTemplate(PAGE_ID, nodeId, '登録')(doc);
    const template = customTemplate(doc);
    doc.pages.push({ id: 'page-2', name: 'Page 2', size: { w: 1280, h: 720 }, nodes: [], edges: [], groups: [] });
    addNodeFromTemplate('page-2', template, template.name)(doc);
    expect(removeTemplate(template.id)(doc)).toEqual({ ok: false, error: 'template-in-use' });
  });

  it('標準テンプレートと存在しないIDは削除しない', () => {
    const { doc } = documentWithNode();
    const before = structuredClone(doc.deviceTemplates);
    expect(removeTemplate(speakerTemplate().id)(doc)).toEqual({ ok: false, error: 'unknown-template' });
    expect(removeTemplate('custom-missing')(doc)).toEqual({ ok: false, error: 'unknown-template' });
    expect(doc.deviceTemplates).toEqual(before);
  });

  it('未使用登録を削除して保存した図は、再読込時の検証に通る', () => {
    const { doc, nodeId } = documentWithNode();
    registerTemplate(PAGE_ID, nodeId, '登録')(doc);
    expect(removeTemplate(customTemplate(doc).id)(doc).ok).toBe(true);
    expect(validateDocument(doc).ok).toBe(true);
    expect(parseDocument(serializeDocument(doc)).ok).toBe(true);
  });
});

describe('登録画像の保持', () => {
  it('機器が参照していなくても、登録テンプレートの画像は使用中として保存する', () => {
    const doc = createEmptyDocument();
    doc.assets['img-a'] = TINY_PNG;
    doc.deviceTemplates.push({ id: 'custom-1', name: '画像登録', kind: 'generic', shape: 'rect', portGroups: [], imageId: 'img-a', size: { w: 120, h: 80 } });
    expect(usedAssets(doc)).toEqual({ 'img-a': TINY_PNG });
    expect(JSON.parse(serializeDocument(doc)).assets).toEqual({ 'img-a': TINY_PNG });
  });

  it('ストアの操作時整理でも、登録テンプレートだけが参照する画像を消さない', () => {
    const doc = createEmptyDocument();
    doc.assets['img-a'] = TINY_PNG;
    doc.deviceTemplates.push({ id: 'custom-1', name: '画像登録', kind: 'generic', shape: 'rect', portGroups: [], imageId: 'img-a', size: { w: 120, h: 80 } });
    const store = new DocumentStore(doc);
    expect(store.apply((draft) => {
      draft.language = 'en';
      return { ok: true };
    }).ok).toBe(true);
    expect(store.doc.assets).toEqual({ 'img-a': TINY_PNG });
  });
});
