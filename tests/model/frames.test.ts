import { describe, expect, it } from 'vitest';
import { buildDeviceCsv } from '../../src/io/csvExport';
import { removeItems } from '../../src/model/actions';
import { addFrame, frameOfNode, moveSelection, nodesInFrame, resizeFrame, updateFrame } from '../../src/model/frames';
import { validateDocument } from '../../src/model/validate';
import { createSampleDocument } from '../fixtures/sampleDocument';

const P = 'page-1';
const H = { name: 'n', model: 'm', quantity: 'q', kind: 'k', ports: 'p', place: 'l' };
const fresh = () => createSampleDocument();
const node = (doc: ReturnType<typeof fresh>, id: string) => doc.pages[0].nodes.find((n) => n.id === id)!;
const frame = (doc: ReturnType<typeof fresh>, id: string) => doc.pages[0].groups.find((g) => g.id === id)!;

describe('所属は見た目で決まる', () => {
  it('機器の中心が枠の中なら所属、外なら所属なし', () => {
    const doc = fresh();
    const page = doc.pages[0];
    expect(frameOfNode(page, node(doc, 'sw'))?.id).toBe('g-rack');
    expect(frameOfNode(page, node(doc, 'ptz'))).toBeUndefined(); // 枠の外の機器
  });

  it('機器を枠の外へ動かすと外れ、枠の中へ動かすと入る(参加・離脱の操作は要らない)', () => {
    const doc = fresh();
    moveSelection(P, [{ id: 'sw', x: 1000, y: 100 }], [])(doc);
    expect(frameOfNode(doc.pages[0], node(doc, 'sw'))).toBeUndefined();
    moveSelection(P, [{ id: 'ptz', x: 600, y: 400 }], [])(doc);
    expect(frameOfNode(doc.pages[0], node(doc, 'ptz'))?.id).toBe('g-rack');
  });

  it('入れ子の枠では、内側(小さい)枠が所属になる', () => {
    const doc = fresh();
    const id = addFrame(P, '内側', { x: 540, y: 340 })(doc).created!;
    resizeFrame(P, id, { x: 540, y: 340, w: 300, h: 200 })(doc); // sw(560,380,260x130)を内側に含む
    expect(frameOfNode(doc.pages[0], node(doc, 'sw'))?.id).toBe(id);
    expect(nodesInFrame(doc.pages[0], frame(doc, 'g-rack')).map((n) => n.id)).toContain('sw');
  });
});

