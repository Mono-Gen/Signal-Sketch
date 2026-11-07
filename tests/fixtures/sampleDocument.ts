import { createEmptyDocument } from '../../src/model/defaults';
import type { DeviceTemplate, DiagramDocument, DiagramNode, PortGroup, Direction, Side } from '../../src/model/types';

// テストと、配布用サンプル(docs/sample_diagram.json)の元になる図。実在のメーカー名・製品名・型番は使わず、
// 型番は明らかに架空の Model-XX 形式にしてある。機器の位置・サイズはすべて10のグリッドの倍数。
// docs/sample_diagram.json を作り直すときは、この図を serializeDocument で書き出す(tests/sample/docsSample.test.ts が一致を確認する)。

const group = (id: string, signalType: string, direction: Direction, side: Side, count: number, labelPrefix: string): PortGroup => ({
  id,
  signalType,
  direction,
  side,
  count,
  labelPrefix,
});

const tpl = (id: string, name: string, kind: string, portGroups: PortGroup[]): DeviceTemplate => ({
  id,
  name,
  kind,
  shape: 'roundRect',
  portGroups,
});

const node = (id: string, templateId: string, label: string, model: string, x: number, y: number, w: number, h: number, count?: number): DiagramNode => ({
  id,
  templateId,
  label,
  model,
  x,
  y,
  w,
  h,
  ...(count ? { count } : {}),
});

