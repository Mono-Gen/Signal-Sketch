import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, DOCUMENT_FORMAT } from '../../src/model/types';
import type { DiagramDocument } from '../../src/model/types';
import { validateDocument } from '../../src/model/validate';
import { MAX_TEMPLATES } from '../../src/model/templateActions';
import { MAX_PAGE } from '../../src/model/pageSize';
import { TINY_PNG } from '../fixtures/tinyImage';

/** 検証に通る最小のドキュメント(テストごとに壊して使う) */
function valid(): DiagramDocument {
  return {
    format: DOCUMENT_FORMAT,
    version: CURRENT_VERSION,
    language: 'ja',
    grid: { size: 10, enabled: true },
    signalTypes: [{ id: 'LAN', label: 'LAN', color: '#1a9850' }],
    deviceTemplates: [
      {
        id: 'sw',
        name: 'Switch',
        kind: 'switch',
        shape: 'rect',
        portGroups: [{ id: 'lan', signalType: 'LAN', direction: 'inout', side: 'left', count: 4, labelPrefix: 'LAN ' }],
      },
    ],
    assets: {},
    pages: [
      {
        id: 'p1',
        name: 'Page 1',
        size: { w: 1280, h: 720 },
        nodes: [
          { id: 'a', templateId: 'sw', label: 'A', model: '', x: 0, y: 0, w: 100, h: 60 },
          { id: 'b', templateId: 'sw', label: 'B', model: '', x: 200, y: 0, w: 100, h: 60 },
        ],
        edges: [{ id: 'e1', from: { nodeId: 'a', portId: 'lan-1' }, to: { nodeId: 'b', portId: 'lan-4' } }],
        groups: [],
      },
    ],
  };
}

describe('validateDocument', () => {
  it('正しいドキュメントは ok', () => {
    expect(validateDocument(valid())).toEqual({ ok: true, errors: [] });
  });

  it('オブジェクトでない入力は不正', () => {
    for (const bad of [null, 1, 'x', [], undefined]) {
      expect(validateDocument(bad).ok).toBe(false);
    }
  });

  it('format が異なる/欠けているファイルは不正(別形式のJSONを誤って開いた場合)', () => {
    const wrong = validateDocument({ ...valid(), format: 'something-else' });
    expect(wrong.ok).toBe(false);
    expect(wrong.errors.join('\n')).toContain('something-else');

    const missing = valid() as unknown as Record<string, unknown>;
    delete missing.format;
    expect(validateDocument(missing).ok).toBe(false);
  });

  it('format の値にアプリ名を含めない(名前変更に備える)', () => {
    expect(DOCUMENT_FORMAT).not.toMatch(/diagram-?maker/i);
  });

  it('未対応バージョンは不正で、版が分かるメッセージ', () => {
    const r = validateDocument({ ...valid(), version: 999 });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('999');
  });

  it('grid.size が正の整数でなければ不正', () => {
    for (const size of [0, -10, 1.5, '10']) {
      expect(validateDocument({ ...valid(), grid: { size, enabled: true } }).ok).toBe(false);
    }
  });

  it('必須の配列が欠けていれば不正', () => {
    const doc = valid() as unknown as Record<string, unknown>;
    delete doc.pages;
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('pages');
  });

  it('存在しない機器を参照する接続は不正', () => {
    const doc = valid();
    doc.pages[0].edges[0].to.nodeId = 'zzz';
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('zzz');
  });

  it('存在しないポートを参照する接続は不正(範囲外の番号)', () => {
    const doc = valid();
    doc.pages[0].edges[0].from.portId = 'lan-5'; // 4ポートしかない
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('lan-5');
  });

  it('機器ごとの上書きでポートが増えれば、その番号を参照できる', () => {
    const doc = valid();
    doc.pages[0].nodes[0].portGroupsOverride = [
      { id: 'lan', signalType: 'LAN', direction: 'inout', side: 'left', count: 48, labelPrefix: 'LAN ' },
    ];
    doc.pages[0].edges[0].from.portId = 'lan-48';
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('機器ID・接続ID・テンプレートIDの重複は不正', () => {
    const dupNode = valid();
    dupNode.pages[0].nodes[1].id = 'a';
    expect(validateDocument(dupNode).ok).toBe(false);

    const dupEdge = valid();
    dupEdge.pages[0].edges.push({ ...dupEdge.pages[0].edges[0] });
    expect(validateDocument(dupEdge).ok).toBe(false);

    const dupTpl = valid();
    dupTpl.deviceTemplates.push({ ...dupTpl.deviceTemplates[0] });
    expect(validateDocument(dupTpl).ok).toBe(false);
  });

  it('存在しないテンプレート/信号種別の参照は不正', () => {
    const noTpl = valid();
    noTpl.pages[0].nodes[0].templateId = 'nope';
    expect(validateDocument(noTpl).ok).toBe(false);

    const noSig = valid();
    noSig.deviceTemplates[0].portGroups[0].signalType = 'XXX';
    const r = validateDocument(noSig);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('XXX');
  });

  it('不正なポート数は検証エラーとして報告される(例外にしない)', () => {
    const doc = valid();
    doc.deviceTemplates[0].portGroups[0].count = -3;
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('ポート数');
  });

  it('複数の問題は全件まとめて返す', () => {
    const doc = valid();
    doc.pages[0].edges[0].from.nodeId = 'x1';
    doc.pages[0].edges[0].to.nodeId = 'x2';
    const r = validateDocument(doc);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('テンプレートの imageId は assets に存在する画像だけを許す', () => {
    const doc = valid();
    doc.deviceTemplates[0].imageId = 'img-a';
    expect(validateDocument(doc).ok).toBe(false);
    doc.assets['img-a'] = TINY_PNG;
    expect(validateDocument(doc).ok).toBe(true);
  });

  it.each([
    [{ w: 0, h: 10 }, '0'],
    [{ w: 10, h: -1 }, '-1'],
    [{ w: Number.POSITIVE_INFINITY, h: 10 }, 'Infinity'],
    [{ w: MAX_PAGE + 1, h: 10 }, String(MAX_PAGE + 1)],
  ])('テンプレートの不正な size を拒否する: %j', (size) => {
    const doc = valid();
    doc.deviceTemplates[0].size = size;
    expect(validateDocument(doc).ok).toBe(false);
  });

  it('テンプレートの size は正の有限値で、ページ最大以下なら許す', () => {
    const doc = valid();
    doc.deviceTemplates[0].size = { w: 0.5, h: MAX_PAGE };
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('テンプレート数は上限まで許し、上限+1件を拒否する', () => {
    const doc = valid();
    const base = doc.deviceTemplates[0];
    while (doc.deviceTemplates.length < MAX_TEMPLATES) {
      doc.deviceTemplates.push({ ...structuredClone(base), id: `template-${doc.deviceTemplates.length}` });
    }
    expect(validateDocument(doc).ok).toBe(true);
    doc.deviceTemplates.push({ ...structuredClone(base), id: 'over-limit' });
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(String(MAX_TEMPLATES));
  });
});
