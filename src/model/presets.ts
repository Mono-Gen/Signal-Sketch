import type { DeviceTemplate, PortGroup, Shape } from './types';

/**
 * 標準の機器(設計書 5.3 のプリセット)。名称は画面側で言語に応じて付ける。
 * 図に追加するとき、テンプレートとして図のドキュメントへコピーされる。
 */
export interface PresetDef {
  id: string;
  kind: string;
  shape: Shape;
  portGroups: PortGroup[];
}

const g = (
  id: string,
  signalType: string,
  direction: PortGroup['direction'],
  side: PortGroup['side'],
  count: number,
  labelPrefix: string,
): PortGroup => ({ id, signalType, direction, side, count, labelPrefix });

const lan = (side: PortGroup['side'], count = 1): PortGroup => g('lan', 'LAN', 'inout', side, count, 'LAN ');

const sw = (n: number): PresetDef => ({
  id: `switch${n}`,
  kind: 'switch',
  shape: 'roundRect',
  portGroups: [lan('bottom', n)],
});

export const PRESETS: readonly PresetDef[] = [
  { id: 'generic', kind: 'generic', shape: 'roundRect', portGroups: [lan('left')] },
  { id: 'pc', kind: 'pc', shape: 'roundRect', portGroups: [lan('left'), g('hdmi', 'HDMI', 'out', 'right', 1, 'HDMI '), g('usb', 'USB', 'out', 'right', 1, 'USB ')] },
  { id: 'panel', kind: 'panel', shape: 'roundRect', portGroups: [lan('left')] },
  { id: 'camera', kind: 'camera', shape: 'roundRect', portGroups: [lan('left'), g('hdmi', 'HDMI', 'out', 'right', 1, 'HDMI ')] },
  { id: 'mic', kind: 'mic', shape: 'roundRect', portGroups: [lan('left')] },
  { id: 'speaker', kind: 'speaker', shape: 'roundRect', portGroups: [g('audio', 'AUDIO', 'in', 'left', 1, 'IN ')] },
  { id: 'amp', kind: 'amp', shape: 'roundRect', portGroups: [lan('left'), g('audio', 'AUDIO', 'in', 'left', 2, 'IN '), g('audio-out', 'AUDIO', 'out', 'right', 2, 'OUT ')] },
  { id: 'display', kind: 'display', shape: 'roundRect', portGroups: [g('hdmi', 'HDMI', 'in', 'left', 1, 'HDMI '), lan('left')] },
  { id: 'encoder', kind: 'generic', shape: 'roundRect', portGroups: [g('hdmi', 'HDMI', 'in', 'left', 1, 'HDMI '), g('usb', 'USB', 'in', 'left', 1, 'USB '), lan('right')] },
  { id: 'decoder', kind: 'generic', shape: 'roundRect', portGroups: [lan('left'), g('hdmi', 'HDMI', 'out', 'right', 1, 'HDMI ')] },
  sw(8),
  sw(16),
  sw(24),
  sw(48),
];

/** プリセットから図に取り込むテンプレートを作る。IDは `preset-<id>` で、再追加時に同じものを使う */
export function presetToTemplate(def: PresetDef, name: string): DeviceTemplate {
  return {
    id: presetTemplateId(def.id),
    name,
    kind: def.kind,
    shape: def.shape,
    portGroups: def.portGroups.map((p) => ({ ...p })),
  };
}

export function presetTemplateId(presetId: string): string {
  return `preset-${presetId}`;
}

export const isPresetTemplateId = (id: string): boolean => id.startsWith('preset-');
