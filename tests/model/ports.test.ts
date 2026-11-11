import { describe, expect, it } from 'vitest';
import { expandPortGroups, findPort, portId, portLabel, resolvePortGroups } from '../../src/model/ports';
import { validateDocument } from '../../src/model/validate';
import { createSampleDocument } from '../fixtures/sampleDocument';
import type { DeviceTemplate, DiagramNode, PortGroup } from '../../src/model/types';

const lan = (count: number, over: Partial<PortGroup> = {}): PortGroup => ({
  id: 'lan',
  signalType: 'LAN',
  direction: 'inout',
  side: 'left',
  count,
  labelPrefix: 'LAN ',
  ...over,
});

describe('expandPortGroups', () => {
  it('開始番号を表示し、不正な開始番号を拒否する', () => {
    expect(expandPortGroups([lan(3, { startNumber: 0 })]).map((p) => p.label)).toEqual(['LAN 0', 'LAN 1', 'LAN 2']);
    for (const startNumber of [-1, 10000, 1.5]) expect(() => expandPortGroups([lan(3, { startNumber })])).toThrow();
    expect(expandPortGroups([lan(2, { startNumber: 9999 })])[1].label).toBe('LAN 10000');
    const doc = createSampleDocument();
    doc.deviceTemplates[0].portGroups[0].startNumber = 10000;
    expect(validateDocument(doc).ok).toBe(false);
  });
  it('グループを「グループID-番号」のポートへ展開する(番号は1始まり)', () => {
    const ports = expandPortGroups([lan(3)]);
    expect(ports.map((p) => p.id)).toEqual(['lan-1', 'lan-2', 'lan-3']);
    expect(ports.map((p) => p.label)).toEqual(['LAN 1', 'LAN 2', 'LAN 3']);
    expect(ports[0]).toMatchObject({ groupId: 'lan', index: 1, signalType: 'LAN', direction: 'inout', side: 'left' });
  });

  it('複数グループは宣言順に並び、各グループの属性を保つ', () => {
    const ports = expandPortGroups([lan(2), lan(1, { id: 'hdmi', signalType: 'HDMI', direction: 'in', side: 'right', labelPrefix: 'HDMI ' })]);
    expect(ports.map((p) => p.id)).toEqual(['lan-1', 'lan-2', 'hdmi-1']);
    expect(ports[2]).toMatchObject({ signalType: 'HDMI', direction: 'in', side: 'right', label: 'HDMI' }); // ポートが1つだけのグループは番号なし
  });

  it('個数0は空配列(ポートなし)', () => {
    expect(expandPortGroups([lan(0)])).toEqual([]);
  });

  it('個数が負・小数・NaNなら例外(黙って直さない)', () => {
    expect(() => expandPortGroups([lan(-1)])).toThrow(RangeError);
    expect(() => expandPortGroups([lan(1.5)])).toThrow(RangeError);
    expect(() => expandPortGroups([lan(Number.NaN)])).toThrow(RangeError);
  });

  it('グループIDが重複したら例外(ポートIDが衝突するため)', () => {
    expect(() => expandPortGroups([lan(2), lan(3)])).toThrow(/重複/);
  });

  it('48ポートでも全て一意なIDになる', () => {
    const ids = expandPortGroups([lan(48)]).map((p) => p.id);
    expect(new Set(ids).size).toBe(48);
  });
});

describe('portId / findPort', () => {
  it('portId は「グループID-番号」', () => {
    expect(portId('lan', 12)).toBe('lan-12');
  });

  it('findPort は存在すれば返し、なければ undefined', () => {
    const ports = expandPortGroups([lan(2)]);
    expect(findPort(ports, 'lan-2')?.index).toBe(2);
    expect(findPort(ports, 'lan-3')).toBeUndefined();
  });
});

describe('resolvePortGroups: 機器ごとの上書きが優先', () => {
  const template: DeviceTemplate = {
    id: 'sw',
    name: 'Switch',
    kind: 'switch',
    shape: 'rect',
    portGroups: [lan(24)],
  };
  const base: DiagramNode = { id: 'n1', templateId: 'sw', label: 'SW', model: '', x: 0, y: 0, w: 260, h: 60 };

  it('上書きなしならテンプレートの構成', () => {
    expect(resolvePortGroups(template, base)).toBe(template.portGroups);
  });

  it('上書きありなら上書きの構成(例: 24ポート→48ポート)', () => {
    const groups = [lan(48)];
    expect(resolvePortGroups(template, { ...base, portGroupsOverride: groups })).toBe(groups);
  });
});

describe('portLabel(表示名の番号)', () => {
  it('ポートが1つだけのグループは、番号を付けない', () => {
    expect(portLabel({ labelPrefix: 'LAN ', count: 1 }, 1)).toBe('LAN');
    expect(portLabel({ labelPrefix: 'IN', count: 1 }, 1)).toBe('IN');
  });

  it('2つ以上なら「表示名+番号」', () => {
    expect(portLabel({ labelPrefix: 'LAN ', count: 24 }, 24)).toBe('LAN 24');
    expect(portLabel({ labelPrefix: 'OUT ', count: 2 }, 1)).toBe('OUT 1');
  });

  it('表示名が空で1つだけのときは、空にせず番号を使う', () => {
    expect(portLabel({ labelPrefix: '  ', count: 1 }, 1)).toBe('1');
    expect(portLabel({ labelPrefix: '', count: 3 }, 2)).toBe('2');
  });

  it('展開したポートのIDは、番号の有無に関わらず従来どおり(保存済みの接続が切れない)', () => {
    const ports = expandPortGroups([{ id: 'lan', signalType: 'LAN', direction: 'inout', side: 'left', count: 1, labelPrefix: 'LAN ' }]);
    expect(ports.map((p) => p.id)).toEqual(['lan-1']);
    expect(ports[0].label).toBe('LAN');
  });
});

it('短い表示名: 複数ポートのグループは番号だけ(開始番号を反映)、1つだけのグループは名前のまま', () => {
  const ports = expandPortGroups([
    { id: 'a', signalType: 'LAN', direction: 'inout', side: 'bottom', count: 3, labelPrefix: 'LAN', startNumber: 5 },
    { id: 'b', signalType: 'HDMI', direction: 'in', side: 'left', count: 1, labelPrefix: 'HDMI' },
  ]);
  expect(ports.map((p) => p.shortLabel)).toEqual(['5', '6', '7', 'HDMI']);
  expect(ports.map((p) => p.label)).toEqual(['LAN5', 'LAN6', 'LAN7', 'HDMI']);
});
