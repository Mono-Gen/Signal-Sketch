import { describe, expect, it } from 'vitest';
import { setPageSize } from '../../src/model/actions';
import { isValidPageSize, itemsOutside, MAX_PAGE, MIN_PAGE, PAGE_SIZE_PRESETS, presetIndexOf } from '../../src/model/pageSize';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { validateDocument } from '../../src/model/validate';
import { createSampleDocument } from '../fixtures/sampleDocument';

const P = 'page-1';
const fresh = () => createSampleDocument();

describe('標準の大きさ', () => {
  it('すべて 16:9 で、先頭は従来の 1280x720', () => {
    for (const p of PAGE_SIZE_PRESETS) expect(p.w * 9).toBe(p.h * 16);
    expect(PAGE_SIZE_PRESETS[0]).toEqual({ w: 1280, h: 720 });
  });
  it('presetIndexOf: 一致すれば番号、しなければ -1', () => {
    expect(presetIndexOf({ w: 1920, h: 1080 })).toBe(1);
    expect(presetIndexOf({ w: 1920, h: 1000 })).toBe(-1);
  });
});

describe('isValidPageSize', () => {
  it('範囲の端は有効、1つ外は無効', () => {
    expect(isValidPageSize({ w: MIN_PAGE.w, h: MIN_PAGE.h })).toBe(true);
    expect(isValidPageSize({ w: MAX_PAGE, h: MAX_PAGE })).toBe(true);
    expect(isValidPageSize({ w: MIN_PAGE.w - 1, h: MIN_PAGE.h })).toBe(false);
    expect(isValidPageSize({ w: MAX_PAGE + 1, h: MIN_PAGE.h })).toBe(false);
  });
  it('整数でない・数でない値は無効', () => {
    expect(isValidPageSize({ w: 1280.5, h: 720 })).toBe(false);
    expect(isValidPageSize({ w: '1280', h: 720 })).toBe(false);
    expect(isValidPageSize({ w: NaN, h: 720 })).toBe(false);
  });
});

describe('setPageSize', () => {
  it('大きくできる(1920x1080)。機器は動かない', () => {
    const doc = fresh();
    const before = JSON.stringify(doc.pages[0].nodes);
    expect(setPageSize(P, { w: 1920, h: 1080 })(doc).ok).toBe(true);
    expect(doc.pages[0].size).toEqual({ w: 1920, h: 1080 });
    expect(JSON.stringify(doc.pages[0].nodes)).toBe(before);
  });

  it('グリッドの倍数へ丸める(1283x722 → 1280x720)', () => {
    const doc = fresh();
    setPageSize(P, { w: 1283, h: 722 })(doc);
    expect(doc.pages[0].size).toEqual({ w: 1280, h: 720 });
  });

  it('範囲外・不正値は拒否し、大きさは変わらない', () => {
    for (const bad of [{ w: 100, h: 100 }, { w: 5000, h: 720 }, { w: NaN, h: 720 }, { w: 1280, h: Infinity }]) {
      const doc = fresh();
      const r = setPageSize(P, bad)(doc);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('invalid-value');
      expect(doc.pages[0].size).toEqual({ w: 1280, h: 720 });
    }
  });

  it('存在しないページは unknown-page', () => {
    expect(setPageSize('nope', { w: 1920, h: 1080 })(fresh()).error).toBe('unknown-page');
  });

  it('機器がはみ出す大きさへは縮められない。はみ出す名称を返し、大きさは変わらない', () => {
    const doc = fresh();
    const page = doc.pages[0];
    const ctl = page.nodes.find((n) => n.id === 'ctl')!; // サンプルの機器(x=730, w=140 → 右端 870)
    expect(ctl.x + ctl.w).toBe(870);
    const r = setPageSize(P, { w: 860, h: 720 })(doc);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('page-too-small');
    expect(r.blockers).toContain(ctl.label || ctl.id);
    expect(page.size).toEqual({ w: 1280, h: 720 });
    expect(setPageSize(P, { w: 1280, h: 720 })(doc).ok).toBe(true); // 失敗のあとも、元の大きさで操作できる
  });

  it('はみ出す枠だけでも縮められない', () => {
    const doc = fresh();
    doc.pages[0].groups.push({ id: 'g-wide', label: '広い枠', x: 0, y: 0, w: 1200, h: 100 });
    const r = setPageSize(P, { w: 1000, h: 720 })(doc);
    expect(r.error).toBe('page-too-small');
    expect(r.blockers).toContain('広い枠');
  });

  it('ちょうど収まる大きさへは縮められる(境界)', () => {
    const doc = fresh();
    doc.pages[0].nodes = [];
    doc.pages[0].groups = [{ id: 'g', label: 'g', x: 100, y: 100, w: 540, h: 260 }];
    expect(setPageSize(P, { w: 640, h: 360 })(doc).ok).toBe(true);
    expect(setPageSize(P, { w: 630, h: 360 })(doc).ok).toBe(false);
  });
});

describe('itemsOutside', () => {
  const page = {
    nodes: [{ id: 'a', label: '', x: -10, y: 0, w: 50, h: 50 }, { id: 'b', label: 'B', x: 0, y: 0, w: 100, h: 100 }],
    groups: [{ label: '', x: 0, y: 0, w: 10, h: 10 }],
  };
  it('負の座標もはみ出しとみなし、名称が空なら id を使う', () => {
    expect(itemsOutside(page, { w: 1000, h: 1000 })).toEqual(['a']);
  });
  it('右端・下端がちょうど一致する機器ははみ出さない', () => {
    expect(itemsOutside({ nodes: [page.nodes[1]], groups: [] }, { w: 100, h: 100 })).toEqual([]);
    expect(itemsOutside({ nodes: [page.nodes[1]], groups: [] }, { w: 99, h: 100 })).toEqual(['B']);
  });
});

describe('保存と読み込み', () => {
  it('変更した大きさは、保存して読み直しても保たれる', () => {
    const doc = fresh();
    setPageSize(P, { w: 1500, h: 800 })(doc);
    const r = parseDocument(serializeDocument(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.pages[0].size).toEqual({ w: 1500, h: 800 });
  });
});

describe('読み込み時の検証', () => {
  it('標準のサンプルは有効', () => {
    expect(validateDocument(fresh()).ok).toBe(true);
  });
  it('1920x1080 の図も有効', () => {
    const doc = fresh();
    doc.pages[0].size = { w: 1920, h: 1080 };
    expect(validateDocument(doc).ok).toBe(true);
  });
  it('不正な大きさのファイルは、原因が分かる形で拒否する', () => {
    for (const size of [{ w: 0, h: 0 }, { w: 1280, h: -1 }, { w: 1280.5, h: 720 }, { w: 99999, h: 720 }, null, 'x']) {
      const doc = fresh();
      (doc.pages[0] as unknown as { size: unknown }).size = size;
      const r = validateDocument(doc);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.includes('ページの大きさ'))).toBe(true);
    }
  });
});
