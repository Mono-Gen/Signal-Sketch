import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/io/fileIo';
import { validateDocument } from '../../src/model/validate';
import { createSampleDocument } from '../fixtures/sampleDocument';

type Json = Record<string, unknown>;
const base = (): Json => JSON.parse(serializeDocument(createSampleDocument())) as Json;
const page = (d: Json) => (d.pages as Json[])[0];
const node = (d: Json, i = 0) => (page(d).nodes as Json[])[i];

describe('読み込み検証: 項目の型(構文は正しいが内容が不正なファイル)', () => {
  it.each([
    ['機器の名称が数値', (d: Json) => (node(d).label = 1), 'label'],
    ['機器の型番が null', (d: Json) => (node(d).model = null), 'model'],
    ['機器の x が文字列', (d: Json) => (node(d).x = '10'), '.x'],
    ['機器の幅が 0', (d: Json) => (node(d).w = 0), '.w'],
    ['機器の高さが負', (d: Json) => (node(d).h = -5), '.h'],
    ['機器の台数が文字列', (d: Json) => (node(d).count = '3'), 'count'],
    ['機器のテンプレートIDが数値', (d: Json) => (node(d).templateId = 7), 'templateId'],
    ['ポートの辺が不正な値', (d: Json) => ((d.deviceTemplates as Json[])[0].portGroups as Json[])[0].side = 'up', 'side'],
    ['ポートの向きが不正な値', (d: Json) => ((d.deviceTemplates as Json[])[0].portGroups as Json[])[0].direction = 'both', 'direction'],
    ['ポートの個数が文字列', (d: Json) => ((d.deviceTemplates as Json[])[0].portGroups as Json[])[0].count = '2', 'count'],
    ['ポートの接頭辞が数値', (d: Json) => ((d.deviceTemplates as Json[])[0].portGroups as Json[])[0].labelPrefix = 1, 'labelPrefix'],
    ['テンプレートの名称が数値', (d: Json) => ((d.deviceTemplates as Json[])[0].name = 5), 'name'],
    ['テンプレートの形が不正な値', (d: Json) => ((d.deviceTemplates as Json[])[0].shape = 'star'), 'shape'],
    ['信号の名前が数値', (d: Json) => ((d.signalTypes as Json[])[0].label = 3), 'label'],
    ['枠の名称が数値', (d: Json) => ((page(d).groups as Json[])[0].label = 9), 'label'],
    ['枠の x が null', (d: Json) => ((page(d).groups as Json[])[0].x = null), '.x'],
    ['接続の端の機器IDが数値', (d: Json) => (((page(d).edges as Json[])[0].from as Json).nodeId = 1), 'nodeId'],
    ['接続のポートIDが null', (d: Json) => (((page(d).edges as Json[])[0].to as Json).portId = null), 'portId'],
    ['グリッドの有効が文字列', (d: Json) => ((d.grid as Json).enabled = 'yes'), 'enabled'],
    ['言語が未対応の値', (d: Json) => (d.language = 'fr'), 'language'],
    ['ページの名称が数値', (d: Json) => (page(d).name = 1), 'name'],
  ])('%s → 例外にならず、理由つきで断る', (_name, mutate, where) => {
    const d = base();
    mutate(d);
    let r: ReturnType<typeof parseDocument> | undefined;
    expect(() => (r = parseDocument(JSON.stringify(d)))).not.toThrow();
    expect(r!.ok).toBe(false);
    if (!r!.ok) expect(r!.errors.join(' ')).toContain(where);
  });

  it('個別に動かしたポートの位置が不正(辺・位置)なら断る', () => {
    const d = base();
    node(d).portPlacements = { 'lan-1': { side: 'sideways', pos: 'x' } };
    const r = validateDocument(d);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/side|pos/);
  });

  it('接続の経路(waypoints)の型も確認する', () => {
    const d = base();
    (page(d).edges as Json[])[0].waypoints = [{ x: 1, y: 'a' }];
    expect(validateDocument(d).ok).toBe(false);
    (page(d).edges as Json[])[0].waypoints = [{ x: 1, y: 2 }];
    expect(validateDocument(d).ok).toBe(true);
  });

  it('省略できる項目(note・iconRef・枠・台数・multi)は、無くてよい', () => {
    const d = base();
    delete node(d).count;
    delete page(d).groups;
    delete d.language;
    expect(validateDocument(d).ok).toBe(true);
  });

  it('型の報告は、件数が増えすぎない', () => {
    const d = base();
    for (const n of page(d).nodes as Json[]) {
      n.label = 1;
      n.model = 2;
      n.x = 'a';
    }
    expect(validateDocument(d).errors.length).toBeLessThanOrEqual(20);
  });
});

/** サンプルの図の、すべての末端の値(文字列・数値・真偽値)の場所 */
function leaves(value: unknown, path: (string | number)[] = [], out: { path: (string | number)[]; value: unknown }[] = []) {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, [...path, i], out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, [...path, k], out);
  else out.push({ path, value });
  return out;
}

function setAt(root: Json, path: (string | number)[], v: unknown): void {
  let cur: unknown = root;
  for (const key of path.slice(0, -1)) cur = (cur as Record<string | number, unknown>)[key];
  (cur as Record<string | number, unknown>)[path[path.length - 1]] = v;
}

describe('読み込み検証: すべての項目を壊しても、例外にならない(網羅)', () => {
  const sample = base();
  const all = leaves(sample);
  const wrongFor = (v: unknown): unknown[] => (typeof v === 'string' ? [1, null, {}, [], true] : typeof v === 'number' ? ['1', null, {}, [], true] : [1, 'true', null, {}]);
  // 型の不一致を理由に断らなくてよい項目: 旧形式の名残など、画面に影響しないもの
  const IGNORED = new Set<string>([]);

  it('サンプルの図には、十分な数の項目がある(検査の対象が空になっていない)', () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it('各項目を、型の違う値へ置き換えたファイルは、例外にならず、読み込みを断る(置き換えで型が変わらない場合を除く)', () => {
    const failures: string[] = [];
    for (const { path, value } of all) {
      if (IGNORED.has(path.join('.'))) continue;
      for (const wrong of wrongFor(value)) {
        const d = JSON.parse(JSON.stringify(sample)) as Json;
        setAt(d, path, wrong);
        let r: ReturnType<typeof parseDocument>;
        try {
          r = parseDocument(JSON.stringify(d));
        } catch (err) {
          failures.push(`${path.join('.')} = ${JSON.stringify(wrong)} → 例外: ${(err as Error).message}`);
          continue;
        }
        if (r.ok) failures.push(`${path.join('.')} = ${JSON.stringify(wrong)} → 受け入れてしまった`);
      }
    }
    expect(failures.slice(0, 15)).toEqual([]);
  });
});
