import { CURRENT_VERSION, DOCUMENT_FORMAT } from './types';
import type { DiagramDocument, SignalType } from './types';

/** 標準の信号種別(設計書 D8)。色・名称はユーザーが後から編集できる前提の初期値 */
export const DEFAULT_SIGNAL_TYPES: readonly SignalType[] = [
  { id: 'LAN', label: 'LAN', color: '#1a9850' },
  { id: 'CONTROL', label: 'CONTROL', color: '#f0b400' },
  { id: 'HDMI', label: 'HDMI', color: '#6f8fd0' },
  { id: 'USB', label: 'USB', color: '#7b4fa0' },
  { id: 'AUDIO', label: 'AUDIO', color: '#ff6fa8' },
];

/** ページの基準サイズ(16:9。設計書 D4) */
const PAGE_SIZE = { w: 1280, h: 720 } as const;

export function createEmptyDocument(): DiagramDocument {
  return {
    format: DOCUMENT_FORMAT,
    version: CURRENT_VERSION,
    language: 'ja',
    grid: { size: 10, enabled: true },
    signalTypes: DEFAULT_SIGNAL_TYPES.map((s) => ({ ...s })),
    deviceTemplates: [],
    assets: {},
    pages: [
      {
        id: 'page-1',
        name: 'Page 1',
        size: { ...PAGE_SIZE },
        nodes: [],
        edges: [],
        groups: [],
      },
    ],
  };
}