describe('addFrame / updateFrame / resizeFrame', () => {
  it('枠を追加でき、位置と大きさはグリッドの倍数、IDは既存と衝突しない', () => {
    const doc = fresh();
    const r = addFrame(P, '新しい枠', { x: 233, y: 117 })(doc);
    const f = frame(doc, r.created!);
    expect(r.ok).toBe(true);
    expect([f.x, f.y, f.w, f.h].every((v) => v % doc.grid.size === 0)).toBe(true);
    expect(new Set(doc.pages[0].groups.map((g) => g.id)).size).toBe(doc.pages[0].groups.length);
    expect(f.memberNodeIds).toBeUndefined(); // 所属は保存しない
  });

  it('位置を省略した枠は、続けて追加してもずらして置かれる', () => {
    const doc = fresh();
    const a = frame(doc, addFrame(P, 'a')(doc).created!);
    const b = frame(doc, addFrame(P, 'b')(doc).created!);
    expect([a.x, a.y]).not.toEqual([b.x, b.y]);
  });

  it('名称を変更できる。存在しない枠は失敗', () => {
    const doc = fresh();
    expect(updateFrame(P, 'g-rack', { label: 'ラック' })(doc).ok).toBe(true);
    expect(frame(doc, 'g-rack').label).toBe('ラック');
    expect(updateFrame(P, 'nope', { label: 'x' })(doc).error).toBe('unknown-frame');
  });

  it('大きさを変えられ、中の機器は動かない。グリッドへ吸着する', () => {
    const doc = fresh();
    const before = JSON.stringify(doc.pages[0].nodes);
    expect(resizeFrame(P, 'g-rack', { x: 503, y: 297, w: 421, h: 383 })(doc).ok).toBe(true);
    expect(frame(doc, 'g-rack')).toMatchObject({ x: 500, y: 300, w: 420, h: 380 });
    expect(JSON.stringify(doc.pages[0].nodes)).toBe(before);
  });

  it('小さすぎる・不正な値は拒否し、状態を変えない', () => {
    const doc = fresh();
    const before = JSON.stringify(doc);
    expect(resizeFrame(P, 'g-rack', { x: 500, y: 300, w: 10, h: 380 })(doc).error).toBe('invalid-value');
    expect(resizeFrame(P, 'g-rack', { x: 500, y: 300, w: Number.NaN, h: 380 })(doc).error).toBe('invalid-value');
    expect(resizeFrame(P, 'nope', { x: 0, y: 0, w: 100, h: 100 })(doc).error).toBe('unknown-frame');
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('moveSelection', () => {
  it('枠を動かすと、中の機器も同じだけ動き、外の機器は動かない', () => {
    const doc = fresh();
    const g = frame(doc, 'g-rack');
    const inside = ['sw', 'ctl', 'amp'].map((id) => ({ id, x: node(doc, id).x, y: node(doc, id).y }));
    const outside = JSON.stringify([node(doc, 'ptz'), node(doc, 'tap')]);
    expect(moveSelection(P, [], [{ id: 'g-rack', x: g.x + 40, y: g.y - 20 }])(doc).ok).toBe(true);
    for (const o of inside) {
      expect([node(doc, o.id).x, node(doc, o.id).y], o.id).toEqual([o.x + 40, o.y - 20]);
    }
    expect(JSON.stringify([node(doc, 'ptz'), node(doc, 'tap')])).toBe(outside);
  });

  it('入れ子の内側の枠も、外側の枠と一緒に動く', () => {
    const doc = fresh();
    const inner = addFrame(P, '内側', { x: 540, y: 340 })(doc).created!;
    resizeFrame(P, inner, { x: 540, y: 340, w: 300, h: 200 })(doc);
    moveSelection(P, [], [{ id: 'g-rack', x: 520, y: 300 }])(doc);
    expect(frame(doc, inner)).toMatchObject({ x: 560, y: 340 });
  });

  it('いっしょにドラッグされた機器は、二重には動かない(指定座標が優先)', () => {
    const doc = fresh();
    const g = frame(doc, 'g-rack');
    const sw = { ...node(doc, 'sw') };
    moveSelection(P, [{ id: 'sw', x: sw.x + 40, y: sw.y }], [{ id: 'g-rack', x: g.x + 40, y: g.y }])(doc);
    expect(node(doc, 'sw').x).toBe(sw.x + 40); // 80ではない
  });

  it('所属の判定は動かす前の位置で行う(動かした結果に影響されない)', () => {
    const doc = fresh();
    const g = frame(doc, 'g-rack');
    // 右へ大きく動かして、移動後の枠が別の機器(ptz)に重なっても、ptz は連れて動かない
    const ptz = { ...node(doc, 'ptz') };
    moveSelection(P, [], [{ id: 'g-rack', x: g.x + 400, y: g.y }])(doc);
    expect([node(doc, 'ptz').x, node(doc, 'ptz').y]).toEqual([ptz.x, ptz.y]);
  });

  it('存在しない機器・枠が1つでもあれば、何も動かさない', () => {
    const doc = fresh();
    const before = JSON.stringify(doc);
    expect(moveSelection(P, [{ id: 'nope', x: 0, y: 0 }], [{ id: 'g-rack', x: 0, y: 0 }])(doc).error).toBe('unknown-node');
    expect(moveSelection(P, [], [{ id: 'nope', x: 0, y: 0 }])(doc).error).toBe('unknown-frame');
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('枠の削除・CSV・検証', () => {
  it('枠を削除しても、中の機器は残る', () => {
    const doc = fresh();
    const nodes = doc.pages[0].nodes.length;
    expect(removeItems(P, { frameIds: ['g-rack'] })(doc).ok).toBe(true);
    expect(doc.pages[0].groups.some((g) => g.id === 'g-rack')).toBe(false);
    expect(doc.pages[0].nodes).toHaveLength(nodes);
  });

  it('CSVの「場所」は、属する枠の名称になる(枠の外は空)', () => {
    const csv = buildDeviceCsv(fresh(), H);
    expect(csv).toMatch(/Network Switch,Model-E1,1,[^,]*,\d+,Rack\r\n/);
    expect(csv).toMatch(/PTZ Camera,Model-J1,1,[^,]*,\d+,\r\n/);
  });

  it('同じ機器でも、場所が違えば別の行になる', () => {
    const doc = fresh();
    // 98" Display 2台は、どちらも枠の外(同じ場所)なので1行にまとまる
    expect(buildDeviceCsv(doc, H)).toMatch(/"98"" Display",Model-D1,2,/); // 名称に引用符があるため、CSVでは引用符で囲まれる
    const rowsBefore = buildDeviceCsv(doc, H).trim().split('\r\n').length;
    moveSelection(P, [{ id: 'd2', x: 520, y: 350 }], [])(doc); // 片方を枠(Rack)の中へ
    expect(buildDeviceCsv(doc, H).trim().split('\r\n')).toHaveLength(rowsBefore + 1);
  });

  it('古い形式(memberNodeIds付き)も、新形式(なし)も、検証を通る', () => {
    const doc = fresh();
    expect(validateDocument(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
    frame(doc, 'g-rack').memberNodeIds = ['sw', 'ghost']; // 使わないので、存在しない機器が入っていても無視する
    expect(validateDocument(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
  });

  it('枠の大きさが不正・IDが重複した保存データは検出される', () => {
    const doc = fresh();
    frame(doc, 'g-rack').w = -5;
    doc.pages[0].groups.push({ ...frame(doc, 'g-table') });
    const r = validateDocument(JSON.parse(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('g-rack');
    expect(r.errors.join('\n')).toContain('重複');
  });
});
