import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, DOCUMENT_FORMAT } from '../../src/model/types';
import type { DiagramDocument } from '../../src/model/types';
import { validateDocument } from '../../src/model/validate';

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
});
