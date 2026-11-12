import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../../src/model/defaults';
import { getNodePorts, layoutNodePorts } from '../../src/model/query';
import { MULTI_OUTLINE_GAP } from '../../src/model/portMarker';
import { addSignalType } from '../../src/model/signalActions';
import type { DiagramDocument, DiagramNode, PortGroup } from '../../src/model/types';
import { buildLookContext, edgeLook, portKey, portLook } from '../../src/view/portLook';
import { DARK_THEME, FLAT_THEME, signalColor } from '../../src/view/theme';

// 仕様: 空きは白抜き(塗り=テーマの空き色、枠=自分の信号色)、接続済みは線にそろえた色で塗る。
// 系統が違う接続や競合するポートは、接続済みでも自分の色のまま。座標は機器内の相対座標(機器の位置に依らない)。

const LAN = '#1a9850';
const HDMI = '#ff0000';

const grp = (id: string, signalType: string, side: PortGroup['side'], extra: Partial<PortGroup> = {}): PortGroup => ({ id, signalType, direction: 'inout', side, count: 1, labelPrefix: id.toUpperCase(), ...extra });

function node(id: string, x: number, groups: PortGroup[], extra: Partial<DiagramNode> = {}): DiagramNode {
  return { id, templateId: 'none', label: id, model: '', x, y: 50, w: 120, h: 80, portGroupsOverride: groups, ...extra };
}

function setup(nodes: DiagramNode[]): DiagramDocument {
  const doc = createEmptyDocument();
  doc.signalTypes = doc.signalTypes.filter((s) => s.id === 'LAN' || s.id === 'HDMI');
  doc.signalTypes.find((s) => s.id === 'LAN')!.color = LAN;
  doc.signalTypes.find((s) => s.id === 'HDMI')!.color = HDMI;
  // ポートは各機器の portGroupsOverride で与える(テンプレートは、機器から参照できればよい空のもの)
  doc.deviceTemplates = [{ id: 'none', name: 'none', kind: 'generic', shape: 'roundRect', portGroups: [] }];
  doc.pages[0].nodes = nodes;
  return doc;
}

/** 機器の最初のポートの見た目 */
function look(doc: DiagramDocument, nodeId: string, theme = FLAT_THEME, index = 0) {
  const n = doc.pages[0].nodes.find((v) => v.id === nodeId)!;
  const ctx = buildLookContext(doc, doc.pages[0].edges, theme);
  const port = getNodePorts(doc, n)[index];
  return portLook(ctx, n, layoutNodePorts(doc, n)[index], port);
}

const link = (doc: DiagramDocument, a: string, b: string, id = `${a}-${b}`) =>
  doc.pages[0].edges.push({ id, from: { nodeId: a, portId: `${a === 'a' ? 'x' : 'y'}-1` }, to: { nodeId: b, portId: `${b === 'a' ? 'x' : 'y'}-1` } });