export function createSampleDocument(): DiagramDocument {
  const doc = createEmptyDocument();
  doc.deviceTemplates = [
    tpl('panel-usb', 'Panel (USB)', 'panel', [group('usb', 'USB', 'out', 'right', 1, 'USB ')]),
    tpl('panel-lan', 'Panel (LAN)', 'panel', [group('lan', 'LAN', 'inout', 'right', 1, 'LAN ')]),
    tpl('pc-usb', 'PC (USB)', 'pc', [group('usb', 'USB', 'out', 'right', 1, 'USB ')]),
    tpl('encoder', 'Encoder', 'generic', [group('usb', 'USB', 'in', 'left', 1, 'USB '), group('lan', 'LAN', 'inout', 'right', 1, 'LAN ')]),
    tpl('decoder', 'Decoder', 'generic', [group('hdmi', 'HDMI', 'out', 'right', 1, 'HDMI '), group('lan', 'LAN', 'inout', 'bottom', 1, 'LAN ')]),
    tpl('minipc', 'Mini PC', 'pc', [
      group('usb', 'USB', 'in', 'top', 1, 'USB '),
      group('hdmi-in', 'HDMI', 'in', 'left', 1, 'HDMI IN '),
      group('hdmi-out', 'HDMI', 'out', 'right', 2, 'HDMI OUT '),
      group('lan', 'LAN', 'inout', 'bottom', 1, 'LAN '),
    ]),
    tpl('display', 'Display', 'display', [group('hdmi', 'HDMI', 'in', 'left', 1, 'HDMI ')]),
    tpl('switch', 'Network Switch', 'switch', [
      group('lan-l', 'LAN', 'inout', 'left', 8, 'L'),
      group('lan-r', 'LAN', 'inout', 'right', 8, 'R'),
      group('lan-t', 'LAN', 'inout', 'top', 2, 'T'),
      group('lan-b', 'LAN', 'inout', 'bottom', 4, 'B'),
    ]),
    tpl('controller', 'Controller', 'generic', [group('lan', 'LAN', 'inout', 'top', 1, 'LAN ')]),
    tpl('amp', 'Amplifier', 'amp', [group('lan', 'LAN', 'inout', 'top', 1, 'LAN '), group('audio', 'AUDIO', 'out', 'right', 1, 'OUT ')]),
    tpl('speaker', 'Speaker', 'speaker', [group('audio', 'AUDIO', 'in', 'left', 1, 'IN ')]),
    tpl('lan-left', 'LAN device', 'generic', [group('lan', 'LAN', 'inout', 'left', 1, 'LAN ')]),
    tpl('camera', 'PTZ Camera', 'camera', [group('lan', 'LAN', 'inout', 'left', 1, 'LAN ')]),
    tpl('mic', 'Ceiling Mic', 'mic', [group('lan', 'LAN', 'inout', 'right', 1, 'LAN ')]),
    // 空きポートを持つ機器(接続操作の確認用)
    tpl('free-ports', 'Access Point', 'generic', [group('lan', 'LAN', 'inout', 'left', 1, 'LAN '), group('audio', 'AUDIO', 'in', 'left', 1, 'AUDIO ')]),
  ];

  const page = doc.pages[0];
  page.nodes = [
    node('tap', 'panel-usb', 'USB Panel', '', 40, 70, 120, 50),
    node('mute', 'panel-lan', 'Mute Button', 'Model-A2', 40, 140, 120, 100, 4),
    node('tsc', 'panel-lan', 'Control Touch Panel', 'Model-A3', 40, 260, 120, 60),
    node('lap', 'pc-usb', 'Laptop PC', '', 40, 350, 120, 50),
    node('enc', 'encoder', 'Encoder', 'Model-B1', 210, 350, 110, 50),
    node('dec', 'decoder', 'Decoder', 'Model-B2', 500, 130, 120, 60),
    node('mini', 'minipc', 'Mini PC', 'Model-C1', 700, 130, 130, 60),
    node('d1', 'display', '98" Display', 'Model-D1', 980, 100, 140, 70),
    node('d2', 'display', '98" Display', 'Model-D1', 980, 190, 140, 70),
    node('sw', 'switch', 'Network Switch', 'Model-E1', 560, 380, 260, 130),
    node('ctl', 'controller', 'Controller', 'Model-F1', 730, 540, 140, 50),
    node('amp', 'amp', 'Amplifier', 'Model-G1', 560, 580, 140, 50),
    node('spk', 'speaker', 'Ceiling Speaker', 'Model-H1', 1000, 490, 140, 140, 6),
    node('ptz', 'camera', 'PTZ Camera', 'Model-J1', 1000, 360, 140, 50),
    node('aif', 'lan-left', 'Audio IF', 'Model-K1', 1000, 420, 140, 50),
    node('mic', 'mic', 'Ceiling Mic', 'Model-L1', 60, 520, 140, 50),
    node('ap', 'free-ports', 'Access Point', 'Model-M1', 1000, 650, 140, 60),
  ];

  const e = (id: string, a: string, ap: string, b: string, bp: string) => ({
    id,
    from: { nodeId: a, portId: ap },
    to: { nodeId: b, portId: bp },
  });
  page.edges = [
    e('e-1', 'tap', 'usb-1', 'mini', 'usb-1'),
    e('e-2', 'dec', 'hdmi-1', 'mini', 'hdmi-in-1'),
    e('e-3', 'mini', 'hdmi-out-1', 'd1', 'hdmi-1'),
    e('e-4', 'mini', 'hdmi-out-2', 'd2', 'hdmi-1'),
    e('e-5', 'mute', 'lan-1', 'sw', 'lan-l-1'),
    e('e-6', 'tsc', 'lan-1', 'sw', 'lan-l-2'),
    e('e-7', 'enc', 'lan-1', 'sw', 'lan-l-3'),
    e('e-8', 'mic', 'lan-1', 'sw', 'lan-l-4'),
    e('e-9', 'lap', 'usb-1', 'enc', 'usb-1'),
    e('e-10', 'dec', 'lan-1', 'sw', 'lan-t-1'),
    e('e-11', 'mini', 'lan-1', 'sw', 'lan-t-2'),
    e('e-12', 'sw', 'lan-r-1', 'ptz', 'lan-1'),
    e('e-13', 'sw', 'lan-r-2', 'aif', 'lan-1'),
    e('e-14', 'sw', 'lan-b-1', 'ctl', 'lan-1'),
    e('e-15', 'sw', 'lan-b-2', 'amp', 'lan-1'),
    e('e-16', 'amp', 'audio-1', 'spk', 'audio-1'),
  ];

  page.groups = [
    { id: 'g-table', label: 'Table', x: 20, y: 40, w: 320, h: 390 },
    { id: 'g-behind', label: 'Behind Display', x: 470, y: 70, w: 400, h: 210 },
    { id: 'g-rack', label: 'Rack', x: 500, y: 300, w: 420, h: 380 },
  ];
  return doc;
}
