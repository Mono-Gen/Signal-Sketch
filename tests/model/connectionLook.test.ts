import { describe, expect, it } from 'vitest';
import { connectionLook, planConnectionColors } from '../../src/model/diagnostics';
import type { DiagramDocument, SignalType } from '../../src/model/types';

// LAN(親)の下に CTRL と DANTE(サブ)、別系統に HDMI
const SIGNALS: SignalType[] = [
  { id: 'LAN', label: 'LAN', color: '#00aa00' },
  { id: 'CTRL', label: 'CTRL', color: '#aa0055', parent: 'LAN' },
  { id: 'DANTE', label: 'DANTE', color: '#0055aa', parent: 'LAN' },
  { id: 'HDMI', label: 'HDMI', color: '#555555' },
];

describe('connectionLook(線と両端のポートの色を決める信号)', () => {
  it('親とサブの接続は、引く向きによらず、サブの色にそろえる', () => {
    expect(connectionLook(SIGNALS, 'LAN', 'CTRL')).toEqual({ line: 'CTRL', ports: 'CTRL' });
    expect(connectionLook(SIGNALS, 'CTRL', 'LAN')).toEqual({ line: 'CTRL', ports: 'CTRL' });
  });

  it('同じ信号どうしは、その信号のまま', () => {
    expect(connectionLook(SIGNALS, 'LAN', 'LAN')).toEqual({ line: 'LAN', ports: 'LAN' });
    expect(connectionLook(SIGNALS, 'CTRL', 'CTRL')).toEqual({ line: 'CTRL', ports: 'CTRL' });
  });

  it('同じ親のサブどうしは、引き始めた側の色', () => {
    expect(connectionLook(SIGNALS, 'CTRL', 'DANTE')).toEqual({ line: 'CTRL', ports: 'CTRL' });
    expect(connectionLook(SIGNALS, 'DANTE', 'CTRL')).toEqual({ line: 'DANTE', ports: 'DANTE' });
  });

  it('系統が違う接続は、線は引き始めた側の色、ポートは自分の色のまま(合わせない)', () => {
    expect(connectionLook(SIGNALS, 'LAN', 'HDMI')).toEqual({ line: 'LAN', ports: null });
    expect(connectionLook(SIGNALS, 'CTRL', 'HDMI')).toEqual({ line: 'CTRL', ports: null });
  });

  it('信号の定義が見つからなくても落ちず、引き始めた側にする', () => {
    expect(connectionLook(SIGNALS, 'X', 'LAN')).toEqual({ line: 'X', ports: null });
  });
});

function docWith(edges: [string, string, string, string][]): DiagramDocument {
  const grp = (id: string, sig: string) => ({ id, signalType: sig, direction: 'inout' as const, side: 'right' as const, count: 4, labelPrefix: 'P' });
  return {
    format: 'system-diagram', version: 1, language: 'ja', grid: { size: 10, enabled: true },
    signalTypes: SIGNALS, assets: {},
    deviceTemplates: [{ id: 't', name: 'T', kind: 'generic', portGroups: [] }],
    pages: [{
      id: 'page-1', name: 'P', size: { w: 800, h: 600 }, groups: [],
      nodes: [
        { id: 'sw', templateId: 't', label: 'SW', model: '', x: 0, y: 0, w: 100, h: 60, portGroupsOverride: [grp('g', 'LAN')] },
        { id: 'a', templateId: 't', label: 'A', model: '', x: 200, y: 0, w: 100, h: 60, portGroupsOverride: [grp('g', 'CTRL')] },
        { id: 'b', templateId: 't', label: 'B', model: '', x: 200, y: 100, w: 100, h: 60, portGroupsOverride: [grp('g', 'DANTE')] },
      ],
      edges: edges.map(([fn, fp, tn, tp], i) => ({ id: `e${i}`, from: { nodeId: fn, portId: fp }, to: { nodeId: tn, portId: tp } })),
    }],
  } as unknown as DiagramDocument;
}

describe('planConnectionColors', () => {
  it('SWのポートは、つながる先のサブの色になる(PC側から引いても同じ)', () => {
    const doc = docWith([['a', 'g-1', 'sw', 'g-1'], ['sw', 'g-2', 'b', 'g-1']]);
    const plan = planConnectionColors(doc, doc.pages[0].edges);
    expect(plan.lineSignal.get('e0')).toBe('CTRL');
    expect(plan.lineSignal.get('e1')).toBe('DANTE');
    expect(plan.portSignal.get('sw/g-1')).toBe('CTRL');
    expect(plan.portSignal.get('sw/g-2')).toBe('DANTE');
    expect(plan.portSignal.get('a/g-1')).toBe('CTRL');
  });

  it('1つのポートに色の違う線が複数あるときは、ポートの色を合わせない', () => {
    const doc = docWith([['a', 'g-1', 'sw', 'g-1'], ['sw', 'g-1', 'b', 'g-1']]);
    const plan = planConnectionColors(doc, doc.pages[0].edges);
    expect(plan.portSignal.has('sw/g-1')).toBe(false);
  });

  it('未接続のポートは含まれない', () => {
    const doc = docWith([['a', 'g-1', 'sw', 'g-1']]);
    expect(planConnectionColors(doc, doc.pages[0].edges).portSignal.has('sw/g-4')).toBe(false);
  });
});