describe('portLook', () => {
  it('空きのポートは白抜き(塗りは空き色、枠は自分の信号の色)', () => {
    const doc = setup([node('a', 0, [grp('x', 'LAN', 'left')])]);
    const p = look(doc, 'a');
    expect(p.connected).toBe(false);
    expect(p.fill).toBe(FLAT_THEME.portEmptyFill);
    expect(p.stroke).toBe(LAN);
    expect(p.outline).toBeUndefined();
    expect(p.label).toBeUndefined();
  });

  it('接続済みのポートは、信号色で塗りつぶす', () => {
    const doc = setup([node('a', 0, [grp('x', 'LAN', 'right')]), node('b', 300, [grp('y', 'LAN', 'left')])]);
    link(doc, 'a', 'b');
    const p = look(doc, 'a');
    expect(p.connected).toBe(true);
    expect(p.fill).toBe(LAN);
    expect(p.stroke).toBe(LAN);
  });

  it('同じ系統のサブ信号と接続したポートは、サブ信号の色にそろう(相手側のポートも)', () => {
    const doc = setup([node('a', 0, [grp('x', 'LAN', 'right')]), node('b', 300, [])]);
    const sub = addSignalType('SUB', '#000000', 'LAN')(doc).created!;
    const subColor = doc.signalTypes.find((s) => s.id === sub)!.color;
    doc.pages[0].nodes[1] = node('b', 300, [grp('y', sub, 'left')]);
    link(doc, 'a', 'b');
    expect(subColor).not.toBe(LAN);
    expect(look(doc, 'a').fill).toBe(subColor);
    expect(look(doc, 'b').fill).toBe(subColor);
  });

  it('系統が違う接続は、接続済みでもポート自身の色を保つ(警告が見えなくならないように)', () => {
    const doc = setup([node('a', 0, [grp('x', 'LAN', 'right')]), node('b', 300, [grp('y', 'HDMI', 'left')])]);
    link(doc, 'a', 'b');
    const a = look(doc, 'a');
    const b = look(doc, 'b');
    expect(a.connected).toBe(true);
    expect([a.fill, a.stroke]).toEqual([LAN, LAN]);
    expect([b.fill, b.stroke]).toEqual([HDMI, HDMI]);
  });

  it('複数接続のポートは、外接を MULTI_OUTLINE_GAP×2 だけ広げた外枠を持ち、枠線は塗りと同じ色', () => {
    const doc = setup([node('a', 0, [grp('x', 'LAN', 'left', { multi: true })])]);
    const p = look(doc, 'a');
    expect(p.outline).toEqual({ size: p.marker.size + 2 * MULTI_OUTLINE_GAP, stroke: LAN });
    expect(p.marker.size).toBe(doc.grid.size * FLAT_THEME.markerRatio);
  });

  it('番号は showPortLabels のときだけ。複数のポートがあるグループは番号だけ、位置は機器の位置に依らない', () => {
    const groups = [grp('x', 'LAN', 'left', { count: 3, labelPrefix: 'P', startNumber: 5 })];
    const near = setup([node('a', 0, groups, { showPortLabels: true })]);
    const far = setup([node('a', 700, groups, { showPortLabels: true })]);
    const off = setup([node('a', 0, groups)]);
    expect(look(near, 'a', FLAT_THEME, 1).label?.text).toBe('6');
    expect(look(off, 'a').label).toBeUndefined();
    const a = look(near, 'a', FLAT_THEME, 1);
    const b = look(far, 'a', FLAT_THEME, 1);
    expect(b.label).toEqual(a.label);
    expect(b.marker).toEqual(a.marker);
    expect(a.label!.align).toBe('left'); // 左辺のポートの番号は、マークの右(機器の内側)
    expect(a.label!.x).toBeGreaterThan(a.marker.cx);
  });

  it('ダークでは、信号色をテーマの用紙の上で見える色へ補正する(画面と書き出しで同じ補正)', () => {
    const doc = setup([node('a', 0, [grp('x', 'LAN', 'left')])]);
    doc.signalTypes.find((s) => s.id === 'LAN')!.color = '#000000';
    expect(look(doc, 'a', DARK_THEME).stroke).toBe(signalColor(DARK_THEME, '#000000'));
    expect(look(doc, 'a', DARK_THEME).stroke).not.toBe('#000000');
  });
});

describe('edgeLook', () => {
  it('線の信号は、サブ信号がある側にそろう', () => {
    const doc = setup([node('a', 0, [grp('x', 'LAN', 'right')]), node('b', 300, [])]);
    const sub = addSignalType('SUB', '#000000', 'LAN')(doc).created!;
    doc.pages[0].nodes[1] = node('b', 300, [grp('y', sub, 'left')]);
    link(doc, 'a', 'b', 'e1');
    const ctx = buildLookContext(doc, doc.pages[0].edges, FLAT_THEME);
    const e = edgeLook(ctx, 'e1', undefined);
    expect(e.signal?.id).toBe(sub);
    expect(e.color).toBe(doc.signalTypes.find((s) => s.id === sub)!.color);
  });

  it('計画にない線は、引き始めのポートの信号。それも無ければ灰色', () => {
    const doc = setup([node('a', 0, [grp('x', 'LAN', 'right')])]);
    const ctx = buildLookContext(doc, [], FLAT_THEME);
    const port = getNodePorts(doc, doc.pages[0].nodes[0])[0];
    expect(edgeLook(ctx, 'none', port).color).toBe(LAN);
    expect(edgeLook(ctx, 'none', undefined)).toEqual({ color: '#666666', signal: undefined });
  });
});

describe('portKey', () => {
  it('機器IDとポートIDを / でつなぐ(画面・書き出しの両方で同じキー)', () => {
    expect(portKey('n1', 'lan-1')).toBe('n1/lan-1');
  });
});
