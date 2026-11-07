import { describe, expect, it } from 'vitest';
import { clearPortPlacements, movePort, setPortGroups } from '../../src/model/actions';
import { layoutNodePorts } from '../../src/model/query';
import { layoutPorts, nearestSide } from '../../src/model/portLayout';
import { expandPortGroups } from '../../src/model/ports';
import { validateDocument } from '../../src/model/validate';
import { createSampleDocument } from '../fixtures/sampleDocument';
import type { PortGroup } from '../../src/model/types';

const P = 'page-1';
const fresh = () => createSampleDocument();
const sw = (doc: ReturnType<typeof fresh>) => doc.pages[0].nodes.find((n) => n.id === 'sw')!;
const at = (doc: ReturnType<typeof fresh>, portId: string) => layoutNodePorts(doc, sw(doc)).find((p) => p.portId === portId)!;

describe('layoutPorts: 個別に動かしたポート', () => {
  const group: PortGroup = { id: 'g', signalType: 'LAN', direction: 'inout', side: 'left', count: 3, labelPrefix: 'L' };
  const ports = expandPortGroups([group]);
  const size = { w: 200, h: 200 };

  it('指定したポートは、指定した辺の上(辺の座標)に置かれる', () => {
    const r = layoutPorts(ports, size, 10, { 'g-2': { side: 'right', pos: 100 } });
    const p = r.find((x) => x.portId === 'g-2')!;
    expect(p).toMatchObject({ side: 'right', x: 200, y: 100 });
  });

  it('指定していないポートの配置は、指定したポートに影響されない位置から詰め直される', () => {
    const r = layoutPorts(ports, size, 10, { 'g-2': { side: 'right', pos: 100 } });
    const ys = r.filter((x) => x.side === 'left').map((x) => x.y);
    expect(ys).toEqual([30, 40]);
  });

  it('辺の範囲外の位置は、範囲の端へ丸める', () => {
    const r = layoutPorts(ports, size, 10, { 'g-1': { side: 'left', pos: 5 }, 'g-3': { side: 'bottom', pos: 999 } });
    expect(r.find((x) => x.portId === 'g-1')!.y).toBe(30); // 左右の辺はヘッダの下から
    expect(r.find((x) => x.portId === 'g-3')!.x).toBe(190); // 端から1グリッド内側まで
  });
});

describe('nearestSide', () => {
  const size = { w: 200, h: 100 };
  it.each([
    [{ x: -5, y: 50 }, 'left'],
    [{ x: 205, y: 50 }, 'right'],
    [{ x: 100, y: -3 }, 'top'],
    [{ x: 100, y: 108 }, 'bottom'],
  ] as const)('%j は %s の辺に最も近い', (local, side) => {
    expect(nearestSide(local, size)).toBe(side);
  });
});

describe('movePort', () => {
  it('ポートを別の辺へ動かせ、位置はグリッドに吸着する', () => {
    const doc = fresh();
    const r = movePort(P, 'sw', 'lan-l-1', 'top', 87)(doc);
    expect(r.ok).toBe(true);
    const p = at(doc, 'lan-l-1');
    expect(p.side).toBe('top');
    expect(p.y).toBe(0);
    expect(p.x % doc.grid.size).toBe(0);
    expect(p.x).toBe(90);
  });

  it('テンプレートは変わらない(この機器だけの上書き)', () => {
    const doc = fresh();
    const before = JSON.stringify(doc.deviceTemplates);
    movePort(P, 'sw', 'lan-l-1', 'top', 80)(doc);
    expect(JSON.stringify(doc.deviceTemplates)).toBe(before);
  });

  it('ほかのポートと同じ場所へは動かせず、状態も変わらない', () => {
    const doc = fresh();
    movePort(P, 'sw', 'lan-l-1', 'top', 80)(doc);
    const snapshot = JSON.stringify(doc);
    const r = movePort(P, 'sw', 'lan-l-2', 'top', 80)(doc);
    expect(r).toMatchObject({ ok: false, error: 'position-occupied' });
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('自動配置の他ポートの場所にも動かせない', () => {
    const doc = fresh();
    const other = at(doc, 'lan-l-2');
    const r = movePort(P, 'sw', 'lan-l-1', other.side, other.y)(doc);
    expect(r).toMatchObject({ ok: false, error: 'position-occupied' });
    expect(sw(doc).portPlacements).toBeUndefined();
  });

  it('存在しないページ・機器・ポート・値は失敗する', () => {
    const doc = fresh();
    expect(movePort('x', 'sw', 'lan-l-1', 'top', 80)(doc).error).toBe('unknown-page');
    expect(movePort(P, 'nope', 'lan-l-1', 'top', 80)(doc).error).toBe('unknown-node');
    expect(movePort(P, 'sw', 'nope', 'top', 80)(doc).error).toBe('unknown-port');
    expect(movePort(P, 'sw', 'lan-l-1', 'top', Number.NaN)(doc).error).toBe('invalid-value');
    expect(movePort(P, 'sw', 'lan-l-1', 'middle' as never, 10)(doc).error).toBe('invalid-value');
  });

  it('接続は、ポートを動かしても保たれる(ポートIDで結ばれている)', () => {
    const doc = fresh();
    const edges = JSON.stringify(doc.pages[0].edges);
    movePort(P, 'sw', 'lan-l-1', 'bottom', 100)(doc);
    expect(JSON.stringify(doc.pages[0].edges)).toBe(edges);
  });

  it('動かした結果のドキュメントは検証を通る', () => {
    const doc = fresh();
    movePort(P, 'sw', 'lan-l-1', 'bottom', 100)(doc);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual({ ok: true, errors: [] });
  });
});

describe('clearPortPlacements / ポート構成の変更との関係', () => {
  it('自動配置へ戻すと、位置指定が消える', () => {
    const doc = fresh();
    movePort(P, 'sw', 'lan-l-1', 'bottom', 100)(doc);
    expect(clearPortPlacements(P, 'sw')(doc).ok).toBe(true);
    expect(sw(doc).portPlacements).toBeUndefined();
  });

  it('ポートを減らすと、なくなったポートの位置指定も消える', () => {
    const doc = fresh();
    movePort(P, 'sw', 'lan-l-7', 'bottom', 100)(doc);
    const node = sw(doc);
    const groups = structuredClone(doc.deviceTemplates.find((t) => t.id === node.templateId)!.portGroups);
    const left = groups.find((g) => g.id === 'lan-l')!;
    left.count = 2;
    const r = setPortGroups(P, 'sw', groups, { removeOrphanEdges: true })(doc);
    expect(r.ok).toBe(true);
    expect(node.portPlacements).toBeUndefined();
  });
});

describe('validateDocument: portPlacements', () => {
  it('存在しないポートを指す位置指定は検出される', () => {
    const doc = fresh();
    sw(doc).portPlacements = { ghost: { side: 'top', pos: 10 } };
    const r = validateDocument(JSON.parse(JSON.stringify(doc)));
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('ghost');
  });

  it('辺の値や位置が不正なものは検出される', () => {
    const doc = fresh();
    sw(doc).portPlacements = { 'lan-l-1': { side: 'middle' as never, pos: 10 } };
    expect(validateDocument(JSON.parse(JSON.stringify(doc))).ok).toBe(false);
    sw(doc).portPlacements = { 'lan-l-1': { side: 'top', pos: 'x' as never } };
    expect(validateDocument(JSON.parse(JSON.stringify(doc))).ok).toBe(false);
  });
});
